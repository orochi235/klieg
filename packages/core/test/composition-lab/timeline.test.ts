import { describe, expect, it } from 'vitest';
import type { Composition, EffectLayer } from '../../dev/composition-lab/src/composition.js';
import { DEFAULT_COMPOSITION } from '../../dev/composition-lab/src/composition.js';
import { MAX_BLOCKS, timelineOf } from '../../dev/composition-lab/src/timeline.js';

const LAYER: EffectLayer = {
  id: 'a',
  kind: 'flicker',
  enabled: true,
  params: { duration: 1000 },
  target: 'run',
  amount: 1,
  seed: 0,
};

const TAIL = 2000;

function composition(...effects: EffectLayer[]): Composition {
  return { ...DEFAULT_COMPOSITION, hold: 6000, effects };
}

describe('timelineOf', () => {
  it('marks the hold against the span the transport runs', () => {
    const t = timelineOf(composition(LAYER), TAIL);
    expect(t.spanMs).toBe(8000);
    expect(t.holdAt).toBeCloseTo(0.75);
  });

  it('lays one block per pass of the piece', () => {
    const t = timelineOf(composition(LAYER), TAIL);
    expect(t.lanes[0]?.blocks).toHaveLength(8);
    expect(t.lanes[0]?.blocks[0]).toEqual({ at: 0, width: 0.125 });
  });

  it('clips the last block at the edge rather than running it past', () => {
    const t = timelineOf(composition({ ...LAYER, params: { duration: 3000 } }), TAIL);
    const last = t.lanes[0]?.blocks.at(-1);
    expect((last?.at ?? 0) + (last?.width ?? 0)).toBeCloseTo(1);
  });

  // The reading the timeline exists for: `roving` at `epochs: 96` makes a 1400ms flicker a 306s
  // pass, so against a 6s hold the layer does about one thing per fire.
  it('says what share of a pass plays when the pass outruns the fire', () => {
    const roved: EffectLayer = {
      ...LAYER,
      params: { duration: 1400 },
      roving: { dwell: 3200, seed: 0, epochs: 96 },
    };
    const lane = timelineOf(composition(roved), TAIL).lanes[0];
    expect(lane?.overruns).toBe(true);
    expect(lane?.shareOfPass).toBeLessThan(0.05);
    expect(lane?.blocks).toEqual([{ at: 0, width: 1 }]);
  });

  it('reports a pass that fits as playing whole', () => {
    expect(timelineOf(composition(LAYER), TAIL).lanes[0]?.shareOfPass).toBe(1);
    expect(timelineOf(composition(LAYER), TAIL).lanes[0]?.overruns).toBe(false);
  });

  // Drawing 8000 one-millisecond blocks says nothing a solid band does not.
  it('draws no blocks at all when there are more than the eye can separate', () => {
    const fast = { ...LAYER, params: { duration: 1 } };
    const lane = timelineOf(composition(fast), TAIL).lanes[0];
    expect(lane?.blocks).toEqual([]);
    expect(lane?.passes).toBeGreaterThan(MAX_BLOCKS);
  });

  // `intermittent` refuses a spell under one pass of what it wraps, and what it wraps here is the
  // roved piece, not the flicker inside it.
  it('names the wrappers a layer carries, in the order they wrap', () => {
    const wrapped: EffectLayer = {
      ...LAYER,
      roving: { dwell: 3200, seed: 0, epochs: 1 },
      intermittent: { spell: 6000, calm: 2000, bouts: 2 },
    };
    expect(timelineOf(composition(wrapped), TAIL).lanes[0]?.label).toBe(
      'flicker · roving · intermittent',
    );
  });

  it('gives no lane to a disabled layer, which contributes no piece', () => {
    expect(timelineOf(composition({ ...LAYER, enabled: false }), TAIL).lanes).toEqual([]);
  });

  it('gives no lane to a draft whose source has not compiled', () => {
    const draft: EffectLayer = { ...LAYER, kind: 'draft', params: {}, source: 'return {}' };
    expect(timelineOf(composition(draft), TAIL).lanes).toEqual([]);
  });
});
