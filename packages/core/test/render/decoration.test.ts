import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  type BeddingSpec,
  buildChunkBlueprint,
  type ChunkSpec,
  chunkGeometry,
  chunkGeometrySide,
  chunkMatrices,
  poolFor,
} from '../../src/render/decoration.js';
import { specOf } from '../../src/render/looks.js';

const CHUNKS: ChunkSpec = {
  kind: 'chunks',
  count: 12,
  size: 0.05,
  shape: 'cube',
  align: 0,
  cluster: 0,
  proud: 0.5,
  look: {},
};

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 0.3);
}

/** Chunk edge, which is what the matrix carries the per-chunk size in. */
function edgeOf(m: THREE.Matrix4): number {
  return new THREE.Vector3().setFromMatrixScale(m).x;
}

/** How far a chunk sits off its sample point, in chunk edges; negative is sunk into the surface. */
function standoff(m: THREE.Matrix4, blueprint: { position: Float32Array; normal: Float32Array }) {
  const at = new THREE.Vector3().setFromMatrixPosition(m);
  let best = Infinity;
  let along = 0;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < blueprint.position.length / 3; i++) {
    p.set(
      blueprint.position[i * 3] as number,
      blueprint.position[i * 3 + 1] as number,
      blueprint.position[i * 3 + 2] as number,
    );
    const d = at.distanceToSquared(p);
    if (d >= best) continue;
    best = d;
    n.set(
      blueprint.normal[i * 3] as number,
      blueprint.normal[i * 3 + 1] as number,
      blueprint.normal[i * 3 + 2] as number,
    );
    along = at.clone().sub(p).dot(n);
  }
  return along / edgeOf(m);
}

/** Share of chunks that landed on a cap rather than the extrusion band. */
function capShare(spec: ChunkSpec): number {
  const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec), faceBias: spec.faceBias });
  const matrices = chunkMatrices(blueprint, spec, 3);
  let caps = 0;
  for (const m of matrices) {
    const at = new THREE.Vector3().setFromMatrixPosition(m);
    if (Math.abs(at.z) > 0.15 - 1e-3) caps++;
  }
  return caps / matrices.length;
}

/**
 * Angle in radians between a chunk's own face and the surface it sat on. A flake and a disc face
 * local +Z, so this is what `lie` drives to zero.
 */
function tilt(m: THREE.Matrix4, blueprint: { position: Float32Array; normal: Float32Array }) {
  const at = new THREE.Vector3().setFromMatrixPosition(m);
  let best = Infinity;
  const p = new THREE.Vector3();
  const near = new THREE.Vector3();
  for (let i = 0; i < blueprint.position.length / 3; i++) {
    p.set(
      blueprint.position[i * 3] as number,
      blueprint.position[i * 3 + 1] as number,
      blueprint.position[i * 3 + 2] as number,
    );
    const d = at.distanceToSquared(p);
    if (d >= best) continue;
    best = d;
    near.set(
      blueprint.normal[i * 3] as number,
      blueprint.normal[i * 3 + 1] as number,
      blueprint.normal[i * 3 + 2] as number,
    );
  }
  const face = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternionOf(m));
  return Math.acos(Math.min(1, Math.abs(face.dot(near))));
}

/** Rotation only, so two matrices can be compared for shared orientation. */
function quaternionOf(m: THREE.Matrix4): THREE.Quaternion {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return q;
}

/**
 * Nearest-neighbour distance for every cap chunk in a placed field, sorted. A lattice puts a floor
 * under this that free placement has no reason to respect.
 */
function capSpacings(spec: ChunkSpec, bedding: BeddingSpec): number[] {
  const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec), bedding });
  const at = chunkMatrices(blueprint, { ...spec, bedding }, 3)
    .map((m) => new THREE.Vector3().setFromMatrixPosition(m))
    .filter((v) => Math.abs(v.z) > 0.15 - 1e-3);

  const out: number[] = [];
  for (let i = 0; i < at.length; i++) {
    let best = Infinity;
    for (let j = 0; j < at.length; j++) {
      if (i === j) continue;
      const a = at[i] as THREE.Vector3;
      const b = at[j] as THREE.Vector3;
      // In the cap plane, which is where the lattice is defined; the two caps are separate fields.
      if (Math.sign(a.z) !== Math.sign(b.z)) continue;
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
    }
    if (Number.isFinite(best)) out.push(best);
  }
  return out.sort((x, y) => x - y);
}

