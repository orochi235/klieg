import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeBlueprint, type TubeSpec } from '../../../src/render/tube/index.js';
import { tightestBend } from '../../../src/render/tube/sweep.js';

const SPEC: TubeSpec = {
  kind: 'tube',
  radius: 0.03,
  segments: 6,
  spacing: 0.02,
  surfaces: ['front'],
  level: 0,
  runs: 6,
  minRun: 0.05,
  select: { by: 'seed', amount: 1 },
  colors: [0xff2d95],
  look: {},
  dark: {},
};

/** Front/back/wall, wandered, with connectors — every surface kind in one build. */
const RICH: TubeSpec = {
  ...SPEC,
  surfaces: ['front', 'back', 'wall'],
  amplitude: 0.04,
  connectors: 2,
  runs: 8,
  select: { by: 'seed', amount: 0.5 },
};

/** Every corner filleted rather than cut, so the corner stage builds analytic points. */
const CONNECT: TubeSpec = {
  ...SPEC,
  corners: { break: 0, connect: 1 },
  radius: 0.05,
  runs: 3,
};

function square(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

// `tightestBend` returns Infinity for a run with no curvature, and Math.round(Infinity) is
// Infinity — the guard is here so the rounding does not have to be read twice.
const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);

describe('buildTubeBlueprint holds its shape', () => {
  it('cuts a plain square into six runs', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(bp.runs.map((r) => r.points.length)).toEqual([48, 48, 25, 24, 25, 24]);
    expect(bp.lit.map((g) => g.getAttribute('position').count)).toEqual([
      392, 392, 231, 224, 231, 224,
    ]);
    expect(bp.paths).toHaveLength(1);
    expect(bp.corners).toHaveLength(4);
    expect(bp.lit).toHaveLength(6);
    expect(bp.dark).toHaveLength(0);
    bp.dispose();
  });

  it('carries every surface kind through at its own bend', () => {
    const bp = buildTubeBlueprint([square()], RICH, 0.3, 7);
    expect(bp.runs.map((r) => r.surface)).toEqual([
      'front',
      'front',
      'front',
      'front',
      'back',
      'back',
      'back',
      'back',
      'wall',
      'wall',
      'wall',
      'wall',
      'connector',
      'connector',
    ]);
    expect(bp.runs.map((r) => r.points.length)).toEqual([
      48, 48, 48, 48, 48, 48, 48, 48, 49, 49, 49, 49, 3, 3,
    ]);
    // The four walls and the two connectors are straight, and a straight run has no curvature.
    expect(bp.runs.map((r) => round(tightestBend(r)))).toEqual([
      2.504733,
      2.505336,
      2.505336,
      2.504733,
      3.22866,
      3.229424,
      3.229424,
      3.22866,
      Infinity,
      Infinity,
      Infinity,
      Infinity,
      Infinity,
      Infinity,
    ]);
    expect(bp.runs.map((r) => r.lit)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(bp.paths).toHaveLength(5);
    expect(bp.corners).toHaveLength(12);
    expect(bp.lit).toHaveLength(7);
    expect(bp.dark).toHaveLength(7);
    bp.dispose();
  });

  it('holds the bend floor exactly where every corner is filleted', () => {
    const bp = buildTubeBlueprint([square()], CONNECT, 0.3, 2);
    expect(bp.corners.map((c) => c.strategy)).toEqual(['connect', 'connect', 'connect', 'connect']);
    expect(bp.runs.map((r) => r.points.length)).toEqual([72, 80, 71]);
    expect(bp.runs.map((r) => round(tightestBend(r)))).toEqual([0.1, 0.1, 0.1]);
    // Fillet points have no contour vertex behind them, so `from` is null across each arc.
    expect(bp.runs.map((r) => r.from.filter((s) => s === null).length)).toEqual([17, 34, 17]);
    expect(bp.lit.map((g) => g.getAttribute('position').count)).toEqual([560, 616, 553]);
    bp.dispose();
  });
});
