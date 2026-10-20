import { describe, expect, it } from 'vitest';
import {
  type LabConfig,
  type LayerEntry,
  newEntry,
  schema,
  toComposition,
} from '../../dev/composition-lab/src/config.js';
import { emit } from '../../dev/composition-lab/src/emit.js';
import { diagramOf, idOf, layerOfGroup, partOf } from '../../dev/composition-lab/src/pipeline.js';

const none = (): string[] => [];

function withLayers(...entries: LayerEntry[]): LabConfig {
  return { ...schema.defaults(), effects: entries as unknown as LabConfig['effects'] };
}

function flicker(over: Partial<LayerEntry> = {}): LayerEntry {
  const e = newEntry('flicker');
  return {
    ...e,
    roving: { ...(e.roving as object), on: true },
    intermittent: { ...(e.intermittent as object), on: true },
    ...over,
  };
}

const pairs = (config: LabConfig, warnings = none) =>
  diagramOf(config, warnings).edges.map((e) => `${e.from}→${e.to}`);

const rowsOf = (config: LabConfig, id: string, warnings = none) =>
  diagramOf(config, warnings).nodes.find((n) => n.id === id)?.lines ?? [];

describe('the pipeline diagram', () => {
  it('draws a layer as patch, its wrappers in order, then its pool, into the word', () => {
    const e = flicker();
    expect(pairs(withLayers(e))).toEqual(
      expect.arrayContaining([
        `patch:${e.id}→roving:${e.id}`,
        `roving:${e.id}→intermittent:${e.id}`,
        `intermittent:${e.id}→pool:${e.id}`,
        `pool:${e.id}→word`,
      ]),
    );
  });

  it('leaves a wrapper that is off out of the row', () => {
    const e = flicker();
    e.roving = { ...(e.roving as object), on: false };
    const drawn = pairs(withLayers(e));
    expect(drawn).toContain(`patch:${e.id}→intermittent:${e.id}`);
    expect(diagramOf(withLayers(e), none).nodes.map((n) => n.id)).not.toContain(`roving:${e.id}`);
  });

  it('draws the motion row and the word with no layers', () => {
    const data = diagramOf(schema.defaults(), none);
    expect(data.nodes.map((n) => n.id).sort()).toEqual(
      ['motion:active', 'motion:enter', 'motion:exit', 'word'].sort(),
    );
    expect(pairs(schema.defaults())).toEqual([
      'motion:enter→motion:active',
      'motion:active→motion:exit',
      'motion:exit→word',
    ]);
    expect(data.groups?.find((g) => g.id === 'layers')?.members).toEqual([]);
  });

  it('labels each motion node with its stage and choice', () => {
    expect(rowsOf(schema.defaults(), 'motion:enter')).toEqual(['enter', 'slam']);
  });

  it('draws a disabled layer and marks it', () => {
    const e = flicker({ enabled: false });
    expect(rowsOf(withLayers(e), `patch:${e.id}`)).toContain('off');
    expect(rowsOf(withLayers(flicker()), `patch:${flicker().id}`)).not.toContain('off');
  });

  it("puts a layer's warnings on its pool node", () => {
    const e = flicker();
    expect(rowsOf(withLayers(e), `pool:${e.id}`, () => ['no runs'])).toContain('no runs');
  });

  it('round-trips every id through partOf', () => {
    const data = diagramOf(withLayers(flicker(), newEntry('lamp')), none);
    for (const { id } of data.nodes) expect(idOf(partOf(id) ?? { kind: 'word' })).toBe(id);
    expect(partOf('nonsense')).toBeNull();
  });

  it('puts each layer in its own group, in order, inside a group that reorders along y', () => {
    const a = flicker();
    const b = newEntry('hue');
    const layers = diagramOf(withLayers(a, b), none).groups?.find((g) => g.id === 'layers');
    expect(layers?.reorder).toBe('y');
    expect(layers?.members.map(layerOfGroup)).toEqual([a.id, b.id]);
  });

  it('draws a trial saved before the diagram', () => {
    const draft = { ...newEntry('draft'), source: 'return { period: 1000, at: () => ({}) };' };
    const both = flicker();
    const config = withLayers(draft, both);
    const before = emit(toComposition(config));
    const ids = diagramOf(config, none).nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([`patch:${draft.id}`, `pool:${draft.id}`]));
    expect(ids.filter((id) => id.endsWith(`:${both.id}`))).toHaveLength(4);
    expect(emit(toComposition(config))).toBe(before);
  });
});
