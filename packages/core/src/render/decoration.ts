import * as THREE from 'three';
import { rng } from '../rng.js';
import type { LookSpec } from './looks.js';
import type { TubeBlueprint, TubeSpec } from './tube/index.js';

/** A decoration's own material, in the same plain numbers a look takes. */
export type MaterialSpec = Omit<LookSpec, 'decoration' | 'bloom'> & {
  /**
   * Limb brightening on a tube, 0..1: how much of the emissive moves off the tube's face, where a
   * line of sight crosses least glowing gas, out to its silhouette, where it crosses most. The
   * width still averages to the look's own emissive. Absent or 0 renders exactly as before, and
   * only an emissive decoration has one — a solid cord has no depth to see through.
   */
  rim?: number;
};

export type { CornerStrategy, CornerWeights, TubeBlueprint, TubeSpec } from './tube/index.js';
export { ALL_BREAK, ALL_CONNECT, buildTubeBlueprint } from './tube/index.js';

/**
 * Ore does not sit evenly in rock. It runs in beds: bands of dense crystal separated by barren
 * matrix, dipping across the letter rather than lying square to it. Omit for an even scatter.
 */
export interface BeddingSpec {
  /** Angle of the beds from horizontal, in degrees. */
  angle: number;
  /** Distance from one bed to the next, in em. */
  spacing: number;
  /** Width of the ore band across a bed, in em. Beds vary either side of it. */
  thickness: number;
  /** How much ore lies in the barren rock between beds, 0..1. */
  scatter: number;
  /**
   * Distance from one chunk to the next along a bed, in em. Omit to place chunks freely along it.
   * Alternate beds are offset by half of this, so the rows stagger the way sewn rows do.
   */
  pitch?: number;
  /**
   * How far a chunk strays from its site, as a fraction of `pitch`. Small values reject most of what
   * sampling draws and degrade toward free placement; 0.25 is a field that reads regular but not
   * printed.
   */
  jitter?: number;
}

export interface ChunkSpec {
  kind: 'chunks';
  /** Chunks per letter. */
  count: number;
  /** Chunk edge, in em. */
  size: number;
  shape: 'flake' | 'cube' | 'disc';
  /** 0 free tumble, 1 one shared lattice per letter. */
  align: number;
  /**
   * How flat a chunk lies on the surface it sits on, 0..1. 1 puts its face in the surface's own
   * plane, which `align` cannot do — that shares one orientation across a whole letter. Spin about
   * the normal is left as the tumble drew it.
   */
  lie?: number;
  /** 0 even scatter, 1 tight intergrown clumps. */
  cluster: number;
  /** How far a chunk sits proud of the surface, 0..1. */
  proud: number;
  /** How far below `proud` a chunk may sink, in chunk edges. 0 gives every chunk one stand-off. */
  sink?: number;
  /** How far below `size` a chunk may shrink, 0..1. 0 gives every chunk one size. */
  sizeVary?: number;
  /** How hard sampling favours the caps over the extrusion band. 0 is pure area weighting. */
  faceBias?: number;
  /** Bands the chunks run in. Omit to scatter them evenly over the surface. */
  bedding?: BeddingSpec;
  /**
   * How much the surface a chunk sits on darkens it, 0..1. The studio is an environment map and
   * nothing else, so a chunk on the extrusion wall reflects as much as one on the front cap and
   * the letter has no shading to carry its form. Zero is that, and the default; 1 takes a chunk
   * facing away from the key down to black. See `chunkShade`.
   */
  relief?: number;
  look: MaterialSpec;
}

