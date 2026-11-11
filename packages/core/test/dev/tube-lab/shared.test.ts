import { describe, expect, it } from 'vitest';
import { specValues, withSpecValue } from '../../../dev/tube-lab/src/rail/values.js';
import {
  DEFAULT_SHARED,
  sharedOf,
  specOfShared,
  validShared,
  writeShared,
} from '../../../dev/tube-lab/src/shared.js';
import { tubeSpecOf } from '../../../dev/tube-lab/src/spec.js';

describe('the shared settings', () => {
  it('rebuild the look’s own spec when nothing was changed', () => {
    for (const look of ['tubing', 'piping'] as const) {
      const shared = sharedOf(tubeSpecOf(look), look, true, 'M');
      expect(specOfShared(shared)).toEqual(tubeSpecOf(look));
    }
  });

  it('rebuild the spec a run of rail writes made', () => {
    let spec = tubeSpecOf('tubing');
    let shared = DEFAULT_SHARED;
    const writes: [string, unknown][] = [
      ['radius', 0.05],
      ['back', true],
      ['domain', 'axis'],
      ['angle', 45],
      ['stopCount', 3],
      ['stop2', '#123456'],
      ['look.rim', 0.4],
      ['cornerMix', 0.25],
    ];
    for (const [path, value] of writes) {
      spec = withSpecValue(spec, path, value) ?? spec;
      shared = writeShared(shared, path, value);
    }
    expect(specOfShared(shared)).toEqual(spec);
    expect(specValues(specOfShared(shared))).toEqual(specValues(spec));
  });

  it('reseed every spec row from a new look, keeping bloom and letters', () => {
    const tuned = writeShared(writeShared(DEFAULT_SHARED, 'radius', 0.1), 'letters', 'AB');
    const next = writeShared(tuned, 'preset', 'piping');
    expect(specOfShared(next)).toEqual(tubeSpecOf('piping'));
    expect(next.letters).toBe('AB');
  });

  it('read a stored record with a row missing as that row’s look value', () => {
    const { radius: _dropped, ...rest } = writeShared(DEFAULT_SHARED, 'runs', 9);
    const read = validShared(rest);
    expect(read?.radius).toBe(tubeSpecOf('tubing').radius);
    expect(read?.runs).toBe(9);
    expect(validShared({ preset: 'neon' })).toBeNull();
  });
});
