import { type Easing, easeInOutCubic, easeOutCubic } from '../easing.js';
import type { Pose } from '../pose.js';
import type { Arrangement } from '../text/placement.js';
import { partition, transition } from './build.js';
import { blankPose, type Slot, slotDuration, Timeline } from './compositor.js';
import type { LetterInfo, MotionPiece } from './types.js';
import { NONE } from './types.js';

/** What a regroup told the sequence about the letters it moved. */
export interface RegroupResult {
  /** Slot indices that survived, in their new reading order. */
  kept: number[];
  /** Slot indices that did not; still parked at their old layout positions. */
  dropped: number[];
  /** Per slot, the offset from the new layout position back to the old one. */
  delta: [number, number][];
}

/** The `Word` side of a stage boundary, narrow enough to stub in a test. */
export interface StageTarget {
  regroup(keep: (letter: LetterInfo) => boolean, as: Arrangement | undefined): RegroupResult;
  retire(slots: readonly number[]): void;
  setFitProgress(u: number): void;
}

export interface TweenPlan {
  duration?: number;
  ease?: Easing;
  /**
   * How long a channel waits before starting: `position` as a fraction of the move, `scale` — the
   * viewport fit — as a fraction of the whole slot, so it can be held back past a longer exit.
   */
  delayBy?: { position?: number; scale?: number };
}

export interface StagePlan {
  keep?: (letter: LetterInfo) => boolean;
  exit: Slot;
  as?: Arrangement;
  active: Slot;
  hold: number | 'click';
  tween: TweenPlan;
}

export interface SequenceOptions {
  enter: Slot;
  /** The opening phase's active slot; each stage carries its own. */
  active: Slot;
  stages: StagePlan[];
  exit: Slot;
  hold: number | 'click';
  blendMs: number;
  target: StageTarget;
  /**
   * Called as each stage's boundary lands, with that stage's index. Never called for the opening
   * word, which is phase -1 and has no boundary behind it.
   */
  onStage?: (index: number) => void;
}

const DEFAULT_MOVE_MS = 700;

/** A stage boundary still playing out: what the regroup moved, and the clock the sequence runs. */
interface Boundary {
  result: RegroupResult;
  /** The stage's motion slot — the move or the exit, whichever is longer. */
  span: number;
  /**
   * When the dropped letters come off screen: their exit has played out, and the blend into the
   * next phase — which ramps that exit back off, since the slot it sits in is an enter — has not
   * opened yet.
   */
  retireAt: number;
  retired: boolean;
  /** Fraction of `span` the fit waits out before it starts. */
  fitDelay: number;
}

/**
 * Plays the opening phase, then one stage after another, then the exit. Each phase is an ordinary
 * `Timeline` on its own clock; the sequence is what happens between them — the regroup, retiring
 * the letters that left, and the viewport fit catching up.
 */
export class Sequence {
  private readonly opts: SequenceOptions;
  private phase = -1;
  private phaseStart = 0;
  private timeline: Timeline;
  private pending: Boundary | null = null;

  constructor(opts: SequenceOptions) {
    this.opts = opts;
    this.timeline = this.openingTimeline();
  }

  private openingTimeline(): Timeline {
    const last = this.opts.stages.length === 0;
    return new Timeline({
      enter: this.opts.enter,
      active: this.opts.active,
      exit: last ? this.opts.exit : NONE,
      hold: this.opts.hold === 'click' ? 'until-release' : this.opts.hold,
      blendMs: this.opts.blendMs,
    });
  }

  /** Advances the stage if the current phase has run out, and keeps the fit moving. */
  tick(elapsed: number): void {
    // Stops on the last stage rather than one past it: that timeline carries the closing exit, and
    // rebasing `phaseStart` onto it would restart its clock and the sequence would never finish.
    while (
      this.phase < this.opts.stages.length - 1 &&
      this.timeline.isFinished(this.local(elapsed))
    ) {
      this.enterNextPhase();
    }
    const boundary = this.pending;
    if (!boundary) return;

    const into = this.local(elapsed);
    if (into >= boundary.retireAt) this.retire(boundary);
    if (into >= boundary.span) {
      this.settle();
      return;
    }

    const start = boundary.span * boundary.fitDelay;
    const u = (into - start) / (boundary.span - start);
    this.opts.target.setFitProgress(Math.max(0, Math.min(1, u)));
  }

  /** Lands the fit, and takes the dropped letters off screen if they are not gone already. */
  private settle(): void {
    const boundary = this.pending;
    if (!boundary) return;
    this.pending = null;
    this.opts.target.setFitProgress(1);
    this.retire(boundary);
    // Last, so a listener cannot observe a half-landed boundary. `phase` is this stage's index at
    // both call sites: `tick` settles the current phase, and `enterNextPhase` settles the outgoing
    // one before it increments.
    this.opts.onStage?.(this.phase);
  }

  private retire(boundary: Boundary): void {
    if (boundary.retired) return;
    boundary.retired = true;
    this.opts.target.retire(boundary.result.dropped);
  }

