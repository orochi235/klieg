import { type Clock, RafClock } from './clock.js';
import type { Easing } from './easing.js';
import { EFFECTS } from './effects/pieces.js';
import type { EffectName, EffectSpec, FrameCtx } from './effects/types.js';
import { ACTIVE } from './motion/active.js';
import { type Slot, slotDuration, slotMovesLetters, Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import { Sequence } from './motion/sequence.js';
import type { ActiveName, EnterName, ExitName, LetterInfo, MotionPiece } from './motion/types.js';
import { pointerFrame } from './pointer.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import { BloomPath } from './render/bloom.js';
import {
  ENV_PIECES,
  type LightingName,
  type LightingSlot,
  mergeEnv,
  resolveLighting,
} from './render/lighting.js';
import { LOOKS, type Look, type LookName, type LookSpec, specOf } from './render/looks.js';
import {
  type Placement,
  prefersReducedMotion,
  Stage as SceneStage,
  webglSupported,
} from './render/stage.js';
import { Word } from './render/word.js';
import { type SelectableMode, TextLayer } from './text/dom-layer.js';
import { type LoadedFont, loadFont } from './text/font.js';
import { measureBaselineRatio, registerFace } from './text/font-face.js';
import { DEFAULT_GLYPH_OPTIONS } from './text/glyphs.js';
import type { Arrangement } from './text/placement.js';
import { projectLetters } from './text/projection.js';
import { isIdentity, type Transform } from './transform.js';

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
  along,
  fixed,
  fromPointer,
  type LampSpec,
  type LightPose,
  type LightSource,
  lamp,
  type OrbitSpec,
  orbit,
} from './effects/lamp.js';
export { type ChaseSpec, EFFECTS, type FlickerSpec, type HueSpec } from './effects/pieces.js';
export { type RovingSpec, roving } from './effects/roving.js';
export type {
  EffectName,
  EffectPiece,
  EffectSpec,
  FrameCtx,
  LightOffset,
  PartInfo,
  PartKind,
  PartOffset,
} from './effects/types.js';
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
export {
  ENV_PIECES,
  type EnvOffset,
  type EnvPiece,
  mergeEnv,
  type ResolvedEnv,
  still,
  sweep,
  type TrackSpec,
  track,
} from './render/lighting.js';
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
export type { SelectableMode } from './text/dom-layer.js';
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
export const LIGHTING_NAMES: readonly LightingName[] = Object.keys(ENV_PIECES) as LightingName[];
export const EFFECT_NAMES: readonly EffectName[] = Object.keys(EFFECTS) as EffectName[];

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

/** Names a slot for a diagnostic; a caller's own piece has no name to give. */
function describeSlot(slot: EnterSlot | ActiveSlot | ExitSlot): string {
  if (typeof slot === 'string') return slot;
  if (Array.isArray(slot)) return slot.map(describeSlot).join(' + ');
  return 'a custom piece';
}

export interface KliegOptions {
  target?: HTMLElement;
  /**
   * Fullscreen overlay, or the type anchored inside one element of the page. Fixed for the
   * instance's lifetime; a page wanting both needs two instances, and two WebGL contexts.
   * An element placement is its own parent, so it cannot be combined with `target`.
   */
  placement?: Placement;
  fontUrl: string;
  clock?: Clock;
  /**
   * `concurrent` is unsound for `sweep`: every live effect writes the shared environment
   * rotation from its own elapsed time, so the highlight sawtooths between their phases.
   */
  policy?: QueuePolicy;
  idleTimeoutMs?: number;
  /** How much of the viewport the type may fill. The default leaves room for the page underneath. */
  framing?: Framing;
}

/**
 * The share of the viewport the type is allowed to fill on each axis, as a fraction of what the
 * camera sees at the word's depth. An omitted axis keeps its default; 1 runs the type to that edge.
 * Height stays the tighter of the two by default because turning the word swings it taller.
 */
export interface Framing {
  /** Defaults to 0.62. */
  width?: number;
  /** Defaults to 0.3. */
  height?: number;
}

export type { Placement } from './render/stage.js';