describe('buildChunkBlueprint', () => {
  it('samples positions and normals in step', () => {
    const blueprint = buildChunkBlueprint(box());

    expect(blueprint.position.length).toBe(blueprint.normal.length);
    expect(blueprint.position.length % 3).toBe(0);
  });

  it('samples the same pool for the same geometry every time', () => {
    const a = buildChunkBlueprint(box());
    const b = buildChunkBlueprint(box());

    expect(Array.from(a.position)).toEqual(Array.from(b.position));
  });

  it('places every sample on the surface', () => {
    const blueprint = buildChunkBlueprint(box());

    for (let i = 0; i < blueprint.position.length; i += 3) {
      const x = Math.abs(blueprint.position[i] as number);
      const y = Math.abs(blueprint.position[i + 1] as number);
      const z = Math.abs(blueprint.position[i + 2] as number);
      const onFace = x > 0.5 - 1e-6 || y > 0.5 - 1e-6 || z > 0.15 - 1e-6;
      expect(onFace).toBe(true);
    }
  });
});

describe('chunkMatrices', () => {
  it('produces one matrix per requested chunk', () => {
    const matrices = chunkMatrices(buildChunkBlueprint(box()), CHUNKS, 3);

    expect(matrices).toHaveLength(CHUNKS.count);
  });

  it('is deterministic for a given seed', () => {
    const blueprint = buildChunkBlueprint(box());
    const a = chunkMatrices(blueprint, CHUNKS, 3);
    const b = chunkMatrices(blueprint, CHUNKS, 3);

    expect(a[0]?.elements).toEqual(b[0]?.elements);
  });

  it('gives different letters different scatter', () => {
    const blueprint = buildChunkBlueprint(box());
    const a = chunkMatrices(blueprint, CHUNKS, 3);
    const b = chunkMatrices(blueprint, CHUNKS, 4);

    expect(a[0]?.elements).not.toEqual(b[0]?.elements);
  });

  it('shares one orientation across a letter at align 1', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, { ...CHUNKS, align: 1 }, 3);
    const first = quaternionOf(matrices[0] as THREE.Matrix4);

    for (const m of matrices) {
      expect(quaternionOf(m).angleTo(first)).toBeCloseTo(0, 5);
    }
  });

  it('tumbles freely at align 0', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, { ...CHUNKS, align: 0 }, 3);
    const first = quaternionOf(matrices[0] as THREE.Matrix4);
    const spread = matrices.map((m) => quaternionOf(m).angleTo(first));

    expect(Math.max(...spread)).toBeGreaterThan(0.1);
  });

  it('keeps a full clump from collapsing onto a couple of points', () => {
    const spec = { ...CHUNKS, count: 40, cluster: 1 };
    const matrices = chunkMatrices(buildChunkBlueprint(box()), spec, 3);
    const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
    const distinct = new Set(matrices.map((m) => at(m).toArray().join(',')));

    expect(distinct.size).toBeGreaterThan(spec.count / 2);
  });

  it('draws a clump tighter than an even scatter', () => {
    const blueprint = buildChunkBlueprint(box());
    const spread = (cluster: number) => {
      const matrices = chunkMatrices(blueprint, { ...CHUNKS, count: 40, cluster }, 3);
      const points = matrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
      const mean = points
        .reduce((acc, p) => acc.add(p), new THREE.Vector3())
        .divideScalar(points.length);
      return points.reduce((acc, p) => acc + p.distanceTo(mean), 0) / points.length;
    };

    expect(spread(1)).toBeLessThan(spread(0));
  });

  it('never places two chunks on one sample point', () => {
    const spec = { ...CHUNKS, count: 90, cluster: 0 };
    const matrices = chunkMatrices(buildChunkBlueprint(box()), spec, 3);
    const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
    const distinct = new Set(matrices.map((m) => at(m).toArray().join(',')));

    expect(distinct.size).toBe(spec.count);
  });

  it('sits chunks proud of the surface', () => {
    const blueprint = buildChunkBlueprint(box());
    const flush = chunkMatrices(blueprint, { ...CHUNKS, proud: 0 }, 3);
    const raised = chunkMatrices(blueprint, { ...CHUNKS, proud: 1 }, 3);

    const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m).length();
    expect(at(raised[0] as THREE.Matrix4)).toBeGreaterThan(at(flush[0] as THREE.Matrix4));
  });
});

