import * as THREE from 'three';

/**
 * A `transform` carried into a space nested in the world, as the matrix that does it there. The
 * turn and scale are about `pivot`, a point of that space; `scale` is how many world units one of
 * its units spans. `eyeZ` is how far the camera stands from z = 0 in the world, null for a
 * parallel lens, and `pivotZ` the pivot's world z: the frame is a fixed height at z = 0, so the
 * translation is shrunk by the pivot's nearness to stay in units of the frame as seen there.
 */
export function turnAbout(
  turn: THREE.Matrix4,
  pivot: THREE.Vector3,
  scale: number,
  pivotZ: number,
  eyeZ: number | null,
): THREE.Matrix4 {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const size = new THREE.Vector3();
  turn.decompose(pos, quat, size);
  const near = eyeZ ? (eyeZ - pivotZ) / eyeZ : 1;
  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().compose(pos.multiplyScalar(near / scale), quat, size))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}
