import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { reportOf } from '../../../dev/tube-lab/src/report.js';
import type { Run } from '../../../src/render/tube/index.js';

/** An arc of `radius` swept through a quarter turn, at the arc-length spacing the pipeline uses. */
function arcRun(radius: number, index: number): Run {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * (Math.PI / 2);
    points.push(new THREE.Vector3(radius * Math.cos(t), radius * Math.sin(t), 0));
  }
  return {
    points,
    from: points.map(() => null),
    surface: 'front',
    length: (radius * Math.PI) / 2,
    index,
    lit: true,
    color: 0,
  };
}

function blueprint(runs: Run[]) {
  return { kind: 'tube' as const, runs, corners: [], paths: [], lit: [], dark: [], dispose() {} };
}

describe('reportOf', () => {
  it("reports a run's own bend radius against the minimum its material allows", () => {
    const report = reportOf(blueprint([arcRun(0.2, 0)]), 0.05, 2);

    const run = report.runs[0];
    expect(run?.tightest).toBeCloseTo(0.2, 2);
    expect(run?.minimum).toBeCloseTo(0.1, 6);
    expect(run?.unresolved).toBe(false);
  });

  /**
   * The discriminating case, and the reason the field was renamed. This arc bends at 0.07: wider
   * than the 0.05 tube radius, yet tighter than the 0.1 that radius is permitted to bend to. The
   * predicate must compare against `minimum`, not against the requested radius — comparing the
   * wrong pair returns `false` here, which is plausible and wrong, on the very panel used to decide
   * whether the corner stage worked.
   */
  it('flags a run the corner stage failed to make bendable', () => {
    const report = reportOf(blueprint([arcRun(0.07, 0)]), 0.05, 2);

    expect(report.runs[0]?.tightest).toBeCloseTo(0.07, 2);
    expect(report.runs[0]?.unresolved).toBe(true);
    expect(report.unresolved).toBe(1);
  });

  it('counts a run that vanished rather than leaving it silently absent', () => {
    const dot: Run = {
      points: [new THREE.Vector3()],
      from: [{ path: 0, index: 0 }],
      surface: 'front',
      length: 0,
      index: 0,
      lit: true,
      color: 0,
    };
    const report = reportOf(blueprint([dot]), 0.05, 2);

    expect(report.runs[0]?.dropped).toBe(true);
    expect(report.dropped).toBe(1);
    expect(report.unresolved).toBe(0);
  });

  it('drops every run at a zero radius without calling any of them unresolved', () => {
    const report = reportOf(blueprint([arcRun(0.2, 0), arcRun(0.02, 1)]), 0, 2);

    expect(report.dropped).toBe(2);
    expect(report.unresolved).toBe(0);
  });

  it('summarises as the panel reads it', () => {
    const report = reportOf(blueprint([arcRun(0.2, 0), arcRun(0.02, 1)]), 0.05, 2);

    expect(report.summary).toBe('2 runs · 1 unresolved · 0 dropped');
  });
});
