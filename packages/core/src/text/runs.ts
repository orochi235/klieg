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

/** Per-run tint never reaches weasel — klieg paints, weasel only places. */
export function tintOf(text: string | TextRun[]): (slot: number) => number | undefined {
  if (typeof text === 'string') return () => undefined;
  const perSlot: (number | undefined)[] = [];
  for (const run of text) {
    for (const _ of Array.from(run.text)) perSlot.push(run.tint);
  }
  return (slot) => perSlot[slot];
}