describe('per-chunk size and stand-off', () => {
  it('keeps one size and one stand-off when neither is asked for', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, CHUNKS, 3);

    for (const m of matrices) {
      expect(edgeOf(m)).toBeCloseTo(CHUNKS.size, 10);
      expect(standoff(m, blueprint)).toBeCloseTo(CHUNKS.proud, 6);
    }
  });

  it('grades chunks below the nominal size, never above it', () => {
    const spec = { ...CHUNKS, count: 120, sizeVary: 0.6 };
    const edges = chunkMatrices(buildChunkBlueprint(box(), { pool: poolFor(spec) }), spec, 3).map(
      edgeOf,
    );

    expect(Math.max(...edges)).toBeLessThanOrEqual(spec.size + 1e-9);
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(spec.size * (1 - spec.sizeVary) - 1e-9);
    expect(Math.min(...edges)).toBeLessThan(spec.size * 0.7);
  });

  // The point of cubing the draw: a fine minority filling between full-size crystals, not an
  // even spread that thins the whole bed.
  it('leaves most chunks near full size', () => {
    const spec = { ...CHUNKS, count: 200, sizeVary: 0.6 };
    const edges = chunkMatrices(buildChunkBlueprint(box(), { pool: poolFor(spec) }), spec, 3).map(
      edgeOf,
    );
    const full = edges.filter((e) => e > spec.size * 0.9).length;

    expect(full / edges.length).toBeGreaterThan(0.5);
  });

  it('sinks some chunks into the surface and leaves others proud', () => {
    const spec = { ...CHUNKS, count: 120, proud: 0.1, sink: 0.45 };
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec) });
    const out = chunkMatrices(blueprint, spec, 3).map((m) => standoff(m, blueprint));

    expect(Math.max(...out)).toBeLessThanOrEqual(spec.proud + 1e-6);
    expect(Math.min(...out)).toBeLessThan(spec.proud - spec.sink + 0.05);
    expect(out.some((o) => o < 0)).toBe(true);
  });
});

describe('faceBias', () => {
  it('leaves the split to area alone at 0', () => {
    const spec = { ...CHUNKS, count: 200 };

    expect(capShare({ ...spec, faceBias: 0 })).toBeCloseTo(capShare(spec), 10);
  });

  it('moves chunks off the extrusion band and onto the caps', () => {
    const spec = { ...CHUNKS, count: 200 };
    const plain = capShare(spec);

    expect(capShare({ ...spec, faceBias: 2 })).toBeGreaterThan(plain + 0.05);
    expect(capShare({ ...spec, faceBias: 4 })).toBeGreaterThan(capShare({ ...spec, faceBias: 2 }));
  });
});

describe('bedding', () => {
  /** Widest run of the axis with no chunk on it — the barren rock between two beds. */
  function widestGap(spec: ChunkSpec, axis: 'x' | 'y'): number {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec), bedding: spec.bedding });
    const at = chunkMatrices(blueprint, spec, 3)
      .map((m) => new THREE.Vector3().setFromMatrixPosition(m)[axis])
      .sort((l, r) => l - r);
    let widest = 0;
    for (let i = 1; i < at.length; i++) {
      widest = Math.max(widest, (at[i] as number) - (at[i - 1] as number));
    }
    return widest;
  }

  const BEDDED: ChunkSpec = {
    ...CHUNKS,
    count: 200,
    bedding: { angle: 0, spacing: 0.5, thickness: 0.08, scatter: 0 },
  };

  it('leaves barren rock between the beds', () => {
    expect(widestGap(BEDDED, 'y')).toBeGreaterThan(0.2);
    expect(widestGap({ ...BEDDED, bedding: undefined }, 'y')).toBeLessThan(0.1);
  });

  it('turns the beds with the angle', () => {
    const turned = { ...BEDDED, bedding: { ...BEDDED.bedding, angle: 90 } as BeddingSpec };

    expect(widestGap(turned, 'x')).toBeGreaterThan(0.2);
    expect(widestGap(turned, 'y')).toBeLessThan(0.1);
  });

  it('fills the barren rock as scatter rises', () => {
    const seeded = { ...BEDDED, bedding: { ...BEDDED.bedding, scatter: 0.6 } as BeddingSpec };

    expect(widestGap(seeded, 'y')).toBeLessThan(widestGap(BEDDED, 'y') / 2);
  });

  // Two letters of one char share a pool when the chunks are scattered, and must not when they
  // are bedded: the bed a glyph shows depends on where the glyph sits in the word.
  it('moves the beds with the glyph origin', () => {
    const options = { pool: poolFor(BEDDED), bedding: BEDDED.bedding };
    const here = buildChunkBlueprint(box(), options);
    const along = buildChunkBlueprint(box(), { ...options, originY: 0.25 });

    expect(Array.from(along.position)).not.toEqual(Array.from(here.position));
  });
});

