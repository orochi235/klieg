import type { ActiveSlot, ExitSlot, FireOptions, Stage, TweenSpec } from './index.js';
import type { LetterInfo } from './motion/types.js';

/**
 * How one class of letter is styled. An object rather than a colour so the axis can grow: a
 * per-letter `look` is the intended growth, and does not fit yet — `look` is per-fire and reaches
 * the material pipeline long before a letter is addressable.
 */
export interface LetterStyle {
  /** Recolours these letters, as `0xff2d6f`. Omitted leaves them the look's own colour. */
  tint?: number;
}

export interface AcronymOptions {
  /** The capitals, in the block and after they gather. Cyan by default, to read out of the body. */
  caps?: LetterStyle;
  /** Everything else, while it is still up. Left to the look's own colour by default. */
  body?: LetterStyle;
  /** The pause after the block renders, before the lower case leaves. */
  read?: number | 'click';
  /** The pause after the lower case has gone, before the capitals gather. */
  settle?: number | 'click';
  /** How long the gathered acronym stays. */
  hold?: number | 'click';
  /** How the lower-case letters leave. */
  exit?: ExitSlot;
  /** What the gathered acronym does while it holds. */
  active?: ActiveSlot;
  /** Timing for the gather. */
  tween?: TweenSpec;
}

const CAPS_TINT = 0x2df0ff;
const SETTLE_MS = 600;

/**
 * Whether a character is a capital: its lower case differs from itself. Locale-independent, and it
 * drops digits and punctuation, which have no case and are not what an acronym is made of.
 */
export function isCapital(char: string | undefined): boolean {
  return !!char && char !== char.toLowerCase() && char === char.toUpperCase();
}

/**
 * The arguments to `fire()` for an acronym: a block of text whose capitals are picked out, held to
 * be read, and then gathered into a line of their own once everything else has left.
 *
 * ```ts
 * await bk.fire(...acronym('Keep\nLighting\nInteresting'));
 * ```
 *
 * Returns the arguments rather than firing, so `look`, `lighting`, `policy` and the rest stay the
 * caller's: spread the options and override whatever you like.
 */
export function acronym(text: string, options: AcronymOptions = {}): [string, FireOptions] {
  const caps = options.caps ?? { tint: CAPS_TINT };
  const body = options.body ?? {};
  const keep = (letter: LetterInfo) => isCapital(letter.char);

  const stages: Stage[] = [
    // `place` leaves the capitals exactly where they were, so the lower case going is its own beat
    // rather than something that happens while the acronym is already travelling.
    { keep, exit: options.exit ?? 'fade', as: 'place', hold: options.settle ?? SETTLE_MS },
    {
      as: 'line',
      active: options.active ?? 'none',
      hold: options.hold ?? 'click',
      ...(options.tween ? { tween: options.tween } : {}),
    },
  ];

  return [
    text,
    {
      hold: options.read ?? 'click',
      tint: (letter) => (keep(letter) ? caps.tint : body.tint),
      stages,
    },
  ];
}