export interface WellSpec {
  kind: 'well';
  /** Which registered cutter places the wells. A second cutter makes this a discriminant. */
  cutter: 'lattice' | 'pave';
  /**
   * How far in from every contour a well stays, in em. Also caps the slab's bevel, because the
   * slab's front face is every well's floor and a bevelled cap ramps across its own bevel width.
   */
  bezel: number;
  /** How deep a well is — the plate's thickness — in em. */
  floor: number;
  /** Lattice pitch, in em. */
  pitch: number;
  /** A well's full diagonal, in em. */
  size: number;
  /**
   * The bead around a well's rim, in em, and how far it falls. Separate from the letter's own
   * chamfer, which is the whole reason the body is stitched rather than extruded: one
   * `ExtrudeGeometry` bevels the outer contour and every hole at the same size, and a letter's
   * chamfer folds a pocket this small through itself.
   */
  rimBevel?: number;
  rimDrop?: number;
  /** Radius the reflex corners are rounded to, in em: stroke junctions and inside a counter. */
  round?: number;
  /** Radius the convex corners are rounded to: outer corners, tips, a leg's point. */
  roundOuter?: number;
  look: MaterialSpec;
  /** Which registered fill occupies the wells. Omitted leaves them empty, as the cutter does. */
  fill?: 'stone';
  /**
   * How far down the well's bevel the girdle sits, 0 at the letter's face and 1 below the collar.
   * Not independent of the stone's width — the bevel widens the opening toward the face, so this
   * sets both.
   */
  sink?: number;
  /**
   * Transmission thickness as a fraction of the girdle's width, which is what the stone's colour
   * actually is: a look's own thickness is in world units and tuned for a letter-sized volume.
   */
  tint?: number;
  /** Girdle points. Four fills a diamond seat corner to corner; eight inscribes an octagon in it. */
  facets?: number;
  /** The stone's own look, rather than the plate's. Defaults to `gem`. */
  stone?: MaterialSpec;
}

export interface ChunkBlueprint {
  kind: 'chunks';
  position: Float32Array;
  normal: Float32Array;
  dispose(): void;
}

export type DecorationSpec = TubeSpec | ChunkSpec | WellSpec;
export type Blueprint = TubeBlueprint | ChunkBlueprint;

/** How many surface samples a char shares. Letters draw their own chunks from this pool. */
const POOL = 512;
/** Fixed, so a char's pool is identical across words and across runs. */
const POOL_SEED = 0x5eed;
/** How wide a clustered draw reaches around its anchor, in pool samples. */
const CLUSTER_NEIGHBOURS = 12;
/** Pool samples per chunk. Below about 4 a dense look draws most of the pool and stops scattering. */
const POOL_PER_CHUNK = 4;
/**
 * Shrinks a chunk toward `1 - sizeVary` of its nominal edge. Cubing the draw keeps most chunks at
 * full size and sends a minority small, which fills between crystals instead of thinning the bed —
 * an even spread, or the same law inverted, costs enough coverage to read as a sprinkle again.
 */
const SIZE_POWER = 3;

/**
 * How squarely a triangle must face the viewer to count as a cap rather than extrusion band. The
 * two are near 1 and near 0; the bevel between them is the only thing this has to cut.
 */
const CAP_FACING = 0.5;

/**
 * Where the studio's light comes from, as the shading sees it. Up, a little to the left and a
 * little toward the viewer: the two brightest bars in `environment.ts` sit overhead and above-left,
 * and a term that disagreed with them would read as a second light nobody lit.
 */
const KEY = new THREE.Vector3(-0.25, 0.85, 0.45).normalize();

/**
 * What a chunk's own surface normal does to its brightness. A cosine off the key, mixed in by
 * `relief` — so 0 leaves every chunk at 1 and cannot move a look that never asked, and the darkest
 * a chunk can go is `1 - relief` rather than black by accident.
 */
export function chunkShade(normal: THREE.Vector3, relief: number): number {
  if (!(relief > 0)) return 1;
  const lambert = Math.max(0, normal.dot(KEY));
  return 1 - Math.min(relief, 1) * (1 - lambert);
}

/** How far a bed strays from a straight line, in bed spacings. */
const BED_WANDER = 0.14;
/**
 * Draws before a sample is taken wherever it landed, so a bedding that rejects nearly everything
 * still terminates. High enough that a `scatter` of 0 really does leave the rock between beds
 * bare: at 24, one sample in twelve exhausted its draws and settled in barren rock.
 */
const BED_ATTEMPTS = 64;

