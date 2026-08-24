import { LOOK_NAMES } from 'klieg';
import { describe, expect, it } from 'vitest';
import { decodeConfig, encodeConfig, resolveConfig } from '../src/show-config.js';

describe('show config', () => {
  it('round-trips a config through the URL codec', () => {
    const config = { text: 'JACKPOT!', looks: ['neon' as const], cycleMs: 2000, pivot: false };
    expect(decodeConfig(encodeConfig(config))).toEqual({
      text: 'JACKPOT!',
      looks: ['neon'],
      cycleMs: 2000,
      lighting: 'static',
      bloom: undefined,
      pivot: false,
      tint: undefined,
    });
  });

  it('survives non-ASCII text', () => {
    expect(decodeConfig(encodeConfig({ text: 'ÜBER — 祝' })).text).toBe('ÜBER — 祝');
  });

  it('repairs the plus signs a query string turns into spaces', () => {
    const encoded = encodeConfig({ text: 'k~' });
    expect(encoded).toContain('+');
    expect(decodeConfig(encoded.replaceAll('+', ' ')).text).toBe('k~');
  });

  for (const [label, raw] of [
    ['absent', ''],
    ['null', null],
    ['not base64', 'not-base64'],
    ['base64 of nothing useful', btoa('hello there')],
    ['truncated', encodeConfig({ text: 'hi' }).slice(0, 9)],
    ['a bare number', encodeConfig(7 as never)],
  ] as const) {
    it(`falls back to defaults for a ${label} hash`, () => {
      expect(decodeConfig(raw)).toEqual({
        text: 'klieg',
        looks: [...LOOK_NAMES],
        cycleMs: 3000,
        lighting: 'static',
        bloom: undefined,
        pivot: true,
        tint: undefined,
      });
    });
  }

  it('drops look names it does not know, and duplicates', () => {
    expect(resolveConfig({ looks: ['gold', 'nope', 'gold', 'neon'] }).looks).toEqual([
      'gold',
      'neon',
    ]);
  });

  it('falls back to every look when none of them are known', () => {
    expect(resolveConfig({ looks: ['nope'] }).looks).toEqual([...LOOK_NAMES]);
  });

  it('clamps a cycle a URL could use to melt a phone, and keeps 0 as "never advance"', () => {
    expect(resolveConfig({ cycleMs: 1 }).cycleMs).toBe(800);
    expect(resolveConfig({ cycleMs: 1e9 }).cycleMs).toBe(60_000);
    expect(resolveConfig({ cycleMs: 0 }).cycleMs).toBe(0);
    expect(resolveConfig({ cycleMs: -5 }).cycleMs).toBe(0);
    expect(resolveConfig({ cycleMs: 'soon' }).cycleMs).toBe(3000);
  });

  it('caps the text length', () => {
    expect(resolveConfig({ text: 'x'.repeat(500) }).text).toHaveLength(120);
    expect(resolveConfig({ text: '   ' }).text).toBe('klieg');
  });

  it('takes a tint only as an in-range integer', () => {
    expect(resolveConfig({ tint: 0xff2d6f }).tint).toBe(0xff2d6f);
    expect(resolveConfig({ tint: -1 }).tint).toBeUndefined();
    expect(resolveConfig({ tint: 0x1000000 }).tint).toBeUndefined();
    expect(resolveConfig({ tint: '#ff2d6f' }).tint).toBeUndefined();
  });

  it('keeps bloom undefined unless it is a real boolean, so the look decides', () => {
    expect(resolveConfig({}).bloom).toBeUndefined();
    expect(resolveConfig({ bloom: 'yes' }).bloom).toBeUndefined();
    expect(resolveConfig({ bloom: false }).bloom).toBe(false);
  });

  it('takes only a lighting name it knows', () => {
    expect(resolveConfig({ lighting: 'sweep' }).lighting).toBe('sweep');
    expect(resolveConfig({ lighting: 'disco' }).lighting).toBe('static');
  });
});
