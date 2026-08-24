import { type Clock, RafClock } from './clock.js';
import type { Easing } from './easing.js';
import { ACTIVE } from './motion/active.js';
import { type Slot, slotDrivesEnv, slotDuration, Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import { Sequence } from './motion/sequence.js';
import type { ActiveName, EnterName, ExitName, LetterInfo, MotionPiece } from './motion/types.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import { BloomPath } from './render/bloom.js';
import { envRotationAt, LIGHTING, type LightingName } from './render/lighting.js';
import { LOOKS, type Look, type LookName, type LookSpec, specOf } from './render/looks.js';
import { prefersReducedMotion, Stage as SceneStage, webglSupported } from './render/stage.js';
import { Word } from './render/word.js';
import { type LoadedFont, loadFont } from './text/font.js';
import type { Arrangement } from './text/placement.js';
import type { Transform } from './transform.js';

export { ManualClock } from './clock.js';
export {
  backOut,
  type Easing,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  linear,
  type SpringParams,
  spring,
} from './easing.js';
export {
  type CycleSpec,
  cycle,
  type Keyframe,
  type TransitionSpec,
  transition,
} from './motion/build.js';
export type { LetterInfo, MotionPiece, StaggerFrom, StaggerSpec } from './motion/types.js';
export { stagger } from './motion/types.js';
export type { Pose, PoseOffset, Vec3 } from './pose.js';
export { POLICY_NAMES } from './queue.js';
export type { DecorationSpec, MaterialSpec } from './render/decoration.js';
export type { FlakeSpec } from './render/flake.js';
export type { LookParams, TintTarget } from './render/looks.js';
/** The spec behind a built-in name, for building a variation on one. */
export { specOf } from './render/looks.js';
export type {
  CornerStrategy,
  CornerWeights,
  PathSource,
  Run,
  SelectSpec,
  SurfaceKind,
  TubeSpec,
} from './render/tube/index.js';
export { ALL_BREAK, ALL_CONNECT } from './render/tube/index.js';
export type { Arrangement } from './text/placement.js';
export { compose, fromAxisAngle, fromEuler, type Transform } from './transform.js';
export type {
  ActiveName,
  Clock,
  EnterName,
  ExitName,
  LightingName,
  Look,
  LookName,
  LookSpec,
  QueuePolicy,
};

// Read off the records the effect itself indexes. Those are typed exhaustive over the unions,
// so a name cannot be added, renamed or dropped without these lists following it.
export const ENTER_NAMES: readonly EnterName[] = Object.keys(ENTER) as EnterName[];
export const ACTIVE_NAMES: readonly ActiveName[] = Object.keys(ACTIVE) as ActiveName[];
export const EXIT_NAMES: readonly ExitName[] = Object.keys(EXIT) as ExitName[];
export const LOOK_NAMES: readonly LookName[] = Object.keys(LOOKS) as LookName[];
export const LIGHTING_NAMES: readonly LightingName[] = Object.keys(LIGHTING) as LightingName[];

const TAU = Math.PI * 2;

/** An explicit `bloom` always wins; a look may only ask when the caller said nothing. */
export function wantsBloom(explicit: boolean | undefined, look: Look): boolean {
  return explicit ?? specOf(look).bloom ?? false;
}

/**
 * Names index the built-in record; anything else is already a piece the caller supplied. Names
 * inside a layered slot are resolved too — leaving a bare string in the array puts it where a
 * piece is expected, and reading `.duration` off it yields NaN rather than throwing.
 */
function resolveSlot<N extends string>(
  slot: N | MotionPiece | (N | MotionPiece)[],
  builtin: Record<N, MotionPiece>,
): Slot {
  if (typeof slot === 'string') return builtin[slot];
  if (Array.isArray(slot)) return slot.map((s) => (typeof s === 'string' ? builtin[s] : s));
  return slot;
}

export interface KliegOptions {
  target?: HTMLElement;
  fontUrl: string;
  clock?: Clock;
  /**
   * `concurrent` is unsound for `sweep`: every live effect writes the shared environment
   * rotation from its own elapsed time, so the highlight sawtooths between their phases.
   */
  policy?: QueuePolicy;
  idleTimeoutMs?: number;
}

/** Closed union so element-anchoring can arrive in v1.2 without an API break. */
export type Placement = { kind: 'fullscreen' };

/** A built-in name, your own piece, or several layered together — names and pieces may mix. */
export type EnterSlot = EnterName | MotionPiece | (EnterName | MotionPiece)[];
export type ActiveSlot = ActiveName | MotionPiece | (ActiveName | MotionPiece)[];
export type ExitSlot = ExitName | MotionPiece | (ExitName | MotionPiece)[];

export interface FireOptions {
  enter?: EnterSlot;
  active?: ActiveSlot;
  exit?: ExitSlot;
  /** A built-in name, or a material of your own as plain numbers. */
  look?: Look;
  /** How the environment lights the type. `sweep` rakes the highlight, `static` holds it still. */
  lighting?: LightingName;
  /**
   * Recolors the look, as `0xff2d6f`. A function is consulted per letter and may return
   * `undefined` for "not mine", leaving that letter the look's own colour.
   *
   * Routed to whichever property carries that look's hue — `gem` is clear stone whose red comes
   * from what light picks up passing through it, so tinting its base color would do nothing.
   */
  tint?: number | ((letter: LetterInfo) => number | undefined);
  /**
   * Turns the whole word as one rigid object — never the camera, which would drift
   * `viewportBudget`'s fit and shrink the word along with its angle. Build one with `fromEuler`,
   * `fromAxisAngle` or `compose` rather than writing the sixteen numbers by hand.
   */
  transform?: Transform;
  /**
   * Milliseconds in the active phase, or `'click'` to hold until the viewer dismisses it.
   * A held effect blocks the queue under the default `queue` policy, and its promise stays
   * pending until it leaves the screen.
   */
  hold?: number | 'click';
  bloom?: boolean;
  blendMs?: number;
  placement?: Placement;
  /** Break long lines to whatever arrangement renders largest. Explicit newlines always break. */
  wrap?: boolean;
  /** Let the overlay swallow the dismissing click instead of passing it through to the page. */
  modal?: boolean;
  /**
   * Stages played after the enter, each regrouping what survives it. Advanced by the viewer when
   * a stage holds on `'click'`. Ignored under reduced motion, which never travels.
   */
  stages?: Stage[];
}

/** Timing for the move into a new layout. `scale` addresses the viewport fit, not letter size. */
export interface TweenSpec {
  /** Milliseconds for the move. Defaults to 700. */
  duration?: number;
  /** Defaults to `easeOutCubic`. */
  ease?: Easing;
  /**
   * Fraction of a span a channel waits before starting. `position` is a fraction of the move;
   * `scale` is a fraction of the move or this stage's exit, whichever is longer, so the fit can
   * wait for an exit that outlasts the move.
   */
  delayBy?: { position?: number; scale?: number };
}

/** One regroup: some letters leave, the rest re-lay out and the effect carries on. */
export interface Stage {
  /** Letters that continue. The rest exit. Omitted keeps all of them. */
  keep?: (letter: LetterInfo) => boolean;
  /** How the letters that do not continue leave. */
  exit?: ExitSlot;
  /** Arrangement for the survivors' new layout. One line by default. */
  as?: Arrangement;
  active?: ActiveSlot;
  hold?: number | 'click';
  tween?: TweenSpec;
}

export interface Klieg {
  readonly supported: boolean;
  /** Resolves when the effect leaves the screen, whether it played out or was cancelled. */
  fire(text: string, options?: FireOptions): Promise<void>;
  /** Cancels everything in flight; the stage comes down once the running effect has settled. */
  destroy(): void;
}

export function createKlieg(options: KliegOptions): Klieg {
  const supported = webglSupported();
  const clock = options.clock ?? new RafClock();
  const queue = new EffectQueue(options.policy ?? 'queue');
  const stage = new SceneStage({
    target: options.target,
    idleTimeoutMs: options.idleTimeoutMs ?? 8000,
  });

  let fontPromise: Promise<LoadedFont> | null = null;
  function font(): Promise<LoadedFont> {
    if (fontPromise) return fontPromise;
    // Memoizing the rejection too would make one failed fetch permanent for this instance.
    fontPromise = loadFont(options.fontUrl).catch((err) => {
      fontPromise = null;
      throw err;
    });
    return fontPromise;
  }

  async function run(text: string, opts: FireOptions, signal: AbortSignal): Promise<void> {
    const loaded = await font();
    if (signal.aborted) return;

    const renderer = stage.mount();
    const bloom = wantsBloom(opts.bloom, opts.look ?? 'gold') ? new BloomPath(renderer) : null;
    let word: Word;
    try {
      word = new Word(
        text,
        loaded,
        opts.look ?? 'gold',
        stage.viewportBudget(),
        opts.wrap,
        opts.tint,
      );
    } catch (err) {
      // This rejects before the settle() that would otherwise free the bloom's render targets.
      bloom?.dispose();
      throw err;
    }
    if (opts.transform) word.transform = opts.transform;
    stage.scene.add(word.group);

    const enter = resolveSlot(opts.enter ?? 'slam', ENTER);
    const active = resolveSlot(opts.active ?? 'none', ACTIVE);
    const lighting = opts.lighting ?? 'sweep';
    const envDriven = slotDrivesEnv(active);
    const hold = opts.hold ?? 1200;
    const untilClick = hold === 'click';
    const exit = resolveSlot(opts.exit ?? 'fade', EXIT);
    const blendMs = opts.blendMs ?? 120;
    const timeline = new Timeline({
      enter,
      active,
      exit,
      hold: untilClick ? 'until-release' : (hold as number),
      blendMs,
    });

    // Reduced motion: hold the pose the enter settles into for `hold`, then leave. No travel.
    const still = prefersReducedMotion();

    // Reduced motion never travels, so a regroup has nothing to play — and a stage held on
    // 'click' would never advance from a clock this path pins to the settled pose.
    const stages = still ? [] : (opts.stages ?? []);
    // A stage that holds on 'click' waits for the same press the top-level hold does, and gets no
    // listener of its own — so the whole effect stalls unless this covers both.
    const awaitsClick = untilClick || stages.some((s) => s.hold === 'click');
    const sequence = stages.length
      ? new Sequence({
          enter,
          active,
          stages: stages.map((s) => ({
            keep: s.keep,
            exit: resolveSlot(s.exit ?? 'fade', EXIT),
            as: s.as,
            active: resolveSlot(s.active ?? 'none', ACTIVE),
            hold: s.hold ?? 1200,
            tween: s.tween ?? {},
          })),
          exit,
          hold: untilClick ? 'click' : (hold as number),
          blendMs,
          target: word,
        })
      : null;
    const driver: Sequence | Timeline = sequence ?? timeline;
    const startedAt = clock.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let released = false;
      let detachDismiss = () => {};

      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        off();
        detachDismiss();
        stage.scene.remove(word.group);
        word.dispose();
        bloom?.dispose();
        stage.scheduleIdleTeardown();
        done();
      };
      const finish = () => settle(resolve);

      if (awaitsClick) {
        // Not one-shot with stages: each dismissal advances one stage, and only the last ends it.
        const dismiss = () => {
          if (released) return;
          const since = clock.now() - startedAt;
          driver.release(since);
          if (!sequence || sequence.isFinished(since)) {
            released = true;
            detachDismiss();
          }
        };
        // Capture on window catches the press in both modes; `modal` only decides whether the
        // canvas absorbs it on the way down or the page underneath sees it too.
        const onPointer = () => dismiss();
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') dismiss();
        };
        globalThis.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
        globalThis.addEventListener('keydown', onKey);
        // A modal hold is a keyboard trap without Escape: it swallows input and never times out.
        if (opts.modal) stage.setInteractive(true);

        detachDismiss = () => {
          globalThis.removeEventListener('pointerdown', onPointer, { capture: true });
          globalThis.removeEventListener('keydown', onKey);
          stage.setInteractive(false);
          detachDismiss = () => {};
        };
      }

      const off = clock.subscribe((now) => {
        if (signal.aborted) return finish();

        try {
          // rAF reports the frame's start time, which can precede a now() sampled moments earlier.
          const since = now - startedAt;
          const settled = slotDuration(enter);
          const raw = Math.max(still ? settled : since, 0);
          const elapsed = sequence ? raw : Math.min(raw, timeline.duration);
          // Ahead of the pose, or the fit and the phase advance both lag it by a frame.
          sequence?.tick(elapsed);
          word.apply(driver, elapsed);

          // A caller piece declaring envRotation wins: it is the more specific choice, and it
          // carries its own duration as the period.
          stage.scene.environmentRotation.y = envDriven
            ? (elapsed / Math.max(1, slotDuration(active))) * TAU
            : envRotationAt(lighting, elapsed);

          if (bloom) {
            bloom.render(stage.scene, stage.camera);
          } else {
            renderer.setRenderTarget(null);
            renderer.clear();
            renderer.render(stage.scene, stage.camera);
          }

          const stillDone = untilClick ? released : since >= (hold as number);
          if (still ? stillDone : driver.isFinished(since)) finish();
        } catch (err) {
          // RafClock keeps a throwing subscriber subscribed, so a lost context would otherwise
          // throw every frame forever with the word still on a stage destroy() can never settle.
          settle(() => reject(err));
        }
      });

      // Teardown must not wait for a tick: rAF stops in a hidden tab, and destroy() holds a
      // scarce GL context until this effect settles.
      signal.addEventListener('abort', finish);
      if (signal.aborted) finish();
    });
  }

  let counter = 0;
  let destroyed = false;

  return {
    supported,
    fire(text, opts = {}) {
      if (!supported || destroyed) return Promise.resolve();
      return queue.push(`${counter++}:${text}`, (signal) => run(text, opts, signal));
    },
    destroy() {
      destroyed = true;
      // A running effect only notices the abort on its next tick, and tearing down first would
      // leave it re-arming idle teardown against a stage that is already gone.
      void queue.cancelAll().then(() => stage.unmount());
    },
  };
}
