import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { minBendRadius } from '../../../../src/render/tube/bend.js';
import { HAIRPIN_SHAPES } from '../../../../src/render/tube/hairpin.js';
import { ALL_BREAK, ALL_CONNECT, cutIntoRuns, REJOINS } from '../../../../src/render/tube/runs.js';
import { tightestBend } from '../../../../src/render/tube/sweep.js';
import {
  circleOf,
  circlePath,
  OPEN_PATH,
  openLPath,
  PATH,
  sharpVPath,
  squarePath,
  turnAt,
} from './paths.js';

describe('corner detection', () => {
  it('ignores repeated points instead of reading them as corners', () => {
    // glyphToShapes emits zero-length LineCurves between curve pairs, which survive into the
    // polyline as duplicate points. A tangent test that does not guard against them sees a
    // corner at every one and cuts the path to shreds.
    const doubled: THREE.Vector3[] = [];
    for (const p of circlePath()) {
      doubled.push(p, p.clone());
    }
    const { runs } = cutIntoRuns([PATH(doubled)], { runs: 3, minRun: 0 });
    expect(runs).toHaveLength(3);
  });
});

describe('cutIntoRuns', () => {
  it('cuts a square at its four corners', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('cuts a cornerless loop by count alone', () => {
    const { runs } = cutIntoRuns([PATH(circlePath())], { runs: 5, minRun: 0 });
    expect(runs).toHaveLength(5);
  });

  it('hits the requested count exactly at high patch counts, not just low ones', () => {
    // A single-span cornerless loop with no floor: nothing but slice()'s own arithmetic can
    // cost a run here. Low counts (a handful of cuts) can't show compounding drift; these can.
    for (const requested of [13, 30, 60]) {
      const { runs } = cutIntoRuns([PATH(circlePath())], { runs: requested, minRun: 0 });
      expect(runs.length, `requested ${requested}, got ${runs.length}`).toBe(requested);
    }
  });

  // `TubeSpec.runs` is documented as bounded above by `minRun`. It was not: the budget was
  // allocated first and any patch under the floor dropped afterwards, so a contour too short to
  // carry the requested count lost every patch and rendered nothing at all.
  it('cuts a short loop into as many runs as it can carry rather than none', () => {
    const perimeter = 2 * Math.PI * 0.153;
    const { runs } = cutIntoRuns([PATH(circleOf(0.153))], { runs: 7, minRun: 0.15 });

    expect(runs.length).toBe(Math.floor(perimeter / 0.15));
    for (const run of runs) expect(run.length).toBeGreaterThanOrEqual(0.15);
  });

  // The old behaviour, kept deliberately: small detail falls out of a sign rather than being
  // drawn coarsely. It is opt-in because it renders nothing, which reads as a defect by default.
  it('drops every patch of a short loop when asked to spend the budget anyway', () => {
    const { runs } = cutIntoRuns([PATH(circleOf(0.153))], {
      runs: 7,
      minRun: 0.15,
      shortRun: 'drop',
    });

    expect(runs).toHaveLength(0);
  });

  it('leaves a loop that cannot carry even one run empty rather than emitting a stub', () => {
    const { runs } = cutIntoRuns([PATH(circleOf(0.01))], { runs: 7, minRun: 0.15 });

    expect(runs).toHaveLength(0);
  });

  it('spends a budget it can afford exactly as before', () => {
    const { runs } = cutIntoRuns([PATH(circleOf(0.5))], { runs: 7, minRun: 0.15 });

    expect(runs).toHaveLength(7);
  });

  it('never returns fewer runs than there are corners', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], { runs: 2, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('reaches the requested count when it exceeds the corner count', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], { runs: 8, minRun: 0 });
    expect(runs).toHaveLength(8);
  });

  it('treats a corner split across two vertices as one corner', () => {
    // A resampled 90 degree corner lands between vertices, so both neighbours break the
    // threshold. Counting them separately cuts a sliver out of the corner.
    const pts = squarePath();
    const rounded = pts.map((p, i) => (i === 10 ? new THREE.Vector3(0.47, -0.47, 0) : p));
    const { runs } = cutIntoRuns([PATH(rounded)], { runs: 1, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('drops runs under the floor and keeps the rest', () => {
    // 18 requested over 4 equal-length sides splits unevenly by largest-remainder: two sides
    // get 5 patches (length 0.2), two get 4 (length 0.25). A 0.22 floor keeps only the latter.
    const { runs: loose } = cutIntoRuns([PATH(squarePath())], { runs: 18, minRun: 0 });
    const { runs: floored } = cutIntoRuns([PATH(squarePath())], { runs: 18, minRun: 0.22 });
    // Some must survive: a floor that drops everything satisfies the per-run assertion vacuously.
    expect(floored.length).toBeGreaterThan(0);
    expect(floored.length).toBeLessThan(loose.length);
    for (const run of floored) expect(run.length).toBeGreaterThanOrEqual(0.22);
  });

  it('carries surface, length and index on every run', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], { runs: 4, minRun: 0 });
    runs.forEach((run, i) => {
      expect(run.surface).toBe('front');
      expect(run.index).toBe(i);
      expect(run.length).toBeGreaterThan(0);
    });
  });

  it('cuts an open path at an interior corner without treating its endpoints as corners', () => {
    const { runs } = cutIntoRuns([OPEN_PATH(openLPath())], { runs: 2, minRun: 0 });
    expect(runs).toHaveLength(2);
  });
});

