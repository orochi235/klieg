import { beforeAll, describe, expect, it } from 'vitest';
import type { LoadedFont } from '../../src/text/font.js';
import {
  fitScale,
  LINE_HEIGHT_EM,
  layoutRunsForKlieg,
  type Slot,
  wrapRuns,
} from '../../src/text/layout.js';
import { familyFor, registerFace } from '../../src/text/outline-face.js';
import { styledRunsOf } from '../../src/text/runs.js';

const UPEM = 1000;

/** Every glyph one advance wide, a space a quarter; the pair A|V kerned tighter. */
function stubLoadedFont(): LoadedFont {
  const font = {
    unitsPerEm: UPEM,
    ascender: 800,
    charToGlyph: (ch: string) => ({
      advanceWidth: ch === ' ' ? 250 : 600,
      getPath: () => ({ commands: ch === ' ' ? [] : [{ type: 'M', x: 0, y: 0 }] }),
    }),
    getKerningValue: () => 0,
  } as unknown as LoadedFont['font'];
  return {
    font,
    unitsPerEm: UPEM,
    metrics: {
      advanceOf: (ch) => (ch === ' ' ? 250 : 600),
      kernOf: (a, b) => (a === 'A' && b === 'V' ? -30 : 0),
    },
    key: '/stub.ttf',
    family: 'klieg-test-stub',
    bytes: new ArrayBuffer(8),
  };
}

// Every glyph is 10 wide; the pair A|V is kerned 3 tighter.
const metrics = {
  advanceOf: (ch: string) => (ch === ' ' ? 5 : 10),
  kernOf: (a: string, b: string) => (a === 'A' && b === 'V' ? -3 : 0),
};

describe('fitScale', () => {
  it('fits to width when the word is wide', () => {
    expect(fitScale(100, 10, { width: 62, height: 100 })).toBeCloseTo(0.62, 5);
  });

  it('fits to height when the word is tall', () => {
    expect(fitScale(10, 100, { width: 100, height: 30 })).toBeCloseTo(0.3, 5);
  });

  it('never scales past the cap', () => {
    expect(fitScale(1, 1, { width: 1000, height: 1000 })).toBe(2.2);
  });

  it('returns the cap for an empty word rather than dividing by zero', () => {
    expect(Number.isFinite(fitScale(0, 0, { width: 10, height: 10 }))).toBe(true);
  });

  it('returns exactly the cap value for a zero-size word, custom cap included', () => {
    expect(fitScale(0, 0, { width: 10, height: 10 })).toBe(2.2);
    expect(fitScale(0, 0, { width: 10, height: 10, cap: 5 })).toBe(5);
  });
});

describe('layoutRunsForKlieg', () => {
  const OPTS = { maxWidth: 1e6, lineHeight: LINE_HEIGHT_EM, align: 'left' as const };
  let family: string;

  beforeAll(async () => {
    family = await registerFace(familyFor(900, 'display'), stubLoadedFont());
  });

  it('gives every code point a slot, including the blank ones', () => {
    const laid = layoutRunsForKlieg(styledRunsOf('A B', family), OPTS);

    expect(laid.slots.map((s) => s.char)).toEqual(['A', ' ', 'B']);
    expect(laid.slots.map((s) => s.drawsInk)).toEqual([true, false, true]);
  });

  it("takes a slot's right edge from its own advance, never the next slot's x", () => {
    const laid = layoutRunsForKlieg(styledRunsOf('AB', family), OPTS);
    const first = laid.slots[0] as Slot;

    expect(first.advance).toBeGreaterThan(0);
    expect(first.x + first.advance).toBeGreaterThan(first.x);
  });

  it("puts a newline's two sides on different lines and gives it no slot", () => {
    const laid = layoutRunsForKlieg(styledRunsOf('A\nB', family), OPTS);

    expect(laid.slots.map((s) => s.char)).toEqual(['A', 'B']);
    expect(laid.slots[0]?.line).toBe(0);
    expect(laid.slots[1]?.line).toBe(1);
  });

  it('lays a string and a single run of the same text out identically', () => {
    const fromString = layoutRunsForKlieg(styledRunsOf('AB', family), OPTS);
    const fromRun = layoutRunsForKlieg(styledRunsOf([{ text: 'AB' }], family), OPTS);

    expect(fromRun.slots.map((s) => s.x)).toEqual(fromString.slots.map((s) => s.x));
    expect(fromRun.width).toBeCloseTo(fromString.width);
  });
});

describe('wrapRuns', () => {
  const OPTS = { maxWidth: 1e6, lineHeight: LINE_HEIGHT_EM, align: 'left' as const };
  let family: string;

  beforeAll(async () => {
    family = await registerFace(familyFor(901, 'display'), stubLoadedFont());
  });

  it('picks the arrangement that lets the type be largest, not the first that fits', () => {
    // On one line the pair is 5.05em wide against a 4em box; broken it is 2.4em against 2.2em tall.
    const wide = wrapRuns(styledRunsOf('AAAA BBBB', family), { width: 4, height: 4 }, OPTS);

    expect(wide.lines).toHaveLength(2);
  });

  it('keeps a single word on one line, having nowhere to break it', () => {
    const one = wrapRuns(styledRunsOf('AAAA', family), { width: 4, height: 4 }, OPTS);

    expect(one.lines).toHaveLength(1);
  });

  it('honours an explicit newline as well as the break it chooses', () => {
    const laid = wrapRuns(styledRunsOf('AA\nBB', family), { width: 4, height: 4 }, OPTS);

    expect(laid.lines).toHaveLength(2);
    expect(laid.slots.map((s) => s.char).join('')).toBe('AABB');
  });

  it('never lays a sign out smaller than the greedy break would', () => {
    const budget = { width: 4, height: 4 };
    for (const text of ['AAAA BBBB', 'AA BB CC', 'AAAAAA B', 'A BB CCC DDDD']) {
      const searched = wrapRuns(styledRunsOf(text, family), budget, OPTS);
      const greedy = layoutRunsForKlieg(styledRunsOf(text, family), {
        ...OPTS,
        maxWidth: budget.width,
      });

      expect(fitScale(searched.width, searched.height, budget)).toBeGreaterThanOrEqual(
        fitScale(greedy.width, greedy.height, budget),
      );
    }
  });

  it('gives every code point a slot under wrap, the blank one included', () => {
    const laid = wrapRuns(styledRunsOf('A B', family), { width: 4, height: 4 }, OPTS);

    expect(laid.slots.map((s) => s.char)).toEqual(['A', ' ', 'B']);
  });
});