/** Repeatable per-bed variation, so beds differ in thickness rather than reading as a ruled grid. */
function bedHash(bed: number): number {
  const x = Math.sin(bed * 127.1 + 11.3) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * How much ore a point carries, 0..1 — 1 at the middle of a bed, `scatter` in the barren rock
 * between. Measured in the letter's own em space.
 */
/** Default stray, as a fraction of `pitch`. */
const BED_JITTER = 0.25;

/**
 * Whether a point is close enough to a lattice site to be kept. Rejecting rather than snapping is
 * what keeps a chunk on the surface it was sampled from: a snap of up to half a pitch can carry one
 * over the edge of a letter, and off a glyph is not a place a sequin can be sewn.
 */
function onSite(x: number, y: number, bedding: BeddingSpec): boolean {
  const pitch = bedding.pitch ?? 0;
  if (pitch <= 0) return true;
  const radians = (bedding.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const along = x * cos + y * sin;
  const across = y * cos - x * sin;
  const row = Math.round(across / bedding.spacing);
  const offset = row % 2 === 0 ? 0 : pitch / 2;
  const dAcross = across - row * bedding.spacing;
  const dAlong = along - offset - Math.round((along - offset) / pitch) * pitch;
  const stray = (bedding.jitter ?? BED_JITTER) * pitch;
  return Math.hypot(dAlong, dAcross) <= stray;
}

function oreAt(x: number, y: number, bedding: BeddingSpec): number {
  const radians = (bedding.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const along = (x * cos + y * sin) / bedding.spacing;
  let across = (y * cos - x * sin) / bedding.spacing;
  // Beds pinch and wander rather than running dead straight; two frequencies so the wander does
  // not read as one sine wave.
  across += BED_WANDER * (Math.sin(along * 2.3) + 0.6 * Math.sin(along * 5.1 + 1.7));

  const bed = Math.round(across);
  const half = ((bedding.thickness / bedding.spacing) * (0.55 + 0.9 * bedHash(bed))) / 2;
  const distance = Math.abs(across - bed);
  const core = half > 0 ? Math.max(0, 1 - (distance / half) ** 2) : 0;
  return bedding.scatter + (1 - bedding.scatter) * core;
}

/** Distinct positions a spec's chunks are drawn from. Never below POOL, so a sparse look holds still. */
export function poolFor(spec: ChunkSpec): number {
  return Math.max(POOL, spec.count * POOL_PER_CHUNK);
}

export interface ChunkPoolOptions {
  /** Distinct positions to sample. */
  pool?: number;
  /** How hard to favour the caps over the extrusion band. */
  faceBias?: number;
  bedding?: BeddingSpec;
  /** Where this glyph sits in the word, so beds run on across letters rather than restarting. */
  originX?: number;
  originY?: number;
}

export function buildChunkBlueprint(
  geometry: THREE.BufferGeometry,
  { pool = POOL, faceBias = 0, bedding, originX = 0, originY = 0 }: ChunkPoolOptions = {},
): ChunkBlueprint {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const vertexAt = (i: number) => (index ? index.getX(i) : i);
  const triangles = (index ? index.count : positions.count) / 3;

  // Area-weighted, so the bevel band's many small triangles do not out-vote the large faces.
  // Area alone puts 60% of a glyph's chunks on the extrusion band and 13% on the face a reader
  // is looking at, which is why `faceBias` can lift the two caps against the band.
  const cumulative = new Float32Array(triangles);
  const facings = new Float32Array(triangles);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(positions, vertexAt(t * 3));
    b.fromBufferAttribute(positions, vertexAt(t * 3 + 1));
    c.fromBufferAttribute(positions, vertexAt(t * 3 + 2));
    const cross = b.sub(a).cross(c.sub(a));
    const area = cross.length() / 2;
    const facing = area > 0 ? Math.abs(cross.z) / (area * 2) : 0;
    facings[t] = facing;
    total += area * (1 + faceBias * facing);
    cumulative[t] = total;
  }

  const pick = (target: number) => {
    let lo = 0;
    let hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] as number) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const random = rng(POOL_SEED);
  const position = new Float32Array(pool * 3);
  const normal = new Float32Array(pool * 3);
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();

  for (let s = 0; s < pool; s++) {
    let t = 0;
    let u = 0;
    let v = 0;
    let w = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    // Bedding is a rejection on top of the area weighting: draw a point, keep it in proportion to
    // the ore there. Sampling into the beds rather than filtering a built pool afterwards is what
    // lets a dense seam come out of a pool no larger than an even scatter needs.
    for (let attempt = 0; attempt < BED_ATTEMPTS; attempt++) {
      t = pick(random() * total);
      u = random();
      v = random();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      w = 1 - u - v;

      a.fromBufferAttribute(positions, vertexAt(t * 3));
      b.fromBufferAttribute(positions, vertexAt(t * 3 + 1));
      c.fromBufferAttribute(positions, vertexAt(t * 3 + 2));
      x = a.x * w + b.x * u + c.x * v;
      y = a.y * w + b.y * u + c.y * v;
      z = a.z * w + b.z * u + c.z * v;
      if (!bedding) break;
      if (random() >= oreAt(x + originX, y + originY, bedding)) continue;
      // A bed is measured in word space, which is a plane the caps lie in and the extrusion band
      // stands perpendicular to, so a lattice projected onto the band smears along the extrusion.
      // The band keeps free placement along the bed.
      if ((facings[t] as number) < CAP_FACING) break;
      if (onSite(x + originX, y + originY, bedding)) break;
    }

    na.fromBufferAttribute(normals, vertexAt(t * 3));
    nb.fromBufferAttribute(normals, vertexAt(t * 3 + 1));
    nc.fromBufferAttribute(normals, vertexAt(t * 3 + 2));

    position[s * 3] = x;
    position[s * 3 + 1] = y;
    position[s * 3 + 2] = z;
    na.multiplyScalar(w).addScaledVector(nb, u).addScaledVector(nc, v).normalize();
    normal[s * 3] = na.x;
    normal[s * 3 + 1] = na.y;
    normal[s * 3 + 2] = na.z;
  }

  return { kind: 'chunks', position, normal, dispose() {} };
}

function randomQuaternion(random: () => number): THREE.Quaternion {
  // Shoemake's uniform quaternion sampling; Euler angles from three uniform numbers cluster.
  const u1 = random();
  const u2 = random() * Math.PI * 2;
  const u3 = random() * Math.PI * 2;
  const r1 = Math.sqrt(1 - u1);
  const r2 = Math.sqrt(u1);
  return new THREE.Quaternion(
    r1 * Math.sin(u2),
    r1 * Math.cos(u2),
    r2 * Math.sin(u3),
    r2 * Math.cos(u3),
  );
}

/**
 * A uniform grid over the pool, so a clustered draw can look at the samples around its anchor
 * instead of all of them. The linear scan it replaces is O(pool) per chunk, which at the densities
 * `pyrite` wants (900 chunks over a 3600-sample pool) costs a third of a second per word.
 */
interface PoolGrid {
  cell: number;
  min: THREE.Vector3;
  dims: [number, number, number];
  /** First sample in each cell, or -1; `next` chains the rest. */
  heads: Int32Array;
  next: Int32Array;
}

/** About 3 samples a cell: enough that the first ring usually settles the k nearest. */
const GRID_OCCUPANCY = 3;

function buildPoolGrid(position: Float32Array, pool: number): PoolGrid {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < pool; i++) {
    p.set(position[i * 3] as number, position[i * 3 + 1] as number, position[i * 3 + 2] as number);
    min.min(p);
    max.max(p);
  }

  const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1e-6);
  const cell = span / Math.max(1, Math.ceil(Math.cbrt(pool / GRID_OCCUPANCY)));
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil((max.x - min.x) / cell) + 1),
    Math.max(1, Math.ceil((max.y - min.y) / cell) + 1),
    Math.max(1, Math.ceil((max.z - min.z) / cell) + 1),
  ];

  const heads = new Int32Array(dims[0] * dims[1] * dims[2]).fill(-1);
  const next = new Int32Array(pool).fill(-1);
  for (let i = 0; i < pool; i++) {
    const x = Math.min(dims[0] - 1, Math.floor(((position[i * 3] as number) - min.x) / cell));
    const y = Math.min(dims[1] - 1, Math.floor(((position[i * 3 + 1] as number) - min.y) / cell));
    const z = Math.min(dims[2] - 1, Math.floor(((position[i * 3 + 2] as number) - min.z) / cell));
    const c = (z * dims[1] + y) * dims[0] + x;
    next[i] = heads[c] as number;
    heads[c] = i;
  }
  return { cell, min, dims, heads, next };
}

