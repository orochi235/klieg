import type { LegendEntry } from '@weasel-js/labkit';

/** The lab's ink table, and the key that names it. */
export type { LegendEntry };

export const INK = {
  glyph: 'rgba(125, 127, 134, 0.35)',
  contour: '#7d7f86',
  built: '#4d8fe0',
  builtAfter: '#a855f7',
  authored: '#2aa87a',
  drawn: '#d44ba0',
  staged: '#5b6cff',
  added: '#e08a20',
  removed: 'rgba(209, 69, 59, 0.55)',
  replaced: 'rgba(255, 107, 96, 0.28)',
  floor: '#9a9ca3',
  bad: '#d1453b',
  frame: 'rgba(154, 156, 163, 0.9)',
};

/** Inks that colour the readout rather than the drawing, so no legend entry names them. */
export const MEASURE_ONLY = ['bad'];

export const LEGEND: LegendEntry[] = [
  { key: 'glyph', label: 'glyph outline', color: INK.glyph },
  { key: 'contour', label: 'contour', color: INK.contour },
  { key: 'built', label: 'run · before', color: INK.built },
  { key: 'builtAfter', label: 'run · after', color: INK.builtAfter },
  { key: 'authored', label: 'authored', color: INK.authored, mark: 'dot' },
  { key: 'staged', label: 'stage output', color: INK.staged },
  { key: 'drawn', label: 'repair', color: INK.drawn },
  { key: 'replaced', label: 'replaced', color: INK.replaced, mark: 'band' },
  { key: 'added', label: 'would add', color: INK.added, mark: 'dash' },
  { key: 'removed', label: 'would remove', color: INK.removed, mark: 'band' },
  { key: 'floor', label: 'bend floor', color: INK.floor, mark: 'dash' },
  { key: 'frame', label: 'viewport', color: INK.frame, mark: 'dash' },
];

/** What the legend reads of a `CornerScene`: how much of each thing there is to draw. */
export interface DrawnScene {
  outline: readonly { points: readonly unknown[] }[];
  contour: readonly unknown[];
  replaced: readonly unknown[];
  carried: readonly { points: readonly unknown[]; authored: readonly boolean[]; side: string }[];
  staged: readonly (readonly unknown[])[];
  ghosts: readonly { ran: boolean; added: readonly unknown[]; removed: readonly unknown[] }[];
  drawn: readonly unknown[] | null;
}

interface Source {
  /** The canvas layer that lays this ink down; null where the corner map does. */
  layer: string | null;
  /** Whether the scene gives that layer anything to draw in it. */
  drawn: (scene: DrawnScene) => boolean;
}

/**
 * `stroke` needs two points, `mark` draws a lone one as a dot, and the arc and the viewport
 * rectangle take their geometry from the view rather than the scene.
 */
const SOURCES: Record<string, Source> = {
  glyph: { layer: 'glyph', drawn: (s) => s.outline.some((p) => p.points.length >= 2) },
  floor: { layer: 'floor', drawn: () => true },
  contour: { layer: 'contour', drawn: (s) => s.contour.length >= 2 },
  replaced: { layer: 'contour', drawn: (s) => s.replaced.length >= 2 },
  built: {
    layer: 'built',
    drawn: (s) => s.carried.some((r) => r.side !== 'after' && r.points.length >= 2),
  },
  builtAfter: {
    layer: 'built',
    drawn: (s) => s.carried.some((r) => r.side === 'after' && r.points.length >= 2),
  },
  authored: {
    layer: 'built',
    drawn: (s) => s.carried.some((r) => r.points.some((_, i) => r.authored[i])),
  },
  staged: { layer: 'staged', drawn: (s) => s.staged.some((span) => span.length >= 2) },
  added: { layer: 'ghost', drawn: (s) => s.ghosts.some((g) => !g.ran && g.added.length >= 1) },
  removed: { layer: 'ghost', drawn: (s) => s.ghosts.some((g) => !g.ran && g.removed.length >= 1) },
  drawn: { layer: 'repair', drawn: (s) => (s.drawn?.length ?? 0) >= 2 },
  frame: { layer: null, drawn: () => true },
};

/** The ink each legend key comes from. Exported so a test can hold the table to `LEGEND`. */
export const LEGEND_SOURCES: Readonly<Record<string, Source>> = SOURCES;

/** The rows this view actually put on the canvas: layer switched on, and ink emitted. */
export function shownLegend(layers: ReadonlySet<string>, scene: DrawnScene): LegendEntry[] {
  return LEGEND.filter((entry) => {
    const source = SOURCES[entry.key];
    if (!source) return false;
    return (source.layer === null || layers.has(source.layer)) && source.drawn(scene);
  });
}

const subscribers = new Set<() => void>();
let drawing = new Set<string>();
let shown: ReadonlySet<string> = new Set();

/**
 * Records that a layer painted. labkit skips a hidden layer's `draw` and offers the instrument no
 * read of its layer list, so this is the only signal for which layers are switched on. Every dirty
 * layer paints in one synchronous pass, so a microtask queued from the first of them sees them all.
 */
export function layerDrew(id: string): void {
  if (drawing.size === 0) queueMicrotask(endPass);
  drawing.add(id);
}

function endPass(): void {
  const next = drawing;
  drawing = new Set();
  if (next.size === shown.size && [...next].every((id) => shown.has(id))) return;
  shown = next;
  for (const notify of subscribers) notify();
}

export function subscribeLayers(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/** The layers that painted on the last pass. Stable between passes, for `useSyncExternalStore`. */
export function drawnLayers(): ReadonlySet<string> {
  return shown;
}
