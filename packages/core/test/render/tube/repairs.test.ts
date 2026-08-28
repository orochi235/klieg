import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CORNER_REPAIRS,
  CUT_REPAIR_IDS,
  DECISION_REPAIRS,
  popStretch,
  SPAN_REPAIRS,
  trimStretch,
} from '../../../src/render/tube/repairs.js';
import { ALL_BREAK, ALL_CONNECT, cutIntoRuns } from '../../../src/render/tube/runs.js';

/** An open path with one sharp interior apex — a V whose walls meet sharp enough to hairpin. */
const sharpV = () => {
  const pts: THREE.Vector3[] = [];
  for (let i = 40; i >= 0; i--) pts.push(new THREE.Vector3(-0.18 * (i / 40), i / 40, 0));
  for (let i = 1; i <= 40; i++) pts.push(new THREE.Vector3(0.18 * (i / 40), i / 40, 0));
  return pts;
};

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

/** Two straight legs meeting at one hard corner — the open-path counterpart to `square()`. */
const openL = () => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 50; i++) pts.push(new THREE.Vector3((i / 50) * 0.5, 0, 0));
  for (let i = 1; i <= 50; i++) pts.push(new THREE.Vector3(0.5, (i / 50) * 0.5, 0));
  return pts;
};

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

  it('hangs every repair off the stage it runs inside', () => {
    for (const entry of [...CORNER_REPAIRS, ...SPAN_REPAIRS, ...DECISION_REPAIRS]) {
      expect(entry.stage).toBe('cut');
    }
  });

  it('separates the three levels a repair can attach at', () => {
    expect(CORNER_REPAIRS.map((r) => r.level)).toEqual(['corner', 'corner', 'corner']);
    expect(SPAN_REPAIRS.map((r) => r.level)).toEqual(['span', 'span', 'span']);
    expect(DECISION_REPAIRS.map((r) => r.id)).toEqual(['fillet', 'hairpin']);
    expect(DECISION_REPAIRS.map((r) => r.level)).toEqual(['decision', 'decision']);
  });

  it('names every id across the three registries exactly once per level', () => {
    const all = [...CORNER_REPAIRS, ...SPAN_REPAIRS, ...DECISION_REPAIRS];
    expect(new Set(all.map((r) => r.id))).toEqual(new Set(CUT_REPAIR_IDS));
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

  // Entry setback's distance trim subsumes whatever the corner-side stretch popped, so on/off
  // geometry is byte-identical under every rejoin as long as setback stays on — the toggle only
  // shows through once setback and resume are also excluded. Pinned by exact count, not
  // inequality, so a mutation that pops unconditionally still fails.
  it('moves the corner-side stretch geometry once setback and resume are also off', () => {
    const path = [{ points: square(), surface: 'front' as const, closed: true }];
    const countOf = (opts: Parameters<typeof cutIntoRuns>[1]) =>
      cutIntoRuns(path, opts).runs.reduce((n, r) => n + r.points.length, 0);
    expect(
      countOf({
        ...OPTS,
        rejoin: 'drop',
        repairs: new Set(['stretch', 'fillet', 'close', 'return', 'hairpin'] as const),
      }),
    ).toBe(241);
    expect(
      countOf({
        ...OPTS,
        rejoin: 'drop',
        repairs: new Set(['fillet', 'close', 'return', 'hairpin'] as const),
      }),
    ).toBe(245);
  });

  it('reports the resume provider that actually answered', () => {
    const points: number[] = [];
    let reports = 0;
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      rejoin: 'bridge',
      onRepair: (id, site) => {
        if (id === 'resume') {
          reports++;
          if (site) points.push(site.points.length);
        }
      },
    });
    // A bridge answers with a blend; the plain walk answers with an index and no geometry.
    expect(points.some((n) => n > 0)).toBe(true);
    // Both sides of all four corners.
    expect(reports).toBe(8);
  });

  // Under `relax`, a successful blend is applied whether or not `resume` is on, so on/off geometry
  // is bit-identical there — the walk-off gate only has bite under the default rejoin, where
  // switching it off leaves the fillet's own vertices in place instead of trimming to the walk.
  // Pinned by exact count, not inequality, so a mutation that trims unconditionally still fails.
  it('pins the resume geometry both walk-off gates control', () => {
    const path = [{ points: square(), surface: 'front' as const, closed: true }];
    const countOf = (opts: Parameters<typeof cutIntoRuns>[1]) =>
      cutIntoRuns(path, opts).runs.reduce((n, r) => n + r.points.length, 0);
    expect(countOf({ ...OPTS })).toBe(209);
    expect(
      countOf({
        ...OPTS,
        repairs: new Set(['stretch', 'setback', 'fillet', 'close', 'return', 'hairpin'] as const),
      }),
    ).toBe(225);

    // The relax branch's own report still needs covering, since geometry alone can't show it ran.
    const relaxPoints: number[] = [];
    cutIntoRuns(path, {
      ...OPTS,
      rejoin: 'relax',
      onRepair: (id, site) => {
        if (id === 'resume' && site) relaxPoints.push(site.points.length);
      },
    });
    expect(relaxPoints.some((n) => n > 0)).toBe(true);
  });

  it('carries the vertices a removal would take out, not just an index', () => {
    const sites: { id: string; removed: number; ran: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      onRepair: (id, site, ran) => {
        if ((id === 'stretch' || id === 'setback') && site) {
          sites.push({ id, removed: site.removed.length, ran });
        }
      },
    });
    // Every corner-side stretch drops the corner's whole group, so none of them is a no-op.
    expect(sites.filter((s) => s.id === 'stretch').every((s) => s.removed > 0)).toBe(true);
    // Entry setback trims by distance and reports what it took; the exit side removes nothing from
    // the accumulator, it advances a cursor, so its `removed` is empty by construction.
    expect(sites.filter((s) => s.id === 'setback').some((s) => s.removed > 0)).toBe(true);
  });

  it('reports resume on both sides of every corner', () => {
    const sides: (string | undefined)[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      onRepair: (id, site) => {
        if (id === 'resume' && site) sides.push(site.side);
      },
    });
    expect(sides.filter((s) => s === 'entry')).toHaveLength(4);
    expect(sides.filter((s) => s === 'exit')).toHaveLength(4);
  });

  it('reports the removal a switched-off repair would have made', () => {
    const off: number[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      repairs: new Set(['setback', 'resume', 'fillet', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, site, ran) => {
        if (id === 'stretch' && !ran && site) off.push(site.removed.length);
      },
    });
    expect(off.length).toBe(4);
    expect(off.every((n) => n > 0)).toBe(true);
  });
});

