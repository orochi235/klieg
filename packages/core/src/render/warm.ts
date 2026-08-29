import * as THREE from 'three';
import type { LoadedFont } from '../text/font.js';
import { BloomPath } from './bloom.js';
import type { WordCaches } from './caches.js';
import type { Look } from './looks.js';
import type { Stage } from './stage.js';
import { Word } from './word.js';

/** One glyph is enough: the driver links a program per look, not per character. */
const WARM_TEXT = 'A';

export interface WarmDeps {
  stage: Stage;
  font(): Promise<LoadedFont>;
  /** The look the automatic warm links; a host-driven `run` names its own. */
  look: Look;
  caches: WordCaches;
  /** True once the instance is destroyed or a fire has started; both make the automatic warm
   * pointless. A host asking for one directly is not subject to it — it knows what it wants. */
  stale(): boolean;
  /** True once the instance is destroyed. Nothing may touch the stage after that. */
  gone(): boolean;
  /** Whether `look` draws through the bloom path, whose quads link programs of their own. */
  blooms: boolean;
}

export interface Warmer {
  /** Links `look` now. Resolves once the draw that links it has been issued. */
  run(look: Look, blooms: boolean): Promise<void>;
  /** Frees the throwaway the warm is holding — its programs have served their purpose. */
  release(): void;
  /** Releases, and stops a scheduled warm that has not run. */
  cancel(): void;
}

type IdleHost = { requestIdleCallback?: (cb: () => void) => unknown };

/**
 * Pays the mount's GL cost before a fire needs it. `renderer.compile()` is not enough — the driver
 * links on the first draw — so this draws, to a one-pixel target rather than the canvas the mount
 * just appended, which would otherwise flash a stray glyph seconds before anything was fired.
 *
 * The returned function ends the warm and frees what it is holding. Call it when the first fire
 * starts, and on destroy.
 */
export function scheduleWarm(deps: WarmDeps): Warmer {
  let cancelled = false;
  const held: { dispose(): void }[] = [];
  const release = () => {
    for (const item of held.splice(0)) item.dispose();
  };

  const idle = (globalThis as IdleHost).requestIdleCallback;
  const automatic = () => {
    if (cancelled) return;
    void warm(deps, deps.look, deps.blooms, () => cancelled || deps.stale(), held);
  };
  if (typeof idle === 'function') idle(automatic);
  else setTimeout(automatic, 1);

  return {
    run(look, blooms) {
      // A host that asks names the instant: an earlier fire does not make this one pointless the
      // way it makes the automatic warm pointless. Only a destroyed instance stops it.
      release();
      return warm(deps, look, blooms, () => cancelled || deps.gone(), held);
    },
    release,
    cancel() {
      cancelled = true;
      release();
    },
  };
}

async function warm(
  deps: WarmDeps,
  look: Look,
  blooms: boolean,
  stop: () => boolean,
  held: { dispose(): void }[],
): Promise<void> {
  const skip = stop;
  if (skip()) return;

  let loaded: LoadedFont;
  try {
    loaded = await deps.font();
  } catch {
    // A warm is a bet on a fire that has not happened; a font that will not load is that fire's
    // error to report, not this one's.
    return;
  }
  if (skip()) return;

  const renderer = deps.stage.mount();
  const target = new THREE.WebGLRenderTarget(1, 1);
  let word: Word | null = null;
  let bloom: BloomPath | null = null;
  try {
    word = new Word(
      WARM_TEXT,
      loaded,
      look,
      deps.stage.viewportBudget(),
      false,
      undefined,
      undefined,
      deps.stage.environment?.texture ?? null,
      deps.caches,
    );
    deps.stage.scene.add(word.group);
    renderer.setRenderTarget(target);
    renderer.render(deps.stage.scene, deps.stage.camera);
    if (blooms) {
      bloom = new BloomPath(renderer);
      bloom.warm();
    }
  } finally {
    renderer.setRenderTarget(null);
    if (word) deps.stage.scene.remove(word.group);
    target.dispose();
    // Held, not disposed. three refcounts a program per material, so disposing the throwaway
    // here releases the very programs this just linked — measured as `info.programs` going
    // straight back to 0 — and the first fire links them again. What the warm buys is only kept
    // by keeping a reference until that fire arrives.
    if (word) held.push(word);
    if (bloom) held.push(bloom);
    // A fire that started while this ran arms its own teardown when it settles; arming here too
    // would set an 8s timer against an effect that has not finished.
    if (!skip()) deps.stage.scheduleIdleTeardown();
  }
}
