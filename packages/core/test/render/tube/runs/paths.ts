import * as THREE from 'three';

/**
 * A closed square path in 3D, four corners, sampled at the pipeline's own 0.02 spacing.
 * The spacing is load-bearing: corners are classified by bend radius now, and `s / (2 sin(theta/2))`
 * makes a 90-degree turn a gentle bend at coarse sampling. At 0.1 it reads as 0.071 em, wider than
 * a 0.03 tube can be asked to bend, and no corner is found at all.
 */
export function squarePath(): THREE.Vector3[] {
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const pts: THREE.Vector3[] = [];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c] as number[];
    const [bx, by] = corners[(c + 1) % 4] as number[];
    for (let i = 0; i < 50; i++) {
      const t = i / 50;
      pts.push(
        new THREE.Vector3(
          (ax as number) + ((bx as number) - (ax as number)) * t,
          (ay as number) + ((by as number) - (ay as number)) * t,
          0,
        ),
      );
    }
  }
  return pts;
}

/** A closed circle — no corners anywhere. */
export function circlePath(): THREE.Vector3[] {
  return Array.from({ length: 120 }, (_, i) => {
    const t = (i / 120) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(t) * 0.5, Math.sin(t) * 0.5, 0);
  });
}

/** A closed circle of a given radius, sampled fine enough that its perimeter is the real one. */
export function circleOf(radius: number): THREE.Vector3[] {
  return Array.from({ length: 720 }, (_, i) => {
    const t = (i / 720) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0);
  });
}

/** An open L-shaped polyline: one interior 90 degree corner, straight legs on either side. */
export function openLPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector3(i / 10, 0, 0));
  for (let i = 1; i <= 10; i++) pts.push(new THREE.Vector3(1, i / 10, 0));
  return pts;
}

/** Direction change at vertex `i`, in radians. */
export function turnAt(p: THREE.Vector3[], i: number): number {
  const a = (p[i] as THREE.Vector3)
    .clone()
    .sub(p[i - 1] as THREE.Vector3)
    .normalize();
  const b = (p[i + 1] as THREE.Vector3)
    .clone()
    .sub(p[i] as THREE.Vector3)
    .normalize();
  return Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
}

export const PATH = (points: THREE.Vector3[], closed = true) => ({
  points,
  surface: 'front' as const,
  closed,
});
export const OPEN_PATH = (points: THREE.Vector3[]) => ({
  points,
  surface: 'front' as const,
  closed: false,
});

/** An open path with one sharp interior apex — a V whose walls meet at about 40 degrees. */
export function sharpVPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 40; i >= 0; i--) pts.push(new THREE.Vector3(-0.18 * (i / 40), i / 40, 0));
  for (let i = 1; i <= 40; i++) pts.push(new THREE.Vector3(0.18 * (i / 40), i / 40, 0));
  return pts;
}
