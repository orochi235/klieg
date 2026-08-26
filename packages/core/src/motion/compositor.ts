import type { Pose, PoseOffset } from '../pose.js';
import { REST } from '../pose.js';
import type { LetterInfo, MotionPiece } from './types.js';

/** A fresh pose at rest, for callers that do not keep their own scratch. */
export const blankPose = (): Pose => ({
  position: [...REST.position],
  rotation: [...REST.rotation],
  scale: REST.scale,
  opacity: REST.opacity,
});

/**
 * `scaleOffset` then `accumulate`, fused and in place. Additive channels fade toward 0 and
 * multiplicative ones toward 1 — scaling those toward 0 would collapse the word rather than
 * remove the contribution.
 */
function addScaled(out: Pose, o: PoseOffset, weight: number): void {
  if (o.position) {
    for (let i = 0; i < 3; i++) {
      out.position[i] = (out.position[i] as number) + (o.position[i] as number) * weight;
    }
  }
  if (o.rotation) {
    for (let i = 0; i < 3; i++) {
      out.rotation[i] = (out.rotation[i] as number) + (o.rotation[i] as number) * weight;
    }
  }
  if (o.scale !== undefined) out.scale *= 1 + (o.scale - 1) * weight;
  if (o.opacity !== undefined) out.opacity *= 1 + (o.opacity - 1) * weight;
}

/** One piece, or several layered together — `['float', 'shimmer']` runs both at once. */
export type Slot = MotionPiece | MotionPiece[];

export interface TimelineOptions {
  enter: Slot;
  active: Slot;
  exit: Slot;
  /** Milliseconds in the active phase, or held open until `release()`. */
  hold: number | 'until-release';
  /** Crossfade window straddling each phase boundary. */
  blendMs: number;
}

const layers = (slot: Slot): MotionPiece[] => (Array.isArray(slot) ? slot : [slot]);

/** A layered slot lasts as long as its longest member. */
export const slotDuration = (slot: Slot): number =>
  Math.max(0, ...layers(slot).map((p) => p.duration));

const SAMPLE_T = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1];
const SAMPLE_LETTERS = 8;

const shifts = (v: readonly number[] | undefined): boolean => v?.some((n) => n !== 0) ?? false;

/**
 * Whether a slot puts any letter anywhere but its layout position. Sampled rather than declared:
 * `offset` is a pure function, so a caller's own piece is judged exactly as a built-in is.
 * Opacity is not movement — a fading letter stays where the DOM layer put it.
 */
export function slotMovesLetters(slot: Slot): boolean {
  for (const piece of layers(slot)) {
    for (const t of SAMPLE_T) {
      for (let index = 0; index < SAMPLE_LETTERS; index++) {
        const o = piece.offset(t, { index, count: SAMPLE_LETTERS, line: 0, column: index });
        if (shifts(o.position) || shifts(o.rotation)) return true;
        if (o.scale !== undefined && o.scale !== 1) return true;
      }
    }
  }
  return false;
}

interface Segment {
  pieces: MotionPiece[];
  start: number;
  end: number;
  loop: boolean;
  duration: number;
}

export class Timeline {
  duration: number;
  private segments: Segment[];
  private readonly blend: number;
  private readonly opts: TimelineOptions;
  private held: boolean;

  constructor(opts: TimelineOptions) {
    this.opts = opts;
    this.blend = opts.blendMs;
    this.held = opts.hold === 'until-release';
    this.duration = 0;
    this.segments = [];
    this.build(this.held ? Number.POSITIVE_INFINITY : (opts.hold as number));
  }

  private build(hold: number): void {
    const enterEnd = slotDuration(this.opts.enter);
    const activeEnd = enterEnd + hold;
    const activeFor = slotDuration(this.opts.active);
    this.duration = activeEnd + slotDuration(this.opts.exit);
    this.segments = [
      { pieces: layers(this.opts.enter), start: 0, end: enterEnd, loop: false, duration: enterEnd },
      {
        pieces: layers(this.opts.active),
        start: enterEnd,
        end: activeEnd,
        loop: true,
        duration: activeFor,
      },
      {
        pieces: layers(this.opts.exit),
        start: activeEnd,
        end: this.duration,
        loop: false,
        duration: slotDuration(this.opts.exit),
      },
    ].filter((seg) => seg.end > seg.start);
  }

  /**
   * Ends the held active phase at `elapsed` and lets the exit run. A no-op on a numeric hold or a
   * second call, so a double click cannot truncate an exit already underway.
   */
  release(elapsed: number): void {
    if (!this.held) return;
    this.held = false;
    this.build(Math.max(0, elapsed - slotDuration(this.opts.enter)));
  }

  isFinished(elapsed: number): boolean {
    return elapsed >= this.duration;
  }

  /**
   * Writes the composed pose into `out` and returns it. An explicit out-parameter rather than a
   * quietly reused return value: this runs once per letter per frame, and an aliased return is a
   * trap for the next caller who retains what they were handed.
   */
  poseAt(elapsed: number, letter: LetterInfo, out: Pose = blankPose()): Pose {
    let total = 0;
    for (const seg of this.segments) total += Math.max(0, this.weight(seg, elapsed));

    // Pairwise-complementary ramps sum to 1, but a `hold` shorter than `blendMs` overlaps all
    // three phases at once and the total runs past 1 — which reads as the word lurching.
    const norm = total > 1 ? 1 / total : 1;

    out.position[0] = 0;
    out.position[1] = 0;
    out.position[2] = 0;
    out.rotation[0] = 0;
    out.rotation[1] = 0;
    out.rotation[2] = 0;
    out.scale = 1;
    out.opacity = 1;

    for (const seg of this.segments) {
      const weight = this.weight(seg, elapsed);
      if (weight <= 0) continue;
      const t = this.localT(seg, elapsed);
      // Layers within a slot share its weight; `accumulate` already took a list, so nothing about
      // the blend math changes.
      for (const piece of seg.pieces) {
        addScaled(out, piece.offset(t, letter), weight * norm);
      }
    }

    return out;
  }

  /** Ramps 0→1 over the blend window at the segment's leading edge and back down at its trailing. */
  private weight(seg: Segment, elapsed: number): number {
    const half = this.blend / 2;
    const head = seg.start - half;
    const tail = seg.end + half;

    // Whichever phase starts at 0 and whichever ends at `duration` hold full weight past that edge
    // rather than fading to nothing; a zero-length enter makes `active` the former. Windowing them
    // would drop the word to rest on the last frame, which callers clamp to exactly `duration`.
    const atStart = seg.start === 0;
    const atEnd = seg.end === this.duration;
    if ((!atStart && elapsed < head) || (!atEnd && elapsed >= tail)) return 0;

    const inW = atStart ? 1 : this.ramp(elapsed - head);
    const outW = atEnd ? 1 : this.ramp(tail - elapsed);
    return Math.min(inW, outW);
  }

  private ramp(into: number): number {
    return this.blend > 0 ? Math.min(1, into / this.blend) : 1;
  }

  private localT(seg: Segment, elapsed: number): number {
    const into = elapsed - seg.start;

    if (seg.loop) {
      const d = seg.duration;
      if (d <= 0) return 0;
      return (((into % d) + d) % d) / d;
    }

    return Math.max(0, Math.min(1, into / (seg.end - seg.start)));
  }
}
