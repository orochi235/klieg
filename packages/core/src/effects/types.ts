import type { LetterInfo, StaggerSpec } from '../motion/types.js';
import type { Vec3 } from '../pose.js';
import type { SelectSpec } from '../select.js';

/** What an effect can address. A part is the smallest thing below a letter. */
export type PartKind = 'run' | 'body';

/**
 * One addressable part, described the way `LetterInfo` describes a letter. The pool is word-wide,
 * so `index` and `count` span the whole sign rather than one letter.
 */
export interface PartInfo {
  kind: PartKind;
  index: number;
  count: number;
  /** The letter this part belongs to, so a piece can order by letter as well as by part. */
  letter: LetterInfo;
  /** Layout position in em, relative to the block centre. */
  x: number;
  y: number;
  /** The letter's place in the laid-out block, so `stagger`'s `grid` order has something to read. */
  line?: number;
  column?: number;
  lineCount?: number;
  columnCount?: number;
  /** Fraction of the pool's extent lying before this part, and this part's share of it. */
  at: number;
  span: number;
}

/** A relative contribution. Omitted fields mean "no contribution", as `PoseOffset` does. */
export interface PartOffset {
  /** Multiplies the part's emissive. */
  gain?: number;
  color?: number;
  /** 0..1 toward a tube decoration's `dark` material. Composited but not yet written: the swap
   * between the lit and dark materials a tube decoration already builds is its own step. */
  dark?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  /** Shifts the colour ramp along the part. Needs a look with a `gradient`; without a
   * ramp there is nothing to shift. */
  crawl?: number;
  /** Light landing on the part, added from zero. Lamps sum. A multiplier cannot express this:
   * `emissive` defaults to black, so scaling it is a no-op on every look but `neon`. */
  light?: LightOffset;
}

/** One lamp's contribution to a part. */
export interface LightOffset {
  color: number;
  amount: number;
}

/** Everything a merge resolved. Multiplicative channels rest at 1, additive at 0. */
export interface ResolvedOffset {
  gain: number;
  color?: number;
  dark: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  crawl: number;
  /** Accumulated lamp colour, premultiplied by amount. sRGB-encoded 0..1 per channel, matching
   * the hex the authoring form takes — not linear radiance. */
  light: Vec3;
}

/** What every lighting piece and light source reads for one frame. */
export interface FrameCtx {
  /** -1..1 over the canvas box, +y down, or null until the pointer has been inside it. */
  pointer: { x: number; y: number } | null;
  /** The same pointer stretched onto the word's layout space — the em, block-relative space
   * `PartInfo.x/y` uses, +y up. The canvas's whole -1..1 covers the word's extent per axis
   * rather than projecting onto it, so on a sign that does not fill the canvas the point
   * travels further than the cursor. The extent is the one the word was built with, so after a
   * `stages` regroup this addresses the original layout rather than where the letters now are.
   * Null whenever `pointer` is. */
  pointerInWord: { x: number; y: number } | null;
  /** Milliseconds since the previous frame, and `Infinity` under reduced motion. Read it to snap
   * to a target, never to integrate: one infinite frame leaves an accumulator `NaN` for good. */
  dt: number;
}

export interface EffectPiece {
  /** Milliseconds for one pass. Loops. Zero does not hold a piece still — the pass never advances,
   * which pins a time-driven source such as `orbit` at its starting angle for good. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  at(t: number, part: PartInfo, ctx: FrameCtx): PartOffset;
}

export type EffectName = 'flicker' | 'hue' | 'chase';

export interface EffectSpec {
  piece: EffectName | EffectPiece;
  /** Which parts, out of the word's pool of that kind. */
  target: { kind: PartKind } & SelectSpec;
  /** Per-part phase spread. */
  stagger?: number | StaggerSpec;
  /** Fixes the selection so a pinned frame is reproducible. */
  seed?: number;
}
