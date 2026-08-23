import {
  biarcBlend,
  cornersByBend,
  junctionRadius,
  minBendRadius,
  STYLE_FACTOR,
  vertexBends,
} from '@core/render/tube/bend.js';
import { generatePaths, type PathSource } from '@core/render/tube/generators.js';
import { buildTubeBlueprint } from '@core/render/tube/index.js';
import { minCurvatureRadius3 } from '@core/render/tube/resample.js';
import { surfacesOf } from '@core/render/tube/surfaces.js';
import { tightestBend } from '@core/render/tube/sweep.js';
import type { LoadedFont } from '@core/text/font.js';
import { glyphToShapes } from '@core/text/glyphs.js';
import * as THREE from 'three';
import { type TubeLook, tubeSpecOf } from './spec.js';

export const REPAIRS = ['built', 'merge', 'relax', 'biarc', 'cut'] as const;
export type Repair = (typeof REPAIRS)[number];

export interface SceneRequest {
  letter: string;
  look: TubeLook;
  source: PathSource;
  corner: number;
  repair: Repair;
}

export interface Measure {
  label: string;
  value: string;
  /** Set where the value fails the invariant it is measured against. */
  bad?: boolean;
}

export interface CornerScene {
  contour: THREE.Vector3[];
  /** The run the tube actually builds through this corner, and which of its points are authored. */
  built: THREE.Vector3[];
  authored: boolean[];
  /** The stretch a repair replaces, and what the chosen repair draws in its place. */
  replaced: THREE.Vector3[];
  drawn: THREE.Vector3[] | null;
  centre: THREE.Vector3;
  rhoMin: number;
  radius: number;
  cornerCount: number;
  measures: Measure[];
  /** Radius at each vertex around the corner, in tube radii, `at` counted from the corner. */
  profile: { at: number; rho: number }[];
}

const PAD = 0.3;

/** Every hard corner of a letter's front paths, in a stable order. */
function hardCorners(font: LoadedFont, req: SceneRequest) {
  const spec = tubeSpecOf(req.look);
  const radius = spec.radius ?? 0.022;
  const rhoMin = minBendRadius(radius, spec.bend);
  const paths = generatePaths(
    surfacesOf(glyphToShapes(font.font, req.letter, 1), PAD),
    spec.surfaces ?? ['front'],
    {
      level: spec.level ?? 0,
      spacing: spec.spacing ?? 0.02,
      wallDepth: 0.5,
      resolution: 256,
      pad: 0.35,
      source: req.source,
    },
  );
  const found = [];
  for (const path of paths) {
    if (path.surface !== 'front') continue;
    const bends = new Map(vertexBends(path.points, path.closed).map((b) => [b.index, b]));
    for (const corner of cornersByBend(path.points, path.closed, rhoMin, radius * STYLE_FACTOR)) {
      if (corner.hard) found.push({ path, corner, bends });
    }
  }
  return { found, spec, radius, rhoMin };
}

const at = (pts: THREE.Vector3[], i: number) =>
  pts[((i % pts.length) + pts.length) % pts.length] as THREE.Vector3;

/** A blend across the corner, reaching outward for room until one clears the floor. */
function blendAcross(
  points: THREE.Vector3[],
  lo: number,
  hi: number,
  rhoMin: number,
  spacing: number,
) {
  for (let out = 0; out <= 8; out++) {
    const i = lo - 1 - out;
    const j = hi + 1 + out;
    const p0 = at(points, i);
    const p1 = at(points, j);
    const t0 = p0.clone().sub(at(points, i - 1));
    const t1 = at(points, j + 1)
      .clone()
      .sub(p1);
    const drawn = biarcBlend(p0, t0, p1, t1, rhoMin, spacing);
    if (drawn) return { drawn, i, j, out };
  }
  return null;
}

