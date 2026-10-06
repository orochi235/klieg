import { type Mix, mix, patch } from '@msb235/blits';
import type { Pose } from '../pose.js';
import { POSE_CHANNELS, POSE_KIT, REST } from '../pose.js';

import { type Layered, type LetterInfo, layersOf, type MotionPatch } from './types.js';

/** A fresh pose at rest, for callers that do not keep their own scratch. */
export const blankPose = (): Pose => ({
  position: [...REST.position],
  rotation: [...REST.rotation],
  scale: REST.scale,
  opacity: REST.opacity,
});

/**
 * The pose source for a word that is placed once and never moved. `Word.apply` still runs its
 * effects — what this withholds is the motion slots, not the frame.
 */
export const PLACED = {
  poseAt(_elapsed: number, _letter: LetterInfo, out: Pose = blankPose()): Pose {
    out.position[0] = REST.position[0];
    out.position[1] = REST.position[1];
    out.position[2] = REST.position[2];
    out.rotation[0] = REST.rotation[0];
    out.rotation[1] = REST.rotation[1];
    out.rotation[2] = REST.rotation[2];
    out.scale = REST.scale;
    out.opacity = REST.opacity;
    return out;
  },
};

/** One patch, or several layered together — `['float', 'shimmer']` runs both at once. */
export type Slot = MotionPatch | Layered<MotionPatch>;

export interface TimelineOptions {
  enter: Slot;
  active: Slot;
  exit: Slot;
  /** Milliseconds in the active segment, or held open until `release()`. */
  hold: number | 'until-release';
  /** Crossfade window straddling each segment boundary. */
  blendMs: number;
}

const layers = (slot: Slot): readonly MotionPatch[] => layersOf(slot);

/** A layered slot lasts as long as its longest member. */
export const slotDuration = (slot: Slot): number =>
  Math.max(0, ...layers(slot).map((p) => p.duration));

const SAMPLE_PHASES = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1];
const SAMPLE_LETTERS = 8;

const shifts = (v: readonly number[] | undefined): boolean => v?.some((n) => n !== 0) ?? false;

/**
 * Whether a slot puts any letter anywhere but its layout position. Sampled rather than declared:
 * `at` is a pure function, so a caller's own patch is judged exactly as a built-in is.
 * Opacity is not movement — a fading letter stays where the DOM layer put it.
 */
export function slotMovesLetters(slot: Slot): boolean {
  for (const layer of layers(slot)) {
    for (const phase of SAMPLE_PHASES) {
      for (let index = 0; index < SAMPLE_LETTERS; index++) {
        const o = layer.at(phase, { index, count: SAMPLE_LETTERS, line: 0, column: index });
        if (shifts(o.position) || shifts(o.rotation)) return true;
        if (o.scale !== undefined && o.scale !== 1) return true;
      }
    }
  }
  return false;
}

type SlotName = 'enter' | 'active' | 'exit';

interface Segment {
  name: SlotName;
  start: number;
  end: number;
  loop: boolean;
  /** One pass, ms: the slot's own length for the looping active segment, the whole span otherwise. */
  period: number;
}

export class Timeline {
  duration: number;
  /** Where the enter patch's duration ends. Fixed: `release()` only moves what comes after it. */
  readonly enterEnd: number;
  /** Where the hold ends and the exit begins. `Infinity` on a held timeline until `release()`. */
  activeEnd: number;
  private segments: Segment[];
  private readonly blend: number;
  private readonly opts: TimelineOptions;
  private held: boolean;
  /**
   * One voice per layer of each segment, which the mix starts, loops and holds at its edges; its
   * weight is this timeline's crossfade. No voice fades, and each holds both edges, so none ever
   * leaves the mix and `poseAt` can read back in time. `release` re-cues rather than retimes.
   */
  private mix: Mix<LetterInfo, Pose>;
  /** The reading in progress, which every voice's weight is asked about. */
  private at = 0;
  /** `norm` for one reading, memoized: every voice asks for it and it is the same answer. */
  private normAt = Number.NaN;
  private norm = 1;

