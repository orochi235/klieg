import { describe, expect, it } from 'vitest';
import { buildPiece, defaultParams } from '../../dev/composition-lab/src/pieces.js';
import type { PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from '../effects/ctx.js';

function part(x: number): PartInfo {
  return {
    kind: 'run',
    index: 0,
    count: 1,
    letter: { index: 0, count: 1 },
    x,
    y: 0,
    ink: { minX: x, maxX: x, minY: 0, maxY: 0 },
    at: 0,
    span: 1,
  };
}

describe('buildPiece for lamp', () => {
  it('lights a part under the lamp and leaves one outside its radius alone', () => {
    const piece = buildPiece('lamp', { ...defaultParams('lamp'), x: 0, radius: 0.5 });
    expect(piece?.at(0, part(0), NO_CTX).light?.amount).toBeGreaterThan(0);
    expect(piece?.at(0, part(4), NO_CTX).light).toBeUndefined();
  });

  it('ignores the clock under a fixed source and follows it under an orbit', () => {
    const params = { ...defaultParams('lamp'), x: 0, y: 0, sweep: 0.4, radius: 0.5 };
    const still = buildPiece('lamp', params, { lampSource: 'fixed' });
    const moving = buildPiece('lamp', params, { lampSource: 'orbit' });
    const at = (p: typeof still, t: number) => p?.at(t, part(0.4), NO_CTX).light?.amount ?? 0;
    expect(at(still, 0)).toBeCloseTo(at(still, 0.5));
    expect(at(moving, 0)).not.toBeCloseTo(at(moving, 0.5));
  });
});
