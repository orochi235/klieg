import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GRADIENT_T_ATTRIBUTE } from '../../../src/render/tube/gradient.js';
import type { Run } from '../../../src/render/tube/runs.js';
import { smoothedPoints, sweepRun, tightestBend } from '../../../src/render/tube/sweep.js';

/** No contour source: an analytic arc is what the corner stage builds, and smoothing must not move it. */
function arcRun(radius: number, sweep: number): Run {
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = (i / 39) * sweep;
    return new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0);
  });
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return {
    points,
    from: points.map(() => null),
    surface: 'front',
    length,
    index: 0,
    lit: true,
    color: 0xffffff,
  };
}

/** An arc of the given radius swept in the x/z plane instead of x/y: straight when flattened to x/y. */
function depthArcRun(radius: number, sweep: number): Run {
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = (i / 39) * sweep;
    return new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius);
  });
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return {
    points,
    from: points.map(() => null),
    surface: 'front',
    length,
    index: 0,
    lit: true,
    color: 0xffffff,
  };
}

/**
 * A straight run along x with points bunched near the start rather than evenly spaced — so the
 * physical midpoint doesn't fall on the wall's own middle index, the way it would for an
 * evenly-spaced run (whose index-middle happens to be its arc-length middle too).
 */
function unevenRun(length: number, n: number): Run {
  const points = Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    return new THREE.Vector3(u * u * length, 0, 0);
  });
  return {
    points,
    from: points.map((_, i) => ({ path: 0, index: i })),
    surface: 'front',
    length,
    index: 0,
    lit: true,
    color: 0xffffff,
  };
}

describe('tightestBend', () => {
  it("reports an arc's own radius, not a radius to draw at", () => {
    expect(tightestBend(arcRun(1, Math.PI / 2))).toBeCloseTo(1, 2);
    expect(tightestBend(arcRun(0.02, Math.PI / 2))).toBeCloseTo(0.02, 3);
  });

  it('measures curvature that lives entirely in depth', () => {
    // Flattened to x/y this run is collinear (y is always 0) and would read as straight; the
    // curve only bends in z. A 2D-only curvature measurement misses this entirely.
    expect(tightestBend(depthArcRun(0.02, Math.PI / 2))).toBeCloseTo(0.02, 3);
  });

  /**
   * The invariant the whole geometry model buys. A 0.02 arc cannot carry a 0.05 tube, and the old
   * behaviour was to thin the tube until it could; now the corner stage is responsible for making
   * the path bendable and the sweep holds its diameter regardless.
   */
  it('sweeps at the requested radius even where the path bends tighter', () => {
    const run = arcRun(0.02, Math.PI / 2);
    const geo = sweepRun(run, 0.05, 8);
    expect(geo).not.toBeNull();
    const pos = (geo as THREE.BufferGeometry).getAttribute('position');
    const centre = (run.points[0] as THREE.Vector3).clone();
    // Ring 0's vertices all sit exactly `requested` from the first path point. Smoothing is
    // 'open', so it pins the endpoints and the first ring's centre is the original vertex.
    const first = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
    expect(first.distanceTo(centre)).toBeCloseTo(0.05, 6);
    geo?.dispose();
  });
});

describe('smoothedPoints', () => {
  it('holds a sourceless vertex exactly where the run put it', () => {
    const run = {
      points: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.02, 0.01, 0),
        new THREE.Vector3(0.04, 0, 0),
        new THREE.Vector3(0.06, 0.01, 0),
        new THREE.Vector3(0.08, 0, 0),
      ],
      from: [
        { path: 0, index: 0 },
        null,
        { path: 0, index: 2 },
        { path: 0, index: 3 },
        { path: 0, index: 4 },
      ],
      surface: 'front' as const,
      length: 0.08,
      index: 0,
      lit: true,
      color: 0xffffff,
    };

    const out = smoothedPoints(run);
    // The sourceless vertex is untouched; a sourced neighbour is pulled toward its own neighbours.
    expect(out[1]?.x).toBeCloseTo(0.02, 12);
    expect(out[1]?.y).toBeCloseTo(0.01, 12);
    expect(out[3]?.y).toBeLessThan(0.01);
  });
});

describe('sweepRun', () => {
  it('builds geometry with position and normal attributes', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.05, 8);
    expect(geo?.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo?.getAttribute('normal').count).toBeGreaterThan(0);
    geo?.dispose();
  });

  it('returns null for a run too short to sweep', () => {
    const run = arcRun(1, Math.PI / 2);
    run.points = run.points.slice(0, 1);
    run.from = run.from.slice(0, 1);
    expect(sweepRun(run, 0.05, 8)).toBeNull();
  });

  it('bakes uv.x as normalized arc length along the run, 0 at the start and 1 at the end', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.05, 6);
    const uv = geo?.getAttribute('uv') as THREE.BufferAttribute;
    const ringCount = (geo?.getAttribute('position').count ?? 0) / 7; // segments 6 -> 7 verts/ring
    let prev = -1;
    for (let ring = 0; ring < ringCount; ring++) {
      const t = uv.getX(ring * 7);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(uv.getX(0)).toBeCloseTo(0, 10);
    expect(uv.getX((ringCount - 1) * 7)).toBeCloseTo(1, 10);
    geo?.dispose();
  });

  it('produces finite, non-degenerate geometry for a run that bends through 3D', () => {
    // An S-shaped run: bends one way then the other, and wanders in z, the exact shape that
    // tore under Frenet frames.
    const points = Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      return new THREE.Vector3(
        t * 2 - 1,
        Math.sin(t * Math.PI * 2) * 0.5,
        Math.sin(t * Math.PI) * 0.1,
      );
    });
    const run: Run = {
      points,
      from: points.map((_, i) => ({ path: 0, index: i })),
      surface: 'front',
      length: 4,
      index: 0,
      lit: true,
      color: 0xffffff,
    };
    const geo = sweepRun(run, 0.02, 10);
    const position = geo?.getAttribute('position');
    expect(position).toBeDefined();
    const array = (position as THREE.BufferAttribute).array;
    for (let i = 0; i < array.length; i++) {
      expect(Number.isFinite(array[i])).toBe(true);
    }
    geo?.dispose();
  });
});