describe('the span registry', () => {
  const OPTS = {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
  };

  it('leaves a return span whole when return is switched off', () => {
    const path = { points: square(), surface: 'front' as const, closed: true };
    const on = cutIntoRuns([path], { ...OPTS, corners: ALL_BREAK, blockout: 1 });
    const off = cutIntoRuns([{ ...path, points: square() }], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'hairpin'] as const),
    });
    expect(on.runs.filter((r) => r.dark).length).toBeGreaterThan(0);
    expect(off.runs.filter((r) => r.dark)).toHaveLength(0);
  });

  // Under the default `drop` rejoin, a corner's own resume walk almost always lands exactly back on
  // the vertex the loop split at, so `closeLoop`'s push is a no-op everywhere except where a fillet's
  // minimum bend radius consumes an entire leg with no valid resume point in it. `bend: 16` against
  // this square's leg length is what forces that — `bend: 2` (the OPTS above) never does, which is
  // why this needs its own bend rather than reusing the shared constant.
  it('pins the seam vertex closeLoop pushes when the entry-side resume exhausts a leg', () => {
    const path = { points: square(), surface: 'front' as const, closed: true };
    const bigBend = { ...OPTS, bend: 16, corners: ALL_CONNECT };
    const countOf = (opts: Parameters<typeof cutIntoRuns>[1]) =>
      cutIntoRuns([path], opts).runs.reduce((n, r) => n + r.points.length, 0);
    expect(countOf(bigBend)).toBe(309);
    expect(
      countOf({
        ...bigBend,
        repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'return', 'hairpin'] as const),
      }),
    ).toBe(308);
  });

  // The closed-path test above only exercises the closed-loop return sites; this covers the third
  // site, the open-path branch, which needs an open path to reach at all.
  it("leaves an open path's return span whole when return is switched off", () => {
    const path = { points: openL(), surface: 'front' as const, closed: false };
    const on = cutIntoRuns([path], { ...OPTS, corners: ALL_BREAK, blockout: 1 });
    const off = cutIntoRuns([{ ...path, points: openL() }], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'hairpin'] as const),
    });
    expect(on.runs.filter((r) => r.dark).length).toBeGreaterThan(0);
    expect(off.runs.filter((r) => r.dark)).toHaveLength(0);
  });
});