/**
 * Pushes each vertex under the floor away from its own centre of curvature until it clears, which
 * keeps the glyph's path where a replacement leaves it. Only useful where the corner is barely
 * under: a spike at a quarter of the floor would have to move most of a tube radius.
 */
function relaxAcross(points: THREE.Vector3[], lo: number, hi: number, rhoMin: number) {
  const span: THREE.Vector3[] = [];
  for (let k = lo - 6; k <= hi + 6; k++) span.push(at(points, k).clone());
  const step = rhoMin * 0.004;
  let moved = 0;
  for (let pass = 0; pass < 400; pass++) {
    let worstAt = -1;
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 1; i + 1 < span.length; i++) {
      const rho = minCurvatureRadius3(
        [span[i - 1], span[i], span[i + 1]].map((p) => ({
          x: (p as THREE.Vector3).x,
          y: (p as THREE.Vector3).y,
          z: (p as THREE.Vector3).z,
        })),
      );
      if (rho < worst) {
        worst = rho;
        worstAt = i;
      }
    }
    if (worst >= rhoMin || worstAt < 0) break;
    const prev = span[worstAt - 1] as THREE.Vector3;
    const cur = span[worstAt] as THREE.Vector3;
    const next = span[worstAt + 1] as THREE.Vector3;
    // Away from the arc through the triple: the bisector of the two legs, pointing outward.
    const away = cur.clone().sub(prev.clone().add(next).multiplyScalar(0.5)).setZ(0);
    if (away.lengthSq() < 1e-18) break;
    cur.addScaledVector(away.normalize(), step);
    moved += step;
  }
  return { span, moved };
}

