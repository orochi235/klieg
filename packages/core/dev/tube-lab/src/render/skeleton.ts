import * as THREE from 'three';
import type { CornerStrategy } from '../../../../src/render/tube/index.js';
import { buildTubeBlueprint, type TubeSpec } from '../../../../src/render/tube/index.js';
import { surfacesOf } from '../../../../src/render/tube/surfaces.js';
import { smoothedPoints } from '../../../../src/render/tube/sweep.js';
import { type Report, reportOf } from '../report.js';

const CONTOUR = 0x39415a;
const LIT = 0xff2d95;
const DARK = 0xa86a90;
const UNRESOLVED = 0xffb020;
const DROPPED = 0x00e5ff;
const ENDPOINT = 0xe6e9f0;

const CORNER_COLOR: Record<CornerStrategy, number> = {
  break: 0xff3b30,
  connect: 0x35d0a5,
  return: 0xa86a90,
  hairpin: 0xffa63a,
};

export interface Skeleton {
  object: THREE.Object3D;
  report: Report;
  dispose(): void;
}

function line(points: THREE.Vector3[], color: number): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color }),
  );
}

/**
 * The glyph's own contour rings from `surfacesOf` — the polygons the distance field rasterises,
 * not a re-derived outline, so a run that looks misplaced against them genuinely is.
 */
function contours(shapes: THREE.Shape[], depth: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const surface of surfacesOf(shapes, depth)) {
    if (surface.kind !== 'wall') continue;
    for (const z of [0, surface.depth]) {
      const ring = surface.ring.map((p) => new THREE.Vector3(p.x, p.y, z));
      out.push(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(ring),
          new THREE.LineBasicMaterial({ color: CONTOUR }),
        ),
      );
    }
  }
  return out;
}

export function buildSkeleton(shapes: THREE.Shape[], spec: TubeSpec, depth: number): Skeleton {
  const blueprint = buildTubeBlueprint(shapes, spec, depth, 0);
  const report = reportOf(blueprint, spec.radius, spec.bend);
  const group = new THREE.Group();

  for (const child of contours(shapes, depth)) group.add(child);

  const ends: THREE.Vector3[] = [];
  blueprint.runs.forEach((run, i) => {
    const state = report.runs[i];
    const color = state?.dropped ? DROPPED : state?.unresolved ? UNRESOLVED : run.lit ? LIT : DARK;
    // The swept path, not the one the run was handed: bend radius is measured on this,
    // so drawing the raw points would flag a run against geometry the panel never shows.
    if (run.points.length >= 2) group.add(line(smoothedPoints(run), color));
    const first = run.points[0];
    const last = run.points[run.points.length - 1];
    if (first) ends.push(first.clone());
    if (last) ends.push(last.clone());
  });

  if (ends.length > 0) {
    group.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(ends),
        new THREE.PointsMaterial({ color: ENDPOINT, size: 4, sizeAttenuation: false }),
      ),
    );
  }

  for (const corner of blueprint.corners) {
    group.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([corner.point.clone()]),
        new THREE.PointsMaterial({
          color: CORNER_COLOR[corner.strategy],
          size: 8,
          sizeAttenuation: false,
        }),
      ),
    );
  }

  // Glyph coordinates put the letter in the first quadrant, and `fitter` only scales. A Word
  // centers its own group before handing it over; the skeleton has to do the same or it clips.
  const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  group.position.set(-center.x, -center.y, 0);

  return {
    object: group,
    report,
    dispose() {
      group.traverse((child) => {
        const holder = child as Partial<THREE.Mesh>;
        holder.geometry?.dispose();
        const material = holder.material;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material?.dispose();
      });
      blueprint.dispose();
    },
  };
}