describe('the whole-corner decisions', () => {
  const OPTS = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };

  it('breaks every hard corner when fillet is switched off', () => {
    const { corners } = cutIntoRuns(
      [{ points: square(), surface: 'front' as const, closed: true }],
      {
        ...OPTS,
        corners: ALL_CONNECT,
        repairs: new Set(['stretch', 'setback', 'resume', 'close', 'return', 'hairpin'] as const),
      },
    );
    expect(corners.every((c) => c.strategy === 'break')).toBe(true);
  });

  it('draws a hairpin at the sharp-V fixture when hairpin is enabled', () => {
    const { corners } = cutIntoRuns(
      [{ points: sharpV(), surface: 'front' as const, closed: false }],
      { ...OPTS, corners: { break: 0, connect: 0, hairpin: 1 } },
    );
    expect(corners.some((c) => c.strategy === 'hairpin')).toBe(true);
  });

  it('breaks a hairpin corner when hairpin is switched off', () => {
    const { corners } = cutIntoRuns(
      [{ points: sharpV(), surface: 'front' as const, closed: false }],
      {
        ...OPTS,
        corners: { break: 0, connect: 0, hairpin: 1 },
        repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'return'] as const),
      },
    );
    expect(corners.some((c) => c.strategy === 'hairpin')).toBe(false);
  });

  // The "everything on" contrast for this same fixture is already pinned by the span registry's
  // "leaves a return span whole when return is switched off" test, which asserts dark runs > 0
  // under this exact `corners: ALL_BREAK, blockout: 1` shape with the default (all-on) repairs.
  it('never returns dark across a corner when fillet is switched off', () => {
    const path = { points: square(), surface: 'front' as const, closed: true };
    const off = cutIntoRuns([path], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      repairs: new Set(['stretch', 'setback', 'resume', 'close', 'return', 'hairpin'] as const),
    });
    expect(off.runs.filter((r) => r.dark)).toHaveLength(0);
  });

  it('reports one fillet per hard corner, all skipped, when fillet is switched off', () => {
    const reports: { site: unknown; ran: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      corners: ALL_CONNECT,
      repairs: new Set(['stretch', 'setback', 'resume', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, site, ran) => {
        if (id === 'fillet') reports.push({ site, ran });
      },
    });
    expect(reports).toHaveLength(4);
    expect(reports.every((r) => r.ran === false)).toBe(true);
    expect(
      reports.every((r) => r.site !== null && (r.site as { points: unknown[] }).points.length > 0),
    ).toBe(true);
  });

  it('reports the fillet as run when fillet is switched on', () => {
    const reports: { ran: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      corners: ALL_CONNECT,
      onRepair: (id, _site, ran) => {
        if (id === 'fillet') reports.push({ ran });
      },
    });
    expect(reports).toHaveLength(4);
    expect(reports.every((r) => r.ran === true)).toBe(true);
  });

  it('reports the hairpin it drew at the sharp V', () => {
    const sites: { ran: boolean; points: number }[] = [];
    cutIntoRuns([{ points: sharpV(), surface: 'front' as const, closed: false }], {
      ...OPTS,
      corners: { break: 0, connect: 0, hairpin: 1 },
      onRepair: (id, site, ran) => {
        if (id === 'hairpin' && site) sites.push({ ran, points: site.points.length });
      },
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.ran).toBe(true);
    expect(sites[0]?.points).toBeGreaterThan(0);
  });

  it('reports the hairpin it declined when the toggle is off', () => {
    const sites: { ran: boolean; points: number }[] = [];
    cutIntoRuns([{ points: sharpV(), surface: 'front' as const, closed: false }], {
      ...OPTS,
      corners: { break: 0, connect: 0, hairpin: 1 },
      repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'return'] as const),
      onRepair: (id, site, ran) => {
        if (id === 'hairpin' && site) sites.push({ ran, points: site.points.length });
      },
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.ran).toBe(false);
    // The site still carries what the hairpin would have drawn — that is the whole point of it.
    expect(sites[0]?.points).toBeGreaterThan(0);
  });

  it('reports the return it would have drawn when fillet is switched off', () => {
    const path = [{ points: square(), surface: 'front' as const, closed: true }];
    const withFillet = { ...OPTS, corners: ALL_BREAK, blockout: 1 };
    const on: boolean[] = [];
    cutIntoRuns(path, {
      ...withFillet,
      onRepair: (id, _site, ran) => {
        if (id === 'return') on.push(ran);
      },
    });
    expect(on.length).toBeGreaterThan(0);
    expect(on.every(Boolean)).toBe(true);

    const off: boolean[] = [];
    cutIntoRuns(path, {
      ...withFillet,
      repairs: new Set(['stretch', 'setback', 'resume', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, _site, ran) => {
        if (id === 'return') off.push(ran);
      },
    });
    // The same corners still report — as skipped, because the fillet they need is gone.
    expect(off.length).toBe(on.length);
    expect(off.some(Boolean)).toBe(false);
  });

  it('reports the blockout fillet candidate, which a connect never sees', () => {
    const seen: number[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      onRepair: (id, site) => {
        if (id === 'fillet' && site) seen.push(site.points.length);
      },
    });
    // Every corner breaks, so every fillet report here is the blockout candidate.
    expect(seen.length).toBe(4);
    expect(seen.every((n) => n > 0)).toBe(true);
  });
});
