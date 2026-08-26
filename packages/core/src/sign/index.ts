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
  /** Re-fires. A sign's settings change rarely enough that diffing them is not worth the branch. */
  update(patch: Partial<SignOptions>): void;
  destroy(): void;
}

export function sign(anchor: HTMLElement, options: SignOptions): Sign {
  let opts = options;
  let instance: Klieg | null = null;
  let lit = false;

  function start(): void {
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

    lit = true;
    opts.onLit?.(true);
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
      .finally(() => {
        lit = false;
        opts.onLit?.(false);
      });
  }

  function stop(): void {
    instance?.destroy();
    instance = null;
  }

  start();

  return {
    get lit() {
      return lit;
    },
    update(patch) {
      opts = { ...opts, ...patch };
      stop();
      start();
    },
    destroy: stop,
  };
}