describe('corner strategies', () => {
  it('an all-break distribution reproduces the plain corner-cut run count', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0, corners: ALL_BREAK });
    expect(runs).toHaveLength(4);
  });

  it('an all-connect distribution on a closed contour yields one run', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], {
      runs: 1,
      minRun: 0,
      corners: ALL_CONNECT,
    });
    expect(runs).toHaveLength(1);
  });

  it('an all-connect distribution keeps an open path in one patch too', () => {
    const { runs } = cutIntoRuns([OPEN_PATH(openLPath())], {
      runs: 1,
      minRun: 0,
      corners: ALL_CONNECT,
    });
    expect(runs).toHaveLength(1);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const weights = { break: 1, connect: 1 };
    const { runs: a } = cutIntoRuns([PATH(squarePath())], {
      runs: 1,
      minRun: 0,
      corners: weights,
      seed: 3,
    });
    const { runs: b } = cutIntoRuns([PATH(squarePath())], {
      runs: 1,
      minRun: 0,
      corners: weights,
      seed: 3,
    });
    expect(a.map((r) => r.length)).toEqual(b.map((r) => r.length));

    const lengths = new Set<number>();
    for (let seed = 0; seed < 8; seed++) {
      const { runs } = cutIntoRuns([PATH(squarePath())], {
        runs: 1,
        minRun: 0,
        corners: weights,
        seed,
      });
      lengths.add(runs.length);
    }
    expect(lengths.size).toBeGreaterThan(1);
  });
});

describe('corner records', () => {
  /** Where `squarePath`'s four corners actually are; every other vertex sits along a side. */
  const CORNERS = [
    [-0.5, -0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
    [0.5, 0.5],
  ];

  function cornerXY(corners: { point: THREE.Vector3 }[]): number[][] {
    return corners
      .map((c) => [c.point.x, c.point.y])
      .sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number));
  }

  /**
   * A filleted corner has had its vertex cut away, so the record sits on the arc that replaced it —
   * near its own corner and nowhere near the middle of a side. Exact equality held only while
   * `connect` left the corner vertex in place.
   */
  it('lands each record on a corner of the path, not merely somewhere along it', () => {
    const { corners } = cutIntoRuns([PATH(squarePath())], {
      runs: 1,
      minRun: 0,
      corners: ALL_CONNECT,
      radius: 0.03,
      bend: 2,
    });

    expect(corners).toHaveLength(4);
    const placed = cornerXY(corners);
    placed.forEach((xy, i) => {
      const want = CORNERS[i] as number[];
      const dx = (xy[0] as number) - (want[0] as number);
      const dy = (xy[1] as number) - (want[1] as number);
      // rho_min is 0.06 here, so a 90-degree fillet pulls the path 0.025 in along the bisector.
      expect(Math.hypot(dx, dy)).toBeLessThan(0.06);
    });
  });

  it('reports the strategy that was actually drawn, not a constant', () => {
    const opts = { runs: 1, minRun: 0 };
    const connected = cutIntoRuns([PATH(squarePath())], { ...opts, corners: ALL_CONNECT });
    const broken = cutIntoRuns([PATH(squarePath())], { ...opts, corners: ALL_BREAK });

    expect(connected.corners.map((c) => c.strategy)).toEqual(Array(4).fill('connect'));
    expect(broken.corners.map((c) => c.strategy)).toEqual(Array(4).fill('break'));
  });

  it('records every corner of a mixed draw, and the draw really does mix', () => {
    const weights = { break: 1, connect: 1 };
    const opts = { runs: 1, minRun: 0, corners: weights, seed: 7 };
    const a = cutIntoRuns([PATH(squarePath())], opts);
    const b = cutIntoRuns([PATH(squarePath())], opts);

    expect(a.corners).toHaveLength(4);
    expect(new Set(a.corners.map((c) => c.strategy)).size).toBeGreaterThan(1);
    expect(a.corners.map((c) => c.strategy)).toEqual(b.corners.map((c) => c.strategy));
    for (const corner of a.corners) expect(corner.turn).toBeGreaterThan(Math.PI / 6);
  });

  it('records nothing for a path with no corner', () => {
    const { corners } = cutIntoRuns([PATH(circlePath())], { runs: 4, minRun: 0 });

    expect(corners).toEqual([]);
  });
});

