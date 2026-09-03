import * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { DEFAULT_GLYPH_OPTIONS, EM, glyphToShapes } from '../../text/glyphs.js';
import { buildTubeBlueprint, type TubeBlueprint, type TubeSpec } from '../decoration.js';
import { seedFlake } from '../flake.js';
import {
  applyLook,
  type FrameOwnedBase,
  frameOwnedBase,
  litEmissive,
  setEmissiveIntensity,
} from '../looks.js';
import { CRAWL_ATTRIBUTE, rampTexture } from '../tube/gradient.js';
import {
  GRADIENT_BOUNDS_UNIFORM,
  GRADIENT_ORIGIN_UNIFORM,
  positionalDomain,
  RUN_COLOR_ATTRIBUTE,
  tintByRunColor,
  tintChannelOf,
} from '../tube/tint.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

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

/** A letter's glyph traced as swept glass: lit runs the effects drive, and unlit ones behind them. */
export class TubeBuilder implements DecorationBuilder {
  private readonly base: FrameOwnedBase;
  /** Base of a tube's unlit runs. */
  private readonly darkBase: FrameOwnedBase;
  /** One ramp for the whole word: every letter's tint samples the same stops. */
  private readonly gradientRamp: THREE.DataTexture | null;
  /** A debug hook may swap in a non-physical material, so these are typed to the material base. */
  private readonly litMaterials: (THREE.Material | null)[] = [];
  /** A tube's unlit-run material, one per letter; indexed by letter slot. */
  private readonly darkMaterials: (THREE.Material | null)[] = [];
  /** A letter's lit-run meshes in blueprint order; indexed by letter slot. */
  private readonly litMeshes: (THREE.Mesh[] | null)[] = [];
  /**
   * Whether a letter's lit-run material reads the run-colour attribute. A debug override brings
   * its own material and no such contract, so writing that buffer would write into nothing.
   */
  private readonly litReadsRunColor: boolean[] = [];
  /**
   * Tube blueprints, one per letter — a per-letter seed can't go through the char-keyed cache.
   * Indexed by letter slot, so a hole is a letter that grew no tube.
   */
  private readonly blueprints: (TubeBlueprint | undefined)[] = [];
  /** Per-letter run bounds in the letter's own 1 em space; null where the glyph drew nothing. */
  private readonly bounds: (THREE.Box2 | null)[] = [];
  /** Each lit run's own colour, so an effect composes from the base rather than from last frame. */
  private readonly runColor = new Map<THREE.Mesh, number>();
  /** One scratch colour for the whole word; `writePart` runs per targeted part per frame. */
  private readonly partColor = new THREE.Color();

  constructor(
    private readonly spec: TubeSpec,
    private readonly ctx: WordBuildContext,
  ) {
    this.base = frameOwnedBase(spec.look);
    this.darkBase = frameOwnedBase(spec.dark);
    this.gradientRamp = spec.gradient ? rampTexture(spec.gradient.stops) : null;
  }

  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void {
    const spec = this.spec;
    const ctx = this.ctx;
    const litOverride = ctx.debug?.tubeMaterial?.('lit');
    const decorMaterial = litOverride ?? ctx.studioMaterial();
    if (!litOverride) {
      applyLook(decorMaterial as THREE.MeshPhysicalMaterial, spec.look, tint);
    }
    this.litReadsRunColor[index] = !litOverride;
    // Only when the look was applied: an override brings its own material and its own meaning
    // for every channel, and has no run-colour contract with us.
    if (!litOverride) {
      tintByRunColor(
        decorMaterial,
        tintChannelOf(spec.look),
        spec.gradient,
        this.gradientRamp ?? undefined,
        spec.look.rim,
      );
      if (spec.gradient && positionalDomain(spec.gradient)) {
        decorMaterial.userData[GRADIENT_BOUNDS_UNIFORM] = new THREE.Vector4(0, 0, 1, 1);
        decorMaterial.userData[GRADIENT_ORIGIN_UNIFORM] = new THREE.Vector2(0, 0);
      }
    }
    decorMaterial.transparent = true;
    // A yawed or curved tube can turn its inside surface toward the camera; FrontSide
    // would cull that invisible.
    decorMaterial.side = THREE.DoubleSide;
    seedFlake(decorMaterial, index);
    decorMaterial.opacity = this.base.opacity;
    setEmissiveIntensity(decorMaterial, this.base.emissiveIntensity);
    this.litMaterials[index] = decorMaterial;

    const darkOverride = ctx.debug?.tubeMaterial?.('dark');
    const darkMaterial = darkOverride ?? ctx.studioMaterial();
    if (!darkOverride) applyLook(darkMaterial as THREE.MeshPhysicalMaterial, spec.dark);
    darkMaterial.transparent = true;
    darkMaterial.side = THREE.DoubleSide;
    seedFlake(darkMaterial, index);
    darkMaterial.opacity = this.darkBase.opacity;
    setEmissiveIntensity(darkMaterial, this.darkBase.emissiveIntensity);
    this.darkMaterials[index] = darkMaterial;

    const shapes = glyphToShapes(ctx.font.font, char, EM);
    // Keyed on the untinted decoration, whose identity is stable across fires; `tintedTube`
    // builds a fresh object every call, so a key on that would never hit.
    const blueprint = ctx.caches.takeBlueprint(
      ctx.font,
      spec,
      char,
      DEFAULT_GLYPH_OPTIONS.depth,
      index,
      tint,
      () => buildTubeBlueprint(shapes, tintedTube(spec, tint), DEFAULT_GLYPH_OPTIONS.depth, index),
    );
    this.blueprints[index] = blueprint;
    const box = new THREE.Box2();
    const point = new THREE.Vector2();
    for (const run of blueprint.runs) {
      for (const p of run.points) box.expandByPoint(point.set(p.x, p.y));
    }
    this.bounds[index] = box.isEmpty() ? null : box;
    const litMeshes: THREE.Mesh[] = [];
    for (const geo of blueprint.lit) {
      const mesh = new THREE.Mesh(geo, decorMaterial);
      litMeshes.push(mesh);
      sized.add(mesh);
    }
    this.litMeshes[index] = litMeshes;
    for (const geo of blueprint.dark) sized.add(new THREE.Mesh(geo, darkMaterial));
  }

