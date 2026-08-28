import {
  type Corner,
  cornersByBend,
  junctionRadius,
  minBendRadius,
  STYLE_FACTOR,
  type VertexBend,
  vertexBends,
} from '@core/render/tube/bend.js';
import {
  type GeneratedPath,
  generatePaths,
  type PathSource,
} from '@core/render/tube/generators.js';
import { buildTubeBlueprint, type Run } from '@core/render/tube/index.js';
import type { Rejoin } from '@core/render/tube/runs.js';
import { surfacesOf } from '@core/render/tube/surfaces.js';
import { tightestBend } from '@core/render/tube/sweep.js';
import type { LoadedFont } from '@core/text/font.js';
import { glyphToShapes } from '@core/text/glyphs.js';
import * as THREE from 'three';
import { type TubeLook, tubeSpecOf } from './spec.js';

export interface SceneRequest {
  letter: string;
  look: TubeLook;
  source: PathSource;
  corner: number;
  rejoin: Rejoin;
}

export interface Measure {
  label: string;
  value: string;
  /** Set where the value fails the invariant it is measured against. */
  bad?: boolean;
}

export interface CarriedRun {
  points: THREE.Vector3[];
  /** Index-parallel to `points`: true where the corner stage built the vertex rather than extracting it. */
  authored: boolean[];
  /** Tightest bend the run ships at, in tube radii. */
  shipped: number;
  /** Which side of the corner this run reaches it from. */
  side: 'before' | 'after' | 'both';
}

export interface CornerMark {
  /** Position in the glyph's own 1 em space. */
  at: THREE.Vector3;
  /** 1-based, matching the `corner` config. */
  ordinal: number;
  /** True where the cut split this corner into two runs. */
  split: boolean;
}

export interface OutlinePath {
  points: THREE.Vector3[];
  closed: boolean;
}

/** The glyph's extent in its own 1 em space. */
export interface GlyphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CornerScene {
  contour: THREE.Vector3[];
  /** Every front path of the glyph — more than one where the letter has counters. */
  outline: OutlinePath[];
  bounds: GlyphBounds;
  /** Every hard corner, in the order the `corner` config numbers them. */
  corners: CornerMark[];
  /** The run or runs the tube builds through this corner — two where the cut split it. */
  carried: CarriedRun[];
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
  const found: {
    path: GeneratedPath;
    pathIndex: number;
    corner: Corner;
    bends: Map<number, VertexBend>;
  }[] = [];
  const fronts: GeneratedPath[] = [];
  paths.forEach((path, pathIndex) => {
    if (path.surface !== 'front') return;
    fronts.push(path);
    const bends = new Map(vertexBends(path.points, path.closed).map((b) => [b.index, b]));
    for (const corner of cornersByBend(path.points, path.closed, rhoMin, radius * STYLE_FACTOR)) {
      if (corner.hard) found.push({ path, pathIndex, corner, bends });
    }
  });
  return { found, fronts, spec, radius, rhoMin };
}

function boundsOf(outline: OutlinePath[]): GlyphBounds {
  const bounds: GlyphBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const { points } of outline) {
    for (const p of points) {
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  }
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bounds;
}

const at = (pts: THREE.Vector3[], i: number) =>
  pts[((i % pts.length) + pts.length) % pts.length] as THREE.Vector3;

/** Samples to search either side of a corner. Measured worst case is 13; a step is one `spacing`. */
const SEARCH_SPAN = 16;

/**
 * The run carrying the nearest contour vertex to the corner in one direction. A hard corner's own
 * vertex is never carried — the cut deletes or replaces it — so the search starts one step out.
 */
function carrierNear(
  runs: readonly Run[],
  pathIndex: number,
  index: number,
  count: number,
  step: -1 | 1,
): Run | null {
  for (let out = 1; out <= SEARCH_SPAN; out++) {
    const v = (((index + step * out) % count) + count) % count;
    const run = runs.find((r) => r.from.some((s) => s?.path === pathIndex && s.index === v));
    if (run) return run;
  }
  return null;
}

/** The runs reaching a corner from either side, and whether the cut left it two of them. */
function carriersAt(runs: readonly Run[], pathIndex: number, index: number, count: number) {
  const before = carrierNear(runs, pathIndex, index, count, -1);
  const after = carrierNear(runs, pathIndex, index, count, 1);
  return { before, after, split: before !== null && after !== null && before !== after };
}

function carriedRun(run: Run, side: CarriedRun['side'], radius: number): CarriedRun {
  return {
    points: run.points.map((p) => p.clone()),
    authored: run.from.map((source) => source === null),
    shipped: tightestBend(run) / radius,
    side,
  };
}

export function buildScene(font: LoadedFont, req: SceneRequest): CornerScene {
  const { found, fronts, spec, radius, rhoMin } = hardCorners(font, req);
  const outline = fronts.map((path) => ({ points: path.points, closed: path.closed }));
  const bounds = boundsOf(outline);
  const pick = found.length
    ? (found[Math.min(req.corner, found.length - 1)] as (typeof found)[number])
    : null;
  const spacing = spec.spacing ?? 0.02;

  if (!pick) {
    return {
      contour: [],
      outline,
      bounds,
      corners: [],
      carried: [],
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

  const { path, pathIndex, corner, bends } = pick;
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

  const blueprint = buildTubeBlueprint(
    glyphToShapes(font.font, req.letter, 1),
    { ...spec, pathSource: req.source, rejoin: req.rejoin },
    PAD,
    0,
  );
  const corners: CornerMark[] = found.map((f, i) => ({
    at: at(f.path.points, f.corner.index).clone(),
    ordinal: i + 1,
    split: carriersAt(blueprint.runs, f.pathIndex, f.corner.index, f.path.points.length).split,
  }));

  const { before, after } = carriersAt(blueprint.runs, pathIndex, corner.index, points.length);
  const carried: CarriedRun[] = [];
  if (before && before === after) carried.push(carriedRun(before, 'both', radius));
  else {
    if (before) carried.push(carriedRun(before, 'before', radius));
    if (after) carried.push(carriedRun(after, 'after', radius));
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
    ...carried.map((run) => ({
      label: run.side === 'both' ? 'run ships at' : `run ${run.side} ships at`,
      value: `${run.shipped.toFixed(2)}r`,
      bad: run.shipped < (rhoMin / radius) * (1 - 1e-6),
    })),
    {
      label: 'carried by',
      value:
        carried.length === 0
          ? 'no run reaches it'
          : carried.length === 1
            ? 'one run'
            : 'two runs — the cut split here',
    },
  ];

  // The junction the built runs actually carry: the widest step between authored and leg geometry.
  let junctionStep = 0;
  let junctionRho = Number.POSITIVE_INFINITY;
  for (const { points: built, authored } of carried) {
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

  const drawn: THREE.Vector3[] | null = null;

  return {
    contour: points,
    outline,
    bounds,
    corners,
    carried,
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
