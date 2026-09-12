import type { FrameCtx } from '@core/effects/types.js';
import { Timeline } from '@core/motion/compositor.js';
import { NONE } from '@core/motion/types.js';
import type { LookSpec } from '@core/render/looks.js';
import { Word } from '@core/render/word.js';
import type { LoadedFont } from '@core/text/font.js';
import { fitter, labCamera, viewBudget } from '@shared/lab-view.js';
import * as THREE from 'three';

/**
 * No motion. The gallery is about the color sweep, and a letter that also flew in would leave
 * every cell disagreeing about where it is halfway through a comparison.
 */
const STILL = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });

export interface GalleryCell {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Sizes the letter to the panel it is about to be drawn into, `w / h`. */
  fit(aspect: number): void;
  /** Drives one frame of the look's own effects. `elapsed` is the gallery's shared clock. */
  advance(elapsed: number, dt: number): void;
  dispose(): void;
}

export interface CellInput {
  letter: string;
  look: LookSpec;
  font: LoadedFont;
  environment: THREE.Texture;
}

export function buildCell(input: CellInput): GalleryCell {
  const scene = new THREE.Scene();
  scene.environment = input.environment;
  const camera = labCamera();
  const pivot = new THREE.Group();
  scene.add(pivot);

  // No debug hooks: a `tubeMaterial` override clears `readsRunColor`, and the tube builder's
  // color write returns early on that, which stops the sweep without failing.
  const word = new Word(input.letter, input.font, input.look, viewBudget(), false);
  const ctx: FrameCtx = { pointer: null, pointerInWord: null, dt: 0 };
  word.apply(STILL, 0, ctx);
  pivot.add(word.group);

  const fit = fitter(pivot);

  return {
    scene,
    camera,
    fit(aspect) {
      fit(aspect);
    },
    advance(elapsed, dt) {
      ctx.dt = dt;
      word.apply(STILL, elapsed, ctx);
    },
    dispose() {
      pivot.remove(word.group);
      word.dispose();
    },
  };
}
