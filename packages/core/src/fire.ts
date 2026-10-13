import type { FireOptions } from './api.js';
import { rowsBehind } from './backdrop.js';
import type { Clock } from './clock.js';
import type { Host } from './effects/types.js';
import type { SceneLayers } from './layers.js';
import { ACTIVE } from './motion/active.js';
import { PLACED, slotDuration, slotMovesLetters, Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import { isolate, MarkReporter } from './motion/marks.js';
import { Sequence } from './motion/sequence.js';
import { type PointerFrame, type PointerWatch, pointerFrame } from './pointer.js';
import { BloomPath, wantsBloom } from './render/bloom.js';
import type { WordCaches } from './render/caches.js';
import { EnvFrame, resolveLighting } from './render/lighting.js';
import {
  cameraZOf,
  type Framing,
  prefersReducedMotion,
  type Stage as SceneStage,
} from './render/stage.js';
import { Word } from './render/word.js';
import { DEFAULT_LOOK, describeSlot, resolveSlot, withEffects } from './resolve.js';
import { type SelectableMode, TextLayer } from './text/dom-layer.js';
import type { LoadedFont } from './text/font.js';
import { measureBaselineRatio, registerFace } from './text/font-face.js';
import { DEFAULT_GLYPH_OPTIONS } from './text/glyphs.js';
import { projectLetters } from './text/projection.js';
import { plainTextOf, sizeOf, type TextRun, tintFor } from './text/runs.js';
import { isIdentity, type Transform } from './transform.js';

/** What one instance shares between its fires and its own methods. */
export interface Instance {
  readonly stage: SceneStage;
  readonly clock: Clock;
  readonly caches: WordCaches;
  readonly framing: Framing | undefined;
  /** The words fires have on screen, which `pointOn` hits against. */
  readonly heroes: Set<Word>;
  /** Fires holding a frame subscription. */
  liveFires: number;
  readonly pointer: PointerWatch;
  readonly layers: SceneLayers;
  font(name?: string): Promise<LoadedFont>;
}
/** The live link between a `FireHandle` and its effect, which may not have started yet. */
export interface FireControl {
  /** Set while the effect is waiting on a dismissal; null before it starts and after it settles. */
  dismiss: (() => void) | null;
  /** An `advance()` that arrived before the effect did, to spend on its first hold. */
  latched: boolean;
  /** The last `turn()`, which a fire that has not built its word yet opens with. */
  transform: Transform | null;
  /** Set while the word is on screen; null before it is built and after it settles. */
  turn: ((transform: Transform) => void) | null;
}

export async function runFire(
  inst: Instance,
  text: string | TextRun[],
  opts: FireOptions,
  signal: AbortSignal,
  control: FireControl,
): Promise<void> {
  const { stage, clock, caches, heroes, layers } = inst;
  // The camera as the type sits in front of it, for anything mapping screen points onto letters.
  const glyphLens = () => ({
    ...stage.lens(),
    depth: DEFAULT_GLYPH_OPTIONS.depth,
    bevel: DEFAULT_GLYPH_OPTIONS.bevelThickness,
  });
  const loaded = await inst.font(opts.font);
  if (signal.aborted) return;

  // A run names a klieg font; layout resolves a registered family. Every distinct name a run
  // mentions is loaded (and so registered) before anything is laid out. The backdrop's own text
  // is in here too, so a run naming a font reads the same behind the sign as in front of it.
  const rowText = opts.backdrop ? (opts.backdrop.text ?? text) : null;
  const namesIn = (t: string | TextRun[]) =>
    typeof t === 'string' ? [] : t.flatMap((r) => r.font ?? []);
  const named = [...new Set([...namesIn(text), ...(rowText ? namesIn(rowText) : [])])];
  const families = new Map<string, string>();
  for (const name of named) families.set(name, (await inst.font(name)).family);
  if (signal.aborted) return;

  const resolve = (t: string | TextRun[]): string | TextRun[] =>
    typeof t === 'string'
      ? t
      : t.map((r) => (r.font ? { ...r, font: families.get(r.font) as string } : r));
  const runs = resolve(text);

  const renderer = stage.mount();
  const chosen = opts.look ?? DEFAULT_LOOK;
  const bloom = wantsBloom(opts.bloom, chosen) ? new BloomPath(renderer) : null;
  const look = withEffects(chosen, opts.effects);
  const budget = stage.viewportBudget(
    inst.framing?.width,
    inst.framing?.height,
    inst.framing?.align,
    opts.lineAlign,
  );
  let word: Word;
  try {
    word = new Word(
      runs,
      loaded,
      look,
      budget,
      opts.wrap,
      tintFor(text, opts.tint),
      undefined,
      stage.environment?.texture ?? null,
      caches,
      sizeOf(text),
      undefined,
      { tracking: opts.tracking, cameraZ: cameraZOf(stage) },
    );
  } catch (err) {
    // This rejects before the settle() that would otherwise free the bloom's render targets.
    bloom?.dispose();
    throw err;
  }
  const transform = control.transform ?? opts.transform;
  if (transform) word.transform = transform;
  stage.scene.add(word.group);

  let backdrop: Word | null = null;
  try {
    backdrop =
      opts.backdrop && rowText
        ? rowsBehind(stage, caches, opts.backdrop, resolve(rowText), word, loaded, budget, chosen)
        : null;
  } catch (err) {
    stage.scene.remove(word.group);
    word.dispose();
    bloom?.dispose();
    throw err;
  }
  if (backdrop) stage.scene.add(backdrop.group);

  const enter = resolveSlot(opts.enter ?? 'slam', ENTER);
  const active = resolveSlot(opts.active ?? 'none', ACTIVE);
  const asked = opts.selectable ?? 'hidden';
  // Whether it *moves* the word, not whether it was passed: a caller wiring rotation sliders
  // sends an identity transform at 0°, and refusing that costs the layer for nothing.
  const blocker =
    transform && !isIdentity(transform)
      ? 'a transform'
      : slotMovesLetters(active)
        ? `the active motion (${describeSlot(opts.active ?? 'none')})`
        : null;
  if (asked === 'layer' && blocker) {
    console.warn(
      `klieg: selectable 'layer' needs the word still, and ${blocker} moves it — falling back to 'hidden'`,
    );
  }
  let mode: SelectableMode = asked === 'layer' && blocker ? 'hidden' : asked;

  // Its own node inside the shared container: under `policy: 'concurrent'` two live effects
  // would otherwise clear each other's text, and the first to settle would wipe the survivor's.
  const host = stage.textLayer?.appendChild(document.createElement('div')) ?? null;
  const layer = host ? new TextLayer(host) : null;
  let family: string | null = null;
  let baselineRatio = 0;
  let built = false;
  // Up first even for 'layer', so the word is never absent from the DOM while the face loads —
  // and a browser with no `FontFace` keeps it rather than getting nothing at all.
  if (layer && mode !== 'none') layer.setHidden(plainTextOf(text));
  if (layer && mode === 'layer') {
    void registerFace(loaded.key, loaded.bytes).then((f) => {
      if (!f) return;
      baselineRatio = measureBaselineRatio(f);
      family = f;
    });
  }

  const envFrame = new EnvFrame(resolveLighting(opts.lighting ?? 'sweep'));
  const hold = opts.hold ?? 1200;
  const untilClick = hold === 'click';
  const exit = resolveSlot(opts.exit ?? 'fade', EXIT);
  const enterEnd = slotDuration(enter);
  const blendMs = opts.blendMs ?? 120;
  const timeline = new Timeline({
    enter,
    active,
    exit,
    hold: typeof hold === 'number' ? hold : 'until-release',
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
  const reporter = opts.onMark ? new MarkReporter(isolate(opts.onMark)) : null;
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
        hold: typeof hold === 'number' ? hold : 'click',
        blendMs,
        target: word,
        onStage: reporter ? (index) => reporter.stage(index) : undefined,
      })
    : null;
  const driver: Sequence | Timeline = sequence ?? timeline;
  // Reduced motion times the hold off `since` itself, and has no enter to skip.
  const landed =
    opts.startAt && !still ? (sequence ? sequence.land(opts.startAt.hold) : timeline.settledAt) : 0;
  if (opts.startAt) reporter?.passActive();
  const startedAt = clock.now() - landed;

  inst.pointer.hold();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let released = false;
    let detachDismiss = () => {};

    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      control.dismiss = null;
      control.turn = null;
      off();
      inst.liveFires--;
      heroes.delete(word);
      detachDismiss();
      stage.scene.remove(word.group);
      if (backdrop) stage.scene.remove(backdrop.group);
      host?.remove();
      word.dispose();
      backdrop?.dispose();
      bloom?.dispose();
      // Another fire or a live layer holds the stage, and arms this itself once it lets go.
      if (inst.liveFires === 0 && !layers.live()) stage.scheduleIdleTeardown();
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
      // A modal hold is a keyboard trap without Escape: it swallows input and never times out.
      // Under host dismissal that trade is the host's to make, since it holds the input.
      if (opts.modal) stage.setInteractive(true);

      if (opts.dismiss === 'host') {
        detachDismiss = () => {
          stage.setInteractive(false);
          detachDismiss = () => {};
        };
      } else {
        // Capture on window catches the press in both modes; `modal` only decides whether the
        // canvas absorbs it on the way down or the page underneath sees it too.
        const onPointer = () => dismiss();
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') dismiss();
        };
        globalThis.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
        globalThis.addEventListener('keydown', onKey);

        detachDismiss = () => {
          globalThis.removeEventListener('pointerdown', onPointer, { capture: true });
          globalThis.removeEventListener('keydown', onKey);
          stage.setInteractive(false);
          detachDismiss = () => {};
        };
      }

      control.dismiss = dismiss;
      if (control.latched) {
        control.latched = false;
        dismiss();
      }
    }

    control.turn = (next) => {
      word.transform = next;
      if (mode !== 'layer' || isIdentity(next)) return;
      console.warn(
        "klieg: selectable 'layer' needs the word still, and a turn moves it — falling back to 'hidden'",
      );
      mode = 'hidden';
      layer?.setHidden(plainTextOf(text));
    };
    inst.liveFires++;
    heroes.add(word);
    const off = clock.subscribe((now) => {
      if (signal.aborted) return finish();

      try {
        // rAF reports the frame's start time, which can precede a now() sampled moments earlier.
        const since = now - startedAt;
        const raw = Math.max(still ? enterEnd : since, 0);
        const elapsed = sequence ? raw : Math.min(raw, timeline.duration);
        // Ahead of the pose, or the fit and the stage advance both lag it by a frame.
        sequence?.tick(elapsed);

        // Detected against this frame rather than scheduled at fire time: `release()` moves
        // `activeEnd`, so a click hold has no exit instant until the press lands. Reduced motion
        // pins `elapsed` to the settled pose, so it reads both boundaries off `since` instead.
        if (reporter) {
          if (still) {
            const over = untilClick ? (released ? 0 : Number.POSITIVE_INFINITY) : (hold as number);
            reporter.observe(since, 0, over);
          } else {
            reporter.observe(elapsed, enterEnd, sequence ? sequence.exitAt : timeline.activeEnd);
          }
        }

        // Resolved on demand, once per frame: placing the cursor reads the canvas' box, which
        // flushes layout, and most signs run no patch that asks for it.
        let placed: PointerFrame | null = null;
        const place = (): PointerFrame =>
          (placed ??= pointerFrame(
            inst.pointer.client ? stage.canvas?.getBoundingClientRect() : null,
            inst.pointer.client,
            {
              fit: word.placement,
              ...glyphLens(),
            },
          ));
        const host: Host = {
          get pointer() {
            return place().pointer;
          },
          get pointerInWord() {
            return place().pointerInWord;
          },
          now,
        };
        word.apply(driver, elapsed, host, still);
        // Never the driver: the backdrop takes no motion slot, so it is at full presence from
        // its first frame. Its own effects still run, off the same clock the hero reads.
        backdrop?.apply(PLACED, elapsed, host, still);

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
                ...glyphLens(),
                width: key.width,
                height: key.height,
                baselineRatio,
              });
              layer.setLayer(projected.boxes, projected.fontSize, family, key, projected.scaleX);
            } else {
              layer.setVisible(true);
            }
            built = true;
          } else if (built) {
            layer.setVisible(false);
          }
        }

        const env = envFrame.at(elapsed, host, still);
        stage.scene.environmentRotation.x = env.pitch;
        stage.scene.environmentRotation.y = env.yaw;
        // The scene write above reaches only a material with no `envMap` of its own; every
        // material the word draws with carries one.
        word.setEnvRotation(env.pitch, env.yaw);
        backdrop?.setEnvRotation(env.pitch, env.yaw);

        layers.step(now);
        if (bloom) {
          bloom.render(stage.scene, stage.camera);
        } else {
          stage.draw(renderer);
        }
        layers.drew(now);

        const stillDone = typeof hold === 'number' ? since >= hold : released;
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
