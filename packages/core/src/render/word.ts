import * as THREE from 'three';
import { EffectFrame, planEffects } from '../effects/frame.js';
import type { EffectSpec, FrameCtx, PartInfo, PartKind, ResolvedOffset } from '../effects/types.js';
import { blankPose } from '../motion/compositor.js';
import type { RegroupResult } from '../motion/sequence.js';
import type { LetterInfo } from '../motion/types.js';
import type { Pose, Vec3 } from '../pose.js';
import type { LoadedFont } from '../text/font.js';
import { DEFAULT_GLYPH_OPTIONS, EM, GlyphCache, glyphToShapes } from '../text/glyphs.js';
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
import {
  type Blueprint,
  buildChunkBlueprint,
  buildTubeBlueprint,
  type ChunkSpec,
  chunkGeometry,
  chunkGeometrySide,
  chunkMatrices,
  type DecorationSpec,
  poolFor,
  type TubeBlueprint,
  type TubeSpec,
} from './decoration.js';
import type { FlakeUniforms } from './flake.js';
import {
  applyLook,
  createMaterial,
  type FrameOwnedBase,
  frameOwnedBase,
  type LightBase,
  type Look,
  type LookSpec,
  lightBase,
  specOf,
  tintMaterialOf,
} from './looks.js';
import { CRAWL_ATTRIBUTE, rampTexture } from './tube/gradient.js';
import {
  GRADIENT_BOUNDS_UNIFORM,
  GRADIENT_ORIGIN_UNIFORM,
  positionalDomain,
  RUN_COLOR_ATTRIBUTE,
  tintByRunColor,
  tintChannelOf,
} from './tube/tint.js';

/**
 * A tube look carries its colour on the per-vertex run attribute, not on the material: the material
 * channel is set to white so the attribute multiplies out exactly. So a tint written to the
 * material is erased before the first frame, and a tint has to reach the palette the runs are
 * dealt from instead. `surfaceColors` is dropped with it — it would out-rank the palette and take
 * the tint back out.
 */
function tintedTube(spec: TubeSpec, tint?: number): TubeSpec {
  if (tint === undefined) return spec;
  return { ...spec, colors: [tint], surfaceColors: undefined };
}

/**
 * Offsets a material's flake field so repeated letters do not sparkle in lockstep. Every material
 * a letter owns takes the same offset — body, tube and chunk alike — so a decoration whose look
 * carries a flake spec breaks up along with the body it sits on.
 */
function seedFlake(material: THREE.Material, i: number): void {
  const flake = material.userData.flake as FlakeUniforms | undefined;
  if (flake) flake.uFlakeSeed.value = i * 17.13;
}

/**
 * The decor and dark families write their emissive through here, at construction and per frame
 * alike: those arrays are typed to the base class so a debug override can supply one without it.
 */
function setEmissiveIntensity(material: THREE.Material | null, value: number): void {
  if (material && 'emissiveIntensity' in material) {
    (material as THREE.MeshPhysicalMaterial).emissiveIntensity = value;
  }
}

const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));

/**
 * Lamp light landing on a part: `base + lamp x hue`. Multiplying by the hue is what keeps a
 * material's identity — a white lamp on gold reflects gold, and adding white reflects cream.
 * @internal exported for test; not part of the public surface.
 */
export function litEmissive(base: number, hue: number, light: Vec3): number {
  const [lr, lg, lb] = light;
  if (!lr && !lg && !lb) return base;
  // A non-finite channel contributes nothing rather than blacking the channel out: clamp255(NaN)
  // is NaN, and NaN << 16 is 0, so the base would vanish on one channel and survive on the others.
  const ch = (shift: number, l: number): number =>
    clamp255(((base >> shift) & 0xff) + (Number.isFinite(l) ? l : 0) * ((hue >> shift) & 0xff));
  return (ch(16, lr) << 16) | (ch(8, lg) << 8) | ch(0, lb);
}

