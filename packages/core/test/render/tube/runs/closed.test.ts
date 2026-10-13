import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assign } from '../../../../src/render/tube/assign.js';
import { minBendRadius } from '../../../../src/render/tube/bend.js';
import { ALL_BREAK, ALL_CONNECT, cutIntoRuns } from '../../../../src/render/tube/runs.js';
import { tightestBend } from '../../../../src/render/tube/sweep.js';
import { circlePath, PATH, squarePath, turnAt } from './paths.js';

describe('the blockout return', () => {
  const OPTS = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };

  it('carries the tube through a corner it would otherwise cut', () => {
    const cut = cutIntoRuns([PATH(squarePath())], { ...OPTS, corners: ALL_BREAK, blockout: 0 });
    const returned = cutIntoRuns([PATH(squarePath())], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
    });

    expect(cut.corners.every((c) => c.strategy === 'break')).toBe(true);
    expect(returned.corners.every((c) => c.strategy === 'return')).toBe(true);
    // Cutting leaves four ends that no other run touches; returning leaves none — every boundary
    // is shared with the neighbouring run.
    const ends = (runs: { points: THREE.Vector3[] }[]) =>
      runs.flatMap((r) => [
        r.points[0] as THREE.Vector3,
        r.points[r.points.length - 1] as THREE.Vector3,
      ]);
    const orphans = (runs: { points: THREE.Vector3[] }[]) =>
      ends(runs).filter((e) => ends(runs).filter((o) => o.distanceTo(e) < 1e-9).length < 2).length;
    expect(orphans(cut.runs)).toBeGreaterThan(0);
    expect(orphans(returned.runs)).toBe(0);
  });

  it('never lights the stretch it carries dark, whatever select picks', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
    });
    expect(runs.some((r) => r.dark)).toBe(true);
    assign(runs, { by: 'seed', amount: 1 }, [0xffffff], 0);
    expect(runs.filter((r) => r.dark).every((r) => !r.lit)).toBe(true);
    expect(runs.filter((r) => !r.dark).every((r) => r.lit)).toBe(true);
  });

  it('keeps a dark stretch that falls under the run floor', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      minRun: 0.5,
    });
    // Dropping it would leave exactly the gap the return exists to avoid.
    expect(runs.some((r) => r.dark)).toBe(true);
  });
});

/**
 * A rectangle sampled at the pipeline's spacing with every corner cut off, so a corner is a stretch
 * of two vertices rather than one — which is what resampling a real outline always produces.
 */
function chamferedRect(w: number, h: number, cut: number): THREE.Vector3[] {
  const box = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const sampled: THREE.Vector3[] = [];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = box[c] as number[];
    const [bx, by] = box[(c + 1) % 4] as number[];
    const n = Math.round(
      Math.hypot((bx as number) - (ax as number), (by as number) - (ay as number)) / 0.02,
    );
    for (let i = 0; i < n; i++) {
      const t = i / n;
      sampled.push(
        new THREE.Vector3(
          (ax as number) + ((bx as number) - (ax as number)) * t,
          (ay as number) + ((by as number) - (ay as number)) * t,
          0,
        ),
      );
    }
  }
  const n = sampled.length;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const cur = sampled[i] as THREE.Vector3;
    const a = cur
      .clone()
      .sub(sampled[(i - 1 + n) % n] as THREE.Vector3)
      .normalize();
    const b = (sampled[(i + 1) % n] as THREE.Vector3).clone().sub(cur).normalize();
    if (a.angleTo(b) < 0.5) out.push(cur);
    else out.push(cur.clone().addScaledVector(a, -cut), cur.clone().addScaledVector(b, cut));
  }
  return out;
}