describe('hard corners', () => {
  const RADIUS = 0.022;
  const RHO_MIN = minBendRadius(RADIUS, 2);

  /** An L with legs long enough to carry a fillet's setback, sampled at the pipeline's spacing. */
  function elbowPath(turnDeg: number, leg: number): THREE.Vector3[] {
    const turn = (turnDeg * Math.PI) / 180;
    const points: THREE.Vector3[] = [];
    const n = Math.round(leg / 0.02);
    for (let i = n; i > 0; i--) points.push(new THREE.Vector3(-i * 0.02, 0, 0));
    points.push(new THREE.Vector3(0, 0, 0));
    for (let i = 1; i <= n; i++) {
      points.push(new THREE.Vector3(Math.cos(turn) * i * 0.02, Math.sin(turn) * i * 0.02, 0));
    }
    return points;
  }

  const cut = (points: THREE.Vector3[], corners: typeof ALL_CONNECT) =>
    cutIntoRuns([{ points, surface: 'front' as const, closed: false }], {
      runs: 1,
      minRun: 0,
      corners,
      radius: RADIUS,
      bend: 2,
      seed: 0,
    });

  // The invariant the whole model buys: a connected hard corner is filleted, not left kinked.
  it('leaves no connected run bending tighter than rhoMin', () => {
    for (const turnDeg of [30, 60, 90, 120, 150]) {
      const { runs } = cut(elbowPath(turnDeg, 0.6), ALL_CONNECT);
      for (const run of runs) {
        expect(tightestBend(run), `${turnDeg} degrees, run ${run.index}`).toBeGreaterThanOrEqual(
          RHO_MIN * 0.95,
        );
      }
    }
  });

  // Setback is rhoMin * tan(theta/2); at 150 degrees that is 0.164 em, far more than a 0.06 leg.
  it('breaks a corner whose fillet has no room rather than filleting it anyway', () => {
    const { runs } = cut(elbowPath(150, 0.06), ALL_CONNECT);
    expect(runs.length).toBeGreaterThan(1);
  });

  it('still breaks when the draw says break', () => {
    const { runs } = cut(elbowPath(90, 0.6), ALL_BREAK);
    expect(runs.length).toBe(2);
  });

  /** An L whose two legs are sampled independently, so one can be trimmed to nothing. */
  function unevenElbow(turnDeg: number, before: number, after: number): THREE.Vector3[] {
    const turn = (turnDeg * Math.PI) / 180;
    const points: THREE.Vector3[] = [];
    const n = Math.round(before / 0.02);
    const m = Math.round(after / 0.02);
    for (let i = n; i > 0; i--) points.push(new THREE.Vector3(-i * 0.02, 0, 0));
    points.push(new THREE.Vector3(0, 0, 0));
    for (let i = 1; i <= m; i++) {
      points.push(new THREE.Vector3(Math.cos(turn) * i * 0.02, Math.sin(turn) * i * 0.02, 0));
    }
    return points;
  }

  // A leg point left inside the setback makes the path run forward to it and double back, and that
  // reversal reads as a bend far tighter than the corner the fillet replaced.
  it('drops a leg point that falls inside the fillet setback', () => {
    for (const leg of [0.06, 0.08, 0.1, 0.12]) {
      for (const turnDeg of [60, 90, 120]) {
        const { runs } = cut(unevenElbow(turnDeg, leg, 0.6), ALL_CONNECT);
        for (const run of runs) {
          for (let i = 1; i + 1 < run.points.length; i++) {
            expect(
              turnAt(run.points, i),
              `${turnDeg} deg, leg ${leg}, run ${run.index} vertex ${i}`,
            ).toBeLessThan(Math.PI / 2);
          }
        }
      }
    }
  });
});