export function buildScene(font: LoadedFont, req: SceneRequest): CornerScene {
  const { found, spec, radius, rhoMin } = hardCorners(font, req);
  const pick = found.length
    ? (found[Math.min(req.corner, found.length - 1)] as (typeof found)[number])
    : null;
  const spacing = spec.spacing ?? 0.02;

  if (!pick) {
    return {
      contour: [],
      built: [],
      authored: [],
      replaced: [],
      drawn: null,
      centre: new THREE.Vector3(),
      rhoMin,
      radius,
      cornerCount: 0,
      measures: [{ label: 'hard corners', value: 'none' }],
      profile: [],
    };
  }

  const { path, corner, bends } = pick;
  const points = path.points;
  const lo = corner.index - corner.groupBefore;
  const hi = corner.index + corner.groupAfter;
  const centre = at(points, corner.index).clone();

  const profile: { at: number; rho: number }[] = [];
  for (let k = -8; k <= 8; k++) {
    const i = (((corner.index + k) % points.length) + points.length) % points.length;
    profile.push({ at: k, rho: (bends.get(i)?.rho ?? Number.POSITIVE_INFINITY) / radius });
  }

  const replaced: THREE.Vector3[] = [];
  for (let k = lo - 1; k <= hi + 1; k++) replaced.push(at(points, k));

  // What the tube actually builds here, found by proximity rather than by index: the corner stage
  // rewrites the path, so no index survives it.
  const blueprint = buildTubeBlueprint(
    glyphToShapes(font.font, req.letter, 1),
    { ...spec, amplitude: 0, pathSource: req.source },
    PAD,
    0,
  );
  let built: THREE.Vector3[] = [];
  let authored: boolean[] = [];
  let shipped = Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const run of blueprint.runs) {
    for (const p of run.points) {
      const d = p.distanceTo(centre);
      if (d < nearest) {
        nearest = d;
        built = run.points.map((q) => q.clone());
        authored = run.from.map((source) => source === null);
        shipped = tightestBend(run) / radius;
      }
    }
  }
  blueprint.dispose();

  const measures: Measure[] = [
    { label: 'corner', value: `${req.corner + 1} of ${found.length}` },
    {
      label: 'glyph bends at',
      value: `${(corner.rho / radius).toFixed(2)}r`,
      bad: corner.rho < rhoMin * (1 - 1e-6),
    },
    {
      label: 'margin under floor',
      value: `${(((rhoMin - corner.rho) / rhoMin) * 100).toFixed(1)}%`,
    },
    { label: 'stretch', value: `${hi - lo + 1} vertices` },
    {
      label: 'run ships at',
      value: `${shipped.toFixed(2)}r`,
      bad: shipped < (rhoMin / radius) * (1 - 1e-6),
    },
  ];

  // The junction the built run actually carries: the widest step between authored and leg geometry.
  let junctionStep = 0;
  let junctionRho = Number.POSITIVE_INFINITY;
  for (let i = 1; i + 1 < built.length; i++) {
    if (authored[i] === authored[i - 1]) continue;
    const step = (built[i] as THREE.Vector3).distanceTo(built[i - 1] as THREE.Vector3);
    junctionStep = Math.max(junctionStep, step / spacing);
    junctionRho = Math.min(
      junctionRho,
      junctionRadius(
        built[i - 1] as THREE.Vector3,
        built[i] as THREE.Vector3,
        built[i + 1] as THREE.Vector3,
      ),
    );
  }
  if (junctionStep > 0) {
    measures.push({
      label: 'junction chord',
      value: `${junctionStep.toFixed(1)}x spacing`,
      bad: junctionStep > 1.5,
    });
    measures.push({
      label: 'junction radius',
      value: Number.isFinite(junctionRho) ? `${(junctionRho / radius).toFixed(2)}r` : 'straight',
      bad: junctionRho < rhoMin * 0.5,
    });
  }

  let drawn: THREE.Vector3[] | null = null;
  if (req.repair === 'biarc') {
    const blend = blendAcross(points, lo, hi, rhoMin, spacing);
    if (blend) {
      drawn = blend.drawn;
      const rho = minCurvatureRadius3(blend.drawn.map((p) => ({ x: p.x, y: p.y, z: p.z })));
      measures.push({
        label: 'blend bends at',
        value: `${(rho / radius).toFixed(2)}r`,
        bad: rho < rhoMin,
      });
      measures.push({ label: 'blend replaces', value: `${blend.j - blend.i} vertices` });
    } else {
      measures.push({ label: 'blend', value: 'none clears the floor', bad: true });
    }
  }
  if (req.repair === 'relax') {
    const { span, moved } = relaxAcross(points, lo, hi, rhoMin);
    drawn = span;
    const rho = minCurvatureRadius3(span.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    measures.push({
      label: 'relaxed to',
      value: `${(rho / radius).toFixed(2)}r`,
      bad: rho < rhoMin,
    });
    measures.push({ label: 'moved', value: `${(moved / radius).toFixed(2)}r of tube radius` });
  }
  if (req.repair === 'merge') {
    // Draw nothing over the corner: the two spans stay one path. Where the ends are near collinear
    // there is no corner to replace, and what the tube would carry is the glyph's own bend.
    const span: THREE.Vector3[] = [];
    for (let k = lo - 6; k <= hi + 6; k++) span.push(at(points, k));
    drawn = span;
    const rho = minCurvatureRadius3(span.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    const ends = at(points, lo - 1)
      .clone()
      .sub(at(points, lo - 2))
      .normalize();
    const out = at(points, hi + 2)
      .clone()
      .sub(at(points, hi + 1))
      .normalize();
    measures.push({
      label: 'merged bends at',
      value: `${(rho / radius).toFixed(2)}r`,
      bad: rho < rhoMin,
    });
    measures.push({
      label: 'ends differ by',
      value: `${((ends.angleTo(out) * 180) / Math.PI).toFixed(0)} deg`,
    });
  }
  if (req.repair === 'cut') {
    drawn = replaced;
    measures.push({ label: 'cut removes', value: `${replaced.length} vertices` });
  }

  return {
    contour: points,
    built,
    authored,
    replaced,
    drawn,
    centre,
    rhoMin,
    radius,
    cornerCount: found.length,
    measures,
    profile,
  };
}