  skipLetter(index: number): void {
    this.litMaterials[index] = null;
    this.darkMaterials[index] = null;
    this.litMeshes[index] = null;
    this.litReadsRunColor[index] = false;
    this.blueprints[index] = undefined;
    this.bounds[index] = null;
  }

  collectParts(): DecorationPart[] {
    const runs: { slot: number; mesh: THREE.Mesh; length: number; color: number }[] = [];
    for (let i = 0; i < this.blueprints.length; i++) {
      const blueprint = this.blueprints[i];
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
        });
      }
    }

    // Arc length, not ordinal: runs differ in length by an order of magnitude, and an ordinal
    // share would put a chase's dwell somewhere other than where the glass is.
    const total = runs.reduce((a, r) => a + r.length, 0);
    let walked = 0;
    const parts: DecorationPart[] = [];
    for (let n = 0; n < runs.length; n++) {
      const run = runs[n] as (typeof runs)[number];
      const at = total > 0 ? walked / total : n / runs.length;
      const span = total > 0 ? run.length / total : 1 / runs.length;
      parts.push({
        info: this.ctx.partInfo(
          'run',
          n,
          runs.length,
          run.slot,
          at,
          span,
          this.ctx.meshInk(run.slot, run.mesh),
        ),
        mesh: run.mesh,
        slot: run.slot,
      });
      this.runColor.set(run.mesh, run.color);
      walked += run.length;
    }
    return parts;
  }

  frame(index: number, opacity: number): void {
    const lit = this.litMaterials[index];
    if (lit) {
      lit.opacity = opacity * this.base.opacity;
      setEmissiveIntensity(lit, this.base.emissiveIntensity);
    }
    const dark = this.darkMaterials[index];
    if (dark) {
      dark.opacity = opacity * this.darkBase.opacity;
      setEmissiveIntensity(dark, this.darkBase.emissiveIntensity);
    }
  }

  boundsAt(index: number): THREE.Box2 | null {
    return this.bounds[index] ?? null;
  }

  applyGradientBounds(word: THREE.Box2): void {
    for (let i = 0; i < this.litMaterials.length; i++) {
      const data = this.litMaterials[i]?.userData;
      const bounds = data?.[GRADIENT_BOUNDS_UNIFORM];
      const origin = data?.[GRADIENT_ORIGIN_UNIFORM];
      // Set, never reassigned: the shader patch aliases these very objects into its uniforms at
      // compile time, so a fresh one would leave a compiled letter on the pre-regroup mapping.
      if (bounds instanceof THREE.Vector4) {
        bounds.set(word.min.x, word.min.y, word.max.x, word.max.y);
      }
      if (origin instanceof THREE.Vector2) {
        origin.set(this.ctx.baseX[i] as number, this.ctx.baseY[i] as number);
      }
    }
  }

  /**
   * A run carries its colour on a per-vertex attribute the look's shader already reads, so gain
   * and colour are one buffer write rather than a material of this run's own. Colour composes from
   * the run's own base, never from the buffer: reading back last frame's value and scaling it
   * again compounds, and the sign fades to black in a few seconds.
   */
  writePart(slot: number, mesh: THREE.Mesh, out: ResolvedOffset): void {
    if (!this.litReadsRunColor[slot]) return;
    const attribute = mesh.geometry.getAttribute(RUN_COLOR_ATTRIBUTE) as
      | THREE.BufferAttribute
      | undefined;
    if (!attribute) return;
    const base = this.runColor.get(mesh);
    if (base === undefined) return;
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

  dispose(): void {
    for (const material of this.litMaterials) material?.dispose();
    this.litMaterials.length = 0;
    for (const material of this.darkMaterials) material?.dispose();
    this.darkMaterials.length = 0;
    for (const blueprint of this.blueprints) {
      if (blueprint) this.ctx.caches.releaseBlueprint(blueprint);
    }
    this.blueprints.length = 0;
    this.bounds.length = 0;
    this.litMeshes.length = 0;
    this.litReadsRunColor.length = 0;
    this.runColor.clear();
    this.gradientRamp?.dispose();
  }
}
