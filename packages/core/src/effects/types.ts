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
  /** Fraction of the pool's extent lying before this part, and this part's share of it. */
  at: number;
  span: number;
}

/** A relative contribution. Omitted fields mean "no contribution", as `PoseOffset` does. */
export interface PartOffset {
  /** Multiplies the part's emissive. */
  gain?: number;
  color?: number;
  /** 0..1 toward a tube decoration's `dark` material. */
  dark?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  /** Shifts the colour ramp along the part. Inert until the crawl step lands. */
  crawl?: number;
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
}

export interface EffectPiece {
  /** Milliseconds for one pass. Loops. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  at(t: number, part: PartInfo): PartOffset;
}

export type EffectName = 'flicker';

export interface EffectSpec {
  piece: EffectName | EffectPiece;
  /** Which parts, out of the word's pool of that kind. */
  target: { kind: PartKind } & SelectSpec;
  /** Per-part phase spread. */
  stagger?: number | StaggerSpec;
  /** Fixes the selection so a pinned frame is reproducible. */
  seed?: number;
}
