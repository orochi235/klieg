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

export interface PlacedGlyph {
  char: string;
  /** Pen x at this glyph's origin, in font units. */
  x: number;
  index: number;
}

export interface Line {
  glyphs: PlacedGlyph[];
  /** Sum of every glyph's advance, including the last — trim trailing whitespace before centering on it. */
  width: number;
}

/** Iterates by Unicode code point, so an astral character (e.g. an emoji) is one glyph, not a split surrogate pair. */
export function layoutLine(text: string, metrics: GlyphMetrics): Line {
  const chars = Array.from(text);
  const glyphs: PlacedGlyph[] = [];
  let pen = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    if (i > 0) pen += metrics.kernOf(chars[i - 1] as string, char);
    glyphs.push({ char, x: pen, index: i });
    pen += metrics.advanceOf(char);
  }

  return { glyphs, width: pen };
}

/** Leading between baselines. Display capitals want less than the 1.2 that suits body text. */
export const LINE_HEIGHT_EM = 1.1;

export interface Block {
  lines: Line[];
  /** Widest line, in font units. */
  width: number;
}

/** Splits on newlines and lays each line out. The separator is consumed, never laid out. */
export function layoutBlock(text: string, metrics: GlyphMetrics): Block {
  const lines = text.split(/\r?\n/).map((seg) => layoutLine(seg, metrics));
  return { lines, width: Math.max(0, ...lines.map((l) => l.width)) };
}

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

/**
 * Chooses line breaks maximizing `fitScale`. Searches one candidate maximum line width rather
 * than line counts, which keeps explicit newline segments from making the search combinatorial.
 *
 * `unitsPerEm` converts em-denominated leading into the font units line widths arrive in.
 * Scoring the two unconverted silently prefers whichever arrangement is tallest.
 */
export function wrapBlock(
  text: string,
  metrics: GlyphMetrics,
  budget: Budget,
  unitsPerEm: number,
): Block {
  const segments = text.split(/\r?\n/).map((seg) => seg.trim().split(/\s+/).filter(Boolean));

  // Kerning makes width non-additive, so a run of words is measured whole rather than summed.
  const measurers = segments.map((words) => {
    const memo = new Map<string, number>();
    return (i: number, j: number): number => {
      if (j < i) return 0;
      const key = `${i}:${j}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const w = layoutLine(words.slice(i, j + 1).join(' '), metrics).width;
      memo.set(key, w);
      return w;
    };
  });

  const candidates = new Set<number>();
  segments.forEach((words, s) => {
    const measure = measurers[s] as (i: number, j: number) => number;
    for (let i = 0; i < words.length; i++) {
      for (let j = i; j < words.length; j++) candidates.add(measure(i, j));
    }
  });
  if (candidates.size === 0) return layoutBlock(text, metrics);

  let best: { text: string[]; scale: number; width: number } | null = null;

  for (const limit of candidates) {
    const lines: string[] = [];
    let widest = 0;

    for (let s = 0; s < segments.length; s++) {
      const words = segments[s] as string[];
      const measure = measurers[s] as (i: number, j: number) => number;
      let start = 0;
      // A single word never splits, so the run always keeps at least one.
      for (let i = 1; i < words.length; i++) {
        if (measure(start, i) > limit) {
          lines.push(words.slice(start, i).join(' '));
          widest = Math.max(widest, measure(start, i - 1));
          start = i;
        }
      }
      lines.push(words.slice(start).join(' '));
      widest = Math.max(widest, measure(start, words.length - 1));
    }

    const scale = fitScale(widest, lines.length * LINE_HEIGHT_EM * unitsPerEm, budget);
    const better =
      best === null ||
      scale > best.scale ||
      (scale === best.scale &&
        (lines.length < best.text.length ||
          (lines.length === best.text.length && widest < best.width)));
    if (better) best = { text: lines, scale, width: widest };
  }

  const lines = (best as { text: string[] }).text.map((line) => layoutLine(line, metrics));
  return { lines, width: Math.max(0, ...lines.map((l) => l.width)) };
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
    width: laid.bounds.width,
    height: laid.bounds.height,
  };
}

/** Wide enough that nothing wraps, so one layout reveals every natural word position. */
const UNBOUNDED = 1e9;

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
