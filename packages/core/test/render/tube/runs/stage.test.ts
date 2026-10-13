import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CUT_REPAIR_IDS } from '../../../../src/render/tube/repairs.js';
import {
  ALL_BREAK,
  ALL_CONNECT,
  type CornerWeights,
  cutIntoRuns,
  type Rejoin,
} from '../../../../src/render/tube/runs.js';
import { OPEN_PATH, PATH, sharpVPath, squarePath } from './paths.js';

describe('the corner stage, pinned before the repair registry', () => {
  const GEOM = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };

  /** An open L sampled at the pipeline's 0.02 spacing, fine enough for its corner to register (unlike `openLPath`, sampled at 0.1). */
  function fineOpenL(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 50; i++) pts.push(new THREE.Vector3(i * 0.02, 0, 0));
    for (let i = 1; i <= 50; i++) pts.push(new THREE.Vector3(1, i * 0.02, 0));
    return pts;
  }

  /** Every rejoin against every corner policy: the matrix the registry must not move. */
  const pin = (corners: CornerWeights, rejoin: Rejoin) => {
    const square = cutIntoRuns([PATH(squarePath())], { ...GEOM, corners, rejoin });
    const open = cutIntoRuns([OPEN_PATH(fineOpenL())], { ...GEOM, corners, rejoin });
    return {
      squareRuns: square.runs.length,
      squarePoints: square.runs.map((r) => r.points.length),
      squareNulls: square.runs.map((r) => r.from.filter((f) => f === null).length),
      squareStrategies: square.corners.map((c) => c.strategy),
      openRuns: open.runs.length,
      openPoints: open.runs.map((r) => r.points.length),
      openStrategies: open.corners.map((c) => c.strategy),
    };
  };

  it('holds connect corners under rejoin `bridge`', () => {
    expect(pin(ALL_CONNECT, 'bridge')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          111,
        ],
        "openRuns": 1,
        "openStrategies": [
          "connect",
        ],
        "squareNulls": [
          68,
        ],
        "squarePoints": [
          241,
        ],
        "squareRuns": 1,
        "squareStrategies": [
          "connect",
          "connect",
          "connect",
          "connect",
        ],
      }
    `);
  });
  it('holds break corners under rejoin `bridge`', () => {
    expect(pin(ALL_BREAK, 'bridge')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          50,
          50,
        ],
        "openRuns": 2,
        "openStrategies": [
          "break",
        ],
        "squareNulls": [
          0,
          0,
          0,
          0,
        ],
        "squarePoints": [
          49,
          49,
          49,
          49,
        ],
        "squareRuns": 4,
        "squareStrategies": [
          "break",
          "break",
          "break",
          "break",
        ],
      }
    `);
  });
  it('holds connect corners under rejoin `widen`', () => {
    expect(pin(ALL_CONNECT, 'widen')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          103,
        ],
        "openRuns": 1,
        "openStrategies": [
          "connect",
        ],
        "squareNulls": [
          44,
        ],
        "squarePoints": [
          209,
        ],
        "squareRuns": 1,
        "squareStrategies": [
          "connect",
          "connect",
          "connect",
          "connect",
        ],
      }
    `);
  });
  it('holds break corners under rejoin `widen`', () => {
    expect(pin(ALL_BREAK, 'widen')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          50,
          50,
        ],
        "openRuns": 2,
        "openStrategies": [
          "break",
        ],
        "squareNulls": [
          0,
          0,
          0,
          0,
        ],
        "squarePoints": [
          49,
          49,
          49,
          49,
        ],
        "squareRuns": 4,
        "squareStrategies": [
          "break",
          "break",
          "break",
          "break",
        ],
      }
    `);
  });
  it('holds connect corners under rejoin `relax`', () => {
    expect(pin(ALL_CONNECT, 'relax')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          106,
        ],
        "openRuns": 1,
        "openStrategies": [
          "connect",
        ],
        "squareNulls": [
          44,
        ],
        "squarePoints": [
          225,
        ],
        "squareRuns": 1,
        "squareStrategies": [
          "connect",
          "connect",
          "connect",
          "connect",
        ],
      }
    `);
  });
  it('holds break corners under rejoin `relax`', () => {
    expect(pin(ALL_BREAK, 'relax')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          50,
          50,
        ],
        "openRuns": 2,
        "openStrategies": [
          "break",
        ],
        "squareNulls": [
          0,
          0,
          0,
          0,
        ],
        "squarePoints": [
          49,
          49,
          49,
          49,
        ],
        "squareRuns": 4,
        "squareStrategies": [
          "break",
          "break",
          "break",
          "break",
        ],
      }
    `);
  });
  it('holds connect corners under rejoin `drop`', () => {
    expect(pin(ALL_CONNECT, 'drop')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          103,
        ],
        "openRuns": 1,
        "openStrategies": [
          "connect",
        ],
        "squareNulls": [
          44,
        ],
        "squarePoints": [
          209,
        ],
        "squareRuns": 1,
        "squareStrategies": [
          "connect",
          "connect",
          "connect",
          "connect",
        ],
      }
    `);
  });
  it('holds break corners under rejoin `drop`', () => {
    expect(pin(ALL_BREAK, 'drop')).toMatchInlineSnapshot(`
      {
        "openPoints": [
          50,
          50,
        ],
        "openRuns": 2,
        "openStrategies": [
          "break",
        ],
        "squareNulls": [
          0,
          0,
          0,
          0,
        ],
        "squarePoints": [
          49,
          49,
          49,
          49,
        ],
        "squareRuns": 4,
        "squareStrategies": [
          "break",
          "break",
          "break",
          "break",
        ],
      }
    `);
  });

  it('holds a return corner, which is the only path through splitReturn', () => {
    const { runs, corners } = cutIntoRuns([PATH(squarePath())], {
      ...GEOM,
      corners: ALL_BREAK,
      blockout: 1,
    });
    expect(corners.map((c) => c.strategy)).toContain('return');
    expect(runs.map((r) => r.points.length)).toMatchInlineSnapshot(`
      [
        21,
        13,
        41,
        13,
        41,
        13,
        41,
        13,
        21,
      ]
    `);
    expect(runs.filter((r) => r.dark).length).toBeGreaterThan(0);
  });

  it('holds a hairpin corner, which bypasses both registries', () => {
    const { runs, corners } = cutIntoRuns([PATH(sharpVPath(), false)], {
      ...GEOM,
      corners: { break: 0, connect: 0, hairpin: 1 },
    });
    expect(corners.map((c) => c.strategy)).toMatchInlineSnapshot(`
      [
        "hairpin",
      ]
    `);
    expect(runs.map((r) => r.points.length)).toMatchInlineSnapshot(`
      [
        120,
      ]
    `);
  });

  it('reports every repair it considered, switched on or off', () => {
    const seen: { id: string; ran: boolean }[] = [];
    cutIntoRuns([PATH(squarePath())], {
      ...GEOM,
      corners: ALL_CONNECT,
      onRepair: (id, _site, ran) => seen.push({ id, ran }),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.ran)).toBe(true);
    expect(new Set(seen.map((s) => s.id))).toContain('setback');
  });

  it('treats an absent repair set as every repair on', () => {
    const all = cutIntoRuns([PATH(squarePath())], {
      ...GEOM,
      corners: ALL_CONNECT,
      repairs: new Set(CUT_REPAIR_IDS),
    });
    const absent = cutIntoRuns([PATH(squarePath())], { ...GEOM, corners: ALL_CONNECT });
    expect(all.runs.map((r) => r.points.length)).toEqual(absent.runs.map((r) => r.points.length));
  });

  it('reports a repair it was told not to run', () => {
    const seen: { id: string; ran: boolean }[] = [];
    cutIntoRuns([PATH(squarePath())], {
      ...GEOM,
      corners: ALL_CONNECT,
      repairs: new Set(CUT_REPAIR_IDS.filter((id) => id !== 'setback')),
      onRepair: (id, _site, ran) => seen.push({ id, ran }),
    });

    expect(seen.some((s) => s.id === 'setback' && s.ran === false)).toBe(true);
  });
});