/**
 * Lab-only diagnostic hooks (see debug.ts). Word owns per-letter layout and the tube pipeline,
 * so a debug view has to plug in here rather than re-deriving either outside core. `createKlieg`
 * never supplies one, so every real caller is unaffected.
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
  private readonly baseX: number[] = [];
  /** Layout y per letter, for the same reason: pose y adds onto it, or the lines stack up. */
  private readonly baseY: number[] = [];
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
  /** A debug hook may swap in a non-physical material, so these are typed to the material base. */
  private readonly decorMaterials: (THREE.Material | null)[] = [];
  /** A tube decoration's unlit-run material, one per letter; null for every non-tube letter. */
  private readonly darkMaterials: (THREE.Material | null)[] = [];
  /** Indexed by letter slot; a slot whose glyph drew no outline is a hole. */
  private readonly bodyMeshes: (THREE.Mesh | null)[] = [];
  /** A tube letter's lit-run meshes in blueprint order; indexed by letter slot. */
  private readonly litMeshes: THREE.Mesh[][] = [];
  /**
   * Whether a letter's lit-run material reads the run-colour attribute. A debug override brings
   * its own material and no such contract, so writing that buffer would write into nothing.
   */
  private readonly litReadsRunColor: boolean[] = [];
  /** The word-wide part pool, body parts first and then run parts. */
  private readonly parts: PartInfo[] = [];
  private readonly partMeshes: THREE.Mesh[] = [];
  /**
   * A run part's own colour, so an effect composes from the base rather than from last frame. A
   * body part gets white, which nothing reads: white is a tint's identity, so a later reader that
   * does read it gets the body untinted rather than black.
   */
  private readonly partBaseColor: number[] = [];
  /** Per part, whether `writePart` may drive it through the run-colour buffer. */
  private readonly partReadsRunColor: boolean[] = [];
  /** Per part, the letter slot it hangs off, so a retired letter's parts can be left alone. */
  private readonly partSlot: number[] = [];
  /** Planned once from the specs; holds the per-frame layer buffers. Null until built. */
  private effectFrame: EffectFrame | null = null;
  /** One scratch colour for the whole word; `writePart` runs per targeted part per frame. */
  private readonly partColor = new THREE.Color();
  private readonly font: LoadedFont;
  private readonly caches: WordCaches;
  /** Set only where this word made its own caches, and so is the one that disposes them. */
  private readonly ownsCaches: boolean;
  private readonly decorCache: GlyphCache<Blueprint> | null;
  /**
   * Tube blueprints, one per letter — a per-letter seed can't go through the char-keyed cache.
   * Indexed by letter slot, so a hole is a letter that grew no tube.
   */
  private readonly tubeBlueprints: (TubeBlueprint | undefined)[] = [];
  /** Per-letter run bounds in the letter's own 1 em space; null where the glyph drew nothing. */
  private readonly tubeBounds: (THREE.Box2 | null)[] = [];
  /** One ramp for the whole word: every letter's tint samples the same stops. */
  private readonly gradientRamp: THREE.DataTexture | null;
  private readonly chunkGeo: THREE.BufferGeometry | null;
  private readonly pose = blankPose();
  /**
   * Frame-owned bases, one per material family. `Word` is the only writer of these properties,
   * and seeds all of them at construction: a word before its first frame is a word at rest.
   */
  private readonly bodyBase: FrameOwnedBase;
  private readonly decorBase: FrameOwnedBase;
  /** Base of a tube's unlit runs; irrelevant to every other decoration kind. */
  private readonly darkBase: FrameOwnedBase;
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
    this.ownsCaches = !caches;
    this.caches = caches ?? new WordCaches();

    const decoration = spec.decoration;
    this.decorBase = frameOwnedBase(decoration?.look ?? {});
    this.darkBase = frameOwnedBase(decoration?.kind === 'tube' ? decoration.dark : {});
    this.chunkGeo = decoration?.kind === 'chunks' ? chunkGeometry(decoration.shape) : null;
    this.gradientRamp =
      decoration?.kind === 'tube' && decoration.gradient
        ? rampTexture(decoration.gradient.stops)
        : null;
    // A tube's runs need a per-letter seed, so two letters of the same char don't repeat the
    // same partial-lit pattern — that can't go through a cache keyed on (char, depth) alone.
    // Bedding places a glyph's chunks by where the glyph sits in the word, so its pool cannot be
    // shared between two letters the way a plain scatter's can.
    this.decorCache =
      decoration && decoration.kind === 'chunks' && !decoration.bedding
        ? new GlyphCache<Blueprint>((char, depth) =>
            buildChunkBlueprint(this.glyph(char, depth), {
              pool: poolFor(decoration),
              faceBias: decoration.faceBias,
            }),
          )
        : null;

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
      this.buildCell(i, font, look, spec, decoration, tint, debug);
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
      this.partBaseColor.push(0xffffff);
      this.partReadsRunColor.push(false);
      this.partSlot.push(i);
    }

    const runs: {
      slot: number;
      mesh: THREE.Mesh;
      length: number;
      color: number;
      tinted: boolean;
    }[] = [];
    for (let i = 0; i < this.charOf.length; i++) {
      const blueprint = this.tubeBlueprints[i];
      const meshes = this.litMeshes[i];
      if (!blueprint || !meshes) continue;
      const lit = blueprint.runs.filter((r) => r.lit);
      // Paired by ordinal, which only holds while every lit run swept a geometry: one missing
      // shifts every later pair, and each effect then lands on a tube it never targeted.
      if (meshes.length !== lit.length) {
        throw new Error(
          `tube blueprint ${i}: ${meshes.length} lit meshes for ${lit.length} lit runs`,
        );
      }
      for (let r = 0; r < meshes.length; r++) {
        const run = lit[r] as (typeof lit)[number];
        runs.push({
          slot: i,
          mesh: meshes[r] as THREE.Mesh,
          length: run.length,
          color: run.color,
          tinted: this.litReadsRunColor[i] === true,
        });
      }
    }

    // Arc length, not ordinal: runs differ in length by an order of magnitude, and an ordinal
    // share would put a chase's dwell somewhere other than where the glass is.
    const total = runs.reduce((a, r) => a + r.length, 0);
    let walked = 0;
    for (let n = 0; n < runs.length; n++) {
      const run = runs[n] as (typeof runs)[number];
      const at = total > 0 ? walked / total : n / runs.length;
      const span = total > 0 ? run.length / total : 1 / runs.length;
      this.parts.push(this.partInfo('run', n, runs.length, run.slot, at, span));
      this.partMeshes.push(run.mesh);
      this.partBaseColor.push(run.color);
      this.partReadsRunColor.push(run.tinted);
      this.partSlot.push(run.slot);
      walked += run.length;
    }
  }

  /**
   * A part carries its letter's grid position: `orderKey` reads `column` to decide whether a
   * radial stagger is even possible, and a part without one silently falls back to reading order.
   */
  private partInfo(
    kind: PartKind,
    index: number,
    count: number,
    slot: number,
    at: number,
    span: number,
  ): PartInfo {
    return {
      kind,
      index,
      count,
      letter: this.letterInfo(slot),
      x: this.baseX[slot] as number,
      y: this.baseY[slot] as number,
      ink: this.inkOf(slot),
      line: this.lineOf[slot] as number,
      column: this.columnOf[slot] as number,
      lineCount: this.lineCount,
      columnCount: this.columnCount,
      at,
      span,
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
   * other. Colour composes from `partBaseColor`, never from the buffer: reading back last frame's
   * value and scaling it again compounds, and the sign fades to black in a few seconds.
   */
  private writePart(index: number, out: ResolvedOffset): void {
    const part = this.parts[index] as PartInfo;
    const mesh = this.partMeshes[index] as THREE.Mesh;

    mesh.position.set(...out.position);
    mesh.rotation.set(...out.rotation);
    mesh.scale.setScalar(out.scale);

    if (part.kind === 'body') {
      const material = mesh.material as THREE.MeshPhysicalMaterial;
      const light = this.bodyLights[this.partSlot[index] as number];
      if (light) material.emissive.setHex(litEmissive(light.emissive, light.hue, out.light));
      setEmissiveIntensity(material, this.bodyBase.emissiveIntensity * out.gain);
      return;
    }

    // A run carries its colour on a per-vertex attribute the look's shader already reads, so gain
    // and colour are one buffer write rather than a material of this run's own.
    if (!this.partReadsRunColor[index]) return;
    const attribute = mesh.geometry.getAttribute(RUN_COLOR_ATTRIBUTE) as
      | THREE.BufferAttribute
      | undefined;
    if (!attribute) return;
    const base = this.partBaseColor[index] as number;
    // Hue and emissive are the same colour here: a lamp on a run tints by what the run is showing,
    // so a `hue` piece sweeping the base takes the lit pool with it.
    const shown = out.color ?? base;
    const color = this.partColor
      .setHex(litEmissive(shown, shown, out.light))
      .multiplyScalar(out.gain);
    const array = attribute.array as Float32Array;
    for (let v = 0; v < array.length; v += 3) {
      array[v] = color.r;
      array[v + 1] = color.g;
      array[v + 2] = color.b;
    }
    attribute.needsUpdate = true;

    // Only present when the look declared a gradient; without a ramp there is nothing to shift.
    const crawl = mesh.geometry.getAttribute(CRAWL_ATTRIBUTE) as THREE.BufferAttribute | undefined;
    if (!crawl) return;
    const shift = out.crawl;
    const buffer = crawl.array as Float32Array;
    if (buffer[0] === shift) return;
    buffer.fill(shift);
    crawl.needsUpdate = true;
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
    const word = new THREE.Box2();
    const at = new THREE.Vector2();
    for (let i = 0; i < this.tubeBounds.length; i++) {
      const box = this.tubeBounds[i];
      if (!box || this.leavingAt(i)) continue;
      const dx = this.baseX[i] as number;
      const dy = this.baseY[i] as number;
      word.expandByPoint(at.set(box.min.x + dx, box.min.y + dy));
      word.expandByPoint(at.set(box.max.x + dx, box.max.y + dy));
    }
    if (word.isEmpty()) return;

    for (let i = 0; i < this.decorMaterials.length; i++) {
      const data = this.decorMaterials[i]?.userData;
      const bounds = data?.[GRADIENT_BOUNDS_UNIFORM];
      const origin = data?.[GRADIENT_ORIGIN_UNIFORM];
      // Set, never reassigned: the shader patch aliases these very objects into its uniforms at
      // compile time, so a fresh one would leave a compiled letter on the pre-regroup mapping.
      if (bounds instanceof THREE.Vector4) {
        bounds.set(word.min.x, word.min.y, word.max.x, word.max.y);
      }
      if (origin instanceof THREE.Vector2) {
        origin.set(this.baseX[i] as number, this.baseY[i] as number);
      }
    }
  }

  private glyph(char: string, depth: number): THREE.ExtrudeGeometry {
    return this.caches.glyph(this.font, char, depth);
  }

  /** A glyph draws ink when its geometry has vertices — the same test the cell build uses. */
  /** Line ranging stays klieg's, in `placeBlock`, so weasel is asked only to place. */
  private layoutOpts() {
    return { maxWidth: UNBOUNDED, lineHeight: LINE_HEIGHT_EM, align: 'left' as const };
  }

  private drawsInk(char: string): boolean {
    return !!this.glyph(char, DEFAULT_GLYPH_OPTIONS.depth).attributes.position?.count;
  }

  private chunkBlueprintFor(char: string, i: number, spec: ChunkSpec): Blueprint {
    const depth = DEFAULT_GLYPH_OPTIONS.depth;
    if (this.decorCache) return this.decorCache.get(char, depth);
    return buildChunkBlueprint(this.glyph(char, depth), {
      pool: poolFor(spec),
      faceBias: spec.faceBias,
      bedding: spec.bedding,
      originX: this.baseX[i] as number,
      originY: this.baseY[i] as number,
    });
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
  private studioMaterial(): THREE.MeshPhysicalMaterial {
    const material = createMaterial(this.envMap);
    this.envMaterials.push(material);
    return material;
  }

  private buildCell(
    i: number,
    font: LoadedFont,
    look: Look,
    spec: LookSpec,
    decoration: DecorationSpec | undefined,
    tint: number | ((letter: LetterInfo) => number | undefined) | undefined,
    debug: WordDebugHooks | undefined,
  ): void {
    const char = this.charOf[i] as string;
    const geo = this.glyph(char, DEFAULT_GLYPH_OPTIONS.depth);
    if (!geo.attributes.position?.count) {
      this.letters.push(null);
      this.bodyMaterials.push(null);
      this.bodyLights.push(null);
      this.decorMaterials.push(null);
      this.darkMaterials.push(null);
      this.tubeBounds.push(null);
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

    const cell = new THREE.Group();
    // A run's size sits below the cell: the pose overwrites `cell.scale` every frame, and
    // `atRest()` calls a cell scaled off 1 unsettled — which silently stops the DOM layer.
    const sized = new THREE.Group();
    sized.scale.setScalar(this.sizeOf?.(i) ?? 1);
    cell.add(sized);
    const bodyMesh = new THREE.Mesh(geo, material);
    this.bodyMeshes[i] = bodyMesh;
    sized.add(bodyMesh);

    let debugShapes: THREE.Shape[] | undefined;

    if (decoration && decoration.kind === 'tube') {
      const litOverride = debug?.tubeMaterial?.('lit');
      const decorMaterial = litOverride ?? this.studioMaterial();
      if (!litOverride) {
        applyLook(
          decorMaterial as THREE.MeshPhysicalMaterial,
          decoration.look,
          tintMaterialOf(spec) === 'decoration' ? hue : undefined,
        );
      }
      this.litReadsRunColor[i] = !litOverride;
      // Only when the look was applied: an override brings its own material and its own meaning
      // for every channel, and has no run-colour contract with us.
      if (!litOverride) {
        tintByRunColor(
          decorMaterial,
          tintChannelOf(decoration.look),
          decoration.gradient,
          this.gradientRamp ?? undefined,
          decoration.look.rim,
        );
        if (decoration.gradient && positionalDomain(decoration.gradient)) {
          decorMaterial.userData[GRADIENT_BOUNDS_UNIFORM] = new THREE.Vector4(0, 0, 1, 1);
          decorMaterial.userData[GRADIENT_ORIGIN_UNIFORM] = new THREE.Vector2(0, 0);
        }
      }
      decorMaterial.transparent = true;
      // A yawed or curved tube can turn its inside surface toward the camera; FrontSide
      // would cull that invisible.
      decorMaterial.side = THREE.DoubleSide;
      seedFlake(decorMaterial, i);
      decorMaterial.opacity = this.decorBase.opacity;
      setEmissiveIntensity(decorMaterial, this.decorBase.emissiveIntensity);
      this.decorMaterials.push(decorMaterial);

      const darkOverride = debug?.tubeMaterial?.('dark');
      const darkMaterial = darkOverride ?? this.studioMaterial();
      if (!darkOverride) applyLook(darkMaterial as THREE.MeshPhysicalMaterial, decoration.dark);
      darkMaterial.transparent = true;
      darkMaterial.side = THREE.DoubleSide;
      seedFlake(darkMaterial, i);
      darkMaterial.opacity = this.darkBase.opacity;
      setEmissiveIntensity(darkMaterial, this.darkBase.emissiveIntensity);
      this.darkMaterials.push(darkMaterial);

      const shapes = glyphToShapes(font.font, char, EM);
      debugShapes = shapes;
      // Keyed on the untinted decoration, whose identity is stable across fires; `tintedTube`
      // builds a fresh object every call, so a key on that would never hit.
      const decorTint = tintMaterialOf(spec) === 'decoration' ? hue : undefined;
      const blueprint = this.caches.takeBlueprint(
        font,
        decoration,
        char,
        DEFAULT_GLYPH_OPTIONS.depth,
        i,
        decorTint,
        () =>
          buildTubeBlueprint(
            shapes,
            tintedTube(decoration, decorTint),
            DEFAULT_GLYPH_OPTIONS.depth,
            i,
          ),
      );
      this.tubeBlueprints[i] = blueprint;
      const box = new THREE.Box2();
      const point = new THREE.Vector2();
      for (const run of blueprint.runs) {
        for (const p of run.points) box.expandByPoint(point.set(p.x, p.y));
      }
      this.tubeBounds.push(box.isEmpty() ? null : box);
      const litMeshes: THREE.Mesh[] = [];
      for (const geo of blueprint.lit) {
        const mesh = new THREE.Mesh(geo, decorMaterial);
        litMeshes.push(mesh);
        sized.add(mesh);
      }
      this.litMeshes[i] = litMeshes;
      for (const geo of blueprint.dark) sized.add(new THREE.Mesh(geo, darkMaterial));
    } else if (decoration && decoration.kind === 'chunks') {
      const decorMaterial = this.studioMaterial();
      applyLook(
        decorMaterial,
        decoration.look,
        tintMaterialOf(spec) === 'decoration' ? hue : undefined,
      );
      decorMaterial.transparent = true;
      if (decoration.kind === 'chunks') decorMaterial.side = chunkGeometrySide(decoration);
      seedFlake(decorMaterial, i);
      decorMaterial.opacity = this.decorBase.opacity;
      setEmissiveIntensity(decorMaterial, this.decorBase.emissiveIntensity);
      this.decorMaterials.push(decorMaterial);
      this.darkMaterials.push(null);
      this.tubeBounds.push(null);

      const blueprint = this.chunkBlueprintFor(char, i, decoration);
      if (blueprint.kind === 'chunks' && this.chunkGeo) {
        const matrices = chunkMatrices(blueprint, decoration, i);
        const instanced = new THREE.InstancedMesh(this.chunkGeo, decorMaterial, matrices.length);
        for (let m = 0; m < matrices.length; m++) {
          instanced.setMatrixAt(m, matrices[m] as THREE.Matrix4);
        }
        instanced.instanceMatrix.needsUpdate = true;
        sized.add(instanced);
      }
    } else {
      this.decorMaterials.push(null);
      this.darkMaterials.push(null);
      this.tubeBounds.push(null);
    }

    if (debug?.onLetter) {
      debug.onLetter(
        cell,
        debugShapes ?? glyphToShapes(font.font, char, EM),
        DEFAULT_GLYPH_OPTIONS.depth,
      );
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
  private leavingAt(i: number): boolean {
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
      const decor = this.decorMaterials[i];
      if (decor) {
        decor.opacity = pose.opacity * this.decorBase.opacity;
        setEmissiveIntensity(decor, this.decorBase.emissiveIntensity);
      }
      const dark = this.darkMaterials[i];
      if (dark) {
        dark.opacity = pose.opacity * this.darkBase.opacity;
        setEmissiveIntensity(dark, this.darkBase.emissiveIntensity);
      }
    }

    if (this.effectFrame) this.applyEffects(elapsed, ctx);
  }

  dispose(): void {
    this.disposed = true;
    for (const material of this.bodyMaterials) material?.dispose();
    this.bodyMaterials.length = 0;
    this.bodyLights.length = 0;
    for (const material of this.decorMaterials) material?.dispose();
    this.decorMaterials.length = 0;
    for (const material of this.darkMaterials) material?.dispose();
    this.darkMaterials.length = 0;
    this.envMaterials.length = 0;
    for (const blueprint of this.tubeBlueprints) {
      if (blueprint) this.caches.releaseBlueprint(blueprint);
    }
    this.tubeBlueprints.length = 0;
    this.tubeBounds.length = 0;
    this.parts.length = 0;
    this.partMeshes.length = 0;
    this.partBaseColor.length = 0;
    this.partReadsRunColor.length = 0;
    this.partSlot.length = 0;
    this.effectFrame = null;
    this.bodyMeshes.length = 0;
    this.litMeshes.length = 0;
    this.gradientRamp?.dispose();
    this.decorCache?.dispose();
    this.chunkGeo?.dispose();
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