describe('a closed contour with no break anywhere', () => {
  it('fillets the corner its own seam falls on', () => {
    const { runs } = cutIntoRuns([PATH(squarePath())], {
      runs: 1,
      minRun: 0,
      corners: ALL_CONNECT,
      radius: 0.03,
      bend: 2,
      spacing: 0.02,
      seed: 0,
    });
    const rhoMin = minBendRadius(0.03, 2);
    expect(runs).toHaveLength(1);
    const points = (runs[0] as { points: THREE.Vector3[] }).points;

    // The walk has to start somewhere, and starting it on a corner starts and ends it on the same
    // one — which no merge then covers, leaving the raw vertex at the seam. `tightestBend` cannot
    // see it, because it measures a run's interior and the seam is its two ends.
    const n = points.length;
    const last = points[n - 1] as THREE.Vector3;
    const closed = last.distanceTo(points[0] as THREE.Vector3) < 1e-9;
    const a = points[n - 2] as THREE.Vector3;
    const b = (closed ? points[0] : last) as THREE.Vector3;
    const c = points[closed ? 1 : 0] as THREE.Vector3;
    const turn = b.clone().sub(a).normalize().angleTo(c.clone().sub(b).normalize());
    const step = (b.distanceTo(a) + c.distanceTo(b)) / 2;
    const rho = turn < 1e-9 ? Number.POSITIVE_INFINITY : step / (2 * Math.sin(turn / 2));
    expect(rho).toBeGreaterThanOrEqual(rhoMin * 0.95);
  });
  // The walk starts mid-leg and has to come back to where it started. The last corner's fillet can
  // reach past that point, and closing onto it anyway runs the path back along the arc it just left.
  it('closes onto a point the last fillet has not already passed', () => {
    const { runs } = cutIntoRuns(
      [{ points: chamferedRect(0.14, 0.6, 0.023), surface: 'front' as const, closed: true }],
      { runs: 1, minRun: 0, corners: ALL_CONNECT, radius: 0.022, bend: 2, spacing: 0.02, seed: 0 },
    );
    expect(runs).toHaveLength(1);
    for (const run of runs) {
      for (let i = 1; i + 1 < run.points.length; i++) {
        expect(turnAt(run.points, i), `run ${run.index} vertex ${i}`).toBeLessThan(Math.PI / 2);
      }
    }
  });
  // The junction between an arc and the leg it resumes on is one chord carrying whatever the fit
  // missed, and the arc's half-spacing sampling makes its own endpoint the worst place to put it:
  // the same angle reads as half the bend radius there that it would a vertex back along the leg.
  it("holds every vertex at rhoMin across both of a fillet's junctions", () => {
    const rhoMin = minBendRadius(0.022, 2);
    for (const w of [0.08, 0.14, 0.2, 0.3]) {
      const { runs } = cutIntoRuns(
        [{ points: chamferedRect(w, 0.6, 0.023), surface: 'front' as const, closed: true }],
        {
          runs: 1,
          minRun: 0,
          corners: ALL_CONNECT,
          radius: 0.022,
          bend: 2,
          spacing: 0.02,
          seed: 0,
        },
      );
      for (const run of runs) {
        expect(tightestBend(run), `w ${w}, run ${run.index}`).toBeGreaterThanOrEqual(
          rhoMin * (1 - 1e-6),
        );
      }
    }
  });
});

describe('vertex provenance', () => {
  it('resolves a run point to the identical vertex of the path it came from', () => {
    const points = squarePath();
    const paths = [{ points, surface: 'front' as const, closed: true }];
    const { runs } = cutIntoRuns(paths, {
      runs: 4,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
    });

    let checked = 0;
    for (const run of runs) {
      expect(run.from).toHaveLength(run.points.length);
      run.from.forEach((source, i) => {
        if (source === null) return;
        expect(source.path).toBe(0);
        // Identical object, not merely equal coordinates: that is what makes the
        // resolution meaningful and what a stray clone would break.
        expect(run.points[i]).toBe(points[source.index]);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('leaves a circle with no null sources — nothing is built where nothing corners', () => {
    const points = circlePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 2,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
      corners: ALL_CONNECT,
    });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.from.every((f) => f !== null)).toBe(true);
  });

  it("marks a fillet's own points as having no source", () => {
    const points = squarePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 1,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
      corners: ALL_CONNECT,
    });
    const nulls = runs.reduce((n, r) => n + r.from.filter((f) => f === null).length, 0);
    // Four corners, each filleted into an arc of at least five samples.
    expect(nulls).toBeGreaterThanOrEqual(20);
  });

  it('gives a sourceless vertex geometry no contour vertex already holds', () => {
    const points = squarePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 6,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
      corners: ALL_CONNECT,
    });

    let checked = 0;
    for (const run of runs) {
      run.from.forEach((source, i) => {
        if (source !== null) return;
        const p = run.points[i] as THREE.Vector3;
        // A clone is bit-identical to the vertex it copied; an arc the corner stage drew is not.
        expect(Math.min(...points.map((q) => p.distanceToSquared(q)))).toBeGreaterThan(0);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps a relaxed vertex sourced — relaxing moves a leg point, it does not build one', () => {
    const points = squarePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 6,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
      corners: ALL_CONNECT,
      rejoin: 'relax',
    });

    for (const run of runs) {
      run.from.forEach((source, i) => {
        if (source !== null) return;
        const p = run.points[i] as THREE.Vector3;
        expect(Math.min(...points.map((q) => p.distanceToSquared(q)))).toBeGreaterThan(0);
      });
    }
  });
});
