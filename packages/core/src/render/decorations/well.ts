import type * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { GlyphCache } from '../../text/glyphs.js';
import type { WellSpec } from '../decoration.js';
import { cutterFor } from '../wells/cutters.js';
import { buildPlate } from '../wells/plate.js';
import { regionOf } from '../wells/region.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

/**
 * A letter carved with wells. Everything it makes is the body, so it adds nothing to the letter
 * group and contributes no parts — the fill that sits in a well is what will bring both.
 */
export class WellBuilder implements DecorationBuilder {
  /** One body per char: a letter's wells cannot depend on its neighbours. */
  private readonly bodies: GlyphCache<THREE.BufferGeometry>;

  constructor(spec: WellSpec, ctx: WordBuildContext) {
    this.bodies = new GlyphCache<THREE.BufferGeometry>((char, depth) => {
      const shapes = ctx.shapes(char);
      const cut = cutterFor(spec.cutter)(shapes, regionOf(shapes), spec);
      return buildPlate(shapes, cut, { depth, bezel: spec.bezel });
    });
  }

  bodyGeometry(char: string, depth: number): THREE.BufferGeometry {
    return this.bodies.get(char, depth);
  }

  buildLetter(): void {}

  skipLetter(): void {}

  /** No parts until a fill occupies the wells; `PartKind` stays closed in this slice. */
  collectParts(): DecorationPart[] {
    return [];
  }

  frame(): void {}

  /** The wells are the body, which already spans the letter, so there is no box of its own. */
  boundsAt(): THREE.Box2 | null {
    return null;
  }

  applyGradientBounds(): void {}

  /** Unreachable: `collectParts()` answers none, so `Word` never routes a write here. */
  writePart(_part: DecorationPart, _out: ResolvedOffset): void {}

  dispose(): void {
    // Builder-owned, unlike `ctx.glyph()`'s — see `bodyGeometry` on the interface.
    this.bodies.dispose();
  }
}