/**
 * The k nearest untaken samples to `at`, nearest first. Rings widen until the box searched is
 * further away on every side than the worst hit kept, which is what makes this the same answer a
 * full scan gives — ordering included, so a look that does not need the grid does not move.
 */
function nearestInGrid(
  grid: PoolGrid,
  position: Float32Array,
  at: THREE.Vector3,
  taken: Set<number>,
  k: number,
): number[] {
  const cx = Math.min(grid.dims[0] - 1, Math.max(0, Math.floor((at.x - grid.min.x) / grid.cell)));
  const cy = Math.min(grid.dims[1] - 1, Math.max(0, Math.floor((at.y - grid.min.y) / grid.cell)));
  const cz = Math.min(grid.dims[2] - 1, Math.max(0, Math.floor((at.z - grid.min.z) / grid.cell)));
  const reach = Math.max(grid.dims[0], grid.dims[1], grid.dims[2]);

  const candidates: number[] = [];
  const near: number[] = [];
  const far: number[] = [];
  const other = new THREE.Vector3();

  for (let ring = 0; ring <= reach; ring++) {
    candidates.length = 0;
    for (let z = cz - ring; z <= cz + ring; z++) {
      if (z < 0 || z >= grid.dims[2]) continue;
      for (let y = cy - ring; y <= cy + ring; y++) {
        if (y < 0 || y >= grid.dims[1]) continue;
        for (let x = cx - ring; x <= cx + ring; x++) {
          if (x < 0 || x >= grid.dims[0]) continue;
          // Only the shell: the inside of the box was collected on an earlier ring.
          const shell =
            ring === 0 ||
            x === cx - ring ||
            x === cx + ring ||
            y === cy - ring ||
            y === cy + ring ||
            z === cz - ring ||
            z === cz + ring;
          if (!shell) continue;
          const c = (z * grid.dims[1] + y) * grid.dims[0] + x;
          for (let i = grid.heads[c] as number; i >= 0; i = grid.next[i] as number) {
            if (!taken.has(i)) candidates.push(i);
          }
        }
      }
    }

    // Ascending, so samples at equal distance keep the order a full scan would have seen them in.
    candidates.sort((l, r) => l - r);
    for (const p of candidates) {
      other.set(
        position[p * 3] as number,
        position[p * 3 + 1] as number,
        position[p * 3 + 2] as number,
      );
      const d = other.distanceToSquared(at);
      let slot = near.length;
      while (slot > 0 && (far[slot - 1] as number) > d) slot--;
      if (slot < k) {
        near.splice(slot, 0, p);
        far.splice(slot, 0, d);
        if (near.length > k) {
          near.pop();
          far.pop();
        }
      }
    }

    if (near.length < k) continue;
    // Nearest point that could still be outside the box searched so far.
    const edge = Math.min(
      at.x - (grid.min.x + (cx - ring) * grid.cell),
      grid.min.x + (cx + ring + 1) * grid.cell - at.x,
      at.y - (grid.min.y + (cy - ring) * grid.cell),
      grid.min.y + (cy + ring + 1) * grid.cell - at.y,
      at.z - (grid.min.z + (cz - ring) * grid.cell),
      grid.min.z + (cz + ring + 1) * grid.cell - at.z,
    );
    if (edge > 0 && edge * edge >= (far[far.length - 1] as number)) break;
  }
  return near;
}

