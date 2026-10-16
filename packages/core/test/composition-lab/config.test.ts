import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPOSITION } from '../../dev/composition-lab/src/composition.js';
import {
  KINDS,
  newEntry,
  schema,
  toComposition,
  toLayer,
} from '../../dev/composition-lab/src/config.js';
import { defaultParams } from '../../dev/composition-lab/src/patches.js';

describe('the lab config', () => {
  it('opens on the default composition', () => {
    expect(toComposition(schema.defaults())).toEqual(DEFAULT_COMPOSITION);
  });

  it.each(KINDS)('gives a new %s layer the params its kind defaults to', (kind) => {
    const layer = toLayer(newEntry(kind));
    expect(layer.kind).toBe(kind);
    expect(layer.enabled).toBe(true);
    expect(layer.params).toEqual(defaultParams(kind));
    expect(layer.roving).toBeUndefined();
    expect(layer.intermittent).toBeUndefined();
  });

  it('gives each new layer an id of its own', () => {
    expect(newEntry('flicker').id).not.toBe(newEntry('flicker').id);
  });

  it('turns a wrapper on only when its switch is', () => {
    const entry = newEntry('flicker');
    expect(toLayer({ ...entry, roving: { on: true, dwell: 1000, epochs: 8 } }).roving).toEqual({
      dwell: 1000,
      epochs: 8,
      seed: 0,
    });
    expect(
      toLayer({ ...entry, intermittent: { on: true, spell: 3000, calm: 500, bouts: 2 } })
        .intermittent,
    ).toEqual({ spell: 3000, calm: 500, bouts: 2 });
  });

  it('never roves a lamp, which would light the part it stands on', () => {
    const entry = { ...newEntry('lamp'), roving: { on: true, dwell: 1000, epochs: 8 } };
    expect(toLayer(entry).roving).toBeUndefined();
    expect(toLayer(entry).lampSource).toBe('fixed');
  });

  it('opens a draft on starter source rather than an empty pane', () => {
    expect(toLayer(newEntry('draft')).source).toMatch(/period/);
  });
});
