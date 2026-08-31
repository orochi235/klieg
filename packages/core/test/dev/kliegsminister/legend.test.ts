import { describe, expect, it } from 'vitest';
import {
  type DrawnScene,
  drawnLayers,
  INK,
  LEGEND,
  LEGEND_SOURCES,
  layerDrew,
  MEASURE_ONLY,
  shownLegend,
  subscribeLayers,
} from '../../../dev/kliegsminister/src/legend.js';

describe('kliegsminister legend', () => {
  it('has an entry for every ink the canvas draws', () => {
    const drawn = Object.keys(INK).filter((k) => !MEASURE_ONLY.includes(k));
    expect(LEGEND.map((e) => e.key).sort()).toEqual(drawn.sort());
  });

  it('never invents a colour the ink table does not hold', () => {
    const inks = new Set(Object.values(INK));
    for (const entry of LEGEND) expect(inks.has(entry.color)).toBe(true);
  });

  it('takes each entry colour from the ink of the same name', () => {
    for (const entry of LEGEND) {
      expect(entry.color).toBe(INK[entry.key as keyof typeof INK]);
    }
  });

  it('leaves out the ink that only ever colours the measures list', () => {
    expect(LEGEND.some((e) => e.key === 'bad')).toBe(false);
    expect(MEASURE_ONLY).toContain('bad');
  });

  it('gives every row a swatch no other row carries', () => {
    const colors = LEGEND.map((e) => e.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('labels every entry with something other than its key', () => {
    for (const entry of LEGEND) expect(entry.label.length).toBeGreaterThan(0);
  });

  it('names both sides of a split corner distinctly', () => {
    const before = LEGEND.find((e) => e.key === 'built')?.label;
    const after = LEGEND.find((e) => e.key === 'builtAfter')?.label;
    expect(before).not.toBe(after);
  });

  it('draws the non-stroke inks as the shapes they actually are', () => {
    const markOf = (k: string) => LEGEND.find((e) => e.key === k)?.mark;
    expect(markOf('floor')).toBe('dash');
    expect(markOf('frame')).toBe('dash');
    expect(markOf('authored')).toBe('dot');
    expect(markOf('replaced')).toBe('band');
    expect(markOf('contour')).toBeUndefined();
  });
});

/** `DrawnScene` reads only lengths, so a placeholder per vertex is geometry enough. */
const pts = (n: number) => Array.from({ length: n }, () => ({}));

const ALL_LAYERS = new Set(['glyph', 'floor', 'contour', 'built', 'staged', 'ghost', 'repair']);

/** A view drawing every ink at once, so a test can take one thing away at a time. */
function fullScene(over: Partial<DrawnScene> = {}): DrawnScene {
  return {
    outline: [{ points: pts(4) }],
    contour: pts(6),
    replaced: pts(3),
    carried: [
      { points: pts(5), authored: [false, true, false, false, false], side: 'before' },
      { points: pts(5), authored: [false, false, false, false, false], side: 'after' },
    ],
    staged: [pts(4)],
    ghosts: [{ ran: false, added: pts(1), removed: pts(2) }],
    drawn: pts(3),
    ...over,
  };
}

const keysOf = (layers: ReadonlySet<string>, scene: DrawnScene) =>
  shownLegend(layers, scene).map((e) => e.key);

describe('kliegsminister legend rows', () => {
  it('names a source for every entry and invents none', () => {
    expect(Object.keys(LEGEND_SOURCES).sort()).toEqual(LEGEND.map((e) => e.key).sort());
  });

  it('shows every row for a view that draws every ink', () => {
    expect(keysOf(ALL_LAYERS, fullScene())).toEqual(LEGEND.map((e) => e.key));
  });

  it('drops the rows of a layer that is switched off', () => {
    const without = new Set([...ALL_LAYERS].filter((id) => id !== 'built'));
    const keys = keysOf(without, fullScene());
    expect(keys).not.toContain('built');
    expect(keys).not.toContain('builtAfter');
    expect(keys).not.toContain('authored');
    expect(keys).toContain('contour');
  });

  it('keeps the viewport row, which the corner map draws rather than a layer', () => {
    expect(keysOf(new Set(), fullScene())).toEqual(['frame']);
  });

  it('drops `run · after` when no carried run reaches the corner from that side', () => {
    const carried = [{ points: pts(5), authored: [true], side: 'both' }];
    const keys = keysOf(ALL_LAYERS, fullScene({ carried }));
    expect(keys).not.toContain('builtAfter');
    expect(keys).toContain('built');
    expect(keys).toContain('authored');
  });

  it('drops `authored` when the corner stage built no vertex of its own', () => {
    const carried = [{ points: pts(3), authored: [false, false, false], side: 'both' }];
    expect(keysOf(ALL_LAYERS, fullScene({ carried }))).not.toContain('authored');
  });

  it('drops the ghost rows when no site would change anything', () => {
    const keys = keysOf(ALL_LAYERS, fullScene({ ghosts: [] }));
    expect(keys).not.toContain('added');
    expect(keys).not.toContain('removed');
  });

  it('drops the ghost rows when every site already ran', () => {
    const ghosts = [{ ran: true, added: pts(2), removed: pts(2) }];
    const keys = keysOf(ALL_LAYERS, fullScene({ ghosts }));
    expect(keys).not.toContain('added');
    expect(keys).not.toContain('removed');
  });

  it('keeps `would remove` for a one-vertex site, which draws as a dot', () => {
    const ghosts = [{ ran: false, added: [], removed: pts(1) }];
    const keys = keysOf(ALL_LAYERS, fullScene({ ghosts }));
    expect(keys).toContain('removed');
    expect(keys).not.toContain('added');
  });

  it('drops `repair` when the scene carries no repaired stretch', () => {
    expect(keysOf(ALL_LAYERS, fullScene({ drawn: null }))).not.toContain('drawn');
    expect(keysOf(ALL_LAYERS, fullScene({ drawn: pts(1) }))).not.toContain('drawn');
  });

  it('drops `replaced` when the stretch is too short to stroke', () => {
    expect(keysOf(ALL_LAYERS, fullScene({ replaced: pts(1) }))).not.toContain('replaced');
  });

  it('drops the outline and stage rows when there is nothing in them', () => {
    const keys = keysOf(ALL_LAYERS, fullScene({ outline: [], staged: [[]] }));
    expect(keys).not.toContain('glyph');
    expect(keys).not.toContain('staged');
  });
});

describe('kliegsminister layer watch', () => {
  it('publishes the whole pass, not the first layer of it', async () => {
    layerDrew('glyph');
    layerDrew('floor');
    await Promise.resolve();
    expect([...drawnLayers()].sort()).toEqual(['floor', 'glyph']);
  });

  it('notifies only when the set of painted layers changes', async () => {
    let calls = 0;
    const stop = subscribeLayers(() => {
      calls++;
    });
    layerDrew('contour');
    await Promise.resolve();
    expect(calls).toBe(1);
    layerDrew('contour');
    await Promise.resolve();
    expect(calls).toBe(1);
    layerDrew('contour');
    layerDrew('ghost');
    await Promise.resolve();
    expect(calls).toBe(2);
    expect([...drawnLayers()].sort()).toEqual(['contour', 'ghost']);
    stop();
  });
});
