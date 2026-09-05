import * as THREE from 'three';

/**
 * Several extrusions as one geometry. `ExtrudeGeometry` is always non-indexed and carries position,
 * normal and uv, so this is concatenation. Groups are dropped: the body draws on one material, and
 * a group whose material index nothing supplies would render nothing.
 */
export function mergeNonIndexed(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const part of parts) {
    if (part.getIndex()) throw new Error('klieg: mergeNonIndexed was handed indexed geometry');
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attrs = parts.map((part) => part.getAttribute(name) as THREE.BufferAttribute);
    const total = attrs.reduce((n, attr) => n + attr.array.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const attr of attrs) {
      merged.set(attr.array as Float32Array, at);
      at += attr.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, attrs[0]?.itemSize ?? 3));
  }
  out.computeBoundingBox();
  return out;
}
