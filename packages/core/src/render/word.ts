import * as THREE from 'three';
import { EffectFrame, planEffects } from '../effects/frame.js';
import type { EffectSpec, FrameCtx, PartInfo, PartKind, ResolvedOffset } from '../effects/types.js';
import { blankPose } from '../motion/compositor.js';
import type { RegroupResult } from '../motion/sequence.js';
import type { LetterInfo } from '../motion/types.js';
import type { Pose } from '../pose.js';
import type { LoadedFont } from '../text/font.js';
import { DEFAULT_GLYPH_OPTIONS, EM, glyphToShapes } from '../text/glyphs.js';
import type { Budget, GlyphMetrics } from '../text/layout.js';
import { LINE_HEIGHT_EM, layoutRunsForKlieg, UNBOUNDED, wrapRuns } from '../text/layout.js';
import {
  type Arrangement,
  arrange,
  type Fit,
  fitOf,
  type GlyphBounds,
  placeBlock,
} from '../text/placement.js';
import { styledRunsOf, type TextRun } from '../text/runs.js';
import type { Transform } from '../transform.js';
import { WordCaches } from './caches.js';
import type { DecorationBuilder, DecorationPart } from './decorations/registry.js';
import { decorationBuilderFor } from './decorations/registry.js';
import { seedFlake } from './flake.js';
import {
  applyLook,
  createMaterial,
  type FrameOwnedBase,
  frameOwnedBase,
  type LightBase,
  type Look,
  type LookSpec,
  lightBase,
  litEmissive,
  setEmissiveIntensity,
  specOf,
  tintMaterialOf,
} from './looks.js';

/**
 * Lab-only diagnostic hooks (see debug.ts). `Word` owns per-letter layout and holds the decoration
 * builder these reach, so a debug view plugs in here rather than re-deriving either outside core.
 * `createKlieg` never supplies one, so every real caller is unaffected.
 */
export interface WordDebugHooks {
  /** Overrides a tube decoration's lit or dark run material; undefined keeps the normal one. */
  tubeMaterial?(which: 'lit' | 'dark'): THREE.Material | undefined;
  /** Called once per drawn letter with its own transformed group, outline shapes, and extrude depth. */
  onLetter?(cell: THREE.Group, shapes: THREE.Shape[], depth: number): void;
}

