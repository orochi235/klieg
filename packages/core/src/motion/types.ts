import type { PoseOffset } from '../pose.js';

export interface LetterInfo {
  /** 0-based position in the word, whitespace included. */
  index: number;
  /** Total letters in the word. */
  count: number;
  /** 0-based line within the block. */
  line?: number;
  /** 0-based column within its own line. */
  column?: number;
  lineCount?: number;
  /** The widest line's length, so a short line's columns do not stretch to fill it. */
  columnCount?: number;
  /** Layout position in em, relative to the block centre. Negate it to travel to the centre. */
  x?: number;
  y?: number;
  /** True once a regroup has dropped this letter: it is playing its exit and will not be back. */
  leaving?: boolean;
}

export interface MotionPiece {
  /** Milliseconds for one pass. `active` pieces loop; `enter`/`exit` run once. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  offset(t: number, letter: LetterInfo): PoseOffset;
  /** Rakes the environment highlight rather than moving the letters. See the `lighting` option. */
  envRotation?: boolean;
}

export type EnterName = 'slam' | 'spin' | 'flip' | 'assemble' | 'rise' | 'none';
export type ActiveName = 'float' | 'pulse' | 'shimmer' | 'none';
export type ExitName = 'shatter' | 'drop' | 'recede' | 'fade' | 'none';

export type StaggerFrom = 'start' | 'end' | 'center' | 'edges' | 'random';

export interface StaggerSpec {
  /** Fraction of the pass consumed by the ramp-in. Ignored when `each` is given. */
  spread?: number;
  /** Fraction of the pass between consecutive letters; `spread = each × count`. */
  each?: number;
  from?: StaggerFrom;
  /** Order by position in the block rather than by reading order. */
  grid?: boolean;
}

/** Deterministic, so screenshots comparing frames across runs stay stable. A seeded generator
 * whose call order depends on letter count would not be. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * What ordering a pool needs: position within it, and optionally where its member sits in the
 * laid-out block. `LetterInfo` satisfies it, and so does a part of a letter.
 */
export interface Ordered {
  index: number;
  count: number;
  line?: number;
  column?: number;
  lineCount?: number;
  columnCount?: number;
}

/** Radial distance from the middle of the laid-out block, 0 at the center and 1 at a corner. */
function radial(item: Ordered): number {
  const multiRow = (item.lineCount ?? 1) > 1;
  const cols = Math.max(1, (item.columnCount ?? 1) - 1);
  const rows = Math.max(1, (item.lineCount ?? 1) - 1);
  const dx = (item.column ?? 0) / cols - 0.5;
  const dy = multiRow ? (item.line ?? 0) / rows - 0.5 : 0;
  // Normalized against this block's own corner, not a constant: dividing by a fixed factor
  // clamps every letter of a wide block to 1 and flattens the ripple to nothing.
  const corner = Math.hypot(0.5, multiRow ? 0.5 : 0);
  return Math.min(1, Math.hypot(dx, dy) / corner);
}

/** Distance from the middle of the word in reading order, 0 at the center and 1 at either end. */
function fromMiddle(item: Ordered): number {
  const mid = (Math.max(1, item.count) - 1) / 2;
  return mid > 0 ? Math.abs(item.index - mid) / mid : 0;
}

/** Where a pool member sits in the stagger order: 0 goes first, 1 goes last. */
export function orderKey(item: Ordered, spec: StaggerSpec = {}): number {
  const from = spec.from ?? 'start';
  // `grid` only changes what "middle" means; reading order is already the same either way.
  const middle = spec.grid && item.column !== undefined ? radial(item) : fromMiddle(item);

  switch (from) {
    case 'random':
      return hash01(item.index);
    case 'end':
      return 1 - item.index / Math.max(1, item.count);
    case 'center':
      return middle;
    case 'edges':
      return 1 - middle;
    default:
      return item.index / Math.max(1, item.count);
  }
}

/** Stagger helper: returns 0..1 for how far along member `index` should be at word-time `t`. */
export function stagger(t: number, item: Ordered, spec: number | StaggerSpec = 0.5): number {
  const resolved: StaggerSpec = typeof spec === 'number' ? { spread: spec } : spec;
  const count = Math.max(1, item.count);
  const spread =
    resolved.each !== undefined ? Math.min(1, resolved.each * count) : (resolved.spread ?? 0.5);

  const start = orderKey(item, resolved) * spread;
  // spread=1 would make span 0, and (t - start) is also 0 at t=start — 0/0 is NaN, which
  // clamps straight through into a transform and makes the letter vanish silently.
  const span = Math.max(1e-6, 1 - spread);
  return Math.max(0, Math.min(1, (t - start) / span));
}

export const NONE: MotionPiece = { duration: 0, offset: () => ({}) };