  private enterNextPhase(): void {
    const outgoing = this.timeline;
    // Rebasing on the outgoing phase's end rather than on `elapsed` is what lets `tick`'s loop
    // catch up: a frame long enough to span several stages would otherwise advance only one.
    this.phaseStart += this.timeline.duration;
    this.settle();
    this.phase++;
    const plan = this.opts.stages[this.phase];
    if (!plan) return;

    const keep = plan.keep ?? (() => true);
    const result = this.opts.target.regroup(keep, plan.as);

    const move = plan.tween.duration ?? DEFAULT_MOVE_MS;
    const half = this.opts.blendMs / 2;
    const leave = slotDuration(plan.exit);
    // `partition` hands both halves the same normalized t over the longer one's duration, so the
    // shorter half must be stretched to the slot or its declared duration is silently ignored.
    // The exit also gets the blend's half-window to itself, so it can finish before `retireAt`.
    const span = Math.max(move, leave > 0 ? leave + half : 0);
    this.pending = {
      result,
      span,
      retireAt: Math.max(0, span - half),
      retired: false,
      fitDelay: Math.min(0.999, Math.max(0, plan.tween.delayBy?.scale ?? 0)),
    };

    const travel = transition(move, {
      from: (letter) => {
        const slot = result.kept[letter.index];
        const d = slot === undefined ? undefined : result.delta[slot];
        return d ? { position: [d[0], d[1], 0] } : {};
      },
      ease: plan.tween.ease ?? easeOutCubic,
      delayBy: plan.tween.delayBy?.position ? { position: plan.tween.delayBy.position } : undefined,
    });

    // A dropped letter keeps its old index, which collides with some survivor's new one — so
    // `leaving` is the only safe discriminator; `result.kept[index]` would route it wrongly.
    const isKept = (letter: LetterInfo) => letter.leaving !== true;

    const last = this.phase === this.opts.stages.length - 1;
    this.timeline = new Timeline({
      enter: [
        partition(isKept, within(travel, span), within(asPiece(plan.exit), span)),
        carry(outgoing, span),
      ],
      active: plan.active,
      exit: last ? this.opts.exit : NONE,
      hold: plan.hold === 'click' ? 'until-release' : plan.hold,
      blendMs: this.opts.blendMs,
    });
  }

  private local(elapsed: number): number {
    return Math.max(0, elapsed - this.phaseStart);
  }

  release(elapsed: number): void {
    this.timeline.release(this.local(elapsed));
  }

  isFinished(elapsed: number): boolean {
    return (
      this.phase >= this.opts.stages.length - 1 && this.timeline.isFinished(this.local(elapsed))
    );
  }

  /**
   * Global elapsed at which the closing exit begins. `Infinity` while an earlier phase is running
   * or the last phase's hold is still open, since neither has an instant to give yet.
   */
  get exitAt(): number {
    if (this.phase < this.opts.stages.length - 1) return Number.POSITIVE_INFINITY;
    return this.phaseStart + this.timeline.activeEnd;
  }

  poseAt(elapsed: number, letter: LetterInfo, out: Pose = blankPose()): Pose {
    return this.timeline.poseAt(this.local(elapsed), letter, out);
  }
}

/**
 * Runs `piece` over its own duration inside a longer slot, then holds its final value. Without
 * this a 200ms travel paired with an 800ms exit plays over the whole 800ms, since `partition`
 * hands both halves the slot's normalized `t`.
 */
function within(piece: MotionPiece, total: number): MotionPiece {
  if (total <= 0 || piece.duration >= total) return piece;
  // A no-time piece has no span to map `t` onto, but it is finished, not unstarted: returning it
  // unwrapped would let the slot's `t` drag it across the whole slot.
  if (piece.duration <= 0)
    return { duration: total, offset: (_t, letter) => piece.offset(1, letter) };
  const fraction = piece.duration / total;
  return {
    duration: total,
    offset: (t, letter) => piece.offset(Math.min(1, t / fraction), letter),
  };
}

/**
 * The pose the outgoing phase ended on, eased away to nothing over the stage. A looping `active`
 * is mid-cycle when its phase runs out, so without this the word loses the loop's whole amplitude
 * in one frame — `float` alone drops it 0.12em and un-yaws it 0.1rad between two frames.
 *
 * The curve is in-out rather than the usual out: a loop caught mid-swing is already moving, and an
 * out curve leaves at its own top speed, which is the jolt again in miniature.
 */
function carry(from: Timeline, span: number): MotionPiece {
  const at = from.duration;
  const scratch = blankPose();
  return {
    duration: span,
    offset: (t, letter) => {
      const w = 1 - easeInOutCubic(Math.min(1, Math.max(0, t)));
      if (w <= 0) return {};
      const pose = from.poseAt(at, letter, scratch);
      const [x, y, z] = pose.position;
      const [rx, ry, rz] = pose.rotation;
      return {
        position: [x * w, y * w, z * w],
        rotation: [rx * w, ry * w, rz * w],
        scale: 1 + (pose.scale - 1) * w,
        opacity: 1 + (pose.opacity - 1) * w,
      };
    },
  };
}

/** A layered slot collapses to one piece so `partition` can take it as a single branch. */
function asPiece(slot: Slot): MotionPiece {
  if (!Array.isArray(slot)) return slot;
  return {
    duration: slotDuration(slot),
    offset: (t, letter) => {
      const out: Pose = blankPose();
      for (const piece of slot) {
        const o = piece.offset(t, letter);
        const { position, rotation } = o;
        if (position) {
          for (let i = 0; i < 3; i++) out.position[i] = (out.position[i] ?? 0) + (position[i] ?? 0);
        }
        if (rotation) {
          for (let i = 0; i < 3; i++) out.rotation[i] = (out.rotation[i] ?? 0) + (rotation[i] ?? 0);
        }
        if (o.scale !== undefined) out.scale *= o.scale;
        if (o.opacity !== undefined) out.opacity *= o.opacity;
      }
      return out;
    },
  };
}
