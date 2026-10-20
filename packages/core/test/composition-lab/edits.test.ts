import { describe, expect, it } from 'vitest';
import { type LayerEntry, newEntry } from '../../dev/composition-lab/src/config.js';
import {
  addLayer,
  insertable,
  insertWrapper,
  removeLayer,
  removeWrapper,
  reorder,
  setEnabled,
  updateEntry,
} from '../../dev/composition-lab/src/edits.js';
import type { Part } from '../../dev/composition-lab/src/pipeline.js';

const on = (e: LayerEntry, w: 'roving' | 'intermittent') =>
  (e[w] as { on?: boolean } | undefined)?.on === true;

const dwellOf = (e: LayerEntry | undefined) => (e?.roving as { dwell?: number } | undefined)?.dwell;

describe('edits to the layer list', () => {
  it('adds a layer of the asked kind at the end', () => {
    const first = newEntry('hue');
    const next = addLayer([first], 'flicker');
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(first);
    expect(next[1]?.kind).toBe('flicker');
    expect(next[1]?.enabled).toBe(true);
  });

  it('leaves the list alone removing a layer it lacks, or reordering to the order it has', () => {
    const list = [newEntry('hue'), newEntry('chase')];
    expect(removeLayer(list, 'missing')).toBe(list);
    expect(
      reorder(
        list,
        list.map((e) => e.id),
      ),
    ).toBe(list);
  });

  it('removes a layer by id', () => {
    const a = newEntry('hue');
    const b = newEntry('chase');
    expect(removeLayer([a, b], a.id)).toEqual([b]);
  });

  it('switches a layer on and off', () => {
    const a = newEntry('hue');
    expect(setEnabled([a], a.id, false)[0]?.enabled).toBe(false);
  });

  it('inserts a wrapper by switching it on, keeping its settings', () => {
    const a = newEntry('flicker');
    const tuned = { ...a, roving: { ...(a.roving as object), on: false, dwell: 5000 } };
    const [after] = insertWrapper([tuned], a.id, 'roving');
    expect(after && on(after, 'roving')).toBe(true);
    expect(dwellOf(after)).toBe(5000);
    const [gone] = removeWrapper([after as LayerEntry], a.id, 'roving');
    expect(gone && on(gone, 'roving')).toBe(false);
    expect(dwellOf(gone)).toBe(5000);
  });

  it('leaves the list alone inserting a wrapper the layer has, or removing one it lacks', () => {
    const a = newEntry('flicker');
    const list = [a];
    expect(removeWrapper(list, a.id, 'roving')).toBe(list);
    const has = insertWrapper(list, a.id, 'roving');
    expect(insertWrapper(has, a.id, 'roving')).toBe(has);
  });

  it('never offers roving to a lamp', () => {
    const lamp = newEntry('lamp');
    const patch: Part = { kind: 'patch', layer: lamp.id };
    const pool: Part = { kind: 'pool', layer: lamp.id };
    expect(insertable(lamp, patch, pool)).toEqual(['intermittent']);
    expect(insertWrapper([lamp], lamp.id, 'roving')[0]).toBe(lamp);
  });

  it('offers only the wrappers that belong between two nodes', () => {
    const entry = newEntry('flicker');
    const id = entry.id;
    const roved = insertWrapper([entry], id, 'roving')[0] as LayerEntry;
    const patch: Part = { kind: 'patch', layer: id };
    const roving: Part = { kind: 'wrapper', layer: id, wrapper: 'roving' };
    const pool: Part = { kind: 'pool', layer: id };
    expect(insertable(entry, patch, pool)).toEqual(['roving', 'intermittent']);
    expect(insertable(roved, roving, pool)).toEqual(['intermittent']);
    expect(insertable(roved, patch, roving)).toEqual([]);
  });

  it('reorders to the given ids and drops none', () => {
    const [a, b, c] = [newEntry('hue'), newEntry('chase'), newEntry('flicker')];
    expect(reorder([a, b, c], [c.id, a.id]).map((e) => e.id)).toEqual([c.id, a.id, b.id]);
  });

  it("keeps a layer's id and enabled across an edit of its fields", () => {
    const a = { ...newEntry('flicker'), enabled: false };
    const [after] = updateEntry([a], a.id, { ...a, id: 'other', enabled: true, period: 900 });
    expect(after?.id).toBe(a.id);
    expect(after?.enabled).toBe(false);
    expect(after?.period).toBe(900);
  });
});