/** A built-in name, your own piece, or several layered together — names and pieces may mix. */
export type EnterSlot = EnterName | MotionPiece | (EnterName | MotionPiece)[];
export type ActiveSlot = ActiveName | MotionPiece | (ActiveName | MotionPiece)[];
export type ExitSlot = ExitName | MotionPiece | (ExitName | MotionPiece)[];
export type { LightingSlot };

export interface FireOptions {
  enter?: EnterSlot;
  active?: ActiveSlot;
  exit?: ExitSlot;
  /** A built-in name, or a material of your own as plain numbers. */
  look?: Look;
  /**
   * Appearance driven over time, below the level of a letter. Replaces the look's own list rather
   * than adding to it — spread `specOf(look).effects` to keep them.
   */
  effects?: EffectSpec[];
  /** How the environment lights the type. `sweep` rakes the highlight, `static` holds it still.
   * Layers compose: `['sweep', track({ pitchRange: 0.1 })]`, each on its own period.
   *
   * A piece you construct carries its own state, so give each fire its own `track()` rather than
   * sharing one; the name `'pointer'` builds a fresh piece per run and is safe to reuse. */
  lighting?: LightingSlot;
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
  /** @deprecated Unread. Placement is fixed per instance — pass it to `createKlieg` instead. */
  placement?: Placement;
  /** Break long lines to whatever arrangement renders largest. Explicit newlines always break. */
  wrap?: boolean;
  /** Let the overlay swallow the dismissing click instead of passing it through to the page. */
  modal?: boolean;
  /**
   * How the word appears in the DOM, so it can be copied, found and read aloud. `'hidden'` is one
   * visually-hidden node; `'layer'` adds a transparent per-letter layer a drag can select, and
   * takes a click on a letter instead of passing it through; `'none'` adds nothing, for a page
   * whose own markup already carries this text.
   *
   * `'layer'` needs the word still — it falls back to `'hidden'` under a `transform` or a motion
   * piece that moves the letters. Defaults to `'hidden'`.
   */
  selectable?: SelectableMode;
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
  const placement = options.placement ?? { kind: 'fullscreen' };
  const anchored = placement.kind === 'element';
  if (anchored && options.target) {
    throw new Error('klieg: an element placement is its own parent, so `target` cannot apply');
  }

  const supported = webglSupported();
  const clock = options.clock ?? new RafClock();
  const queue = new EffectQueue(options.policy ?? 'queue');
  const stage = new SceneStage({
    target: options.target,
    idleTimeoutMs: options.idleTimeoutMs ?? 8000,
    placement,
  });

  let pointerClient: { x: number; y: number } | null = null;
  let pointerAttached = false;
  const onMove = (event: PointerEvent) => {
    pointerClient = { x: event.clientX, y: event.clientY };
  };

  /** Once attached it stays for the instance's life. The cursor goes on moving between effects,
   * so a listener that came and went would open the next one aimed where the pointer used to be. */
  function holdPointer(): void {
    if (pointerAttached) return;
    pointerAttached = true;
    globalThis.addEventListener('pointermove', onMove, { passive: true });
  }