/** A letter's chunk field: where each chunk sits, and what the surface under it does to its light. */
export interface ChunkInstances {
  matrices: THREE.Matrix4[];
  /** One per matrix, in the same order. All 1 unless the look asked for `relief`. */
  shades: Float32Array;
}

export function chunkInstances(
  blueprint: ChunkBlueprint,
  spec: ChunkSpec,
  seed: number,
): ChunkInstances {
  const random = rng(Math.round(seed * 2654435761) ^ POOL_SEED);
  const pool = blueprint.position.length / 3;
  const lattice = randomQuaternion(random);

  const chosen: number[] = [];
  const taken = new Set<number>();
  const sample = new THREE.Vector3();
  const grid = spec.cluster > 0 ? buildPoolGrid(blueprint.position, pool) : null;

  for (let n = 0; n < spec.count; n++) {
    let index = Math.min(pool - 1, Math.floor(random() * pool));
    // Clustering draws near an already-placed chunk instead of anywhere, which is what leaves
    // bare matrix between clumps rather than an even sprinkle. Taking the single nearest sample
    // instead of one of the k nearest collapses the clump: that map is symmetric, so the draw
    // ping-pongs between one pair of samples forever.
    if (grid && chosen.length > 0 && random() < spec.cluster) {
      const anchor = chosen[Math.floor(random() * chosen.length)] as number;
      sample.set(
        blueprint.position[anchor * 3] as number,
        blueprint.position[anchor * 3 + 1] as number,
        blueprint.position[anchor * 3 + 2] as number,
      );
      const near = nearestInGrid(
        grid,
        blueprint.position,
        sample,
        taken,
        Math.min(CLUSTER_NEIGHBOURS, pool),
      );
      index = near[Math.floor(random() * near.length)] ?? index;
    }
    // Probing rather than redrawing: an exhausted pool then degrades to a repeat instead of
    // spinning, and the walk cannot desynchronize the seeded draw sequence.
    for (let probe = 0; taken.has(index) && probe < pool; probe++) index = (index + 1) % pool;
    chosen.push(index);
    taken.add(index);
  }

  const matrices: THREE.Matrix4[] = [];
  const shades = new Float32Array(chosen.length);
  const scale = new THREE.Vector3(spec.size, spec.size, spec.size);
  const sizeVary = spec.sizeVary ?? 0;
  const sink = spec.sink ?? 0;
  const lie = spec.lie ?? 0;
  const face = new THREE.Vector3();
  const onto = new THREE.Vector3();
  const lay = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const flip = new THREE.Quaternion();

  for (const index of chosen) {
    const position = new THREE.Vector3(
      blueprint.position[index * 3] as number,
      blueprint.position[index * 3 + 1] as number,
      blueprint.position[index * 3 + 2] as number,
    );
    const normal = new THREE.Vector3(
      blueprint.normal[index * 3] as number,
      blueprint.normal[index * 3 + 1] as number,
      blueprint.normal[index * 3 + 2] as number,
    );
    // Both draws are skipped when the look asks for neither: an unused knob must not consume a
    // random number, or turning it on for one look reseeds every other look's scatter.
    if (sizeVary > 0) {
      const edge = spec.size * (1 - sizeVary * random() ** SIZE_POWER);
      scale.set(edge, edge, edge);
    }
    const proud = sink > 0 ? spec.proud - sink * random() : spec.proud;
    position.addScaledVector(normal, scale.x * proud);

    const rotation = randomQuaternion(random).slerp(lattice, spec.align);
    if (lie > 0) {
      // Turned by the shortest arc onto the normal rather than built from it, so the chunk keeps
      // the spin the tumble gave it and `lie` costs no random draw of its own.
      face.set(0, 0, 1).applyQuaternion(rotation);
      // Onto the near side of the surface plane, then half a turn about the chunk's own laid axis
      // for one that landed face-down. Aiming `setFromUnitVectors` straight at the far normal is
      // the same orientation and reads simpler, but it hands the function a pair of vectors close
      // to antiparallel, where it keeps only a fraction of its precision — enough that the same
      // build placed chunks differently on macOS and on CI.
      const down = face.dot(normal) < 0;
      onto.copy(normal).multiplyScalar(down ? -1 : 1);
      lay.setFromUnitVectors(face, onto).multiply(rotation);
      if (down) {
        // In the surface plane, since the lay just put the chunk's face on the normal.
        axis.set(1, 0, 0).applyQuaternion(lay);
        flip.set(axis.x, axis.y, axis.z, 0);
        lay.premultiply(flip);
      }
      rotation.slerp(lay, lie);
    }
    shades[matrices.length] = chunkShade(normal, spec.relief ?? 0);
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
  }

  return { matrices, shades };
}

