import * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache } from '../../text/glyphs.js';
import {
  buildChunkBlueprint,
  type ChunkBlueprint,
  type ChunkSpec,
  chunkGeometry,
  chunkGeometrySide,
  chunkInstances,
  poolFor,
} from '../decoration.js';
import { seedFlake } from '../flake.js';
import {
  applyLook,
  type FrameOwnedBase,
  frameOwnedBase,
  type LightBase,
  lightBase,
  litEmissive,
} from '../looks.js';
import { CHUNK_SHADE_ATTRIBUTE, shadeByInstance } from '../shade.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

/** A letter's chunks as one instanced draw, scattered over its glyph's own surface. */
export class ChunksBuilder implements DecorationBuilder {
  private readonly base: FrameOwnedBase;
  /** The one chunk every field draws, shared across letters unless the look sets `relief`. */
  private readonly sharedGeometry: THREE.BufferGeometry;
  /** Every clone made for a relief field, so each can be disposed. Not indexed by letter. */
  private readonly reliefClones: THREE.BufferGeometry[] = [];
  private readonly cache: GlyphCache<ChunkBlueprint> | null;
  /** A letter's whole chunk field as one instanced draw; indexed by letter slot. */
  private readonly meshes: (THREE.InstancedMesh | null)[] = [];
  /** The emissive and hue a chunk field's lamp light resolves against; indexed by letter slot. */
  private readonly lights: (LightBase | null)[] = [];
  /** A field's own material; indexed by letter slot. */
  private readonly materials: (THREE.MeshPhysicalMaterial | null)[] = [];

  constructor(
    private readonly spec: ChunkSpec,
    private readonly ctx: WordBuildContext,
  ) {
    this.base = frameOwnedBase(spec.look);
    this.sharedGeometry = chunkGeometry(spec.shape);
    // Bedding places a glyph's chunks by where the glyph sits in the word, so its pool cannot be
    // shared between two letters the way a plain scatter's can.
    this.cache = spec.bedding
      ? null
      : new GlyphCache<ChunkBlueprint>((char, depth) =>
          buildChunkBlueprint(this.ctx.glyph(char, depth), {
            pool: poolFor(spec),
            faceBias: spec.faceBias,
          }),
        );
  }

  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void {
    const spec = this.spec;
    this.lights[index] = lightBase(spec.look, tint);

    const material = this.ctx.studioMaterial();
    applyLook(material, spec.look, tint);
    material.transparent = true;
    material.side = chunkGeometrySide(spec);
    seedFlake(material, index);
    material.opacity = this.base.opacity;
    material.emissiveIntensity = this.base.emissiveIntensity;
    this.materials[index] = material;

    const { matrices, shades } = chunkInstances(this.blueprintFor(char, index), spec, index);
    // An instanced attribute lives on the geometry, and every letter's field is its own, so a
    // relief look cannot share the one chunk geometry the others do.
    let geometry = this.sharedGeometry;
    if (spec.relief) {
      geometry = this.sharedGeometry.clone();
      geometry.setAttribute(CHUNK_SHADE_ATTRIBUTE, new THREE.InstancedBufferAttribute(shades, 1));
      this.reliefClones.push(geometry);
      shadeByInstance(material);
    }
    const instanced = new THREE.InstancedMesh(geometry, material, matrices.length);
    for (let m = 0; m < matrices.length; m++) {
      instanced.setMatrixAt(m, matrices[m] as THREE.Matrix4);
    }
    instanced.instanceMatrix.needsUpdate = true;
    this.meshes[index] = instanced;
    sized.add(instanced);
  }

  skipLetter(index: number): void {
    this.lights[index] = null;
    this.materials[index] = null;
    this.meshes[index] = null;
  }

  collectParts(): DecorationPart[] {
    const fields: number[] = [];
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.meshes[i]) fields.push(i);
    }
    return fields.map((slot, n) => ({
      info: this.ctx.partInfo(
        'chunk',
        n,
        fields.length,
        slot,
        n / fields.length,
        1 / fields.length,
      ),
      mesh: this.meshes[slot] as THREE.InstancedMesh,
      slot,
    }));
  }

  frame(index: number, opacity: number): void {
    const material = this.materials[index];
    if (material) {
      material.opacity = opacity * this.base.opacity;
      material.emissiveIntensity = this.base.emissiveIntensity;
      const light = this.lights[index];
      if (this.meshes[index] && light) material.emissive.setHex(light.emissive);
    }
  }

  /** A chunk field covers its whole letter, so it has no box of its own to lend the span. */
  boundsAt(): THREE.Box2 | null {
    return null;
  }

  applyGradientBounds(): void {}

  writePart(part: DecorationPart, out: ResolvedOffset): void {
    const material = part.mesh.material as THREE.MeshPhysicalMaterial;
    const light = this.lights[part.slot];
    if (light) material.emissive.setHex(litEmissive(light.emissive, light.hue, out.light));
    material.emissiveIntensity = this.base.emissiveIntensity * out.gain;
  }

  dispose(): void {
    for (const material of this.materials) material?.dispose();
    this.materials.length = 0;
    // The instanced meshes' own buffers are freed by the owning Word's scene traversal; dropping
    // them here without that traversal leaks an instanceMatrix per letter.
    this.meshes.length = 0;
    this.lights.length = 0;
    this.cache?.dispose();
    this.sharedGeometry.dispose();
    for (const geometry of this.reliefClones) geometry.dispose();
    this.reliefClones.length = 0;
  }

  private blueprintFor(char: string, i: number): ChunkBlueprint {
    const depth = DEFAULT_GLYPH_OPTIONS.depth;
    if (this.cache) return this.cache.get(char, depth);
    return buildChunkBlueprint(this.ctx.glyph(char, depth), {
      pool: poolFor(this.spec),
      faceBias: this.spec.faceBias,
      bedding: this.spec.bedding,
      originX: this.ctx.baseX[i] as number,
      originY: this.ctx.baseY[i] as number,
    });
  }
}