  function releasePointer(): void {
    if (!pointerAttached) return;
    pointerAttached = false;
    globalThis.removeEventListener('pointermove', onMove);
  }

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
    const chosen = opts.look ?? 'gold';
    const bloom = wantsBloom(opts.bloom, chosen) ? new BloomPath(renderer) : null;
    // A caller's list replaces the look's own rather than adding to it.
    const look = opts.effects ? { ...specOf(chosen), effects: opts.effects } : chosen;
    let word: Word;
    try {
      word = new Word(
        text,
        loaded,
        look,
        stage.viewportBudget(options.framing?.width, options.framing?.height),
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
    const asked = opts.selectable ?? 'hidden';
    // Whether it *moves* the word, not whether it was passed: a caller wiring rotation sliders
    // sends an identity transform at 0°, and refusing that costs the layer for nothing.
    const blocker =
      opts.transform && !isIdentity(opts.transform)
        ? 'a transform'
        : slotMovesLetters(active)
          ? `the active motion (${describeSlot(opts.active ?? 'none')})`
          : null;
    if (asked === 'layer' && blocker) {
      console.warn(
        `klieg: selectable 'layer' needs the word still, and ${blocker} moves it — falling back to 'hidden'`,
      );
    }
    const mode: SelectableMode = asked === 'layer' && blocker ? 'hidden' : asked;

    // Its own node inside the shared container: under `policy: 'concurrent'` two live effects
    // would otherwise clear each other's text, and the first to settle would wipe the survivor's.
    const host = stage.textLayer?.appendChild(document.createElement('div')) ?? null;
    const layer = host ? new TextLayer(host) : null;
    let family: string | null = null;
    let baselineRatio = 0;
    let built = false;
    // Up first even for 'layer', so the word is never absent from the DOM while the face loads —
    // and a browser with no `FontFace` keeps it rather than getting nothing at all.
    if (layer && mode !== 'none') layer.setHidden(text);
    if (layer && mode === 'layer') {
      void registerFace(options.fontUrl, loaded.bytes).then((f) => {
        if (!f) return;
        baselineRatio = measureBaselineRatio(f);
        family = f;
      });
    }

    const envPieces = resolveLighting(opts.lighting ?? 'sweep');
    // A construction-time snapshot, as `partExtent` documents: a regroup re-lays the letters and
    // leaves the pool alone, so this cannot change under a running effect.
    const extent = word.partExtent();
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

    holdPointer();

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
        host?.remove();
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

      let lastTick = clock.now();

      const off = clock.subscribe((now) => {
        if (signal.aborted) return finish();

        try {
          const dt = now - lastTick;
          lastTick = now;
          // rAF reports the frame's start time, which can precede a now() sampled moments earlier.
          const since = now - startedAt;
          const settled = slotDuration(enter);
          const raw = Math.max(still ? settled : since, 0);
          const elapsed = sequence ? raw : Math.min(raw, timeline.duration);
          // Ahead of the pose, or the fit and the phase advance both lag it by a frame.
          sequence?.tick(elapsed);

          const { pointer, pointerInWord } = pointerFrame(
            pointerClient ? stage.canvas?.getBoundingClientRect() : null,
            pointerClient,
            extent,
          );
          const ctx: FrameCtx = {
            pointer,
            pointerInWord,
            dt: still ? Number.POSITIVE_INFINITY : dt,
          };
          word.apply(driver, elapsed, ctx);

          if (layer && mode === 'layer' && family) {
            if (word.atRest()) {
              const canvas = stage.canvas;
              const readout = word.readout();
              const key = {
                version: word.layoutVersion,
                width: canvas?.clientWidth ?? 0,
                height: canvas?.clientHeight ?? 0,
                scale: readout.fit.scale,
                midY: readout.fit.midY,
              };
              if (layer.isStale(key)) {
                const projected = projectLetters({
                  ...readout,
                  fov: stage.camera.fov,
                  cameraZ: stage.camera.position.z,
                  aspect: stage.camera.aspect,
                  depth: DEFAULT_GLYPH_OPTIONS.depth,
                  width: key.width,
                  height: key.height,
                  baselineRatio,
                });
                layer.setLayer(projected.boxes, projected.fontSize, family, key);
              } else {
                layer.setVisible(true);
              }
              built = true;
            } else if (built) {
              layer.setVisible(false);
            }
          }

          const env = mergeEnv(
            envPieces.map((piece) =>
              piece.env(piece.duration > 0 ? (elapsed % piece.duration) / piece.duration : 0, ctx),
            ),
          );
          stage.scene.environmentRotation.x = env.pitch;
          stage.scene.environmentRotation.y = env.yaw;

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
      // Every honest meaning for it hangs: a window listener dismisses on clicks that have nothing
      // to do with the strip, and one scoped to the anchor never fires once the anchor scrolls off,
      // stalling the effect and blocking the queue for good.
      if (anchored && (opts.hold === 'click' || opts.stages?.some((s) => s.hold === 'click'))) {
        throw new Error("klieg: `hold: 'click'` has no meaning for an element placement");
      }
      if (!supported || destroyed) return Promise.resolve();
      return queue.push(`${counter++}:${text}`, (signal) => run(text, opts, signal));
    },
    destroy() {
      destroyed = true;
      releasePointer();
      // A running effect only notices the abort on its next tick, and tearing down first would
      // leave it re-arming idle teardown against a stage that is already gone.
      void queue.cancelAll().then(() => stage.unmount());
    },
  };
}
