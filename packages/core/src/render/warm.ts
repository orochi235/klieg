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
  look: Look;
  caches: WordCaches;
  /** True once the instance is destroyed or a fire has started; both make the warm pointless. */
  stale(): boolean;
  /** Whether `look` draws through the bloom path, whose quads link programs of their own. */
  blooms: boolean;
}

type IdleHost = { requestIdleCallback?: (cb: () => void) => unknown };

/**
 * Pays the mount's GL cost before a fire needs it. `renderer.compile()` is not enough — the driver
 * links on the first draw — so this draws, to a one-pixel target rather than the canvas the mount
 * just appended, which would otherwise flash a stray glyph seconds before anything was fired.
 */
export function scheduleWarm(deps: WarmDeps): () => void {
  let cancelled = false;
  const idle = (globalThis as IdleHost).requestIdleCallback;
  const run = () => {
    if (cancelled) return;
    void warm(deps, () => cancelled);
  };
  if (typeof idle === 'function') idle(run);
  else setTimeout(run, 1);

  return () => {
    cancelled = true;
  };
}

async function warm(deps: WarmDeps, cancelled: () => boolean): Promise<void> {
  const skip = () => cancelled() || deps.stale();
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
      deps.look,
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
    if (deps.blooms) {
      bloom = new BloomPath(renderer);
      bloom.warm();
    }
  } finally {
    bloom?.dispose();
    renderer.setRenderTarget(null);
    if (word) {
      deps.stage.scene.remove(word.group);
      word.dispose();
    }
    target.dispose();
    // A fire that started while this ran arms its own teardown when it settles; arming here too
    // would set an 8s timer against an effect that has not finished.
    if (!skip()) deps.stage.scheduleIdleTeardown();
  }
}
