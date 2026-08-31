import type { StyledRun } from '@weasel-js/text';

/** One span of a fired word that carries its own styling. */
export interface TextRun {
  text: string;
  /** A name from the instance's `fonts`. Defaults to the fire's own `font`. */
  font?: string;
  /** Multiple of the word's size. 1 is the surrounding size. */
  size?: number;
  /** Overrides the fire's `tint` for this span. */
  tint?: number;
}

/** Glyphs are laid out at 1 em, so a run's `size` is its font size outright. */
const EM = 1;

export function styledRunsOf(text: string | TextRun[], defaultFont: string): StyledRun[] {
  const runs = typeof text === 'string' ? [{ text } as TextRun] : text;
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => ({
      text: run.text,
      fontFamily: run.font ?? defaultFont,
      fontSize: (run.size ?? 1) * EM,
    }));
}

/**
 * Spreads one value per run across the slots that run occupies. A newline separates cells rather
 * than being one, so counting it here would shift every later run's slots by one.
 */
function perSlot<T>(runs: TextRun[], of: (run: TextRun) => T): T[] {
  const out: T[] = [];
  for (const run of runs) {
    for (const char of Array.from(run.text)) {
      if (char === '\n' || char === '\r') continue;
      out.push(of(run));
    }
  }
  return out;
}

/** The text a run list spells, for the DOM layer that carries selection and copy. */
export function plainTextOf(text: string | TextRun[]): string {
  return typeof text === 'string' ? text : text.map((run) => run.text).join('');
}

/** Per-run tint never reaches weasel — klieg paints, weasel only places. */
export function tintOf(text: string | TextRun[]): (slot: number) => number | undefined {
  if (typeof text === 'string') return () => undefined;
  const tints = perSlot(text, (run) => run.tint);
  return (slot) => tints[slot];
}

/** Per-run size, for the scale node inside each letter cell. */
export function sizeOf(text: string | TextRun[]): ((slot: number) => number) | undefined {
  if (typeof text === 'string') return undefined;
  if (!text.some((run) => run.size !== undefined)) return undefined;
  const sizes = perSlot(text, (run) => run.size ?? 1);
  return (slot) => sizes[slot] ?? 1;
}