describe('lie', () => {
  const spec: ChunkSpec = { ...CHUNKS, shape: 'flake', count: 40, proud: 0 };

  it('lays every chunk flat on the surface at 1', () => {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec) });
    const matrices = chunkMatrices(blueprint, { ...spec, lie: 1 }, 3);

    const worst = Math.max(...matrices.map((m) => tilt(m, blueprint)));
    expect(worst).toBeLessThan(1e-6);
  });

  it('leaves a chunk tumbling at 0', () => {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec) });
    const matrices = chunkMatrices(blueprint, { ...spec, lie: 0 }, 3);

    // A free tumble sits about a radian off the surface; near zero would mean `lie` leaked.
    const mean = matrices.reduce((sum, m) => sum + tilt(m, blueprint), 0) / matrices.length;
    expect(mean).toBeGreaterThan(0.5);
  });

  it('places a chunk exactly as an omitted lie does at 0', () => {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec) });
    const off = chunkMatrices(blueprint, spec, 3);
    const zero = chunkMatrices(blueprint, { ...spec, lie: 0 }, 3);

    expect(zero.map((m) => m.elements.join())).toEqual(off.map((m) => m.elements.join()));
  });

  it('turns a chunk the short way, so a partial lie never tilts it further off', () => {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec) });
    const free = chunkMatrices(blueprint, { ...spec, lie: 0 }, 3);
    const half = chunkMatrices(blueprint, { ...spec, lie: 0.5 }, 3);

    // Reaching for the far side of the surface would spin a nearly-flipped chunk most of a turn to
    // reach a plane it was already in, which reads as a chunk standing up on the way to lying down.
    for (let i = 0; i < half.length; i++) {
      expect(tilt(half[i] as THREE.Matrix4, blueprint)).toBeLessThanOrEqual(
        tilt(free[i] as THREE.Matrix4, blueprint) + 1e-9,
      );
    }
  });

  it('spins a chunk freely about the normal even when it lies flat', () => {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec) });
    const matrices = chunkMatrices(blueprint, { ...spec, lie: 1 }, 3);

    // Every chunk on one cap shares a normal, so a pinned spin would make them all identical.
    const onCap = matrices.filter(
      (m) => new THREE.Vector3().setFromMatrixPosition(m).z > 0.15 - 1e-3,
    );
    const spins = new Set(onCap.map((m) => quaternionOf(m).x.toFixed(6)));
    expect(spins.size).toBeGreaterThan(1);
  });
});

describe('bedding pitch', () => {
  const spec: ChunkSpec = { ...CHUNKS, shape: 'disc', count: 120, proud: 0, lie: 1, faceBias: 8 };
  const bed: BeddingSpec = { angle: 12, spacing: 0.12, thickness: 0.12, scatter: 1 };

  it('holds chunks apart on a cap, where free placement lets them touch', () => {
    const free = capSpacings(spec, bed);
    const laid = capSpacings(spec, { ...bed, pitch: 0.12 });

    // The tightest pair is the whole point: a random field always has one almost coincident.
    expect(free[0] as number).toBeLessThan(0.02);
    expect(laid[0] as number).toBeGreaterThan(free[0] as number);
  });

  it('leaves placement alone when no pitch is asked for', () => {
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec), bedding: bed });
    const pitched = buildChunkBlueprint(box(), {
      pool: poolFor(spec),
      bedding: { ...bed, pitch: undefined },
    });

    expect(Array.from(pitched.position)).toEqual(Array.from(blueprint.position));
  });

  it('keeps every chunk on the surface it was sampled from', () => {
    const blueprint = buildChunkBlueprint(box(), {
      pool: poolFor(spec),
      bedding: { ...bed, pitch: 0.12 },
    });

    // Rejecting rather than snapping is what guarantees this: the box is 1 x 1 x 0.3, so anything
    // outside it is a point the lattice moved off the letter.
    for (let i = 0; i < blueprint.position.length / 3; i++) {
      expect(Math.abs(blueprint.position[i * 3] as number)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(blueprint.position[i * 3 + 1] as number)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(blueprint.position[i * 3 + 2] as number)).toBeLessThanOrEqual(0.15 + 1e-6);
    }
  });

  it('leaves the extrusion band free, where a word-space lattice has no meaning', () => {
    const bedding: BeddingSpec = { ...bed, pitch: 0.12, jitter: 0.25 };
    const blueprint = buildChunkBlueprint(box(), { pool: poolFor(spec), bedding });

    // Worked out here rather than read from the source, so this measures the field and not the
    // implementation that produced it.
    const radians = (bedding.angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const pitch = bedding.pitch as number;
    const stray = (bedding.jitter as number) * pitch;
    const sits = (x: number, y: number) => {
      const along = x * cos + y * sin;
      const across = y * cos - x * sin;
      const row = Math.round(across / bedding.spacing);
      const offset = row % 2 === 0 ? 0 : pitch / 2;
      return (
        Math.hypot(
          along - offset - Math.round((along - offset) / pitch) * pitch,
          across - row * bedding.spacing,
        ) <= stray
      );
    };

    let band = 0;
    let onSites = 0;
    let caps = 0;
    let capsOnSites = 0;
    for (let i = 0; i < blueprint.position.length / 3; i++) {
      const x = blueprint.position[i * 3] as number;
      const y = blueprint.position[i * 3 + 1] as number;
      const z = blueprint.position[i * 3 + 2] as number;
      if (Math.abs(z) > 0.15 - 1e-3) {
        caps++;
        if (sits(x, y)) capsOnSites++;
      } else {
        band++;
        if (sits(x, y)) onSites++;
      }
    }

    // The caps are held to the lattice; the band is not, so its points land on a site only at the
    // rate the site discs cover the plane -- about a fifth here.
    expect(capsOnSites / caps).toBeGreaterThan(0.9);
    expect(band).toBeGreaterThan(20);
    expect(onSites / band).toBeLessThan(0.45);
  });
});

