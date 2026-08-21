import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildChunkBlueprint,
  type ChunkSpec,
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
  const blueprint = buildChunkBlueprint(box(), poolFor(spec), spec.faceBias ?? 0);
  const matrices = chunkMatrices(blueprint, spec, 3);
  let caps = 0;
  for (const m of matrices) {
    const at = new THREE.Vector3().setFromMatrixPosition(m);
    if (Math.abs(at.z) > 0.15 - 1e-3) caps++;
  }
  return caps / matrices.length;
}

/** Rotation only, so two matrices can be compared for shared orientation. */
function quaternionOf(m: THREE.Matrix4): THREE.Quaternion {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return q;
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
    const edges = chunkMatrices(buildChunkBlueprint(box(), poolFor(spec)), spec, 3).map(edgeOf);

    expect(Math.max(...edges)).toBeLessThanOrEqual(spec.size + 1e-9);
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(spec.size * (1 - spec.sizeVary) - 1e-9);
    expect(Math.min(...edges)).toBeLessThan(spec.size * 0.7);
  });

  // The point of cubing the draw: a fine minority filling between full-size crystals, not an
  // even spread that thins the whole bed.
  it('leaves most chunks near full size', () => {
    const spec = { ...CHUNKS, count: 200, sizeVary: 0.6 };
    const edges = chunkMatrices(buildChunkBlueprint(box(), poolFor(spec)), spec, 3).map(edgeOf);
    const full = edges.filter((e) => e > spec.size * 0.9).length;

    expect(full / edges.length).toBeGreaterThan(0.5);
  });

  it('sinks some chunks into the surface and leaves others proud', () => {
    const spec = { ...CHUNKS, count: 120, proud: 0.1, sink: 0.45 };
    const blueprint = buildChunkBlueprint(box(), poolFor(spec));
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

describe('poolFor', () => {
  it('holds the shared pool for a sparse look', () => {
    expect(poolFor({ ...CHUNKS, count: 90 })).toBe(512);
  });

  it('grows the pool with a dense one, so chunks still have room to scatter', () => {
    expect(poolFor({ ...CHUNKS, count: 700 })).toBeGreaterThanOrEqual(700 * 4);
  });
});

/**
 * `sequin` shares this machinery with `pyrite` and has no business moving when `pyrite` is
 * retuned. Recorded before the respec; a change here means a new field stopped defaulting to the
 * behaviour it replaced, or the clustering draw started answering differently.
 */
describe('sequin', () => {
  it('draws the same chunks it always has', () => {
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

    expect(hash >>> 0).toBe(3226201452);
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