/** Segments around a disc. Twelve reads round at the size a chunk is drawn and costs six triangles. */
const DISC_SEGMENTS = 12;

export function chunkGeometry(shape: ChunkSpec['shape']): THREE.BufferGeometry {
  if (shape === 'cube') return new THREE.BoxGeometry(1, 1, 1);
  if (shape === 'disc') return new THREE.CircleGeometry(0.5, DISC_SEGMENTS);
  return new THREE.PlaneGeometry(1, 1);
}

/**
 * A chunk this flat has been turned far enough onto the outward normal that culling its back cannot
 * take a chunk the viewer should see. Measured on `sequin`: at 0.8 the near cap loses none, at 0.75
 * one in a hundred, and at 0.4 one in eight.
 */
const LIE_FACES_OUT = 0.8;

/**
 * A flake and a disc are each one open face, so culling the back hides exactly the chunks the letter
 * itself already hides — but only once they face outward, which `lie` decides and a shape cannot.
 * Below that, a chunk still tumbling can face inward, and culling would delete it outright.
 */
export function chunkGeometrySide(spec: ChunkSpec): THREE.Side {
  if (spec.shape === 'cube') return THREE.FrontSide;
  return (spec.lie ?? 0) >= LIE_FACES_OUT ? THREE.FrontSide : THREE.DoubleSide;
}
