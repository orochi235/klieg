import * as THREE from 'three';

/** Whether a mesh is on screen: every ancestor visible and some opacity left. A letter mid-exit
 * keeps its geometry at zero opacity. */
function drawn(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  const material = (object as THREE.Mesh).material;
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  return materials.some((m) => m.visible && m.opacity > 0);
}

const raycaster = new THREE.Raycaster();
const aim = new THREE.Vector2();

/**
 * The nearest drawn surface under a client position, for a camera drawing into `box`; null outside
 * the box or with nothing drawn there. What `pointOn` answers, and what a lab that draws its own
 * scenes measures a gesture with.
 */
export function hitAt(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  camera: THREE.Camera,
  roots: readonly THREE.Object3D[],
): THREE.Intersection | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const nx = ((clientX - box.left) / box.width) * 2 - 1;
  const ny = ((clientY - box.top) / box.height) * 2 - 1;
  if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(aim.set(nx, -ny), camera);
  for (const root of roots) root.updateWorldMatrix(true, true);
  return raycaster.intersectObjects([...roots], true).find((h) => drawn(h.object)) ?? null;
}