describe('poolFor', () => {
  it('holds the shared pool for a sparse look', () => {
    expect(poolFor({ ...CHUNKS, count: 90 })).toBe(512);
  });

  it('grows the pool with a dense one, so chunks still have room to scatter', () => {
    expect(poolFor({ ...CHUNKS, count: 700 })).toBeGreaterThanOrEqual(700 * 4);
  });
});

/**
 * Pins `sequin`'s placement so a change to the shared chunk machinery cannot move it unnoticed.
 * The pool scales with `count`, so this moves whenever `sequin`'s own count crosses a pool step —
 * which is a real change to the look, not drift, and the pin is re-recorded deliberately.
 */
describe('sequin', () => {
  it('draws the chunks it was pinned at', () => {
    const spec = specOf('sequin').decoration as ChunkSpec;
    const blueprint = buildChunkBlueprint(box());
    let hash = 0x811c9dc5;
    const view = new DataView(new ArrayBuffer(8));
    for (let letter = 0; letter < 6; letter++) {
      for (const m of chunkMatrices(blueprint, spec, letter)) {
        for (const value of m.elements) {
          view.setFloat64(0, value);
          hash = Math.imul(hash ^ view.getUint32(0), 0x01000193);
          hash = Math.imul(hash ^ view.getUint32(4), 0x01000193);
        }
      }
    }

    expect(hash >>> 0).toBe(1879882926);
  });
});

describe('chunkGeometry', () => {
  it('draws a disc round rather than square', () => {
    const disc = chunkGeometry('disc');
    const at = disc.getAttribute('position');
    const radii = new Set<string>();
    for (let i = 0; i < at.count; i++) {
      const r = Math.hypot(at.getX(i), at.getY(i));
      if (r > 1e-6) radii.add(r.toFixed(6));
    }

    // A quad's corners sit further out than its edge midpoints; every point on a rim shares one radius.
    expect(radii.size).toBe(1);
    expect(Number([...radii][0])).toBeCloseTo(0.5, 6);
  });

  it('spans the same edge a flake does, so size means one thing across shapes', () => {
    const disc = chunkGeometry('disc');
    const flake = chunkGeometry('flake');
    disc.computeBoundingBox();
    flake.computeBoundingBox();

    expect(disc.boundingBox?.max.x).toBeCloseTo(flake.boundingBox?.max.x as number, 6);
    expect(disc.boundingBox?.max.y).toBeCloseTo(flake.boundingBox?.max.y as number, 6);
  });
});

describe('chunkGeometrySide', () => {
  it('renders a flake from both sides', () => {
    expect(chunkGeometrySide('flake')).toBe(THREE.DoubleSide);
  });

  it('leaves a closed cube front-sided', () => {
    expect(chunkGeometrySide('cube')).toBe(THREE.FrontSide);
  });
});