  constructor(opts: TimelineOptions) {
    this.opts = opts;
    this.blend = opts.blendMs;
    this.held = opts.hold === 'until-release';
    this.duration = 0;
    this.enterEnd = slotDuration(opts.enter);
    this.activeEnd = 0;
    this.segments = [];
    this.build(this.held ? Number.POSITIVE_INFINITY : (opts.hold as number));
    this.mix = this.cue();
  }

  /**
   * A voice per layer rather than one per slot, and no locus: layers and segments both stack, so the
   * mix must join them the way the channel says. A shared locus would fold them as alternatives.
   */
  private cue(): Mix<LetterInfo, Pose> {
    const cued = mix<LetterInfo, Pose>(POSE_KIT, {});
    for (const seg of this.segments) {
      for (const layer of layers(this.opts[seg.name])) {
        cued.cue({
          patch: patch<LetterInfo, Pose>(seg.period, (phase, letter) => layer.at(phase, letter), {
            writes: POSE_CHANNELS,
          }),
          start: seg.start,
          loop: seg.loop && seg.period > 0 ? true : 1,
          freeze: 'both',
          weight: () => this.weightAt(seg, this.at),
        });
      }
    }
    return cued;
  }

  private build(hold: number): void {
    const enterEnd = this.enterEnd;
    const activeEnd = enterEnd + hold;
    this.activeEnd = activeEnd;
    this.duration = activeEnd + slotDuration(this.opts.exit);
    this.segments = (
      [
        { name: 'enter', start: 0, end: enterEnd, loop: false, period: enterEnd },
        {
          name: 'active',
          start: enterEnd,
          end: activeEnd,
          loop: true,
          period: slotDuration(this.opts.active),
        },
        {
          name: 'exit',
          start: activeEnd,
          end: this.duration,
          loop: false,
          period: this.duration - activeEnd,
        },
      ] satisfies Segment[]
    ).filter((seg) => seg.end > seg.start);
    this.normAt = Number.NaN;
  }

  /**
   * Ends the held active segment at `elapsed` and lets the exit run. A no-op on a numeric hold or a
   * second call, so a double click cannot truncate an exit already underway. The active segment ends
   * half a blend later, so the crossfade into the exit starts at `elapsed` rather than before it.
   */
  release(elapsed: number): void {
    if (!this.held) return;
    this.held = false;
    const lead = slotDuration(this.opts.exit) > 0 ? this.blend / 2 : 0;
    this.build(Math.max(0, elapsed + lead - this.enterEnd));
    this.mix = this.cue();
  }

  isFinished(elapsed: number): boolean {
    return elapsed >= this.duration;
  }

  /** The first instant the word is in its hold at full weight: the enter's blend into it is over. */
  get settledAt(): number {
    if (this.enterEnd === 0) return 0;
    return Math.min(this.enterEnd + this.blend / 2, this.activeEnd);
  }

  /**
   * Writes the composed pose into `out` and returns it. An explicit out-parameter rather than a
   * quietly reused return value: this runs once per letter per frame, and an aliased return is a
   * trap for the next caller who retains what they were handed.
   */
  poseAt(elapsed: number, letter: LetterInfo, out: Pose = blankPose()): Pose {
    this.at = elapsed;
    this.mix.sync(elapsed);
    return this.mix.probe(letter, out);
  }

  /**
   * The segment's own ramp, times the guard against three segments overlapping at once. Pairwise-
   * complementary ramps sum to 1, but a `hold` shorter than `blendMs` overlaps all three and the
   * total runs past 1 — which reads as the word lurching.
   */
  private weightAt(seg: Segment, elapsed: number): number {
    const own = this.weight(seg, elapsed);
    if (own <= 0) return 0;
    if (this.normAt !== elapsed) {
      let total = 0;
      for (const other of this.segments) total += Math.max(0, this.weight(other, elapsed));
      this.norm = total > 1 ? 1 / total : 1;
      this.normAt = elapsed;
    }
    return own * this.norm;
  }

  /** Ramps 0→1 over the blend window at the segment's leading edge and back down at its trailing. */
  private weight(seg: Segment, elapsed: number): number {
    const half = this.blend / 2;
    const head = seg.start - half;
    const tail = seg.end + half;

    // Whichever segment starts at 0 and whichever ends at `duration` hold full weight past that edge
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
}
