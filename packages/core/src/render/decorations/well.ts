import * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache } from '../../text/glyphs.js';
import type { WellSpec } from '../decoration.js';
import {
  applyLook,
  type FrameOwnedBase,
  frameOwnedBase,
  type LightBase,
  lightBase,
  litEmissive,
} from '../looks.js';
import type { Cut } from '../wells/cutters.js';
import { cutterFor } from '../wells/cutters.js';
import type { Filled } from '../wells/fills.js';
import { fillFor } from '../wells/fills.js';
import { buildPlate, platePlanes } from '../wells/plate.js';
import { regionOf } from '../wells/region.js';
// Registers the `stone` fill. Imported for the side effect the way `cutters.js` registers
// `lattice`: a fill nothing imports is a name `fillFor` cannot answer.
import '../wells/stone.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

/**
 * A letter carved with wells, and whatever fills them.
 *
 * The body is everything the cutter makes, so it is answered through `bodyGeometry` rather than
 * added to the letter's group. A fill is the opposite: it draws into the group and contributes a
 * part. With no fill named the wells stay empty, which is what every spec written before this did.
 */
export class WellBuilder implements DecorationBuilder {
  /** One body per char: a letter's wells cannot depend on its neighbours. */
  private readonly bodies: GlyphCache<THREE.BufferGeometry>;
  /** One cut per char, shared by the body and the fill so they cannot disagree about the wells. */
  private readonly cuts = new Map<string, Cut>();
  /** Per letter slot, so an effect can reach one letter's stones without moving its neighbours'. */
  private readonly filled: (Filled | null)[] = [];
  private readonly meshes: (THREE.InstancedMesh | null)[] = [];
  private readonly lights: (LightBase | null)[] = [];
  private readonly base: FrameOwnedBase;
  private depth = DEFAULT_GLYPH_OPTIONS.depth;

  constructor(
    private readonly spec: WellSpec,
    private readonly ctx: WordBuildContext,
  ) {
    this.base = frameOwnedBase(spec.stone ?? 'gem');
    this.bodies = new GlyphCache<THREE.BufferGeometry>((char, depth) =>
      buildPlate(ctx.shapes(char), this.cutOf(char), { depth, bezel: spec.bezel }),
    );
  }

  private cutOf(char: string): Cut {
    let cut = this.cuts.get(char);
    if (!cut) {
      const shapes = this.ctx.shapes(char);
      cut = cutterFor(this.spec.cutter)(shapes, regionOf(shapes), this.spec);
      this.cuts.set(char, cut);
    }
    return cut;
  }

  bodyGeometry(char: string, depth: number): THREE.BufferGeometry {
    // The fill has to sit against the plate this letter actually got, and the depth only arrives
    // here. Defaulted rather than left unset so a fill is right even if nothing asks for a body.
    this.depth = depth;
    return this.bodies.get(char, depth);
  }

  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void {
    this.filled[index] = null;
    this.meshes[index] = null;
    this.lights[index] = null;
    if (!this.spec.fill) return;

    const cut = this.cutOf(char);
    if (cut.seats.length === 0) return;

    // The depth the body is built at, so the fill sits against the plate this letter actually got.
    const planes = platePlanes(this.depth, cut.floor, this.spec.bezel);
    const filled = fillFor(this.spec.fill)(
      cut.seats,
      {
        material: () => this.ctx.studioMaterial(),
        faceZ: planes.faceZ,
        floorZ: planes.floorZ,
      },
      this.spec,
    );
    applyLook(filled.material, this.spec.stone ?? 'gem', tint);
    filled.material.transparent = true;
    filled.material.opacity = this.base.opacity;
    filled.material.emissiveIntensity = this.base.emissiveIntensity;

    const mesh = new THREE.InstancedMesh(filled.geometry, filled.material, filled.matrices.length);
    for (let m = 0; m < filled.matrices.length; m++) {
      mesh.setMatrixAt(m, filled.matrices[m] as THREE.Matrix4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.filled[index] = filled;
    this.meshes[index] = mesh;
    this.lights[index] = lightBase(this.spec.stone ?? 'gem', tint);
    sized.add(mesh);
  }

  skipLetter(index: number): void {
    this.filled[index] = null;
    this.meshes[index] = null;
    this.lights[index] = null;
  }

  /** One part per letter that drew stones — a field moves and lights together, as a chunk does. */
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
        undefined,
        this.spec.fill,
      ),
      mesh: this.meshes[slot] as THREE.InstancedMesh,
      slot,
    }));
  }

  frame(index: number, opacity: number): void {
    const material = this.filled[index]?.material;
    if (!material) return;
    material.opacity = opacity * this.base.opacity;
    material.emissiveIntensity = this.base.emissiveIntensity;
    const light = this.lights[index];
    if (light) material.emissive.setHex(light.emissive);
  }

  /** The wells are the body, which already spans the letter, so there is no box of its own. */
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
    // Builder-owned, unlike `ctx.glyph()`'s — see `bodyGeometry` on the interface.
    this.bodies.dispose();
    for (const filled of this.filled) {
      filled?.geometry.dispose();
      filled?.material.dispose();
    }
    this.filled.length = 0;
    // The instanced meshes' own buffers go with the owning Word's scene traversal, as a chunk
    // field's do; dropping them here without it leaks an instanceMatrix per letter.
    this.meshes.length = 0;
    this.lights.length = 0;
    this.cuts.clear();
  }
}
