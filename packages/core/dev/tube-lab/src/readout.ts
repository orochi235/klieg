import type { TypePoint } from '@core/api.js';
import { hitAt } from '@core/render/hit.js';
import { DEFAULT_GLYPH_OPTIONS } from '@core/text/glyphs.js';
import type { PanelRect } from '@shared/lab-renderer.js';
import * as THREE from 'three';
import type { Cell } from './render/cell.js';

/** What `kliegLab.pointOn` reads: each panel's cell and the rect it was last drawn into. */
export interface Readable {
  canvas: HTMLCanvasElement;
  cells: ReadonlyMap<string, Cell>;
  rects: ReadonlyMap<string, PanelRect>;
}

/**
 * Hands `scripts/lab-probe.mjs` the lab's `pointOn`: the type point under a client position in
 * whichever panel holds it. `inWord` is where the pointer's ray crosses the plane of the ink's
 * face, in the frame the ink is built in, rather than whatever surface the ray hit first: a tube
 * stands in front of the face and its curved wall would make the reading depend on which side the
 * pointer landed. Returns the teardown.
 */
export function exposeReadout(read: () => Readable | null): () => void {
  const along = new THREE.Vector3();
  const pointOn = (clientX: number, clientY: number): TypePoint | null => {
    const now = read();
    if (!now) return null;
    const canvas = now.canvas.getBoundingClientRect();
    for (const [id, rect] of now.rects) {
      const cell = now.cells.get(id);
      if (!cell) continue;
      const box = {
        left: canvas.left + rect.x,
        top: canvas.top + rect.y,
        width: rect.w,
        height: rect.h,
      };
      const hit = hitAt(clientX, clientY, box, cell.camera, [cell.pivot]);
      if (!hit) continue;
      const { x, y, z } = hit.point;
      const reach = 2 * Math.tan((cell.camera.fov * Math.PI) / 360) * (cell.camera.position.z - z);
      const a = cell.inkOf(hit.point);
      const b = cell.inkOf(along.subVectors(hit.point, cell.camera.position).add(hit.point));
      const t = b.z === a.z ? 0 : (DEFAULT_GLYPH_OPTIONS.depth - a.z) / (b.z - a.z);
      const face = a.lerp(b, t);
      return { x, y, z, unitsPerPx: reach / rect.h, inWord: { x: face.x, y: face.y } };
    }
    return null;
  };
  const probe = globalThis as { kliegLab?: { pointOn: typeof pointOn } };
  const mine = { pointOn };
  probe.kliegLab = mine;
  return () => {
    if (probe.kliegLab === mine) delete probe.kliegLab;
  };
}
