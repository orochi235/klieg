import type { FrameCtx } from '@core/effects/types.js';
import { Timeline } from '@core/motion/compositor.js';
import { NONE } from '@core/motion/types.js';
import type { LookSpec } from '@core/render/looks.js';
import { Word } from '@core/render/word.js';
import type { LoadedFont } from '@core/text/font.js';
import { fitter, labCamera, viewBudget } from '@shared/lab-view.js';
import * as THREE from 'three';
import type { PanelMeta } from '../panels.js';

/**
 * The rest pose. Word starts every material at three's default opacity of 1 until `apply` runs,
 * which renders tubing's 0.08 backing as a solid wall over its own tube.
 */
const REST = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });
const NO_CTX: FrameCtx = { pointer: null, pointerInWord: null, dt: 0 };

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
    viewBudget(),
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