describe('sweepRun gradientT attribute', () => {
  it('is absent when no gradient is asked for', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8);
    expect(geo?.getAttribute(GRADIENT_T_ATTRIBUTE)).toBeUndefined();
  });

  it('runs 0..1 along the run under the run domain', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'run' },
      place: { start: 0, span: 1 },
    });
    const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
    expect(attr).toBeDefined();
    expect(attr?.itemSize).toBe(1);
    expect(attr?.getX(0)).toBeCloseTo(0, 6);
    expect(attr?.getX((attr?.count ?? 1) - 1)).toBeCloseTo(1, 6);
  });

  it('confines the sweep to the run’s own slice under the letter domain', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'letter' },
      place: { start: 0.4, span: 0.2 },
    });
    const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
    expect(attr?.getX(0)).toBeCloseTo(0.4, 6);
    expect(attr?.getX((attr?.count ?? 1) - 1)).toBeCloseTo(0.6, 6);
  });

  it('is absent for a positional domain, which the shader resolves', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'axis' },
      place: { start: 0, span: 1 },
    });
    expect(geo?.getAttribute(GRADIENT_T_ATTRIBUTE)).toBeUndefined();
  });

  it('writes exactly one value per vertex, matching the position attribute', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'run' },
      place: { start: 0, span: 1 },
    });
    const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
    const position = geo?.getAttribute('position');
    expect(attr?.count).toBe(position?.count);
    geo?.dispose();
  });

  it('is proportional to arc length, not ring index, along an unevenly-spaced run', () => {
    // A short, unevenly-spaced run: ring-index parameterization would put its physical midpoint
    // ring at t=0.656 (25-point) or t=0.588 (10-point) instead of 0.5, because the domed caps
    // consume a fixed share of ring count regardless of how little length they physically cover.
    for (const [n, length] of [
      [25, 0.479],
      [10, 0.1],
    ] as const) {
      const radius = 0.03;
      const run = unevenRun(length, n);
      const geo = sweepRun(run, radius, 8, { domain: { of: 'run' }, place: { start: 0, span: 1 } });
      const position = geo?.getAttribute('position');
      const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
      const vertsPerRing = 9; // segments 8 -> 9 verts/ring
      const ringCount = (position?.count ?? 0) / vertsPerRing;
      // The run lies along x, and the cross-section offset is purely in the normal/binormal
      // plane (perpendicular to x), so a ring's x-coordinate equals its centre's x exactly.
      const xMin = position?.getX(0) ?? 0;
      const xMax = position?.getX((ringCount - 1) * vertsPerRing) ?? 0;
      const xMid = (xMin + xMax) / 2;
      let bestRing = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let ring = 0; ring < ringCount; ring++) {
        const d = Math.abs((position?.getX(ring * vertsPerRing) ?? 0) - xMid);
        if (d < bestDist) {
          bestDist = d;
          bestRing = ring;
        }
      }
      expect(attr?.getX(bestRing * vertsPerRing)).toBeCloseTo(0.5, 1);
      geo?.dispose();
    }
  });

  it('is finite everywhere for a fully degenerate (coincident-point) run', () => {
    // Every ring centre collapses toward the same point, so cumulative arc length approaches
    // zero from below the caps' own contribution. This is the closest reachable case to the
    // zero-length-total guard: `sweepRun` never allows radius <= 0, and `rotationMinimizingFrames`
    // never yields an exactly-zero tangent, so the guard's literal branch isn't reachable through
    // this public API — this instead confirms nothing goes non-finite as the input degenerates.
    const points = Array.from({ length: 5 }, () => new THREE.Vector3(0, 0, 0));
    const run: Run = {
      points,
      from: points.map(() => null),
      surface: 'front',
      length: 0,
      index: 0,
      lit: true,
      color: 0xffffff,
    };
    const geo = sweepRun(run, 0.02, 6, { domain: { of: 'run' }, place: { start: 0, span: 1 } });
    const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
    expect(attr).toBeDefined();
    for (let i = 0; i < (attr?.count ?? 0); i++) {
      expect(Number.isFinite(attr?.getX(i))).toBe(true);
    }
    expect(attr?.getX(0)).toBeCloseTo(0, 6);
    expect(attr?.getX((attr?.count ?? 1) - 1)).toBeCloseTo(1, 6);
    geo?.dispose();
  });
});
