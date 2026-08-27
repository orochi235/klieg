import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeBlueprint, type TubeSpec } from '../../../src/render/tube/index.js';
import { TUBE_STAGES, type TubeStageId } from '../../../src/render/tube/stages.js';
import { tightestBend } from '../../../src/render/tube/sweep.js';

/**
 * A deliberate copy of `index.test.ts`'s SPEC, not a shared fixture: tuning the radius there
 * would otherwise silently re-baseline every integer pinned in this file.
 */
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

const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe('buildTubeBlueprint, pinned against the stage refactor', () => {
  it('holds every stage output for a plain square', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect.soft(bp.paths).toHaveLength(1);
    expect.soft(bp.corners).toHaveLength(4);
    expect.soft(bp.runs.map((r) => r.points.length)).toEqual([48, 48, 25, 24, 25, 24]);
    expect.soft(bp.lit).toHaveLength(6);
    expect.soft(bp.dark).toHaveLength(0);
    expect
      .soft(bp.lit.map((g) => g.getAttribute('position').count))
      .toEqual([392, 392, 231, 224, 231, 224]);
    bp.dispose();
  });

  it('holds every stage output for all surface kinds and connectors', () => {
    const bp = buildTubeBlueprint([square()], RICH, 0.3, 7);
    expect.soft(bp.paths).toHaveLength(5);
    expect
      .soft(bp.paths.map((p) => p.surface))
      .toEqual(['front', 'back', 'wall', 'connector', 'connector']);
    expect.soft(bp.corners).toHaveLength(12);
    expect
      .soft(bp.runs.map((r) => r.points.length))
      .toEqual([48, 48, 48, 48, 48, 48, 48, 48, 49, 49, 49, 49, 3, 3]);
    expect
      .soft(bp.runs.map((r) => r.from.find((s) => s)?.path))
      .toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 4]);
    expect
      .soft(bp.runs.map((r) => r.surface))
      .toEqual([
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
    // The four walls and the two connectors are straight, and a straight run has no curvature.
    expect
      .soft(bp.runs.map((r) => round(tightestBend(r))))
      .toEqual([
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
    expect
      .soft(bp.runs.map((r) => r.lit))
      .toEqual([
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
    expect.soft(bp.lit).toHaveLength(7);
    expect.soft(bp.dark).toHaveLength(7);
    bp.dispose();
  });

  it('holds every fillet at the minimum bend radius', () => {
    const bp = buildTubeBlueprint([square()], CONNECT, 0.3, 2);
    expect
      .soft(bp.corners.map((c) => c.strategy))
      .toEqual(['connect', 'connect', 'connect', 'connect']);
    expect.soft(bp.runs.map((r) => r.points.length)).toEqual([72, 80, 71]);
    expect.soft(bp.runs.map((r) => round(tightestBend(r)))).toEqual([0.1, 0.1, 0.1]);
    // Fillet points have no contour vertex behind them, so `from` is null across each arc.
    expect.soft(bp.runs.map((r) => r.from.filter((s) => s === null).length)).toEqual([17, 34, 17]);
    expect.soft(bp.lit.map((g) => g.getAttribute('position').count)).toEqual([560, 616, 553]);
    bp.dispose();
  });
});

describe('TUBE_STAGES', () => {
  it('names the pipeline in the order it runs', () => {
    expect(TUBE_STAGES.map((s) => s.id)).toEqual(['generate', 'wander', 'cut', 'assign', 'sweep']);
  });

  it('gives every stage a label to put in a lab', () => {
    for (const stage of TUBE_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });
});

describe('onStage', () => {
  it('reports each stage in order, once', () => {
    const seen: string[] = [];
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, {
      onStage: (id) => seen.push(id),
    });
    expect(seen).toEqual(['generate', 'wander', 'cut', 'assign', 'sweep']);
    bp.dispose();
  });

  it('reports state that has grown by the time each stage is named', () => {
    const at = new Map<string, { paths: number; runs: number; geo: number }>();
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, {
      onStage: (id, state) =>
        at.set(id, {
          paths: state.paths.length,
          runs: state.runs.length,
          geo: state.lit.length + state.dark.length,
        }),
    });
    expect.soft(at.get('generate')).toEqual({ paths: 1, runs: 0, geo: 0 });
    expect.soft(at.get('wander')).toEqual({ paths: 1, runs: 0, geo: 0 });
    expect.soft(at.get('cut')).toEqual({ paths: 1, runs: 6, geo: 0 });
    expect.soft(at.get('assign')).toEqual({ paths: 1, runs: 6, geo: 0 });
    expect.soft(at.get('sweep')).toEqual({ paths: 1, runs: 6, geo: 6 });
    bp.dispose();
  });

  it('marks a switched-off stage as not having run', () => {
    const ran = new Map<string, boolean>();
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, {
      stages: new Set<TubeStageId>(['generate', 'wander', 'assign', 'sweep']),
      onStage: (id, _state, didRun) => ran.set(id, didRun),
    });
    // Every stage is reported, so a lab can draw a bypassed step rather than a blank panel.
    expect.soft([...ran.keys()]).toEqual(['generate', 'wander', 'cut', 'assign', 'sweep']);
    expect.soft(ran.get('cut')).toBe(false);
    expect.soft([...ran.values()].filter(Boolean)).toHaveLength(4);
    bp.dispose();
  });

  it('builds the same blueprint whether or not anyone is watching', () => {
    const watched = buildTubeBlueprint([square()], SPEC, 0.3, 0, { onStage: () => {} });
    const plain = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(watched.runs.map((r) => [r.points.length, r.lit, r.color])).toEqual(
      plain.runs.map((r) => [r.points.length, r.lit, r.color]),
    );
    watched.dispose();
    plain.dispose();
  });
});

const ALL = new Set<TubeStageId>(['generate', 'wander', 'cut', 'assign', 'sweep']);
const without = (...off: TubeStageId[]) => {
  const on = new Set(ALL);
  for (const id of off) on.delete(id);
  return on;
};

describe('the stages gate', () => {
  it('builds what no options builds when every stage is named', () => {
    const gated = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: ALL });
    const plain = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(gated.runs.map((r) => r.points.length)).toEqual(plain.runs.map((r) => r.points.length));
    gated.dispose();
    plain.dispose();
  });

  it('leaves the paths flat with wander off, exactly as amplitude zero does', () => {
    const off = buildTubeBlueprint([square()], RICH, 0.3, 7, { stages: without('wander') });
    const flat = buildTubeBlueprint([square()], { ...RICH, amplitude: 0 }, 0.3, 7);
    expect(off.runs.map((r) => r.points.map((p) => p.z))).toEqual(
      flat.runs.map((r) => r.points.map((p) => p.z)),
    );
    off.dispose();
    flat.dispose();
  });

  it('passes each whole path through as one run with cut off', () => {
    const bp = buildTubeBlueprint([square()], RICH, 0.3, 7, { stages: without('cut') });
    expect.soft(bp.runs).toHaveLength(bp.paths.length);
    expect.soft(bp.runs.map((r) => r.points.length)).toEqual(bp.paths.map((p) => p.points.length));
    expect.soft(bp.runs.map((r) => r.surface)).toEqual(bp.paths.map((p) => p.surface));
    // Nothing was built, so every vertex still resolves to a contour vertex.
    expect.soft(bp.runs.every((r) => r.from.every((s) => s !== null))).toBe(true);
    expect.soft(bp.corners).toHaveLength(0);
    bp.dispose();
  });

  it('still draws an uncut contour', () => {
    // Sweeping a raw contour through unsoftened corners self-intersects; it must not throw.
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: without('cut') });
    expect(bp.lit.length + bp.dark.length).toBeGreaterThan(0);
    bp.dispose();
  });

  it("leaves the cut's own light and colour with assign off", () => {
    const bp = buildTubeBlueprint([square()], RICH, 0.3, 7, { stages: without('assign') });
    expect.soft(bp.runs.every((r) => r.color === 0)).toBe(true);
    expect.soft(bp.runs.every((r) => r.lit)).toBe(true);
    bp.dispose();
  });

  it('keeps the runs but drops the geometry with sweep off', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: without('sweep') });
    expect.soft(bp.runs).toHaveLength(6);
    expect.soft(bp.lit).toHaveLength(0);
    expect.soft(bp.dark).toHaveLength(0);
    bp.dispose();
  });

  it('empties out rather than throwing with generate off', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: without('generate') });
    expect.soft(bp.paths).toHaveLength(0);
    expect.soft(bp.runs).toHaveLength(0);
    expect.soft(bp.lit).toHaveLength(0);
    expect(() => bp.dispose()).not.toThrow();
  });
});

describe('the registry is internal', () => {
  it('is not reachable from the published entry', async () => {
    const published = await import('../../../src/index.js');
    expect.soft(Object.keys(published)).not.toContain('TUBE_STAGES');
    expect.soft(Object.keys(published)).not.toContain('buildTubeBlueprint');
  });
});