/** One group per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
/** The ink bounding box of a word's part pool, in its own layout space. */
export interface WordExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class Word {
  readonly group = new THREE.Group();
  /** Sits between `group` (the viewport fit) and the letters — see the `transform` accessor. */
  private readonly inner = new THREE.Group();
  private readonly sizeOf: ((slot: number) => number) | undefined;
  private readonly family: string;
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Group | null)[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  readonly baseX: number[] = [];
  /** Layout y per letter, for the same reason: pose y adds onto it, or the lines stack up. */
  readonly baseY: number[] = [];
  private readonly lineOf: number[] = [];
  private readonly columnOf: number[] = [];
  /** Every glyph's character, so a regroup can lay the survivors out again. */
  private readonly charOf: string[] = [];
  /** Per-letter ink bounds in em, relative to the glyph origin; null where it drew nothing. */
  private readonly geoMinY: (number | null)[] = [];
  private readonly geoMaxY: (number | null)[] = [];
  private readonly geoMinX: (number | null)[] = [];
  private readonly geoMaxX: (number | null)[] = [];
  private readonly metrics: GlyphMetrics;

  /** The studio, carried onto every material so each look's own `envMapIntensity` is honoured. */
  private readonly envMap: THREE.Texture | null;
  /** Every material this word made carrying the studio, so a lighting turn can reach them all. */
  private readonly envMaterials: THREE.MeshPhysicalMaterial[] = [];
  private readonly budget: Budget;
  private fit: Fit;
  /** The fit before the last regroup; `setFitProgress` interpolates between this and `fitTo`. */
  private fitFrom: Fit;
  private fitTo: Fit;
  /** Reading position within the live group; a regroup renumbers it. */
  private readonly idxOf: number[] = [];
  /** Set on a letter a regroup dropped; its info stops tracking the live group. */
  private readonly frozenInfo: (LetterInfo | null)[] = [];
  /** Bumped by every regroup, so a DOM layer can tell it is built against a stale layout. */
  layoutVersion = 0;
  lineCount: number;
  private columnCount: number;
  /** Letters still in the group — not `letters.length`, which counts the retired ones too. */
  private liveCount = 0;
  /** Indexed by letter slot, null where the glyph drew no outline. */
  private readonly bodyMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
  private readonly bodyLights: (LightBase | null)[] = [];
  /** Indexed by letter slot; a slot whose glyph drew no outline is a hole. */
  private readonly bodyMeshes: (THREE.Mesh | null)[] = [];
  /** The word-wide part pool: body parts, then the decoration's own. */
  private readonly parts: PartInfo[] = [];
  private readonly partMeshes: THREE.Mesh[] = [];
  /** Per part, the letter slot it hangs off, so a retired letter's parts can be left alone. */
  private readonly partSlot: number[] = [];
  /** The decoration's own parts as its builder handed them over, offset by `decorFrom`. */
  private readonly decorParts: DecorationPart[] = [];
  /** Where the decoration's own parts start in the pool; they run to its end. */
  private decorFrom = Number.POSITIVE_INFINITY;
  /** Planned once from the specs; holds the per-frame layer buffers. Null until built. */
  private effectFrame: EffectFrame | null = null;
  readonly font: LoadedFont;
  readonly caches: WordCaches;
  readonly debug?: WordDebugHooks;
  /** Set only where this word made its own caches, and so is the one that disposes them. */
  private readonly ownsCaches: boolean;
  /** The decoration's own builder, or null where the look carries no decoration. */
  private readonly builder: DecorationBuilder | null;
  private readonly pose = blankPose();
  /**
   * The body's frame-owned base. `Word` is its only writer, and seeds it at construction:
   * a word before its first frame is a word at rest.
   */
  private readonly bodyBase: FrameOwnedBase;
  private disposed = false;

  constructor(
    text: string | TextRun[],
    font: LoadedFont,
    look: Look,
    budget: Budget,
    wrap = false,
    tint?: number | ((letter: LetterInfo) => number | undefined),
    debug?: WordDebugHooks,
    envMap: THREE.Texture | null = null,
    caches?: WordCaches,
    sizeOf?: (slot: number) => number,
    family?: string,
  ) {
    this.sizeOf = sizeOf;
    this.family = family ?? font.family;
    this.envMap = envMap;
    this.group.add(this.inner);

    const spec = specOf(look);
    this.bodyBase = frameOwnedBase(spec);

    this.font = font;
    this.debug = debug;
    this.ownsCaches = !caches;
    this.caches = caches ?? new WordCaches();

    this.builder = decorationBuilderFor(spec.decoration, this);

    const runs = styledRunsOf(text, this.family);
    const laid = wrap
      ? wrapRuns(runs, budget, this.layoutOpts())
      : layoutRunsForKlieg(runs, this.layoutOpts());

    this.metrics = font.metrics;
    this.budget = budget;

    const placed = placeBlock(laid, (char) => this.drawsInk(char), budget.lineEdge);
    this.lineCount = placed.lineCount;
    this.columnCount = placed.columnCount;

    // Bounds for every glyph first: the fit has to be settled before any cell is built.
    for (let i = 0; i < placed.x.length; i++) {
      const char = placed.char[i] as string;
      const geo = this.glyph(char, DEFAULT_GLYPH_OPTIONS.depth);
      const drawn = geo.attributes.position?.count ? geo.boundingBox : null;
      this.charOf.push(char);
      this.baseX.push(placed.x[i] as number);
      this.baseY.push(placed.y[i] as number);
      this.lineOf.push(placed.line[i] as number);
      this.columnOf.push(placed.column[i] as number);
      this.idxOf.push(i);
      this.frozenInfo.push(null);
      this.geoMinX.push(drawn ? drawn.min.x : null);
      this.geoMaxX.push(drawn ? drawn.max.x : null);
      this.geoMinY.push(drawn ? drawn.min.y : null);
      this.geoMaxY.push(drawn ? drawn.max.y : null);
    }
    this.liveCount = placed.x.length;
    this.fit = fitOf(placed, this.glyphBounds(), budget);
    this.fitFrom = this.fit;
    this.fitTo = this.fit;
    this.applyFit(this.fit);

    for (let i = 0; i < this.charOf.length; i++) {
      this.buildCell(i, font, look, spec, tint, debug);
    }
    this.setGradientBounds();
    this.buildParts();
    this.buildEffects(spec.effects ?? []);
  }

  /**
   * The word-wide pool of addressable parts, built once every letter exists. Word-wide rather than
   * per letter: `{ count: 1 }` picks one bad tube in the sign, not one in every letter.
   *
   * A construction-time snapshot. `regroup` re-lays the letters and leaves the pool alone, so a
   * part keeps the index its effect resolved against and the layout it was built with — a letter
   * a regroup drops takes its parts out of play rather than renumbering the pool under an effect
   * already running against it.
   */
  private buildParts(): void {
    const bodies: number[] = [];
    for (let i = 0; i < this.charOf.length; i++) {
      if (this.bodyMeshes[i]) bodies.push(i);
    }
    for (let n = 0; n < bodies.length; n++) {
      const i = bodies[n] as number;
      this.parts.push(
        this.partInfo('body', n, bodies.length, i, n / bodies.length, 1 / bodies.length),
      );
      this.partMeshes.push(this.bodyMeshes[i] as THREE.Mesh);
      this.partSlot.push(i);
    }

    this.decorFrom = this.parts.length;
    for (const part of this.builder?.collectParts() ?? []) {
      this.parts.push(part.info);
      this.partMeshes.push(part.mesh);
      this.partSlot.push(part.slot);
      this.decorParts.push(part);
    }
  }

  /**
   * A part carries its letter's grid position: `orderKey` reads `column` to decide whether a
   * radial stagger is even possible, and a part without one silently falls back to reading order.
   */
  partInfo(
    kind: PartKind,
    index: number,
    count: number,
    slot: number,
    at: number,
    span: number,
    ink: PartInfo['ink'] = this.inkOf(slot),
    fill?: string,
  ): PartInfo {
    return {
      kind,
      fill,
      index,
      count,
      letter: this.letterInfo(slot),
      x: this.baseX[slot] as number,
      y: this.baseY[slot] as number,
      ink,
      line: this.lineOf[slot] as number,
      column: this.columnOf[slot] as number,
      lineCount: this.lineCount,
      columnCount: this.columnCount,
      at,
      span,
    };
  }

  /**
   * One run's own drawn bounds, rather than its letter's. The tube meshes are built in the same
   * letter-local space the glyph geometry is, and carry no position of their own, so the letter's
   * origin places them the same way. Unlike the glyph's box this includes the tube's radius.
   */
  meshInk(slot: number, mesh: THREE.Mesh): PartInfo['ink'] {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return this.inkOf(slot);
    const x = this.baseX[slot] as number;
    const y = this.baseY[slot] as number;
    return {
      minX: x + box.min.x,
      maxX: x + box.max.x,
      minY: y + box.min.y,
      maxY: y + box.max.y,
    };
  }

  /** A letter's drawn bounds in layout space. A glyph with no outline collapses to its origin. */
  private inkOf(slot: number): PartInfo['ink'] {
    const x = this.baseX[slot] as number;
    const y = this.baseY[slot] as number;
    return {
      minX: x + (this.geoMinX[slot] ?? 0),
      maxX: x + (this.geoMaxX[slot] ?? 0),
      minY: y + (this.geoMinY[slot] ?? 0),
      maxY: y + (this.geoMaxY[slot] ?? 0),
    };
  }

  /** The fit placing the word in the frustum. `projectLetters` maps out through it and
   * `layoutFromNdc` maps back in, so both read the same one. */
  get placement(): Fit {
    return { ...this.fit };
  }

  /** The word's parts of one kind, in pool order. */
  partsOf(kind: PartKind): readonly PartInfo[] {
    return this.parts.filter((p) => p.kind === kind);
  }

  /**
   * The ink bounding box of the part pool in layout space, or null before any part exists.
   * Describes the pool as built: `regroup` re-lays the letters and leaves the pool alone.
   *
   * Each glyph's own bounds are folded in the way `fitOf` does. A box of origins alone would have
   * zero height on a single-line sign, since every letter on a line shares its baseline.
   */
  partExtent(): WordExtent | null {
    if (this.parts.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.parts.length; i++) {
      const ink = (this.parts[i] as PartInfo).ink;
      minX = Math.min(minX, ink.minX);
      maxX = Math.max(maxX, ink.maxX);
      minY = Math.min(minY, ink.minY);
      maxY = Math.max(maxY, ink.maxY);
    }
    return { minX, maxX, minY, maxY };
  }

  /**
   * Resolves each effect against the pool once. Selection is seeded and stable, so doing it per
   * frame would pick the same parts at the cost of re-selecting and re-allocating every frame.
   */
  private buildEffects(specs: readonly EffectSpec[]): void {
    this.effectFrame = specs.length > 0 ? new EffectFrame(planEffects(specs, this.parts)) : null;
  }

  /**
   * Layers every effect that reached a part, then writes each targeted part once. A part whose
   * letter a regroup dropped is skipped: it is playing its exit against a pool position that no
   * longer describes it, and the mesh it would write is on its way off screen.
   */
  private applyEffects(elapsed: number, ctx: FrameCtx): void {
    const resolved = this.effectFrame?.resolve(this.parts, elapsed, ctx, (index) =>
      this.retiredPart(index),
    );
    if (!resolved) return;
    for (const [index, out] of resolved) this.writePart(index, out);
  }

  private retiredPart(index: number): boolean {
    return this.leavingAt(this.partSlot[index] as number);
  }

  /**
   * A part's own share of its family's material. Transform lands on the mesh, which is a child of
   * the letter cell the pose drives, so the two compose without either having to know about the
   * other. A decoration's own parts take their colour write from its builder.
   */
  private writePart(index: number, out: ResolvedOffset): void {
    const mesh = this.partMeshes[index] as THREE.Mesh;

    mesh.position.set(...out.position);
    mesh.rotation.set(...out.rotation);
    mesh.scale.setScalar(out.scale);

    if (index >= this.decorFrom) {
      this.builder?.writePart(this.decorParts[index - this.decorFrom] as DecorationPart, out);
      return;
    }

    const material = mesh.material as THREE.MeshPhysicalMaterial;
    const light = this.bodyLights[this.partSlot[index] as number];
    if (light) material.emissive.setHex(litEmissive(light.emissive, light.hue, out.light));
    setEmissiveIntensity(material, this.bodyBase.emissiveIntensity * out.gain);
  }

  /**
   * Positional gradients live in the letter-placement space — a letter's own coordinates plus its
   * offset in the word — deliberately excluding the group's fit transform, so a resize cannot
   * slide the sweep across the sign. A regroup does move the letters, so it re-runs this.
   *
   * The span covers the live letters only; one a regroup dropped keeps the offset it is still
   * standing at, so it reads the ramp where it sits while its exit plays.
   */
  private setGradientBounds(): void {
    const builder = this.builder;
    if (!builder) return;
    const word = new THREE.Box2();
    const at = new THREE.Vector2();
    for (let i = 0; i < this.charOf.length; i++) {
      const box = builder.boundsAt(i);
      if (!box || this.leavingAt(i)) continue;
      const dx = this.baseX[i] as number;
      const dy = this.baseY[i] as number;
      word.expandByPoint(at.set(box.min.x + dx, box.min.y + dy));
      word.expandByPoint(at.set(box.max.x + dx, box.max.y + dy));
    }
    // An empty box is min +Infinity / max -Infinity, and handing that to the shader's bounds
    // turns every positional gradient NaN.
    if (word.isEmpty()) return;
    builder.applyGradientBounds(word);
  }

  glyph(char: string, depth: number): THREE.ExtrudeGeometry {
    return this.caches.glyph(this.font, char, depth);
  }

  shapes(char: string): THREE.Shape[] {
    return this.caches.shapes(this.font, char);
  }

  /** A glyph draws ink when its geometry has vertices — the same test the cell build uses. */
  /** Line ranging stays klieg's, in `placeBlock`, so weasel is asked only to place. */
  private layoutOpts() {
    return { maxWidth: UNBOUNDED, lineHeight: LINE_HEIGHT_EM, align: 'left' as const };
  }

  private drawsInk(char: string): boolean {
    return !!this.glyph(char, DEFAULT_GLYPH_OPTIONS.depth).attributes.position?.count;
  }

  /** Every glyph's bounds, or just those `pick` names, in the order a regroup re-lays them. */
  private glyphBounds(pick?: readonly number[]): GlyphBounds {
    const at = (src: (number | null)[]) => (pick ? pick.map((i) => src[i] ?? null) : src);
    return {
      depth: DEFAULT_GLYPH_OPTIONS.depth,
      minX: at(this.geoMinX),
      maxX: at(this.geoMaxX),
      minY: at(this.geoMinY),
      maxY: at(this.geoMaxY),
    };
  }

  private applyFit(fit: Fit): void {
    this.group.scale.setScalar(fit.scale);
    this.group.position.set(fit.offsetX, -fit.midY * fit.scale, 0);
  }

  /** A material carrying the studio, listed so `setEnvRotation` can turn every one of them. */
  studioMaterial(): THREE.MeshPhysicalMaterial {
    const material = createMaterial(this.envMap);
    this.envMaterials.push(material);
    return material;
  }

  private buildCell(
    i: number,
    font: LoadedFont,
    look: Look,
    spec: LookSpec,
    tint: number | ((letter: LetterInfo) => number | undefined) | undefined,
    debug: WordDebugHooks | undefined,
  ): void {
    const char = this.charOf[i] as string;
    const geo = this.glyph(char, DEFAULT_GLYPH_OPTIONS.depth);
    if (!geo.attributes.position?.count) {
      this.letters.push(null);
      this.bodyMaterials.push(null);
      this.bodyLights.push(null);
      this.builder?.skipLetter(i);
      return;
    }

    const hue = typeof tint === 'function' ? tint(this.letterInfo(i)) : tint;
    const bodyTint = tintMaterialOf(spec) === 'body' ? hue : undefined;

    const material = this.studioMaterial();
    applyLook(material, look, bodyTint);
    // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
    material.transparent = true;
    // A near-transparent backing still writes depth by default, which culls the tube drawn
    // behind it — the sign vanishes as the tube thins rather than being occluded by anything visible.
    material.depthWrite = this.bodyBase.opacity >= 1;
    seedFlake(material, i);
    material.opacity = this.bodyBase.opacity;
    material.emissiveIntensity = this.bodyBase.emissiveIntensity;
    this.bodyMaterials.push(material);
    this.bodyLights.push(lightBase(look, bodyTint));
    const decorTint = tintMaterialOf(spec) === 'decoration' ? hue : undefined;

    const cell = new THREE.Group();
    // A run's size sits below the cell: the pose overwrites `cell.scale` every frame, and
    // `atRest()` calls a cell scaled off 1 unsettled — which silently stops the DOM layer.
    const sized = new THREE.Group();
    sized.scale.setScalar(this.sizeOf?.(i) ?? 1);
    cell.add(sized);
    // The builder's own geometry when it has one, the cache's otherwise. Asked before the builder
    // builds its letter, so a body-replacing kind never sees a half-built cell.
    const body = this.builder?.bodyGeometry?.(char, DEFAULT_GLYPH_OPTIONS.depth) ?? geo;
    const bodyMesh = new THREE.Mesh(body, material);
    this.bodyMeshes[i] = bodyMesh;
    sized.add(bodyMesh);

    this.builder?.buildLetter(i, char, sized, decorTint);

    if (debug?.onLetter) {
      debug.onLetter(cell, glyphToShapes(font.font, char, EM), DEFAULT_GLYPH_OPTIONS.depth);
    }

    cell.position.set(this.baseX[i] as number, this.baseY[i] as number, 0);
    this.letters.push(cell);
    this.inner.add(cell);
  }

  get letterCount(): number {
    return this.letters.length;
  }

  /**
   * Turns the whole word as one rigid object — never per letter, and never the camera, so the
   * viewport fit stays put. Applied on a group between the fit and the letters, so it composes
   * with the fit instead of overwriting it.
   */
  get transform(): Transform {
    return new THREE.Matrix4()
      .compose(this.inner.position, this.inner.quaternion, this.inner.scale)
      .toArray();
  }

  set transform(matrix: Transform) {
    new THREE.Matrix4()
      .fromArray(matrix as number[])
      .decompose(this.inner.position, this.inner.quaternion, this.inner.scale);
  }

  /** The live letters' layout, in em, with the fit that maps em to world units. */
  readout(): { chars: string[]; x: number[]; y: number[]; line: number[]; fit: Fit } {
    const chars: string[] = [];
    const x: number[] = [];
    const y: number[] = [];
    const line: number[] = [];
    for (let i = 0; i < this.charOf.length; i++) {
      if (this.leavingAt(i)) continue;
      chars.push(this.charOf[i] as string);
      x.push(this.baseX[i] as number);
      y.push(this.baseY[i] as number);
      line.push(this.lineOf[i] as number);
    }
    return { chars, x, y, line, fit: { ...this.fit } };
  }

  /**
   * Whether every live letter sits exactly where the layout puts it, fit included. The DOM text
   * layer is only aligned while this holds — through an enter, an exit or a stage tween it does not.
   */
  atRest(): boolean {
    if (
      this.fit.scale !== this.fitTo.scale ||
      this.fit.midY !== this.fitTo.midY ||
      this.fit.offsetX !== this.fitTo.offsetX
    )
      return false;
    for (let i = 0; i < this.letters.length; i++) {
      const cell = this.letters[i];
      if (!cell || this.leavingAt(i)) continue;
      if (cell.position.x !== this.baseX[i] || cell.position.y !== this.baseY[i]) return false;
      if (cell.position.z !== 0) return false;
      if (cell.rotation.x !== 0 || cell.rotation.y !== 0 || cell.rotation.z !== 0) return false;
      if (cell.scale.x !== 1 || cell.scale.y !== 1 || cell.scale.z !== 1) return false;
    }
    return true;
  }

  /** Fresh each call: a caller-supplied piece receives this, and a reused object would alias. */
  private letterInfo(i: number): LetterInfo {
    const frozen = this.frozenInfo[i];
    if (frozen) return { ...frozen, leaving: true };
    return {
      char: this.charOf[i] as string,
      index: this.idxOf[i] as number,
      count: this.liveCount,
      line: this.lineOf[i] as number,
      column: this.columnOf[i] as number,
      lineCount: this.lineCount,
      columnCount: this.columnCount,
      x: this.baseX[i] as number,
      y: (this.baseY[i] as number) - this.fit.midY,
    };
  }

  /** A letter a regroup already dropped: it is playing its exit and never rejoins the group. */
  leavingAt(i: number): boolean {
    return !!this.frozenInfo[i];
  }

  /**
   * Re-lays the letters `keep` selects as a word of their own. Survivors are renumbered against
   * the new group; a dropped letter keeps the numbering its exit was staggered against, and stays
   * at its old position until `retire()` takes it off screen. Returns, per slot, the offset from
   * the new position back to the old one, so a move can start from where the letter visually was.
   */
  regroup(keep: (letter: LetterInfo) => boolean, as: Arrangement = 'line'): RegroupResult {
    const kept: number[] = [];
    const dropped: number[] = [];
    const delta: [number, number][] = this.charOf.map(() => [0, 0]);

    for (let i = 0; i < this.charOf.length; i++) {
      if (this.leavingAt(i)) continue;
      (keep(this.letterInfo(i)) ? kept : dropped).push(i);
    }

    // Frozen before the renumbering below, so each keeps the count its exit was staggered against.
    for (const i of dropped) this.frozenInfo[i] = this.letterInfo(i);

    // `place` renumbers the survivors as their own group but leaves every position, line and
    // column describing where they still physically are — which is what each of those fields
    // means. The viewport does not refit either: a stage that only removes letters must not zoom.
    if (as === 'place') {
      this.liveCount = kept.length;
      for (let n = 0; n < kept.length; n++) this.idxOf[kept[n] as number] = n;
      this.layoutVersion++;
      return { kept, dropped, delta };
    }

    const chars = kept.map((i) => this.charOf[i] as string);
    const laid = layoutRunsForKlieg(
      styledRunsOf(arrange(chars, as), this.family),
      this.layoutOpts(),
    );
    const placed = placeBlock(laid, (char) => this.drawsInk(char), this.budget.lineEdge);

    this.lineCount = placed.lineCount;
    this.columnCount = placed.columnCount;
    this.liveCount = kept.length;

    for (let n = 0; n < kept.length; n++) {
      const i = kept[n] as number;
      const oldX = this.baseX[i] as number;
      const oldY = this.baseY[i] as number;
      this.baseX[i] = placed.x[n] as number;
      this.baseY[i] = placed.y[n] as number;
      this.lineOf[i] = placed.line[n] as number;
      this.columnOf[i] = placed.column[n] as number;
      this.idxOf[i] = n;
      delta[i] = [oldX - (this.baseX[i] as number), oldY - (this.baseY[i] as number)];
    }

    this.fitFrom = this.fit;
    this.fitTo = fitOf(placed, this.glyphBounds(kept), this.budget);
    this.setGradientBounds();
    this.layoutVersion++;

    return { kept, dropped, delta };
  }

  /** Takes dropped letters off screen once their exit has played out. */
  retire(slots: readonly number[]): void {
    for (const i of slots) {
      const cell = this.letters[i];
      if (cell) cell.visible = false;
    }
  }

  /**
   * Turns the studio each material carries. `scene.environmentRotation` turns only what falls back
   * to `scene.environment`, which none of these do.
   */
  setEnvRotation(pitch: number, yaw: number): void {
    for (const material of this.envMaterials) material.envMapRotation.set(pitch, yaw, 0);
  }

  /**
   * Moves the viewport fit from the pre-regroup one to the new group's, `u` in 0..1. Kept off the
   * per-letter pose deliberately: pose scale grows each letter in place, where the fit has to
   * scale the whole group so the letters spread with it.
   */
  setFitProgress(u: number): void {
    const w = Math.max(0, Math.min(1, u));
    // Lerping to w = 1 lands a ULP short of fitTo, leaving the settled fit uncomparable by equality.
    this.fit =
      w === 1
        ? { ...this.fitTo }
        : {
            scale: this.fitFrom.scale + (this.fitTo.scale - this.fitFrom.scale) * w,
            midY: this.fitFrom.midY + (this.fitTo.midY - this.fitFrom.midY) * w,
            offsetX: this.fitFrom.offsetX + (this.fitTo.offsetX - this.fitFrom.offsetX) * w,
          };
    this.applyFit(this.fit);
  }

  apply(
    source: { poseAt(elapsed: number, letter: LetterInfo, out?: Pose): Pose },
    elapsed: number,
    ctx: FrameCtx,
  ): void {
    if (this.disposed) return;

    for (let i = 0; i < this.letters.length; i++) {
      const cell = this.letters[i];
      if (!cell) continue;

      // One scratch pose for the whole word; this loop runs per letter per frame.
      const pose = source.poseAt(elapsed, this.letterInfo(i), this.pose);
      cell.position.x = (this.baseX[i] as number) + pose.position[0];
      cell.position.y = (this.baseY[i] as number) + pose.position[1];
      cell.position.z = pose.position[2];
      cell.rotation.set(...pose.rotation);
      cell.scale.setScalar(pose.scale);
      const material = this.bodyMaterials[i];
      if (material) {
        material.opacity = pose.opacity * this.bodyBase.opacity;
        material.emissiveIntensity = this.bodyBase.emissiveIntensity;
        const light = this.bodyLights[i];
        if (light) material.emissive.setHex(light.emissive);
      }
      this.builder?.frame(i, pose.opacity);
    }

    if (this.effectFrame) this.applyEffects(elapsed, ctx);
  }

  dispose(): void {
    this.disposed = true;
    for (const material of this.bodyMaterials) material?.dispose();
    this.bodyMaterials.length = 0;
    this.bodyLights.length = 0;
    this.envMaterials.length = 0;
    this.parts.length = 0;
    this.partMeshes.length = 0;
    this.partSlot.length = 0;
    this.decorParts.length = 0;
    this.effectFrame = null;
    this.bodyMeshes.length = 0;
    this.builder?.dispose();
    // An InstancedMesh owns an instanceMatrix buffer that clearing the group does not free.
    for (const cell of this.letters) {
      // Traverses rather than iterating: the meshes hang off the cell's scale node, not the cell.
      cell?.traverse((child) => {
        if (child instanceof THREE.InstancedMesh) child.dispose();
      });
    }
    this.group.clear();
    if (this.ownsCaches) this.caches.dispose();
  }
}
