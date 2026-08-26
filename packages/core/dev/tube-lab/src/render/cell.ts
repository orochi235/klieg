import * as THREE from 'three';
import type { FrameCtx } from '../../../../src/effects/types.js';
import { Timeline } from '../../../../src/motion/compositor.js';
import { NONE } from '../../../../src/motion/types.js';
import type { LookSpec } from '../../../../src/render/looks.js';
import { Word } from '../../../../src/render/word.js';
import type { LoadedFont } from '../../../../src/text/font.js';
import type { PanelMeta } from '../panels.js';

const FOV = 38;
const DISTANCE = 11;

/** Visible height at the word plane. The camera never moves, so it is a constant. */
const VIEW_HEIGHT = 2 * Math.tan((FOV * Math.PI) / 360) * DISTANCE;

/** How much of the panel's smaller side the letter spans. */
export const FILL = 0.72;

/** The lab's fixed view, shared with the fit test so it projects against the same frustum. */
export function labCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);
  return camera;
}

/**
 * The rest pose. Word starts every material at three's default opacity of 1 until `apply` runs,
 * which renders tubing's 0.08 backing as a solid wall over its own tube.
 */
const REST = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });
const NO_CTX: FrameCtx = { pointer: null, pointerInWord: null, dt: 0 };

/**
 * A square budget rather than the panel's own aspect: the fit is baked at construction, so
 * reading the live aspect would rebuild every Word on every gutter drag.
 */
function budget(): { width: number; height: number } {
  const extent = VIEW_HEIGHT * 0.8;
  return { width: extent, height: extent };
}

function cornersOf(box: THREE.Box3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  return corners;
}

/**
 * Sizes the letter to its panel: `fitScale`'s 2.2 cap is a page effect's fit, a third of the panel
 * and useless for reading tube geometry. Every corner is solved on the plane it sits on and the
 * tightest one wins: the tube stands most of a glyph depth in front of the word, and a fit
 * measured on the word plane overshoots by that plane's magnification and gets scissored.
 *
 * Measured once, in the pose the pivot is in when the fitter is made, then re-solved on each call
 * under the pivot's current rotation. Reach is from the pivot's own axis rather than across the
 * box because the camera is fixed on that axis: a turn hangs the letter's depth over one edge.
 *
 * `zoom` multiplies the solved scale, so the fit stays absolute and idempotent however often a
 * zoomed panel is re-fit. Above 1 the letter is meant to overrun the panel and be scissored.
 */
export function fitter(pivot: THREE.Group): (aspect: number, zoom?: number) => void {
  const corners = cornersOf(new THREE.Box3().setFromObject(pivot));
  const turned = new THREE.Vector3();
  return (aspect, zoom = 1) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    const span = FILL * Math.min(1, aspect) * VIEW_HEIGHT;
    let scale = Number.POSITIVE_INFINITY;
    for (const corner of corners) {
      turned.copy(corner).applyEuler(pivot.rotation);
      const reach = 2 * Math.max(Math.abs(turned.x), Math.abs(turned.y));
      // A corner far enough behind shrinks faster than it reaches out, and binds nothing.
      const bound = reach + (span * turned.z) / DISTANCE;
      if (bound > 0) scale = Math.min(scale, span / bound);
    }
    if (!Number.isFinite(scale) || scale <= 0) return;
    pivot.scale.setScalar(scale * zoom);
  };
}

export interface Cell {
  /** What this cell was built from; a change to it is what makes the cell stale. */
  key: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Yawed and pitched by the pose. The camera never moves; the fit solves against `DISTANCE`. */
  pivot: THREE.Group;
  /** Sizes the letter to the panel it is about to be drawn into, `w / h`, times `zoom`. */
  fit(aspect: number, zoom?: number): void;
  /** Whether the rail's bloom switch reaches this cell. A diagnostic's colours must not lie. */
  bloomable: boolean;
  dispose(): void;
}

export interface CellInput {
  meta: PanelMeta;
  look: LookSpec;
  font: LoadedFont;
  environment: THREE.Texture;
  /** Whatever the mode wants drawn instead of a Word; `beauty` passes nothing. */
  content?: THREE.Object3D;
  /** Replaces both tube materials, for the ramp mode. */
  tubeMaterial?: (which: 'lit' | 'dark') => THREE.Material | undefined;
}

export function buildCell(input: CellInput): Cell {
  const scene = new THREE.Scene();
  scene.environment = input.environment;
  const camera = labCamera();
  const pivot = new THREE.Group();
  scene.add(pivot);

  if (input.content) {
    pivot.add(input.content);
    return {
      key: '',
      scene,
      camera,
      pivot,
      fit: fitter(pivot),
      bloomable: false,
      dispose() {
        pivot.clear();
      },
    };
  }

  // Word adopts an override into its own material lists and disposes it; the cell must not.
  const word = new Word(
    input.meta.letter,
    input.font,
    input.look,
    budget(),
    false,
    undefined,
    input.tubeMaterial ? { tubeMaterial: input.tubeMaterial } : undefined,
  );
  word.apply(REST, 0, NO_CTX);
  pivot.add(word.group);

  return {
    key: '',
    scene,
    camera,
    pivot,
    fit: fitter(pivot),
    bloomable: !input.tubeMaterial,
    dispose() {
      pivot.remove(word.group);
      word.dispose();
    },
  };
}
