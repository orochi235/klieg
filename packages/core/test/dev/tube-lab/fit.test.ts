import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FILL, fitter, labCamera } from '../../../dev/shared/lab-view.js';

/** A tubing glyph as measured: the tube stands most of a glyph depth in front of the word plane. */
const SIZE = { x: 1.674, y: 1.79, z: 1.183 };
const FRONT = 1.062;

function pivotWithBox(): THREE.Group {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z));
  mesh.position.z = FRONT - SIZE.z / 2;
  pivot.add(mesh);
  return pivot;
}

/** N as measured: a real glyph is not centered on the pivot axis, and y runs -0.840 to 0.949. */
const OFF_CENTER = { bottom: -0.84, top: 0.949 };

function pivotWithOffCenterBox(): THREE.Group {
  const pivot = new THREE.Group();
  const height = OFF_CENTER.top - OFF_CENTER.bottom;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE.x, height, SIZE.z));
  mesh.position.set(0, (OFF_CENTER.top + OFF_CENTER.bottom) / 2, FRONT - SIZE.z / 2);
  pivot.add(mesh);
  return pivot;
}

/** The pivot's own box, read before it is turned or scaled — the corners the fitter measured. */
function localBox(pivot: THREE.Group): THREE.Box3 {
  return new THREE.Box3().setFromObject(pivot);
}

/** What fraction of the viewport's smaller side the content covers, on the plane it sits on. */
function minSideFill(pivot: THREE.Group, aspect: number): number {
  const camera = labCamera();
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  // project() reads matrixWorldInverse, which the constructor's position never wrote.
  camera.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(pivot);
  const lo = new THREE.Vector3(box.min.x, box.min.y, box.max.z).project(camera);
  const hi = new THREE.Vector3(box.max.x, box.max.y, box.max.z).project(camera);
  return Math.max(
    ((hi.x - lo.x) / 2) * Math.max(1, aspect),
    ((hi.y - lo.y) / 2) * Math.max(1, 1 / aspect),
  );
}

/**
 * The farthest any corner of the content reaches from the panel's center, as a fraction of the
 * half-side. The box's own corners, not the world AABB's: a turned box swells its AABB.
 */
function cornerReach(pivot: THREE.Group, aspect: number, box: THREE.Box3): number {
  const camera = labCamera();
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  pivot.updateMatrixWorld(true);
  let reach = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const ndc = new THREE.Vector3(x, y, z).applyMatrix4(pivot.matrixWorld).project(camera);
        reach = Math.max(
          reach,
          Math.abs(ndc.x) * Math.max(1, aspect),
          Math.abs(ndc.y) * Math.max(1, 1 / aspect),
        );
      }
  return reach;
}

describe('the tube lab panel fit', () => {
  // A fit measured on the word plane instead of the tube's overshoots to ~0.98 at every aspect,
  // which the scissor then cuts. The spread of aspects is what pins the min-side rule.
  it.each([1, 5.65, 0.15, 100, 0.01])('fills the smaller side of a %f panel', (aspect) => {
    const pivot = pivotWithBox();
    fitter(pivot)(aspect);

    expect(minSideFill(pivot, aspect)).toBeCloseTo(FILL, 4);
  });

  // The measured box is cached at build time, so a turned letter is fit against a projection the
  // fitter never saw unless it re-measures: at the seeded 30/13 the flat fit overflows its scissor.
  it.each([
    [30, 13],
    [-45, 25],
    [90, 0],
    [60, -60],
  ])('keeps a letter turned %f/%f inside the panel', (yaw, pitch) => {
    const pivot = pivotWithBox();
    const box = localBox(pivot);
    // Built before the turn, as the cell builds it: the measurement is of the letter, not the pose.
    const fit = fitter(pivot);
    pivot.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0);
    fit(1);

    expect(cornerReach(pivot, 1, box)).toBeCloseTo(FILL, 4);
  });

  // Reach from the pivot's own axis, not the content's size: the camera sits on that axis, so an
  // off-center letter measured by size overruns FILL on the side it leans to.
  it('fits an off-center letter by its farthest corner, not its size', () => {
    const pivot = pivotWithOffCenterBox();
    const box = localBox(pivot);
    fitter(pivot)(1);

    expect(cornerReach(pivot, 1, box)).toBeCloseTo(FILL, 4);
    expect(minSideFill(pivot, 1)).toBeLessThan(FILL);
  });

  // Zoom deviates from the fit; the fit stays the source of truth for what fills the panel, so
  // re-fitting a zoomed panel — every gutter drag does — must neither drop it nor compound it.
  it('multiplies the fitted size by zoom, however often it is re-fit', () => {
    const pivot = pivotWithBox();
    const fit = fitter(pivot);
    fit(1);
    const fitted = pivot.scale.x;
    fit(1, 4);
    fit(1, 4);

    expect(pivot.scale.x).toBeCloseTo(fitted * 4, 10);
  });

  it('leaves a rejected aspect unscaled', () => {
    const pivot = pivotWithBox();
    fitter(pivot)(0);

    expect(pivot.scale.x).toBe(1);
  });
});
