import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { specOf } from '../../../src/render/looks.js';
import { assign } from '../../../src/render/tube/assign.js';
import { type ContourPolicies, RESCUE_LADDER } from '../../../src/render/tube/contours.js';
import { type GeneratedPath, generatePaths } from '../../../src/render/tube/generators.js';
import { buildTubeBlueprint, type TubeSpec } from '../../../src/render/tube/index.js';
import { type CutOptions, cutIntoRuns, type Run } from '../../../src/render/tube/runs.js';
import { surfacesOf } from '../../../src/render/tube/surfaces.js';
import { glyphToShapes } from '../../../src/text/glyphs.js';

const LAB = fileURLToPath(new URL('../../../../../apps/lab/public/', import.meta.url));

/** The cut settings `tubing` ships with. */
const TUBING: CutOptions = {
  runs: 7,
  minRun: 0.15,
  radius: 0.022,
  bend: 2,
  spacing: 0.02,
  blockout: 0.7,
  corners: { break: 0.7, connect: 0.3 },
  seed: 0,
};

/**
 * A regular ring of `radius` em at the shipped spacing. Every vertex of one bends at exactly its own
 * radius, so under 0.044 em — `tubing`'s minimum bend — the glass cannot go round it anywhere.
 */
function ring(radius: number, role?: GeneratedPath['role']): GeneratedPath {
  const n = Math.max(8, Math.round((2 * Math.PI * radius) / 0.02));
  const points = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  });
  return { points, surface: 'front', closed: true, ...(role ? { role } : {}) };
}

const SMALL = 0.0318;

function squareWithHole(): THREE.Shape {
  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1, 0),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(0, 1),
  ]);
  shape.holes.push(
    new THREE.Path([
      new THREE.Vector2(0.3, 0.3),
      new THREE.Vector2(0.3, 0.7),
      new THREE.Vector2(0.7, 0.7),
      new THREE.Vector2(0.7, 0.3),
    ]),
  );
  return shape;
}

const geometry = (runs: readonly Run[]) =>
  runs.map((r) => [r.points.map((p) => [p.x, p.y, p.z]), r.lit, r.dark === true]);

describe('contour roles', () => {
  it("marks a shape's holes as counters and the shape itself as its outline", () => {
    const surfaces = surfacesOf([squareWithHole()], 0.3);
    const front = surfaces.find((s) => s.kind === 'front');
    expect(front?.kind === 'front' && front.roles).toEqual(['outline', 'counter']);
    expect(surfaces.flatMap((s) => (s.kind === 'wall' ? [s.role] : []))).toEqual([
      'outline',
      'counter',
    ]);
  });

  it('carries the role onto every direct path, and onto no grid path', () => {
    const opts = { level: 0, spacing: 0.02, wallDepth: 0.5, resolution: 64, pad: 0.35 };
    const surfaces = surfacesOf([squareWithHole()], 0.3);
    expect(generatePaths(surfaces, ['front'], opts).map((p) => p.role)).toEqual([
      'outline',
      'counter',
    ]);
    expect(
      generatePaths(surfaces, ['front'], { ...opts, source: 'field' }).every(
        (p) => p.role === undefined,
      ),
    ).toBe(true);
  });
});

describe('rescuing a contour in the cut', () => {
  const COUNTERS: ContourPolicies = { counter: { rescue: RESCUE_LADDER } };

  it('loses a ring tighter than the glass bends, at stock settings', () => {
    expect(cutIntoRuns([ring(SMALL, 'counter')], TUBING).runs).toHaveLength(0);
  });

  it('brings that ring back down the ladder, on glass no thinner than the floor', () => {
    const { runs } = cutIntoRuns([ring(SMALL, 'counter')], { ...TUBING, contours: COUNTERS });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.role).toBe('counter');
      expect(run.radius ?? 0.022).toBeGreaterThanOrEqual(0.022 * 0.5);
    }
  });

  it('sweeps a thinned rescue at the thinner radius', () => {
    const { runs } = cutIntoRuns([ring(SMALL, 'counter')], {
      ...TUBING,
      contours: { counter: { rescue: [{ radius: 0.7 }] } },
    });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.radius).toBe(0.022 * 0.7);
  });

  it('refuses a rung thinner than the floor', () => {
    const { runs } = cutIntoRuns([ring(SMALL, 'counter')], {
      ...TUBING,
      contours: { counter: { rescue: [{ radius: 0.7 }], floor: 0.8 } },
    });
    expect(runs).toHaveLength(0);
  });

  it('fits glass to the tightest bend when a rung asks for it', () => {
    const { runs } = cutIntoRuns([ring(SMALL, 'counter')], {
      ...TUBING,
      contours: { counter: { rescue: [{ radius: 'fit' }], floor: 0 } },
    });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.radius).toBeLessThanOrEqual(SMALL / 2 + 1e-9);
  });

  it('leaves a contour of another role alone', () => {
    const { runs } = cutIntoRuns([ring(SMALL, 'outline')], { ...TUBING, contours: COUNTERS });
    expect(runs).toHaveLength(0);
  });

  it('cuts a contour that already reaches the screen exactly as it did', () => {
    const paths = () => [ring(0.3, 'outline'), ring(0.12, 'counter')];
    const bare = cutIntoRuns(paths(), TUBING);
    const policed = cutIntoRuns(paths(), { ...TUBING, contours: COUNTERS });
    expect(geometry(policed.runs)).toEqual(geometry(bare.runs));
  });

  it('reports only the repairs of the attempt it keeps', () => {
    const heard = (opts: CutOptions, path: GeneratedPath) => {
      const out: [string, boolean][] = [];
      cutIntoRuns([path], { ...opts, onRepair: (id, _site, ran) => out.push([id, ran]) });
      return out;
    };
    const rescued = heard(
      { ...TUBING, contours: { counter: { rescue: [{ radius: 0.7 }] } } },
      ring(SMALL, 'counter'),
    );
    const direct = heard({ ...TUBING, radius: 0.022 * 0.7 }, ring(SMALL));
    expect(rescued).toEqual(direct);
  });
});

