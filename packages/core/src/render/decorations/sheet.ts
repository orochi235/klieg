import * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache } from '../../text/glyphs.js';
import type { SheetSpec } from '../decoration.js';
import { DEFAULT_INFLATE } from '../inflate.js';
import {
  applyLook,
  type FrameOwnedBase,
  frameOwnedBase,
  type LightBase,
  lightBase,
  litEmissive,
} from '../looks.js';
import {
  type BakedSheet,
  bakeSheet,
  markSheet,
  maskMaterial,
  SHEET_BODY,
  type SheetLetter,
  sheetLetterOf,
  sheetUniforms,
} from '../wells/sheet.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;
/** Room past the glyph on every side, so the sheet has whole cells where the mask cuts it. */
const MARGIN = 0.08;
/** How far one letter's patch of the sheet may sit from another's, in em: six cells or so. */
export const SLACK = 0.3;
/** Ordinary text's glyph extent in em, so warm-up bakes the sheet nearly every word uses. */
const ORDINARY = new THREE.Box2(new THREE.Vector2(-0.05, -0.25), new THREE.Vector2(0.95, 0.8));

const frac = (n: number) => n - Math.floor(n);

/**
 * Where letter `slot` sits on the sheet. Fixed per slot, so each fire of a word shows the same
 * patches, until a glyph bigger than ordinary text grows the sheet and moves its lattice.
 */
export function slideOf(slot: number): THREE.Vector2 {
  return new THREE.Vector2(-SLACK * frac(slot * 0.618034), -SLACK * frac(slot * 0.381966 + 0.1));
}

/** `object` turned onto the letter's back: mirrored through its middle. */
function turned<T extends THREE.Object3D>(object: T): T {
  object.position.z = DEPTH;
  object.scale.z = -1;
  return object;
}

/**
 * Pavé as one baked sheet shown through each letter, front and back, under a rim on the seam.
 *
 * The sheet's metal and the rim draw on the body's own material, hung off the body mesh, so every
 * write the body gets lands on them too. The stones are the one part this contributes.
 *
 * The metal fades by dither, not by blending, so a see-through look (base opacity below 1) is a
 * stipple rather than a tint.
 */
export class SheetBuilder implements DecorationBuilder {
  /** One marked clone per char, builder-owned; the cache's glyph stays unmarked for other looks. */
  private readonly bodies: GlyphCache<THREE.BufferGeometry>;
  /** Per letter slot, so an effect can reach one letter's stones without its neighbors'. */
  private readonly materials: (THREE.MeshPhysicalMaterial | null)[] = [];
  private readonly meshes: (THREE.Mesh | null)[] = [];
  private readonly lights: (LightBase | null)[] = [];
  private readonly base: FrameOwnedBase;
  /** Each char's outline box, which the sheet is sized from. */
  private readonly glyphBoxes = new Map<string, THREE.Box2>();
  /** Drawless geometry for each stone part's carrier, shared by every letter. */
  private readonly carrier = new THREE.BufferGeometry();

  constructor(
    private readonly spec: SheetSpec,
    private readonly ctx: WordBuildContext,
  ) {
    if (ctx.inflate && { ...DEFAULT_INFLATE, ...ctx.inflate }.profile !== 'flat') {
      throw new Error(
        "klieg: a 'sheet' decoration needs a flat letter; carve an inflated one with 'well'",
      );
    }
    this.base = frameOwnedBase(spec.stone ?? 'gem');
    this.bodies = new GlyphCache<THREE.BufferGeometry>((char, depth) => {
      const body = ctx.glyph(char, depth).clone();
      markSheet(body, SHEET_BODY);
      return body;
    });
  }

  prime(chars: readonly string[]): void {
    const glyphs = new THREE.Box2();
    for (const char of new Set(chars)) glyphs.union(this.boxOf(char));
    if (!glyphs.isEmpty()) this.sheetOver(glyphs);
  }

  bodyGeometry(char: string, depth: number): THREE.BufferGeometry {
    return this.bodies.get(char, depth);
  }

