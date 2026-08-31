import type { Budget, LaidOut, Slot } from './layout.js';
import { fitScale, LINE_HEIGHT_EM } from './layout.js';

/**
 * How a regrouped word is laid out: one line, one glyph per line, or `place` — left exactly where
 * the letters already are, so a stage can drop letters without moving the ones that stay.
 */
export type Arrangement = 'line' | 'stack' | 'place';

export interface Placement {
  /** Layout x per glyph, in em, already centred on its own line. */
  x: number[];
  /** Layout y per glyph, in em, before the block's vertical centring. */
  y: number[];
  /** The character each entry places. */
  char: string[];
  line: number[];
  column: number[];
  lineCount: number;
  /** The widest line's glyph count, so a short line's columns do not stretch to fill it. */
  columnCount: number;
  /** Width of the drawn ink across the whole block, in em; 0 when nothing draws. */
  inkWidth: number;
}

/** The string that lays `chars` out in the given arrangement. */
export function arrange(chars: readonly string[], as: Arrangement): string {
  return chars.join(as === 'stack' ? '\n' : '');
}

/**
 * Positions every glyph of a laid-out block. Each line centres on x = 0 across the glyphs that
 * draw ink — spanning `line.width` instead would push a line with a trailing space off centre.
 *
 * `lineEdge` ranges the lines against one another instead: every line's ink starts (or ends) at
 * the same x, and the block as a whole is re-centred afterwards so the word still sits on x = 0.
 * An acrostic needs this — centred lines put its initials at as many x positions as there are
 * lines, which is the one thing the form cannot survive.
 */
export function placeBlock(
  laid: LaidOut,
  drawsInk: (char: string) => boolean,
  lineEdge?: 'left' | 'right',
): Placement {
  const perLine: Slot[][] = Array.from({ length: laid.lines.length }, () => []);
  for (const slot of laid.slots) perLine[slot.line]?.push(slot);

  const out: Placement = {
    x: [],
    y: [],
    char: [],
    line: [],
    column: [],
    lineCount: laid.lines.length,
    columnCount: Math.max(0, ...perLine.map((l) => l.length)),
    inkWidth: 0,
  };

  let blockInkStart = Number.POSITIVE_INFINITY;
  let blockInkEnd = Number.NEGATIVE_INFINITY;

  for (let ln = 0; ln < perLine.length; ln++) {
    const y = -ln * LINE_HEIGHT_EM;
    const first = out.x.length;
    let inkStart: number | null = null;
    let inkEnd = 0;

    const slots = perLine[ln] as Slot[];
    for (let col = 0; col < slots.length; col++) {
      const slot = slots[col] as Slot;
      const x = slot.x;
      out.x.push(x);
      out.y.push(y);
      out.char.push(slot.char);
      out.line.push(ln);
      out.column.push(col);
      // klieg's own predicate, not the slot's: this ranges the painted extent, and weasel's
      // `drawsInk` answers for the code point and face whether or not anything was emitted.
      if (drawsInk(slot.char)) {
        inkStart ??= x;
        inkEnd = x + slot.advance;
      }
    }

    const shift =
      inkStart === null
        ? 0
        : lineEdge === 'left'
          ? -inkStart
          : lineEdge === 'right'
            ? -inkEnd
            : -(inkStart + inkEnd) / 2;
    for (let i = first; i < out.x.length; i++) out.x[i] = (out.x[i] as number) + shift;
    if (inkStart !== null) {
      blockInkStart = Math.min(blockInkStart, inkStart + shift);
      blockInkEnd = Math.max(blockInkEnd, inkEnd + shift);
    }
  }

  out.inkWidth = Number.isFinite(blockInkStart) ? blockInkEnd - blockInkStart : 0;
  // Ranged lines leave the block off x = 0 by construction; centred ones are already there.
  if (lineEdge && Number.isFinite(blockInkStart)) {
    const recentre = -(blockInkStart + blockInkEnd) / 2;
    for (let i = 0; i < out.x.length; i++) out.x[i] = (out.x[i] as number) + recentre;
  }
  return out;
}

export interface Fit {
  scale: number;
  /** Vertical centre of the drawn ink, in em. The group shifts by `-midY * scale`. */
  midY: number;
  /** World-space x for the group, placing the painted edge on the box's. 0 when centred. */
  offsetX: number;
}

/** Each glyph's own bounds in em, indexed like the placement; null where the glyph draws nothing. */
export interface GlyphBounds {
  /** How far the paint stands toward the camera, in em. Zero leaves alignment in the plane. */
  depth?: number;
  minX: readonly (number | null | undefined)[];
  maxX: readonly (number | null | undefined)[];
  minY: readonly (number | null | undefined)[];
  maxY: readonly (number | null | undefined)[];
}

/**
 * Uniform scale, vertical centring and horizontal alignment for a placed block. Ink height, not
 * cap height: a descender both drops the centre and eats budget. Alignment measures the painted
 * extent rather than the advance span the fit is scored on, so an edge glyph's side bearing does
 * not hold the word off the edge it was asked to meet.
 */
export function fitOf(placed: Placement, geo: GlyphBounds, budget: Budget): Fit {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < placed.x.length; i++) {
    const lo = geo.minY[i];
    const hi = geo.maxY[i];
    if (lo === null || lo === undefined || hi === null || hi === undefined) continue;
    const y = placed.y[i] as number;
    minY = Math.min(minY, y + lo);
    maxY = Math.max(maxY, y + hi);

    const left = geo.minX[i];
    const right = geo.maxX[i];
    if (left === null || left === undefined || right === null || right === undefined) continue;
    const x = placed.x[i] as number;
    minX = Math.min(minX, x + left);
    maxX = Math.max(maxX, x + right);
  }

  const drawn = Number.isFinite(minY);
  const scale = fitScale(placed.inkWidth, drawn ? maxY - minY : 0, budget);

  return {
    scale,
    midY: drawn ? (minY + maxY) / 2 : 0,
    offsetX: alignOffset(scale, minX, maxX, geo.depth ?? 0, budget),
  };
}

function alignOffset(
  scale: number,
  minX: number,
  maxX: number,
  depth: number,
  budget: Budget,
): number {
  const { edge, extent, cameraZ } = budget;
  if (!edge || extent === undefined) return 0;
  if (!Number.isFinite(minX)) return 0;

  // The frustum narrows toward the camera, so the box's edge at the near cap's depth is inside
  // its edge at the word's. Aligning on the nearer one is what keeps the extrusion out of the clip.
  const half = (extent / 2) * (cameraZ ? (cameraZ - depth * scale) / cameraZ : 1);
  return edge === 'left' ? -half - minX * scale : half - maxX * scale;
}
