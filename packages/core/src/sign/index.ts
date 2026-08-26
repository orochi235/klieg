import {
  createKlieg,
  type EffectSpec,
  type FireOptions,
  type Framing,
  type Klieg,
  type LightingName,
  type Look,
} from '../index.js';
import { prefersReducedMotion } from '../render/stage.js';
import { resolveTint } from './tint.js';

export interface SignOptions {
  /** No default: bundling a typeface is a licensing decision the library does not get to make. */
  font: string;
  /** Defaults to the anchor's own text, which is what makes the page's markup the DOM copy. */
  text?: string;
  look?: Look;
  /** A number, or any CSS color — `currentColor` and `var(--x)` included, resolved on `anchor`. */
  tint?: number | string;
  framing?: Framing;
  lighting?: LightingName;
  bloom?: boolean;
  effects?: EffectSpec[];
  /** Merged over everything the options above build. */
  fire?: FireOptions;
  /**
   * Called with `true` **synchronously, before the word is built**, and `false` when the sign
   * leaves. Building blocks the main thread for hundreds of milliseconds and nothing paints during
   * it, so a caller hiding its fallback has to be told before the block, not after.
   */
  onLit?: (lit: boolean) => void;
}

export interface Sign {
  readonly lit: boolean;
  /**
   * Re-fires. A sign's settings change rarely enough that diffing them is not worth the branch,
   * though only `font` and `framing` are constructor-level: everything else could in principle
   * re-fire on the existing instance. As it stands each update builds a WebGL context and
   * refetches the font, so driving it rapidly stacks contexts against the browser's cap.
   */
  update(patch: Partial<SignOptions>): void;
  destroy(): void;
}

export function sign(anchor: HTMLElement, options: SignOptions): Sign {
  let opts = options;
  let instance: Klieg | null = null;
  let lit = false;
  let run = 0;
  let destroyed = false;

  function setLit(next: boolean): void {
    if (lit === next) return;
    lit = next;
    opts.onLit?.(next);
  }

  function start(): void {
    if (destroyed) return;
    const text = opts.text ?? anchor.textContent?.trim() ?? '';
    if (!text) return;

    const klieg = createKlieg({
      fontUrl: opts.font,
      placement: { kind: 'element', el: anchor },
      ...(opts.framing ? { framing: opts.framing } : {}),
    });
    if (!klieg.supported) {
      klieg.destroy();
      return;
    }
    instance = klieg;

    const still = prefersReducedMotion();
    const tint = resolveTint(anchor, opts.tint);

    const token = ++run;
    setLit(true);
    void klieg
      .fire(text, {
        // An anchored canvas crops to its box and every enter piece travels outside it.
        enter: 'none',
        hold: 'forever',
        // The page already carries the word whenever the anchor supplied it; a second copy is
        // announced twice by a screen reader and matches find-in-page twice.
        selectable: opts.text === undefined ? 'none' : 'hidden',
        // A held pose is a still image, so reduced motion stills what moves rather than the sign.
        lighting: still ? 'static' : (opts.lighting ?? 'sweep'),
        effects: still ? [] : opts.effects,
        ...(opts.look !== undefined ? { look: opts.look } : {}),
        ...(tint !== undefined ? { tint } : {}),
        ...(opts.bloom !== undefined ? { bloom: opts.bloom } : {}),
        ...opts.fire,
      })
      // A fire the next `start()` already replaced settles late and no longer speaks for the sign.
      .finally(() => {
        if (token === run) setLit(false);
      })
      // `sign()` returns no promise, so this is the only place a failed font fetch or a lost
      // context can be handled — unhandled, it reaches the host page as an app crash.
      .catch((err) => {
        console.warn('klieg: a sign failed to light', err);
      });
  }

  function stop(): void {
    run++;
    instance?.destroy();
    instance = null;
    setLit(false);
  }

  start();

  return {
    get lit() {
      return lit;
    },
    update(patch) {
      // Before the swap: the callback that saw the sign light is the one owed its `false`.
      stop();
      opts = { ...opts, ...patch };
      start();
    },
    destroy() {
      destroyed = true;
      stop();
    },
  };
}
