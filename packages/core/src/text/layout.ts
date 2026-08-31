import {
  type LayoutRunsOpts,
  layoutRuns,
  resolveRuns,
  resolveTextStyle,
  type StyledRun,
} from '@weasel-js/text';

export interface GlyphMetrics {
  advanceOf(char: string): number;
  kernOf(left: string, right: string): number;
}

/** Leading between baselines. Display capitals want less than the 1.2 that suits body text. */
export const LINE_HEIGHT_EM = 1.1;

/** Where the word sits in the box, in reading order — which edge that is depends on direction. */
export type Align = 'start' | 'center' | 'end';

export interface Budget {
  width: number;
  height: number;
  /**
   * Ceiling on upscaling past the glyphs' natural size, defaulting to `FIT_CAP`. An anchored
   * placement lifts it: the anchor's box is already the bound, and against a short wide strip
   * the cap binds long before the budget does, holding the type well under its framing.
   */
  cap?: number;
  /**
   * Full visible width at the word's depth. Alignment measures against the whole box, where
   * `width` is only the share of it the type may fill — aligning inside that share would leave
   * the word inset by exactly the slack the fraction cut out.
   */
  extent?: number;
  /**
   * Camera distance to the word's plane. Alignment needs it because the type is extruded: the
   * near cap of a glyph off the frustum's axis projects wider than the plane the extent measures,
   * so a word aligned in the plane alone overhangs the box and the canvas clips it.
   */
  cameraZ?: number;
  /** The physical edge the word meets, direction already resolved. Absent leaves it centred. */
  edge?: 'left' | 'right';
  /** The physical edge every line ranges against, direction already resolved. Absent centres each. */
  lineEdge?: 'left' | 'right';
}

/** Keeps one short word on a fullscreen overlay from blowing up to fill the viewport. */
export const FIT_CAP = 2.2;

/**
 * Uniform scale fitting the word inside the budget on both axes. Height matters as much as
 * width: idle rotation swings the word toward the camera, so a width-only fit overflows.
 * An empty word has no ratio to compute, so it falls back to the cap, the same bound a normal
 * word is clamped to.
 */
export function fitScale(width: number, height: number, budget: Budget): number {
  const cap = budget.cap ?? FIT_CAP;
  const byWidth = width > 0 ? budget.width / width : Number.POSITIVE_INFINITY;
  const byHeight = height > 0 ? budget.height / height : Number.POSITIVE_INFINITY;
  return Math.min(byWidth, byHeight, cap);
}

/** One code point of a fired word, in klieg's slot order. */
export interface Slot {
  char: string;
  /** Pen x at this slot's origin, in em. */
  x: number;
  /** This slot's own width, in em. Its right edge is `x + advance` — never the next slot's `x`. */
  advance: number;
  line: number;
  /** From the code point and the face, not from whether geometry was emitted. */
  drawsInk: boolean;
}

export interface LaidOut {
  slots: Slot[];
  lines: { baselineY: number; x0: number; x1: number }[];
  /** In em. */
  width: number;
  height: number;
}

/**
 * Every fire routes through here, so a string and a one-run list take the same path. Slot `i` is
 * `cells[i]`: weasel gives every code point a cell, and klieg reconstructs nothing.
 */
export function layoutRunsForKlieg(runs: StyledRun[], opts: LayoutRunsOpts): LaidOut {
  const laid = layoutRuns(resolveRuns(runs, resolveTextStyle()), opts);
  const slots: Slot[] = [];
  laid.lines.forEach((line, index) => {
    for (const cell of line.cells) {
      slots.push({
        char: String.fromCodePoint(cell.cp),
        x: cell.x,
        advance: cell.advance,
        line: index,
        drawsInk: cell.drawsInk,
      });
    }
  });
  return {
    slots,
    lines: laid.lines.map((l) => ({ baselineY: l.baselineY, x0: l.x0, x1: l.x1 })),
    width: trimmedWidth(slots, laid.lines.length),
    height: laid.bounds.height,
  };
}

/**
 * The widest line measured to its last non-blank slot. Not `bounds.width`, which counts a wrapped
 * line's trailing space: scoring the fit on that shrinks every wrapped sign by one space advance.
 */
function trimmedWidth(slots: Slot[], lineCount: number): number {
  let widest = 0;
  for (let line = 0; line < lineCount; line++) {
    const onLine = slots.filter((slot) => slot.line === line);
    const first = onLine[0];
    if (!first) continue;
    let end: number | null = null;
    for (const slot of onLine) if (!/\s/.test(slot.char)) end = slot.x + slot.advance;
    if (end !== null) widest = Math.max(widest, end - first.x);
  }
  return widest;
}

/** Wide enough that nothing wraps, so one layout reveals every natural word position. */
export const UNBOUNDED = 1e9;

/**
 * Candidate line widths, taken from where the words actually fall rather than from summed
 * advances: kerning makes width non-additive, so a run of words is measured whole. Every
 * contiguous run of words on a line contributes the width it would occupy alone.
 */
function candidateWidths(runs: StyledRun[], opts: LayoutRunsOpts): number[] {
  const flat = layoutRunsForKlieg(runs, { ...opts, maxWidth: UNBOUNDED });
  const widths = new Set<number>();

  for (let line = 0; line < flat.lines.length; line++) {
    const slots = flat.slots.filter((s) => s.line === line);
    const lefts: number[] = [];
    const rights: number[] = [];
    let open = false;
    for (const slot of slots) {
      if (/\s/.test(slot.char)) {
        open = false;
        continue;
      }
      if (!open) {
        lefts.push(slot.x);
        rights.push(slot.x + slot.advance);
        open = true;
      } else {
        rights[rights.length - 1] = slot.x + slot.advance;
      }
    }
    for (let i = 0; i < lefts.length; i++) {
      for (let j = i; j < rights.length; j++) {
        widths.add((rights[j] as number) - (lefts[i] as number));
      }
    }
  }
  return [...widths];
}

/**
 * Chooses line breaks maximizing `fitScale` — it breaks to make the type as large as the box
 * allows, which is the whole point of a sign, and is not the greedy break weasel would pick alone.
 * Only the measuring changed: each candidate is laid out and scored on the bounds that come back.
 */
export function wrapRuns(runs: StyledRun[], budget: Budget, opts: LayoutRunsOpts): LaidOut {
  let best: LaidOut | null = null;
  let bestScale = -1;

  for (const maxWidth of candidateWidths(runs, opts)) {
    // layoutRuns, not cachedLayoutRuns: the cache caps variants per runs array at 8 and evicts the
    // whole set at once, so a search probing more widths than that would thrash its own cache.
    const laid = layoutRunsForKlieg(runs, { ...opts, maxWidth });
    const scale = fitScale(laid.width, laid.height, budget);
    const better =
      best === null ||
      scale > bestScale ||
      (scale === bestScale &&
        (laid.lines.length < best.lines.length ||
          (laid.lines.length === best.lines.length && laid.width < best.width)));
    if (better) {
      best = laid;
      bestScale = scale;
    }
  }

  return best ?? layoutRunsForKlieg(runs, { ...opts, maxWidth: UNBOUNDED });
}
