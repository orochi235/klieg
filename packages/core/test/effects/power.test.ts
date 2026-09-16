import { describe, expect, it, vi } from 'vitest';
import {
  blowout,
  glow,
  type PowerControl,
  type PowerState,
  power,
  strike,
  thinning,
} from '../../src/effects/power.js';
import { level } from '../../src/effects/signal.js';
import type { FrameCtx, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

const partAt = (index: number): PartInfo => ({
  kind: 'run',
  index,
  count: 3,
  letter: { index: 0, count: 1 },
  x: 0,
  y: 0,
  ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  at: 0,
  span: 1,
});
const PARTS = [partAt(0), partAt(1), partAt(2)];
const frame = (now: number, dt = 16): FrameCtx => ({ ...NO_CTX, now, dt });

/** Every part asked once at `now`, as `EffectFrame` does; returns what the first part got. */
function draw(control: PowerControl, now: number, dt = 16) {
  const outs = PARTS.map((p) => control.piece.at(0, p, frame(now, dt)));
  return outs[0];
}

/** Frames every 100ms from `from` to `to` inclusive, all parts each frame. */
function run(c: PowerControl, from: number, to: number, before?: (now: number) => void) {
  let out = {};
  for (let now = from; now <= to; now += 100) {
    before?.(now);
    out = draw(c, now) as object;
  }
  return out;
}

describe('warm-up curves', () => {
  it('strike opens dark, catches by its end and holds lit after', () => {
    const w = strike({ duration: 1000, strikes: 4 });
    expect(w.gain(0)).toBe(0);
    expect(w.gain(999)).toBe(1);
    expect(w.gain(5000)).toBe(1);
  });

  it('strike stays lit longer with each blink', () => {
    const w = strike({ duration: 1000, strikes: 4 });
    const lit = [0, 1, 2, 3].map((i) => {
      let n = 0;
      for (let ms = i * 250; ms < (i + 1) * 250; ms++) n += w.gain(ms);
      return n;
    });
    for (let i = 1; i < lit.length; i++) expect(lit[i]).toBeGreaterThan(lit[i - 1] as number);
  });

  it('thinning drops less often as it warms, and not at all past its duration', () => {
    const w = thinning({ duration: 3000 });
    const drops = (from: number, to: number) => {
      let n = 0;
      for (let ms = from; ms < to; ms += 1400 / 24) if (w.gain(ms) < 1) n++;
      return n;
    };
    expect(drops(0, 1500)).toBeGreaterThan(drops(1500, 3000));
    expect(w.gain(3000)).toBe(1);
  });

  it('glow climbs from dark to full', () => {
    const w = glow({ duration: 1000 });
    const mean = (from: number, to: number) => {
      let sum = 0;
      for (let ms = from; ms < to; ms++) sum += w.gain(ms);
      return sum / (to - from);
    };
    expect(w.gain(0)).toBe(0);
    expect(mean(500, 1000)).toBeGreaterThan(mean(0, 500));
    expect(w.gain(1000)).toBe(1);
  });

  it('never goes NaN at a non-finite time', () => {
    for (const w of [strike(), thinning(), glow()]) expect(w.gain(Number.NaN)).toBe(1);
  });
});

describe('blowout', () => {
  it('climbs well past its own glow, holds, and dies to dark by its end', () => {
    const f = blowout({ duration: 400, peak: 3 });
    expect(f.gain(0)).toBe(1);
    expect(f.gain(100)).toBeCloseTo(3);
    expect(f.gain(200)).toBeGreaterThan(2);
    expect(f.gain(399)).toBeLessThan(0.1);
    expect(f.gain(400)).toBe(0);
    expect(f.gain(Number.NaN)).toBe(0);
  });
});

describe('power', () => {
  it('contributes nothing while on', () => {
    const c = power();
    expect(draw(c, 0)).toEqual({});
    expect(c.warm(0, partAt(0), frame(0))).toBe(1);
  });

  it('goes dark on the next frame after a short, and stays dark until up', () => {
    const c = power({ flare: null });
    draw(c, 0);
    c.overload();
    expect(c.state).toBe('shorted');
    expect(draw(c, 16)).toEqual({ gain: 0 });
    expect(draw(c, 60_000)).toEqual({ gain: 0 });
    expect(c.warm(0, partAt(0), frame(60_000))).toBe(0);
  });

  it('warms up from the frame after up, then comes back on', () => {
    const c = power({ flare: null, warmup: strike({ duration: 1000 }) });
    c.overload();
    draw(c, 0);
    c.up();
    expect(draw(c, 100)).toEqual({ gain: 0 });
    expect(draw(c, 1099)).toEqual({ gain: 1 });
    expect(c.warm(0, partAt(0), frame(1099))).toBe(0);
    expect(draw(c, 1100)).toEqual({});
    expect(c.warm(0, partAt(0), frame(1100))).toBe(1);
  });

  it('warms up by itself after a timed short, counted from the end of the dark', () => {
    const c = power({ flare: null, warmup: strike({ duration: 400 }) });
    c.overload({ for: 1000 });
    draw(c, 0);
    expect(draw(c, 999)).toEqual({ gain: 0 });
    // 1300 is 300ms into the warm-up whichever frame first saw the dark end.
    expect(draw(c, 1300)).toEqual({ gain: strike({ duration: 400 }).gain(300) });
    expect(c.state).toBe('warming');
    expect(draw(c, 1400)).toEqual({});
  });

  it('opens warming when asked to', () => {
    const c = power({ start: 'warming', warmup: strike({ duration: 500 }) });
    expect(draw(c, 1000)).toEqual({ gain: 0 });
    expect(draw(c, 1500)).toEqual({});
  });

  it('does nothing to a sign that is already on or warming', () => {
    const c = power({ start: 'warming', warmup: strike({ duration: 500 }) });
    draw(c, 0);
    c.up();
    expect(draw(c, 250)).toEqual({ gain: strike({ duration: 500 }).gain(250) });
    const on = power();
    on.up();
    expect(on.state).toBe('on');
  });

  it('skips the flare and the warm-up under reduced motion', () => {
    const seen: PowerState[] = [];
    const c = power({ onState: (s) => seen.push(s) });
    draw(c, 0, Number.POSITIVE_INFINITY);
    c.overload();
    expect(draw(c, 16, Number.POSITIVE_INFINITY)).toEqual({ gain: 0 });
    c.up();
    expect(draw(c, 32, Number.POSITIVE_INFINITY)).toEqual({});
    // Straight to dark and straight back: a flare or warm-up would each have shown up here.
    expect(seen).toEqual(['shorted', 'warming', 'on']);
  });
});

describe('power flare', () => {
  it('flares before a short goes dark, and reports each change as it lands', () => {
    const seen: string[] = [];
    const f = blowout({ duration: 400 });
    const c = power({ flare: f, onState: (s, p) => seen.push(`${p}>${s}`) });
    draw(c, 0);
    c.overload();
    expect(draw(c, 16)).toEqual({ gain: f.gain(0) });
    expect(draw(c, 216)).toEqual({ gain: f.gain(200) });
    expect(c.warm(0, partAt(0), frame(216))).toBe(0);
    expect(draw(c, 416)).toEqual({ gain: 0 });
    expect(seen).toEqual(['on>flaring', 'flaring>shorted']);
  });

  it("counts a timed short's dark from the end of the flare", () => {
    const c = power({ flare: blowout({ duration: 400 }), warmup: strike({ duration: 100 }) });
    draw(c, 0);
    c.overload({ for: 1000 });
    draw(c, 16);
    // Seen 84ms after the flare ended at 416: the dark still counts from 416, not from this frame.
    expect(draw(c, 500)).toEqual({ gain: 0 });
    expect(draw(c, 1415)).toEqual({ gain: 0 });
    expect(c.state).toBe('shorted');
    draw(c, 1416);
    expect(c.state).toBe('warming');
    expect(draw(c, 1516)).toEqual({});
  });

  it('flares when the trip shorts the sign, then goes dark and relights', () => {
    const hover = level(1);
    const seen: PowerState[] = [];
    const c = power({
      flare: blowout({ duration: 300 }),
      warmup: strike({ duration: 200 }),
      trip: { on: hover, holdMs: 1000, outMs: 500 },
      onState: (s) => seen.push(s),
    });
    expect(run(c, 0, 900)).toEqual({});
    draw(c, 1000);
    expect(c.state).toBe('flaring');
    expect(draw(c, 1300)).toEqual({ gain: 0 });
    hover.set(0);
    draw(c, 1800);
    expect(c.state).toBe('warming');
    expect(draw(c, 2000)).toEqual({});
    expect(seen).toEqual(['flaring', 'shorted', 'warming', 'on']);
  });

  it('warms up straight from a flare when told to', () => {
    const c = power({ warmup: strike({ duration: 500 }) });
    draw(c, 0);
    c.overload();
    draw(c, 16);
    expect(c.state).toBe('flaring');
    c.up();
    expect(draw(c, 32)).toEqual({ gain: strike({ duration: 500 }).gain(0) });
    expect(c.state).toBe('warming');
  });

  it('lets a flare finish when the sign is shorted again during it', () => {
    const f = blowout({ duration: 400 });
    const c = power({ flare: f, warmup: strike({ duration: 100 }) });
    draw(c, 0);
    c.overload();
    draw(c, 16);
    c.overload({ for: 100 });
    expect(draw(c, 100)).toEqual({ gain: f.gain(84) });
    expect(draw(c, 416)).toEqual({ gain: 0 });
    draw(c, 516);
    expect(c.state).toBe('warming');
  });

  it('keeps the frame going when a listener throws', () => {
    const reported: unknown[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        reported.push(err);
      }
    });
    try {
      const c = power({
        onState: () => {
          throw new Error('listener');
        },
      });
      draw(c, 0);
      c.overload();
      expect(() => draw(c, 16)).not.toThrow();
      expect(reported).toHaveLength(1);
      expect(c.state).toBe('flaring');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('power trip', () => {
  it('shorts the whole sign once the watched signal holds at its level, then reignites', () => {
    const hover = level(1);
    const c = power({
      flare: null,
      warmup: strike({ duration: 500 }),
      trip: { on: hover, holdMs: 3000, outMs: 2000 },
    });
    expect(run(c, 0, 2900)).toEqual({});
    expect(draw(c, 3000)).toEqual({ gain: 0 });
    expect(PARTS.map((p) => c.piece.at(0, p, frame(3000)))).toEqual(PARTS.map(() => ({ gain: 0 })));
    expect(run(c, 3100, 4900)).toEqual({ gain: 0 });
    expect(draw(c, 5000)).toEqual({ gain: 0 });
    expect(c.state).toBe('warming');
    expect(draw(c, 5500)).toEqual({});
  });

  // A signal like `dwell` reads high on the one run under the cursor and low on the rest; the hold
  // has to survive the low readings from the parts asked after it in the same frame.
  it('trips when a single part holds high while the rest read low', () => {
    const c = power({
      flare: null,
      trip: { on: (_t, part) => (part.index === 0 ? 1 : 0), holdMs: 1000 },
    });
    expect(run(c, 0, 900)).toEqual({});
    expect(draw(c, 1000)).toEqual({ gain: 0 });
  });

  it('starts the hold over when the reading dips', () => {
    const hover = level(1);
    const c = power({ flare: null, trip: { on: hover, holdMs: 3000 } });
    run(c, 0, 4000, (now) => hover.set(now === 2000 ? 0.99 : 1));
    expect(c.state).toBe('on');
    expect(draw(c, 5100)).toEqual({ gain: 0 });
  });

  it('does not trip below its level', () => {
    const hover = level(0.9);
    const c = power({ trip: { on: hover, holdMs: 1000 } });
    expect(run(c, 0, 10_000)).toEqual({});
  });
});
