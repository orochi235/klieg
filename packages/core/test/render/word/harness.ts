import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import type { Host } from '../../../src/effects/types.js';
import { Timeline } from '../../../src/motion/compositor.js';
import type { MotionPatch } from '../../../src/motion/types.js';
import { NONE } from '../../../src/motion/types.js';
import type { Word } from '../../../src/render/word.js';
import type { LoadedFont } from '../../../src/text/font.js';
import type { Budget } from '../../../src/text/layout.js';
import { registerFace } from '../../../src/text/outline-face.js';

export const UPEM = 1000;
export const ADVANCE = 600;
/** One advance in em units — the layout gap between two adjacent letters. */
export const STEP = ADVANCE / UPEM;
export const NBSP = '\u00a0';
export const ZWJ = '\u200d';
export const BLANK = new Set([' ', NBSP, ZWJ]);
export const DESCENDS = new Set(['g']);
export const WIDE = new Set(['W']);

/** Box spanning `bottom`..`top` in three's y-up space; opentype paths are y-down. */
export function boxPath(w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x: 0, y: -bottom },
    { type: 'L', x: w, y: -bottom },
    { type: 'L', x: w, y: -top },
    { type: 'L', x: 0, y: -top },
    { type: 'Z' },
  ];
}

/**
 * Chars are 0.5 em wide boxes rising 0.7 em; 'W' is 1.5 em wide, 'g' also drops 0.2 em, and blanks
 * draw nothing.
 */
export const STUB_FAMILY = 'klieg-test-word';

export function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: BLANK.has(char)
          ? []
          : boxPath(
              (WIDE.has(char) ? 1.5 : 0.5) * size,
              0.7 * size,
              DESCENDS.has(char) ? -0.2 * size : 0,
            ),
        toPathData: () => 'M0 0',
      }),
    }),
  } as unknown as Font;

  return {
    font,
    unitsPerEm: UPEM,
    key: '/f.ttf',
    family: STUB_FAMILY,
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

// Layout resolves the face through weasel's module-global registry, so it must be in it.
export async function registerStubFace(): Promise<void> {
  await registerFace(STUB_FAMILY, stubFont());
}

export const ROOMY: Budget = { width: 100, height: 100 };

/** No pointer, at time 0. */
export const HOST: Host = { pointer: null, pointerInWord: null, now: 0 };

export function timelineOf(at: MotionPatch['at']): Timeline {
  return new Timeline({
    enter: { duration: 100, at },
    active: NONE,
    exit: NONE,
    hold: 0,
    blendMs: 0,
  });
}

/** Letter cells sit under an inner group between the fit and the caller transform. */
export function groups(word: Word): THREE.Group[] {
  return (word.group.children[0] as THREE.Group).children as THREE.Group[];
}

/** A letter's meshes hang off a scale node inside the cell, so the pose cannot overwrite a run's size. */
export function drawn(cell: THREE.Group): THREE.Group {
  return cell.children[0] as THREE.Group;
}

export function meshes(word: Word): THREE.Mesh[] {
  return groups(word).map((g) => drawn(g).children[0] as THREE.Mesh);
}

/** Distinct material instances and meshes under a word, counted the way a draw call would be. */
export function census(word: Word): { meshes: number; materials: number } {
  const materials = new Set<THREE.Material>();
  let meshes = 0;
  word.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    for (const material of [object.material].flat()) materials.add(material);
  });
  return { meshes, materials: materials.size };
}

export function materialOf(word: Word): THREE.MeshPhysicalMaterial {
  return (meshes(word)[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
}

/** The material of the first letter's chunk field, which is a sibling of its body mesh. */
export function decorationOf(word: Word): THREE.MeshPhysicalMaterial {
  const field = drawn(groups(word)[0] as THREE.Group).children.find(
    (c) => c instanceof THREE.InstancedMesh,
  );
  if (!field) throw new Error('the word has no chunk field');
  return (field as THREE.InstancedMesh).material as THREE.MeshPhysicalMaterial;
}

/** World-space midpoint of the advance span the drawn glyphs occupy. */
export function inkCenter(word: Word): number {
  const drawn = groups(word);
  const first = drawn[0] as THREE.Group;
  const last = drawn[drawn.length - 1] as THREE.Group;
  const span = (first.position.x + last.position.x + STEP) / 2;
  return word.group.position.x + word.group.scale.x * span;
}

/** Vertical extent the drawn glyphs cover, in group-local units. */
export function inkSpanY(word: Word): { min: number; max: number } {
  const boxes = meshes(word).map((m) => m.geometry.boundingBox as THREE.Box3);
  return {
    min: Math.min(...boxes.map((b) => b.min.y)),
    max: Math.max(...boxes.map((b) => b.max.y)),
  };
}

/** World-space vertical midpoint of that ink, before any pose is applied. */
export function inkCenterY(word: Word): number {
  const { min, max } = inkSpanY(word);
  return word.group.position.y + word.group.scale.x * ((min + max) / 2);
}