describe('hard corners on a closed contour', () => {
  it('fillets a closed square, which is the shape every glyph contour actually is', () => {
    const rhoMin = minBendRadius(0.022, 2);
    const { runs } = cutIntoRuns(
      [{ points: squarePath(), surface: 'front' as const, closed: true }],
      { runs: 1, minRun: 0, corners: ALL_CONNECT, radius: 0.022, bend: 2, spacing: 0.02, seed: 0 },
    );
    for (const run of runs) {
      expect(tightestBend(run), `run ${run.index}`).toBeGreaterThanOrEqual(rhoMin * 0.95);
    }
  });
});

describe('the rejoin strategy', () => {
  const OPTS = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };
  const lengthOf = (runs: { length: number }[]) => runs.reduce((a, r) => a + r.length, 0);

  it('defaults to leaving the path where `drop` leaves it', () => {
    const fallback = cutIntoRuns([PATH(squarePath())], { ...OPTS, corners: ALL_CONNECT });
    const named = cutIntoRuns([PATH(squarePath())], {
      ...OPTS,
      corners: ALL_CONNECT,
      rejoin: 'drop',
    });
    expect(named.runs.length).toBe(fallback.runs.length);
    expect(lengthOf(named.runs)).toBeCloseTo(lengthOf(fallback.runs), 12);
  });

  for (const rejoin of REJOINS) {
    it(`draws a closed square under \`${rejoin}\``, () => {
      const { runs, corners } = cutIntoRuns([PATH(squarePath())], {
        ...OPTS,
        corners: ALL_CONNECT,
        rejoin,
      });
      expect(corners.length).toBe(4);
      expect(runs.length).toBeGreaterThan(0);
      // A square's legs are long and straight, so no strategy has an excuse to give one up.
      expect(lengthOf(runs)).toBeGreaterThan(3.5);
    });
  }

  /**
   * `splitReturn` locates the fillet in a span by object identity, so a rejoin that splices a copy
   * of the arc's first point instead of the point itself loses the lookup — and the dark stretch
   * silently grows from one corner to most of the run. Nothing else in the cut notices.
   */
  it('keeps a return dark only over its own corner, whatever the rejoin', () => {
    for (const rejoin of REJOINS) {
      const { runs } = cutIntoRuns([PATH(squarePath())], {
        ...OPTS,
        corners: ALL_BREAK,
        blockout: 1,
        rejoin,
      });
      const dark = lengthOf(runs.filter((r) => r.dark));
      expect(
        runs.some((r) => r.dark),
        rejoin,
      ).toBe(true);
      expect(dark / lengthOf(runs), rejoin).toBeLessThan(0.3);
    }
  });
});

describe('the hairpin corner', () => {
  const OPTS = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };
  const rhoMin = minBendRadius(OPTS.radius, OPTS.bend);
  const apex = new THREE.Vector3(0, 0, 0);
  const reach = (runs: { points: THREE.Vector3[] }[]) => {
    let best = Number.POSITIVE_INFINITY;
    for (const run of runs) for (const p of run.points) best = Math.min(best, p.distanceTo(apex));
    return best;
  };

  it('draws none unless a look asks for one', () => {
    const { corners } = cutIntoRuns([PATH(sharpVPath(), false)], {
      ...OPTS,
      corners: ALL_CONNECT,
    });
    expect(corners.some((c) => c.strategy === 'hairpin')).toBe(false);
  });

  for (const hairpin of HAIRPIN_SHAPES) {
    it(`turns the tube around the apex under \`${hairpin}\``, () => {
      const plain = cutIntoRuns([PATH(sharpVPath(), false)], { ...OPTS, corners: ALL_CONNECT });
      const pinned = cutIntoRuns([PATH(sharpVPath(), false)], {
        ...OPTS,
        corners: { break: 0, connect: 0, hairpin: 1 },
        hairpin,
      });
      expect(
        pinned.corners.some((c) => c.strategy === 'hairpin'),
        hairpin,
      ).toBe(true);
      // A fillet at rho_min cannot reach into a 40 degree V, so it stops well short of the point.
      // The whole reason for a hairpin is that it does not.
      expect(reach(plain.runs)).toBeGreaterThan(rhoMin);
      expect(reach(pinned.runs), hairpin).toBeLessThan(reach(plain.runs));
    });
  }

  it('holds the bend floor it exists to respect', () => {
    for (const hairpin of HAIRPIN_SHAPES) {
      const { runs } = cutIntoRuns([PATH(sharpVPath(), false)], {
        ...OPTS,
        corners: { break: 0, connect: 0, hairpin: 1 },
        hairpin,
      });
      for (const run of runs) {
        expect(tightestBend(run), `${hairpin} run ${run.index}`).toBeGreaterThanOrEqual(
          rhoMin * 0.95,
        );
      }
    }
  });
});