describe('lighting a contour select left dark', () => {
  const run = (over: Partial<Run>): Run => ({
    points: [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)],
    from: [],
    surface: 'front',
    length: 0.2,
    index: 0,
    lit: false,
    color: 0,
    ...over,
  });

  it("lights the counter's longest lightable run and nothing else", () => {
    const runs = [
      run({ index: 0, path: 0, role: 'counter', length: 0.2 }),
      run({ index: 1, path: 0, role: 'counter', length: 0.3 }),
      run({ index: 2, path: 0, role: 'counter', length: 0.9, dark: true }),
      run({ index: 3, length: 0.5 }),
    ];
    assign(runs, { by: 'index', amount: 0 }, [0xffffff], 0, undefined, [], undefined, {
      counter: { lit: 'one' },
    });
    expect(runs.map((r) => r.lit)).toEqual([false, true, false, false]);
  });

  it('leaves a counter alone when select already lit some of it', () => {
    const runs = [
      run({ index: 0, path: 0, role: 'counter', length: 0.2 }),
      run({ index: 1, path: 0, role: 'counter', length: 0.3 }),
    ];
    assign(runs, { by: 'index', count: 1 }, [0xffffff], 0, undefined, [], undefined, {
      counter: { lit: 'one' },
    });
    expect(runs.map((r) => r.lit)).toEqual([true, false]);
  });
});

function faceAt(path: string) {
  const buf = readFileSync(path);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function tubing(): TubeSpec {
  const decoration = specOf('tubing').decoration;
  if (decoration?.kind !== 'tube') throw new Error('tubing has no tube decoration');
  return decoration;
}

describe('real faces under tubing', () => {
  const spec = tubing();
  const { contours: _shipped, ...bare } = spec;
  /** Roles stamped, nothing rescued and nothing lit that select did not light. */
  const watched: TubeSpec = { ...bare, contours: { counter: {} } };

  it("lights the counter of the lab's A, which stock blockout drew as dark glass", () => {
    // Archivo Black, fired as the A of JACKPOT!: letter slot 1, and slot is the seed.
    const font = faceAt(`${LAB}font.ttf`);
    const counterLit = (s: TubeSpec) => {
      const bp = buildTubeBlueprint(glyphToShapes(font as never, 'A', 1), s, 0.3, 1);
      const counter = bp.runs.filter((r) => r.role === 'counter');
      bp.dispose();
      return { drawn: counter.length, lit: counter.filter((r) => r.lit).length };
    };
    expect(counterLit(watched)).toEqual({ drawn: 1, lit: 0 });
    expect(counterLit(spec).lit).toBeGreaterThan(0);
  });

  const files = readdirSync(`${LAB}fonts`).filter((f) => f.endsWith('.ttf'));
  it.each(files)('changes nothing in a letter whose counters already light: %s', (file) => {
    const font = faceAt(`${LAB}fonts/${file}`);
    let untouched = 0;
    for (const char of 'ABDOPQRabdegopq08') {
      const shapes = () => glyphToShapes(font as never, char, 1);
      const seen = buildTubeBlueprint(shapes(), watched, 0.3, 0);
      const counters = seen.paths.flatMap((p, i) => (p.role === 'counter' ? [i] : []));
      const alreadyLit = counters.every((i) => seen.runs.some((r) => r.path === i && r.lit));
      seen.dispose();
      if (!alreadyLit) continue;

      const before = buildTubeBlueprint(shapes(), bare, 0.3, 0);
      const after = buildTubeBlueprint(shapes(), spec, 0.3, 0);
      expect(geometry(after.runs), char).toEqual(geometry(before.runs));
      before.dispose();
      after.dispose();
      untouched++;
    }
    expect(untouched).toBeGreaterThan(0);
  });
});

describe('the thinner rungs, on shipped faces', () => {
  const spec = tubing();
  const floor = spec.radius * 0.5;
  const files = readdirSync(`${LAB}fonts`).filter((f) => f.endsWith('.ttf'));
  let thinned = 0;

  it.each(files)('thin only counters, and never below the floor: %s', (file) => {
    const font = faceAt(`${LAB}fonts/${file}`);
    for (const char of 'ABDOPQRabdegopq08@&') {
      const bp = buildTubeBlueprint(glyphToShapes(font as never, char, 1), spec, 0.3, 0);
      for (const run of bp.runs) {
        if (run.radius === undefined) continue;
        expect(run.role, char).toBe('counter');
        expect(run.radius, char).toBeGreaterThanOrEqual(floor);
        expect(run.radius, char).toBeLessThan(spec.radius);
        thinned++;
      }
      bp.dispose();
    }
  });

  // The synthetic ring proves the rung works; this proves real outlines reach it.
  it('bring back some counter on thinner glass somewhere', () => {
    expect(thinned).toBeGreaterThan(0);
  });
});
