import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CORNER_REPAIRS,
  CUT_REPAIR_IDS,
  popStretch,
  SPAN_REPAIRS,
  trimStretch,
} from '../../../src/render/tube/repairs.js';
import { ALL_CONNECT, cutIntoRuns } from '../../../src/render/tube/runs.js';

describe('the repair registries', () => {
  it('names every repair the design does, and nothing else', () => {
    expect([...CUT_REPAIR_IDS]).toEqual([
      'stretch',
      'setback',
      'resume',
      'fillet',
      'close',
      'return',
      'hairpin',
    ]);
  });

  it('splits the two registries by where they run, with stretch in both', () => {
    expect(CORNER_REPAIRS.map((r) => r.id)).toEqual(['stretch', 'setback', 'resume']);
    expect(SPAN_REPAIRS.map((r) => r.id)).toEqual(['stretch', 'close', 'return']);
  });

  it('gives every repair a label, since the lab shows it to a person', () => {
    for (const r of [...CORNER_REPAIRS, ...SPAN_REPAIRS]) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

describe('the two stretches', () => {
  const line = () => Array.from({ length: 5 }, (_, i) => new THREE.Vector3(i / 10, 0, 0));

  it('lets the corner-side stretch empty a span', () => {
    const span = line();
    popStretch(span, 99);
    expect(span).toHaveLength(0);
  });

  it('pops exactly count vertices off the tail', () => {
    const span = line();
    popStretch(span, 2);
    expect(span.map((p) => p.x)).toEqual([0, 0.1, 0.2]);
  });

  it('floors the break-side stretch at two vertices', () => {
    expect(trimStretch(line(), 99, 'tail')).toHaveLength(2);
    expect(trimStretch(line(), 99, 'head')).toHaveLength(2);
  });

  it('trims exactly count vertices off the tail, keeping the head', () => {
    expect(trimStretch(line(), 2, 'tail').map((p) => p.x)).toEqual([0, 0.1, 0.2]);
  });

  it('trims exactly count vertices off the head, keeping the tail', () => {
    expect(trimStretch(line(), 2, 'head').map((p) => p.x)).toEqual([0.2, 0.3, 0.4]);
  });
});

describe('the inner pass', () => {
  /** Sampled at the pipeline's 0.02 spacing — load-bearing: at 0.1 no corner is detected at all. */
  const square = () => {
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    const pts: THREE.Vector3[] = [];
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = corners[c] as number[];
      const [bx, by] = corners[(c + 1) % 4] as number[];
      for (let i = 0; i < 50; i++) {
        const t = i / 50;
        pts.push(
          new THREE.Vector3(
            (ax as number) + ((bx as number) - (ax as number)) * t,
            (ay as number) + ((by as number) - (ay as number)) * t,
            0,
          ),
        );
      }
    }
    return pts;
  };
  const OPTS = {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
    corners: ALL_CONNECT,
  };

  it('fires each inner repair twice per corner, once per side', () => {
    let setbackReports = 0;
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      onRepair: (id) => {
        if (id === 'setback') setbackReports++;
      },
    });
    // Four corners, entry and exit apiece.
    expect(setbackReports).toBe(8);
  });

  it('reports a site for a repair it did not run', () => {
    const off: { id: string; hadSite: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      repairs: new Set(['stretch', 'resume', 'fillet', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, site, ran) => {
        if (!ran) off.push({ id, hadSite: site !== null });
      },
    });
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((o) => o.id === 'setback')).toBe(true);
    expect(off.every((o) => o.hadSite)).toBe(true);
  });

  // Under the default rejoin, `resumeAt`'s own walk lands on the same vertex the trim would have —
  // the same subsumption already hit on the entry side — so setback-off geometry is pinned under
  // `relax` instead, where it differs. Pinned rather than compared against setback-on: the entry
  // side is switched off too (one `repairs` id gates both), so a bare inequality would stay green
  // even if the exit side's own gate did nothing at all.
  it('moves the exit-side geometry when its setback is switched off', () => {
    const path = [{ points: square(), surface: 'front' as const, closed: true }];
    const countOf = (opts: Parameters<typeof cutIntoRuns>[1]) =>
      cutIntoRuns(path, opts).runs.reduce((n, r) => n + r.points.length, 0);
    expect(countOf({ ...OPTS, rejoin: 'relax' })).toBe(225);
    expect(
      countOf({
        ...OPTS,
        rejoin: 'relax',
        repairs: new Set(['stretch', 'resume', 'fillet', 'close', 'return', 'hairpin'] as const),
      }),
    ).toBe(241);
  });
});
