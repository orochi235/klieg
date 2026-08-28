/**
 * The lab's ink table, and the key that names it. `LegendEntry` is declared here rather than
 * imported: labkit's `Legend` was deferred, so no published type describes these entries.
 */
export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  /** How the swatch is drawn when a plain filled stroke would misread. */
  mark?: 'dot' | 'dash' | 'band';
}

export const INK = {
  glyph: 'rgba(125, 127, 134, 0.35)',
  contour: '#7d7f86',
  built: '#4d8fe0',
  builtAfter: '#a855f7',
  authored: '#2aa87a',
  drawn: '#e08a20',
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
