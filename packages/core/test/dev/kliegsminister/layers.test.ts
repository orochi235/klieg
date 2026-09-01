import { describe, expect, it } from 'vitest';
import { junction } from '../../../dev/kliegsminister/src/instrument.js';

describe('kliegsminister layers', () => {
  it('paints in the order the layer panel lists, so a reorder cannot change the drawing', () => {
    expect(junction.canvas?.layers.map((l) => l.id)).toEqual(junction.layers?.ids);
  });
});