  dressBody(index: number, char: string, body: THREE.Mesh): void {
    const sheet = this.sheetFor(char);
    const letter = this.letterOf(char);
    const shift = slideOf(index);
    const material = body.material as THREE.MeshPhysicalMaterial;
    maskMaterial(material, sheetUniforms(letter, shift), 'body');
    // Opaque, fading by dither: three's transmission pass samples only opaque objects, so the
    // stones would otherwise refract the background instead of the gold behind them.
    material.alphaHash = true;
    material.transparent = false;
    material.depthWrite = true;

    const front = new THREE.Mesh(sheet.shell, material);
    front.position.set(shift.x, shift.y, 0);
    const back = turned(new THREE.Mesh(sheet.shell, material));
    back.position.x = shift.x;
    back.position.y = shift.y;
    body.add(
      front,
      back,
      new THREE.Mesh(letter.rim, material),
      turned(new THREE.Mesh(letter.rim, material)),
    );
  }

  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void {
    this.skipLetter(index);
    if (!this.spec.fill) return;
    const sheet = this.sheetFor(char);
    if (!sheet.stones) return;

    const shift = slideOf(index);
    const material = this.ctx.studioMaterial();
    applyLook(material, this.spec.stone ?? 'gem', tint);
    material.thickness = sheet.thickness;
    material.transparent = true;
    material.opacity = this.base.opacity;
    material.emissiveIntensity = this.base.emissiveIntensity;
    maskMaterial(material, sheetUniforms(this.letterOf(char), shift), 'stones');

    const slid = new THREE.Group();
    slid.position.set(shift.x, shift.y, 0);
    slid.add(
      new THREE.Mesh(sheet.stones, material),
      turned(new THREE.Mesh(sheet.stones, material)),
    );
    // The part is a carrier at the letter's origin, so an effect's scale pivots there rather than
    // at the slide, which would walk the stones off their pockets.
    const mesh = new THREE.Mesh(this.carrier, material);
    mesh.layers.disableAll();
    mesh.add(slid);
    sized.add(mesh);

    this.materials[index] = material;
    this.meshes[index] = mesh;
    this.lights[index] = lightBase(this.spec.stone ?? 'gem', tint);
  }

  skipLetter(index: number): void {
    this.materials[index] = null;
    this.meshes[index] = null;
    this.lights[index] = null;
  }

  /** One part per letter that drew stones, as the carved wells contribute. */
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
      mesh: this.meshes[slot] as THREE.Mesh,
      slot,
    }));
  }

  frame(index: number, opacity: number): void {
    const material = this.materials[index];
    if (!material) return;
    material.opacity = opacity * this.base.opacity;
    material.emissiveIntensity = this.base.emissiveIntensity;
    const light = this.lights[index];
    if (light) material.emissive.setHex(light.emissive);
  }

  /** The sheet shows only within its letter, so there is no box of its own. */
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
    // The sheet and every mask and rim belong to the caches, which outlive this word.
    this.bodies.dispose();
    this.carrier.dispose();
    this.glyphBoxes.clear();
    for (const material of this.materials) material?.dispose();
    this.materials.length = 0;
    this.meshes.length = 0;
    this.lights.length = 0;
  }

  /** `char`'s outline box, empty for a glyph that drew no ink. Shared: never mutate it. */
  private boxOf(char: string): THREE.Box2 {
    let box = this.glyphBoxes.get(char);
    if (!box) {
      box = new THREE.Box2();
      if (this.ctx.glyph(char, DEPTH).attributes.position?.count) {
        for (const shape of this.ctx.shapes(char)) {
          for (const point of shape.getPoints(24)) box.expandByPoint(point);
        }
      }
      this.glyphBoxes.set(char, box);
    }
    return box;
  }

  private sheetFor(char: string): BakedSheet {
    return this.sheetOver(this.boxOf(char));
  }

  /**
   * The shared sheet, grown if it must be to hold `glyphs`, ordinary text, the margin and any
   * letter's slide.
   */
  private sheetOver(glyphs: THREE.Box2): BakedSheet {
    const need = glyphs.clone().union(ORDINARY).expandByScalar(MARGIN);
    need.max.addScalar(SLACK);
    return this.ctx.caches.sheet(this.spec, need, (box) => bakeSheet(box, this.spec));
  }

  private letterOf(char: string): SheetLetter {
    return this.ctx.caches.sheetLetter(this.ctx.font, char, () =>
      sheetLetterOf(this.ctx.shapes(char)),
    );
  }
}
