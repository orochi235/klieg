import { LOOK_NAMES } from 'klieg';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOKS, decodeConfig, encodeConfig, resolveConfig } from '../src/show-config.js';

describe('show config: the performance fields', () => {
  const round = (c: Parameters<typeof encodeConfig>[0]) => decodeConfig(encodeConfig(c));

  it('carries the motion slots', () => {
    const c = round({ enter: 'slam', active: 'float', exit: 'shatter' });
    expect([c.enter, c.active, c.exit]).toEqual(['slam', 'float', 'shatter']);
  });

  it('drops a motion name it does not know', () => {
    expect(round({ enter: 'nope' as never }).enter).toBeUndefined();
  });

  it('carries a transform in degrees and clamps it', () => {
    expect(round({ transform: { yaw: 20, pitch: -10, roll: 0 } }).transform).toEqual({
      yaw: 20,
      pitch: -10,
      roll: 0,
    });
    expect(round({ transform: { yaw: 9999, pitch: 0, roll: 0 } }).transform?.yaw).toBe(180);
  });

  it('defaults lineAlign to center and keeps a known one', () => {
    expect(round({}).lineAlign).toBe('center');
    expect(round({ lineAlign: 'start' }).lineAlign).toBe('start');
    expect(round({ lineAlign: 'sideways' as never }).lineAlign).toBe('center');
  });

  it('carries the acronym routine, or nothing at all', () => {
    expect(round({}).acronym).toBeUndefined();
    expect(
      round({ acronym: { caps: 0x2df0ff, read: 1200, settle: 600, hold: 'click' } }).acronym,
    ).toEqual({ caps: 0x2df0ff, read: 1200, settle: 600, hold: 'click' });
  });

  it('keeps chrome on unless a link turns it off', () => {
    expect(round({}).chrome).toBe(true);
    expect(round({ chrome: false }).chrome).toBe(false);
    expect(round({ chrome: 'no' as never }).chrome).toBe(true);
  });

  it('carries one composed look, and presents it instead of the cycle', () => {
    expect(round({ look: 'gold' }).look).toBe('gold');
    expect(round({ look: 'gold' }).looks).toEqual(['gold']);
    expect(round({ look: 'unlook' as never }).look).toBeUndefined();
  });
});

/** The base64 JSON `show` links used before the query string, built the way that codec built it. */
const legacy = (config: unknown) => btoa(encodeURIComponent(JSON.stringify(config)));

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
      lineAlign: 'center',
      wrap: true,
      chrome: true,
    });
  });

  it('survives non-ASCII text', () => {
    expect(decodeConfig(encodeConfig({ text: 'ÜBER — 祝' })).text).toBe('ÜBER — 祝');
  });

  it('carries a space, which a query string writes as a plus', () => {
    const encoded = encodeConfig({ text: 'BIG TOP' });
    expect(encoded).toBe('t=BIG+TOP');
    expect(decodeConfig(encoded).text).toBe('BIG TOP');
  });

  it('still reads a link made before the query-string format', () => {
    const c = decodeConfig(legacy({ text: 'JACKPOT!', look: 'gold', lineAlign: 'start' }));
    expect([c.text, c.look, c.lineAlign]).toEqual(['JACKPOT!', 'gold', 'start']);
  });

  it('repairs the plus signs a `?c=` legacy link turns into spaces', () => {
    const encoded = legacy({ text: 'k~' });
    expect(encoded).toContain('+');
    expect(decodeConfig(encoded.replaceAll('+', ' ')).text).toBe('k~');
  });

  it('writes a link a person can read and edit in the address bar', () => {
    const hash = encodeConfig({
      text: 'Keep\nLighting\nInteresting, Every\nGlowing letter',
      look: 'tubing',
      lineAlign: 'start',
      hold: 'click',
      cycleMs: 0,
      acronym: { caps: 0x2df0ff, read: 1200, settle: 0, hold: 'click' },
    });
    expect(hash).toBe(
      't=Keep%0ALighting%0AInteresting%2C+Every%0AGlowing+letter&lk=tubing&ln=start' +
        '&cy=0&hd=click&an=on&cp=2df0ff&rd=1200&st=0&gt=click',
    );
    // Assigning it to `URL.hash` is what `main.ts` does, and it must not re-encode a thing.
    const url = new URL('https://klieg.dev/show/');
    url.hash = hash;
    expect(url.hash.slice(1)).toBe(hash);
  });

  it('hides the text behind base64url, and round-trips it back', () => {
    const config = { text: 'THE PUNCHLINE', look: 'gold' as const, lineAlign: 'end' as const };
    const opaque = encodeConfig(config, true);
    expect(opaque).not.toContain('PUNCHLINE');
    // Nothing outside the unreserved set, so no '#', '%', '+' or '&' for a link detector in a
    // chat client to end the URL on — which is what clipped the old fragment into its own message.
    expect(opaque).toMatch(/^[A-Za-z0-9_-]+$/);
    const c = decodeConfig(opaque);
    expect([c.text, c.look, c.lineAlign]).toEqual(['THE PUNCHLINE', 'gold', 'end']);
  });

  it('survives the URL builder that puts it in `?c=`', () => {
    const opaque = encodeConfig({ text: 'JACKPOT!', tint: 0xff2d6f }, true);
    const url = new URL('https://klieg.dev/show/');
    url.searchParams.set('c', opaque);
    expect(url.searchParams.get('c')).toBe(opaque);
    expect(url.toString()).toContain(`?c=${opaque}`);
  });

  it('reads the long spelling of a key as well as the short one it writes', () => {
    const long = decodeConfig('text=HI&lighting=sweep&lines=start&acronym=on&caps=2df0ff');
    const short = decodeConfig('t=HI&lt=sweep&ln=start&an=on&cp=2df0ff');
    expect(long).toEqual(short);
  });

  it('writes only what differs from the defaults', () => {
    expect(encodeConfig({})).toBe('');
    expect(encodeConfig({ lineAlign: 'center', chrome: true, cycleMs: 3000 })).toBe('');
  });

  for (const [label, raw] of [
    ['absent', ''],
    ['null', null],
    ['not base64', 'not-base64'],
    ['base64 of nothing useful', btoa('hello there')],
    ['truncated legacy', legacy({ text: 'hi' }).slice(0, 9)],
    ['a bare number', encodeConfig(7 as never)],
  ] as const) {
    it(`falls back to defaults for a ${label} hash`, () => {
      expect(decodeConfig(raw)).toEqual({
        text: 'klieg',
        looks: [...DEFAULT_LOOKS],
        cycleMs: 3000,
        lighting: 'static',
        bloom: undefined,
        pivot: true,
        tint: undefined,
        lineAlign: 'center',
        wrap: true,
        chrome: true,
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
    expect(resolveConfig({ looks: ['nope'] }).looks).toEqual([...DEFAULT_LOOKS]);
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

  it('leaves neon out of the default cycle but still accepts it', () => {
    expect(DEFAULT_LOOKS).not.toContain('neon');
    expect(DEFAULT_LOOKS).toContain('tubing');
    expect(DEFAULT_LOOKS).toHaveLength(LOOK_NAMES.length - 1);
    expect(resolveConfig({ looks: ['neon'] }).looks).toEqual(['neon']);
  });
});
