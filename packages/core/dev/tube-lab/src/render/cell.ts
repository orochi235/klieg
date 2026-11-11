import type { Host } from '@core/effects/types.js';
import { Timeline } from '@core/motion/compositor.js';
import { NONE } from '@core/motion/types.js';
import type { LookSpec } from '@core/render/looks.js';
import { turnAbout } from '@core/render/turn.js';
import { Word } from '@core/render/word.js';
import type { LoadedFont } from '@core/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '@core/text/glyphs.js';
import { fitter, labCamera, viewBudget } from '@shared/lab-view.js';
import { type Orbit, orbitPose, orbitTransform } from '@shared/orbit.js';
import * as THREE from 'three';

/**
 * The rest pose. Word starts every material at three's default opacity of 1 until `apply` runs,
 * which renders tubing's 0.08 backing as a solid wall over its own tube.
 */
const REST = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });
const NO_HOST: Host = { pointer: null, pointerInWord: null, now: 0 };

export interface Cell {
  /** What this cell was built from; a change to it is what makes the cell stale. */
  key: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Holds everything drawn. The camera never moves; the fit solves against `DISTANCE`. */
  pivot: THREE.Group;
  /**
   * Sizes the letter to the panel it is about to be drawn into, `w / h`, as it stands at `home`,
   * then turns and zooms it for `view` about the middle of its ink's face, as a fired word's
   * `transform` does. Absolute, so it can be re-applied any number of times without compounding.
   */
  pose(aspect: number, view: Orbit, home: Orbit): void;
  /** A world point in the frame the ink is built in, which no pose moves; the face is at z = depth. */
  inkOf(world: THREE.Vector3): THREE.Vector3;
  /** Whether the rail's bloom switch reaches this cell. A diagnostic's colours must not lie. */
  bloomable: boolean;
  dispose(): void;
}

export interface CellInput {
  letter: string;
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
  const turned = new THREE.Group();
  pivot.add(turned);
  scene.add(pivot);

  if (input.content) {
    const content = input.content;
    turned.add(content);
    return {
      key: '',
      scene,
      camera,
      pivot,
      // Centered by its own box, standing on z = 0 like a glyph.
      pose: poser(
        pivot,
        turned,
        camera,
        () => new THREE.Vector3(0, 0, DEFAULT_GLYPH_OPTIONS.depth),
      ),
      inkOf: (world) => content.worldToLocal(world.clone()),
      bloomable: false,
      dispose() {
        pivot.clear();
      },
    };
  }

  // Word adopts an override into its own material lists and disposes it; the cell must not.
  const word = new Word(
    input.letter,
    input.font,
    input.look,
    viewBudget(),
    false,
    undefined,
    input.tubeMaterial ? { tubeMaterial: input.tubeMaterial } : undefined,
  );
  word.apply(REST, 0, NO_HOST);
  turned.add(word.group);

  return {
    key: '',
    scene,
    camera,
    pivot,
    pose: poser(pivot, turned, camera, () => {
      word.group.updateMatrix();
      return word.turnPivot.applyMatrix4(word.group.matrix);
    }),
    inkOf: (world) => word.layoutPoint(world),
    bloomable: !input.tubeMaterial,
    dispose() {
      turned.remove(word.group);
      word.dispose();
    },
  };
}

/**
 * The fit scales `pivot`; the orbit turns `turned`, inside it, by core's own `turnAbout`, about
 * `face`: where the ink's face is middled, in the pivot's space.
 */
function poser(
  pivot: THREE.Group,
  turned: THREE.Group,
  camera: THREE.PerspectiveCamera,
  face: () => THREE.Vector3,
): Cell['pose'] {
  const fit = fitter(pivot);
  return (aspect, view, home) => {
    const about = face();
    fit(aspect, 1, { rotation: orbitPose(home).rotation, about });
    const scale = pivot.scale.x;
    const turn = new THREE.Matrix4().fromArray(orbitTransform(view) as number[]);
    turnAbout(turn, about, scale, about.z * scale, camera.position.z).decompose(
      turned.position,
      turned.quaternion,
      turned.scale,
    );
  };
}
