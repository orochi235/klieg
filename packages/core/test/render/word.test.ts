import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';
import { Timeline } from '../../src/motion/compositor.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import { NONE, orderKey } from '../../src/motion/types.js';
import { pointerFrame } from '../../src/pointer.js';
import type { PoseOffset } from '../../src/pose.js';
import { WordCaches } from '../../src/render/caches.js';
import type { FlakeUniforms } from '../../src/render/flake.js';
import { type LookSpec, specOf } from '../../src/render/looks.js';
import type { GradientSpec } from '../../src/render/tube/gradient.js';
import { Word } from '../../src/render/word.js';
import type { LoadedFont } from '../../src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../src/text/glyphs.js';
import type { Budget } from '../../src/text/layout.js';
import { LINE_HEIGHT_EM } from '../../src/text/layout.js';
import { registerFace } from '../../src/text/outline-face.js';
import { projectLetters } from '../../src/text/projection.js';
import { fromEuler } from '../../src/transform.js';
import { NO_CTX } from '../effects/ctx.js';

const UPEM = 1000;
const ADVANCE = 600;
/** One advance in em units — the layout gap between two adjacent letters. */
const STEP = ADVANCE / UPEM;
const NBSP = '\u00a0';
const ZWJ = '\u200d';
const BLANK = new Set([' ', NBSP, ZWJ]);
const DESCENDS = new Set(['g']);

/** Box spanning `bottom`..`top` in three's y-up space; opentype paths are y-down. */
function boxPath(w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x: 0, y: -bottom },
    { type: 'L', x: w, y: -bottom },
    { type: 'L', x: w, y: -top },
    { type: 'L', x: 0, y: -top },
    { type: 'Z' },
  ];
}

/** Chars are 0.5 em wide boxes rising 0.7 em; 'g' also drops 0.2 em, and blanks draw nothing. */
const STUB_FAMILY = 'klieg-test-word';

function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: BLANK.has(char)
          ? []
          : boxPath(0.5 * size, 0.7 * size, DESCENDS.has(char) ? -0.2 * size : 0),
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
beforeAll(async () => {
  await registerFace(STUB_FAMILY, stubFont());
});

const ROOMY: Budget = { width: 100, height: 100 };

function timelineOf(offset: MotionPiece['offset']): Timeline {
  return new Timeline({
    enter: { duration: 100, offset },
    active: NONE,
    exit: NONE,
    hold: 0,
    blendMs: 0,
  });
}

/** Letter cells sit under an inner group between the fit and the caller transform. */
function groups(word: Word): THREE.Group[] {
  return (word.group.children[0] as THREE.Group).children as THREE.Group[];
}

/** A letter's meshes hang off a scale node inside the cell, so the pose cannot overwrite a run's size. */
function drawn(cell: THREE.Group): THREE.Group {
  return cell.children[0] as THREE.Group;
}

function meshes(word: Word): THREE.Mesh[] {
  return groups(word).map((g) => drawn(g).children[0] as THREE.Mesh);
}

/** Distinct material instances and meshes under a word, counted the way a draw call would be. */
function census(word: Word): { meshes: number; materials: number } {
  const materials = new Set<THREE.Material>();
  let meshes = 0;
  word.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    for (const material of [object.material].flat()) materials.add(material);
  });
  return { meshes, materials: materials.size };
}

function materialOf(word: Word): THREE.MeshPhysicalMaterial {
  return (meshes(word)[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
}

/** World-space midpoint of the advance span the drawn glyphs occupy. */
function inkCenter(word: Word): number {
  const drawn = groups(word);
  const first = drawn[0] as THREE.Group;
  const last = drawn[drawn.length - 1] as THREE.Group;
  const span = (first.position.x + last.position.x + STEP) / 2;
  return word.group.position.x + word.group.scale.x * span;
}

/** Vertical extent the drawn glyphs cover, in group-local units. */
function inkSpanY(word: Word): { min: number; max: number } {
  const boxes = meshes(word).map((m) => m.geometry.boundingBox as THREE.Box3);
  return {
    min: Math.min(...boxes.map((b) => b.min.y)),
    max: Math.max(...boxes.map((b) => b.max.y)),
  };
}

/** World-space vertical midpoint of that ink, before any pose is applied. */
function inkCenterY(word: Word): number {
  const { min, max } = inkSpanY(word);
  return word.group.position.y + word.group.scale.x * ((min + max) / 2);
}

describe('Word', () => {
  it('gives every code point a slot but only the drawn glyphs a mesh', () => {
    const word = new Word('A B', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(3);
    expect(meshes(word)).toHaveLength(2);
  });

  it('treats any outline-less glyph as blank, not just the space character', () => {
    const word = new Word(`A${NBSP}B${ZWJ}C`, stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(5);
    expect(meshes(word)).toHaveLength(3);
  });

  it('draws the geometry a borrowed cache holds', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const word = new Word('A', font, 'gold', ROOMY, false, undefined, undefined, null, caches);

    expect(meshes(word)[0]?.geometry).toBe(caches.glyph(font, 'A', DEFAULT_GLYPH_OPTIONS.depth));
    word.dispose();
  });

  it('leaves a borrowed cache intact when it disposes', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const first = new Word('A', font, 'gold', ROOMY, false, undefined, undefined, null, caches);
    const geo = meshes(first)[0]?.geometry as THREE.BufferGeometry;
    const spy = vi.spyOn(geo, 'dispose');
    first.dispose();
    const second = new Word('A', font, 'gold', ROOMY, false, undefined, undefined, null, caches);

    expect(spy).not.toHaveBeenCalled();
    expect(meshes(second)[0]?.geometry).toBe(geo);
    second.dispose();
  });

  it('disposes a cache of its own when it was not given one', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const spy = vi.spyOn(meshes(word)[0]?.geometry as THREE.BufferGeometry, 'dispose');
    word.dispose();

    expect(spy).toHaveBeenCalled();
  });

  it('shares one cached geometry across repeated letters', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect(a?.geometry).toBe(b?.geometry);
  });

  it('lays letters out one advance apart', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = groups(word);

    expect((b?.position.x ?? 0) - (a?.position.x ?? 0)).toBeCloseTo(STEP, 10);
  });

  it('adds pose x onto the layout x instead of replacing it', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [restA, restB] = groups(word).map((g) => g.position.x);
    word.apply(
      timelineOf(() => ({ position: [1, 0, 0] })),
      50,
      NO_CTX,
    );
    const [a, b] = groups(word);

    expect(a?.position.x).toBeCloseTo((restA as number) + 1, 10);
    expect(b?.position.x).toBeCloseTo((restB as number) + 1, 10);
    expect((restB as number) - (restA as number)).toBeCloseTo(STEP, 10);
  });

  it('adds pose y onto the layout y, and takes z, rotation and scale absolutely', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const rest = (groups(word)[0] as THREE.Group).position.y;
    word.apply(
      timelineOf(() => ({ position: [0, 2, 3], rotation: [0.1, 0.2, 0.3], scale: 4 })),
      50,
      NO_CTX,
    );
    const [a] = groups(word);

    expect(a?.position.y).toBeCloseTo(rest + 2, 10);
    expect(a?.position.z).toBeCloseTo(3, 10);
    expect([a?.rotation.x, a?.rotation.y, a?.rotation.z]).toEqual([0.1, 0.2, 0.3]);
    expect(a?.scale.x).toBeCloseTo(4, 10);
  });

  it('hands the timeline each letter index including the blanks it skips', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A B', stubFont(), 'gold', ROOMY);

    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      50,
      NO_CTX,
    );

    expect(seen.map((l) => [l.index, l.count])).toEqual([
      [0, 3],
      [2, 3],
    ]);
  });

  it('centers the word on both axes', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);

    expect(inkCenter(word)).toBeCloseTo(0, 10);
    expect(inkCenterY(word)).toBeCloseTo(0, 10);
  });

  it('centers on the ink, so a descender is not left hanging below the frame', () => {
    const font = stubFont();
    const plain = new Word('AA', font, 'gold', ROOMY);
    const dropped = new Word('Ag', font, 'gold', ROOMY);

    expect(inkCenterY(dropped)).toBeCloseTo(0, 10);
    // Cap-height centering would put both at the same y; a lower ink center has to raise the group.
    expect(dropped.group.position.y).toBeGreaterThan(plain.group.position.y);
  });

  it('fits the ink height, descender included, rather than the cap height', () => {
    const font = stubFont();
    const loose = new Word('g', font, 'gold', ROOMY);
    const { min, max } = inkSpanY(loose);

    const fitted = new Word('g', font, 'gold', { width: 100, height: (max - min) / 2 });

    expect(fitted.group.scale.x).toBeCloseTo(0.5, 10);
  });

  it('centers on the drawn glyphs, so surrounding whitespace does not shift the word', () => {
    const font = stubFont();
    const plain = new Word('AA', font, 'gold', ROOMY);
    const trailing = new Word('AA  ', font, 'gold', ROOMY);
    const leading = new Word('  AA', font, 'gold', ROOMY);

    expect(inkCenter(trailing)).toBeCloseTo(0, 10);
    expect(inkCenter(leading)).toBeCloseTo(0, 10);
    expect(trailing.group.scale.x).toBeCloseTo(plain.group.scale.x, 10);
    expect(leading.group.scale.x).toBeCloseTo(plain.group.scale.x, 10);
  });

  it('scales the word down to the budget it is given', () => {
    // Two letters span two advances, so a budget of one advance has to halve them.
    const word = new Word('AA', stubFont(), 'gold', { width: STEP, height: 100 });

    expect(word.group.scale.x).toBeCloseTo(0.5, 10);
    expect(inkCenter(word)).toBeCloseTo(0, 10);
  });

  it('falls back to the fit cap for a word with nothing to draw', () => {
    const word = new Word('  ', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(2);
    expect(meshes(word)).toHaveLength(0);
    expect(word.group.scale.x).toBe(2.2);
    expect(word.group.position.x).toBeCloseTo(0, 10);
  });

  it('renders through the transparent path so an exit can fade', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    expect(materialOf(word).transparent).toBe(true);
  });

  it('gives each letter its own material', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect((a as THREE.Mesh).material).not.toBe((b as THREE.Mesh).material);
  });

  it('fades each letter on its own schedule', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const fadeByIndex = (_t: number, letter: LetterInfo): PoseOffset => ({
      opacity: letter.index === 0 ? 1 : 0,
    });

    word.apply(timelineOf(fadeByIndex), 50, NO_CTX);

    const [a, b] = meshes(word);
    expect(((a as THREE.Mesh).material as THREE.MeshPhysicalMaterial).opacity).toBe(1);
    expect(((b as THREE.Mesh).material as THREE.MeshPhysicalMaterial).opacity).toBe(0);
  });

  it('applies the look to every letter material', () => {
    const word = new Word('AB', stubFont(), 'chrome', ROOMY);

    for (const mesh of meshes(word)) {
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      expect(mat.metalness).toBe(1);
      expect(mat.roughness).toBeCloseTo(0.05, 10);
    }
  });

  it('disposes every glyph geometry and every letter material, and empties the group', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);
    const geoA = vi.spyOn(a?.geometry as THREE.BufferGeometry, 'dispose');
    const geoB = vi.spyOn(b?.geometry as THREE.BufferGeometry, 'dispose');
    const matA = vi.spyOn((a as THREE.Mesh).material as THREE.MeshPhysicalMaterial, 'dispose');
    const matB = vi.spyOn((b as THREE.Mesh).material as THREE.MeshPhysicalMaterial, 'dispose');

    word.dispose();

    expect(geoA).toHaveBeenCalled();
    expect(geoB).toHaveBeenCalled();
    expect(matA).toHaveBeenCalled();
    expect(matB).toHaveBeenCalled();
    expect(word.group.children).toHaveLength(0);
  });

  it('multiplies pose opacity by the look base opacity', () => {
    const word = new Word('A', stubFont(), { opacity: 0.5 }, ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 0.4 })),
      50,
      NO_CTX,
    );

    expect(materialOf(word).opacity).toBeCloseTo(0.2, 10);
  });

  // A declared 0 is the case that separates ?? from ||, and every other opacity test passes
  // under both.
  it('keeps a look that declares full transparency transparent', () => {
    const word = new Word('A', stubFont(), { opacity: 0 }, ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 1 })),
      50,
      NO_CTX,
    );

    expect(materialOf(word).opacity).toBe(0);
  });

  it('treats a look with no declared opacity as fully opaque', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 0.4 })),
      50,
      NO_CTX,
    );

    expect(materialOf(word).opacity).toBeCloseTo(0.4, 10);
  });

  it('exposes transform as a settable rigid turn between the fit and the letters', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const fitScale = word.group.scale.x;
    const fitPosition = word.group.position.clone();

    word.transform = fromEuler(0.1, 0.5, -0.2);

    const m = new THREE.Matrix4().fromArray(word.transform as number[]);
    const rotation = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
    expect(rotation.x).toBeCloseTo(0.1, 10);
    expect(rotation.y).toBeCloseTo(0.5, 10);
    expect(rotation.z).toBeCloseTo(-0.2, 10);
    // The fit lives on the outer group and must survive a caller transform untouched.
    expect(word.group.scale.x).toBeCloseTo(fitScale, 10);
    expect(word.group.position.x).toBeCloseTo(fitPosition.x, 10);
    expect(word.group.position.y).toBeCloseTo(fitPosition.y, 10);
  });

  it('applies transform to the word as one rigid object, not per letter', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = groups(word);
    const restA = (a as THREE.Group).rotation.y;
    const restB = (b as THREE.Group).rotation.y;

    word.transform = fromEuler(0, 0.5, 0);

    // The turn lands on the shared parent; individual letter cells stay at rest.
    expect((groups(word)[0] as THREE.Group).rotation.y).toBeCloseTo(restA, 10);
    expect((groups(word)[1] as THREE.Group).rotation.y).toBeCloseTo(restB, 10);
  });

  it('leaves transform alone when apply() runs, since apply only poses per-letter cells', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    word.transform = fromEuler(0.1, 0.5, -0.2);
    const before = word.transform;

    word.apply(
      timelineOf(() => ({ position: [1, 2, 3], rotation: [0.4, 0.4, 0.4] })),
      50,
      NO_CTX,
    );

    expect(word.transform).toEqual(before);
  });

  it('goes inert after dispose rather than posing into a disposed material', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const [cell] = groups(word);
    const material = (meshes(word)[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const rest = (cell as THREE.Group).position.x;

    word.dispose();
    word.apply(
      timelineOf(() => ({ position: [5, 0, 0], opacity: 0.25 })),
      50,
      NO_CTX,
    );

    expect(cell?.position.x).toBe(rest);
    expect(material.opacity).toBe(1);
  });

  const TUBE: LookSpec = {
    opacity: 0.1,
    decoration: {
      kind: 'tube',
      radius: 0.04,
      segments: 8,
      spacing: 0.03,
      surfaces: ['front'],
      level: 0,
      runs: 4,
      minRun: 0.05,
      select: { by: 'seed', amount: 1 },
      colors: [0xff2d95],
      look: { emissive: 0xff2d95, opacity: 1 },
      dark: { color: 0x1a0010, opacity: 1 },
    },
  };

  it('wraps every letter in a group', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);

    for (const group of groups(word)) {
      expect(group).toBeInstanceOf(THREE.Group);
      expect(group.children).toHaveLength(1);
    }
  });

  it('adds decoration alongside the body in the same group', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);

    expect(drawn(groups(word)[0] as THREE.Group).children.length).toBeGreaterThan(1);
  });

  it('drives body and decoration from one pose', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);
    const cell = groups(word)[0] as THREE.Group;
    const rest = cell.position.x;

    word.apply(
      timelineOf(() => ({ position: [3, 0, 0] })),
      50,
      NO_CTX,
    );

    expect(cell.position.x).toBeCloseTo(rest + 3, 5);
    // The pose lands once, on the cell: body and decoration ride it rather than being posed apart.
    for (const child of drawn(cell).children) expect(child.position.x).toBe(0);
  });

  it('fades body and decoration to their own base opacities', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 0.5 })),
      50,
      NO_CTX,
    );

    const group = drawn(groups(word)[0] as THREE.Group);
    const body = (group.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const decor = (group.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(body.opacity).toBeCloseTo(0.05, 10);
    expect(decor.opacity).toBeCloseTo(0.5, 10);
  });

  it('disposes decoration materials and the decoration cache', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);
    const group = drawn(groups(word)[0] as THREE.Group);
    const decor = (group.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const spy = vi.spyOn(decor, 'dispose');

    word.dispose();

    expect(spy).toHaveBeenCalled();
  });

  /** The first tube run mesh of the word's first letter; the body mesh is child 0. */
  const firstRun = (word: Word) =>
    (drawn(groups(word)[0] as THREE.Group).children[1] as THREE.Mesh).geometry;

  it('re-uses a tube blueprint the previous word released', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const first = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);
    const geo = firstRun(first);
    first.dispose();
    const second = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);

    expect(firstRun(second)).toBe(geo);
    second.dispose();
  });

  it('gives two live words their own blueprints', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const a = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);
    const b = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);

    expect(firstRun(b)).not.toBe(firstRun(a));
    a.dispose();
    b.dispose();
  });

  it('disposes every tube run geometry along with its per-letter blueprint', () => {
    const word = new Word('AB', stubFont(), TUBE, ROOMY);
    const spies = groups(word).map((group) =>
      drawn(group)
        .children.slice(1)
        .map((child) => vi.spyOn((child as THREE.Mesh).geometry, 'dispose')),
    );

    word.dispose();

    for (const perLetter of spies) for (const spy of perLetter) expect(spy).toHaveBeenCalled();
  });

  it('renders flake chunks from both sides so tumbled ones stay visible', () => {
    const flakes: LookSpec = {
      decoration: {
        kind: 'chunks',
        count: 8,
        size: 0.05,
        shape: 'flake',
        align: 0,
        cluster: 0,
        proud: 0.4,
        look: {},
      },
    };
    const word = new Word('A', stubFont(), flakes, ROOMY);
    const instanced = drawn(groups(word)[0] as THREE.Group).children[1] as THREE.InstancedMesh;

    expect((instanced.material as THREE.Material).side).toBe(THREE.DoubleSide);
  });

  it('frees the instance buffer a chunk decoration allocates', () => {
    const chunks: LookSpec = {
      decoration: {
        kind: 'chunks',
        count: 8,
        size: 0.05,
        shape: 'cube',
        align: 0,
        cluster: 0,
        proud: 0.4,
        look: {},
      },
    };
    const word = new Word('A', stubFont(), chunks, ROOMY);
    const instanced = drawn(groups(word)[0] as THREE.Group).children[1] as THREE.InstancedMesh;
    const spy = vi.spyOn(instanced, 'dispose');

    word.dispose();

    expect(instanced).toBeInstanceOf(THREE.InstancedMesh);
    expect(spy).toHaveBeenCalled();
  });
});

describe('tube run seeding', () => {
  const PARTIAL_TUBE: LookSpec = {
    decoration: {
      kind: 'tube',
      radius: 0.03,
      segments: 6,
      spacing: 0.03,
      surfaces: ['front'],
      level: 0,
      runs: 8,
      minRun: 0,
      select: { by: 'seed', amount: 0.5 },
      colors: [0xff2d95],
      look: {},
      dark: {},
    },
  };

  /** First position sample of every decoration mesh, in insertion order. */
  function decorFingerprint(cell: THREE.Group): string {
    return drawn(cell)
      .children.slice(1)
      .flatMap((child) => {
        const pos = (child as THREE.Mesh).geometry.getAttribute('position');
        return [pos.getX(0), pos.getY(0), pos.getZ(0)];
      })
      .join(',');
  }

  it('gives two letters of the same glyph different run selections', () => {
    const word = new Word('OO', stubFont(), PARTIAL_TUBE, ROOMY);
    const [a, b] = groups(word);

    expect(decorFingerprint(a as THREE.Group)).not.toBe(decorFingerprint(b as THREE.Group));
  });
});

describe('WordDebugHooks', () => {
  const TUBE: LookSpec = {
    decoration: {
      kind: 'tube',
      radius: 0.04,
      segments: 8,
      spacing: 0.03,
      surfaces: ['front'],
      level: 0,
      runs: 4,
      minRun: 0.05,
      select: { by: 'seed', amount: 1 },
      colors: [0xff2d95],
      look: { emissive: 0xff2d95, opacity: 1 },
      dark: { color: 0x1a0010, opacity: 1 },
    },
  };

  it('lets a caller override a tube decoration material without touching the default path', () => {
    const lit = new THREE.MeshBasicMaterial();
    const dark = new THREE.MeshBasicMaterial();
    const word = new Word('A', stubFont(), TUBE, ROOMY, false, undefined, {
      tubeMaterial: (which) => (which === 'lit' ? lit : dark),
    });
    const [cell] = groups(word);
    const decorMeshes = drawn(cell as THREE.Group).children.slice(1) as THREE.Mesh[];

    expect(decorMeshes.length).toBeGreaterThan(0);
    for (const mesh of decorMeshes) {
      expect(mesh.material === lit || mesh.material === dark).toBe(true);
    }
  });

  it('leaves the default material in place when the hook declines', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY, false, undefined, {
      tubeMaterial: () => undefined,
    });
    const [cell] = groups(word);
    const decor = drawn(cell as THREE.Group).children[1] as THREE.Mesh;

    expect(decor.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it('calls onLetter once per drawn letter with its own group, shapes and depth', () => {
    const seen: { cell: THREE.Group; shapeCount: number; depth: number }[] = [];
    const word = new Word('AB', stubFont(), 'gold', ROOMY, false, undefined, {
      onLetter: (cell, shapes, depth) => seen.push({ cell, shapeCount: shapes.length, depth }),
    });

    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.cell)).toEqual(groups(word));
    for (const s of seen) {
      expect(s.shapeCount).toBeGreaterThan(0);
      expect(s.depth).toBeGreaterThan(0);
    }
  });

  it('never calls onLetter for a blank glyph', () => {
    const seen: THREE.Group[] = [];
    const word = new Word('A B', stubFont(), 'gold', ROOMY, false, undefined, {
      onLetter: (cell) => seen.push(cell),
    });

    expect(word.letterCount).toBe(3);
    expect(seen).toHaveLength(2);
  });
});

describe('Word as a block', () => {
  it('gives every line its own row of letters', () => {
    const word = new Word('AB\nCD', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(4);
    expect(meshes(word)).toHaveLength(4);
    expect(word.lineCount).toBe(2);
  });

  it('drops each line below the one above it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const [first, second] = groups(word);

    expect((second as THREE.Group).position.y).toBeLessThan((first as THREE.Group).position.y);
  });

  it('centers each line independently', () => {
    const word = new Word('AA\nB', stubFont(), 'gold', ROOMY);
    const [a1, a2, b] = groups(word);
    const rowCenter = ((a1 as THREE.Group).position.x + (a2 as THREE.Group).position.x) / 2;

    expect((b as THREE.Group).position.x).toBeCloseTo(rowCenter, 5);
  });

  it('adds pose y onto the line baseline instead of replacing it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const before = groups(word).map((g) => g.position.y);

    word.apply(
      timelineOf(() => ({ position: [0, 1, 0] })),
      0,
      NO_CTX,
    );

    const after = groups(word).map((g) => g.position.y);
    expect(after[0] as number).toBeCloseTo((before[0] as number) + 1, 5);
    expect(after[1] as number).toBeCloseTo((before[1] as number) + 1, 5);
    // The lines must stay apart; a replaced baseline collapses them onto one row.
    expect(after[0] as number).not.toBeCloseTo(after[1] as number, 5);
  });

  it('reports each letter its position in the block', () => {
    const word = new Word('AB\nC', stubFont(), 'gold', ROOMY);
    const seen: LetterInfo[] = [];

    word.apply(
      timelineOf((_t, letter) => {
        seen.push(letter);
        return {};
      }),
      0,
      NO_CTX,
    );

    expect(seen.map((l) => l.line)).toEqual([0, 0, 1]);
    expect(seen.map((l) => l.column)).toEqual([0, 1, 0]);
    expect(seen.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(seen[0]?.lineCount).toBe(2);
    expect(seen[0]?.columnCount).toBe(2);
  });

  it('wraps only when asked', () => {
    const narrow: Budget = { width: 1.2, height: 100 };

    expect(new Word('AA BB', stubFont(), 'gold', narrow, true).lineCount).toBeGreaterThan(1);
    expect(new Word('AA BB', stubFont(), 'gold', narrow, false).lineCount).toBe(1);
  });

  it('centers the block vertically, so a two-line block straddles the origin', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const ys = groups(word).map((g) => word.group.position.y + word.group.scale.x * g.position.y);

    expect((ys[0] as number) > 0).toBe(true);
    expect((ys[1] as number) < 0).toBe(true);
  });

  it('a newline never reaches the glyph cache, so it draws no tofu', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(2);
    expect(meshes(word)).toHaveLength(2);
  });
});

describe('flake seeding', () => {
  it('gives each letter a distinct flake seed', () => {
    const word = new Word('AA', stubFont(), 'glitter', ROOMY);
    const [a, b] = meshes(word);
    const seedOf = (mesh: THREE.Mesh) =>
      ((mesh.material as THREE.MeshPhysicalMaterial).userData.flake as FlakeUniforms).uFlakeSeed
        .value;

    expect(seedOf(a as THREE.Mesh)).not.toBe(seedOf(b as THREE.Mesh));
  });

  it('shares one geometry across repeated letters even for a flake look', () => {
    const word = new Word('AA', stubFont(), 'glitter', ROOMY);
    const [a, b] = meshes(word);

    expect((a as THREE.Mesh).geometry).toBe((b as THREE.Mesh).geometry);
  });

  it('gives a decoration material the same per-letter seed the body gets', () => {
    const FLAKED_TUBE: LookSpec = {
      decoration: {
        kind: 'tube',
        radius: 0.04,
        segments: 8,
        spacing: 0.03,
        surfaces: ['front'],
        level: 0,
        runs: 4,
        minRun: 0,
        select: { by: 'seed', amount: 1 },
        colors: [0xff2d95],
        look: { flake: { size: 0.02, density: 0.5, spread: 0.3 } },
        dark: {},
      },
    };
    const word = new Word('AA', stubFont(), FLAKED_TUBE, ROOMY);
    const [a, b] = groups(word);
    // children[0] is the body; the decoration meshes follow it.
    const decorSeed = (cell: THREE.Group) =>
      (
        ((drawn(cell).children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial).userData
          .flake as FlakeUniforms
      ).uFlakeSeed.value;

    expect(decorSeed(a as THREE.Group)).not.toBe(decorSeed(b as THREE.Group));
  });
});

describe('LetterInfo position', () => {
  it('hands each letter its laid-out position in em', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    // Glyph origins, centred on the advance span: 'AB' puts A at -STEP and B at 0.
    expect(seen[0]?.x).toBeCloseTo(-STEP);
    expect(seen[1]?.x).toBeCloseTo(0);
  });

  it('measures y from the block centre, so a single line sits at zero', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    // The stub's 'A' spans 0..0.7em, so its centre is 0.35 below the glyph origin.
    expect(seen[0]?.y).toBeCloseTo(-0.35);
  });

  it('separates two lines by one line height', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    expect((seen[0]?.y as number) - (seen[1]?.y as number)).toBeCloseTo(1.1);
  });
});

describe('regroup', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;

  it('leaves every survivor where it was under `place`', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const before: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        before.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );

    const result = word.regroup(firstOfLine, 'place');
    expect(result.kept).toEqual([0, 2, 4]);
    // Nothing moved, so nothing has anywhere to move back from.
    expect(result.delta.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);

    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    for (const i of result.kept) {
      expect(after[i]?.x, `x of ${i}`).toBeCloseTo(before[i]?.x as number);
      expect(after[i]?.y, `y of ${i}`).toBeCloseTo(before[i]?.y as number);
      expect(after[i]?.line, `line of ${i}`).toBe(before[i]?.line);
      expect(after[i]?.column, `column of ${i}`).toBe(before[i]?.column);
    }
    // Renumbered as their own group all the same, so a stagger over them is coherent.
    expect(result.kept.map((i) => after[i]?.index)).toEqual([0, 1, 2]);
    expect(after[0]?.count).toBe(3);
  });

  it('lays the survivors out as the word they spell', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const result = word.regroup(firstOfLine, 'line');
    expect(result.kept).toEqual([0, 2, 4]);
    expect(result.dropped).toEqual([1, 3, 5]);

    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    // Three survivors on one line, origins centred on the advance span.
    expect(seen[0]?.x).toBeCloseTo(-1.5 * STEP);
    expect(seen[2]?.x).toBeCloseTo(-0.5 * STEP);
    expect(seen[4]?.x).toBeCloseTo(0.5 * STEP);
  });

  it('stacks one survivor per line when asked', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'stack');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    expect(seen[0]?.line).toBe(0);
    expect(seen[2]?.line).toBe(1);
    expect(seen[0]?.x).toBeCloseTo(-STEP / 2);
  });

  it('renumbers the survivors and leaves the dropped letters their old numbering', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    expect([seen[0]?.index, seen[2]?.index]).toEqual([0, 1]);
    expect([seen[0]?.count, seen[2]?.count]).toEqual([2, 2]);
    // `column` is the canonical stage selector, so a second stage picks from the new layout.
    expect([seen[0]?.column, seen[2]?.column]).toEqual([0, 1]);
    expect([seen[0]?.line, seen[2]?.line]).toEqual([0, 0]);
    // The dropped letter keeps the numbering its exit was staggered against.
    expect(seen[1]?.index).toBe(1);
    expect(seen[1]?.count).toBe(4);
  });

  it('marks a dropped letter as leaving and a survivor as not', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    expect(seen[1]?.leaving).toBe(true);
    expect(seen[0]?.leaving).toBeFalsy();
  });

  it('reports each survivor the offset back to the line and column it left', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const { delta } = word.regroup(firstOfLine, 'line');
    // Every survivor was first on a two-glyph line and is now one of three on a single line.
    expect(delta[0]?.[0]).toBeCloseTo(0.5 * STEP, 10);
    expect(delta[0]?.[1]).toBeCloseTo(0, 10);
    expect(delta[2]?.[0]).toBeCloseTo(-0.5 * STEP, 10);
    expect(delta[2]?.[1]).toBeCloseTo(-1.1, 10);
    expect(delta[4]?.[0]).toBeCloseTo(-1.5 * STEP, 10);
    expect(delta[4]?.[1]).toBeCloseTo(-2.2, 10);
  });

  it('puts a survivor back where it was when its offset is posed onto it', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const before = groups(word).map((g) => g.position.clone());
    const { kept, delta } = word.regroup(firstOfLine, 'line');

    word.apply(
      timelineOf((_t, letter): PoseOffset => {
        // delta is keyed by slot; a survivor's index is its new position in the group.
        if (letter.leaving) return {};
        const [dx, dy] = delta[kept[letter.index] as number] as [number, number];
        return { position: [dx, dy, 0] };
      }),
      0,
      NO_CTX,
    );

    const after = groups(word).map((g) => g.position.clone());
    for (const i of kept) {
      expect(after[i]?.x).toBeCloseTo(before[i]?.x as number, 10);
      expect(after[i]?.y).toBeCloseTo(before[i]?.y as number, 10);
    }
  });

  it('leaves a dropped letter parked where it was', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    const before: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        before.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    word.regroup(firstOfLine, 'line');
    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    expect(after[1]?.x).toBeCloseTo(before[1]?.x as number);
  });

  it('matches laying the survivors out directly', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const regrouped: number[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        regrouped.push(letter.x as number);
        return {};
      }),
      0,
      NO_CTX,
    );

    const direct = new Word('NEO', stubFont(), 'gold', ROOMY);
    const plain: number[] = [];
    direct.apply(
      timelineOf((_t, letter) => {
        plain.push(letter.x as number);
        return {};
      }),
      0,
      NO_CTX,
    );
    expect([regrouped[0], regrouped[2], regrouped[4]]).toEqual(plain);
  });

  it('selects from the survivors of an earlier regroup, not from every slot', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'stack');
    // The survivors now stand one per line, so every one of them is a first-of-line again.
    const second = word.regroup((l) => (l.index as number) < 2, 'line');
    expect(second.kept).toEqual([0, 2]);
    expect(second.dropped).toEqual([4]);
  });

  it('takes a retired letter off screen', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    const result = word.regroup(firstOfLine, 'line');
    expect(groups(word).every((g) => g.visible)).toBe(true);
    word.retire(result.dropped);
    expect(groups(word).map((g) => g.visible)).toEqual([true, false, true, false]);
  });
});

describe('fit tween', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;
  const TIGHT: Budget = { width: 2, height: 2 };
  /** Tall enough to matter and wide enough not to: the fit here is decided by ink height. */
  const SHORT: Budget = { width: 100, height: 1 };

  it('holds the old fit at progress 0 and reaches the new one at 1', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    const before = word.group.scale.x;
    word.regroup(firstOfLine, 'line');

    word.setFitProgress(0);
    expect(word.group.scale.x).toBeCloseTo(before);

    word.setFitProgress(1);
    // Two letters need far less width than ten, so the fit grows.
    expect(word.group.scale.x).toBeGreaterThan(before);
  });

  it('settles on exactly the fit the survivors get as a word of their own', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const direct = new Word('NE', stubFont(), 'gold', TIGHT);

    expect(word.group.scale.x).toBe(direct.group.scale.x);
    expect(word.group.position.y).toBe(direct.group.position.y);
  });

  it('measures the new fit over the glyphs that survived, descenders included', () => {
    const font = stubFont();
    const word = new Word('gA', font, 'gold', SHORT);
    word.regroup((l) => l.column === 1, 'line');
    word.setFitProgress(1);
    const direct = new Word('A', font, 'gold', SHORT);

    // The dropped 'g' is the only glyph that reaches below the baseline; it must stop counting.
    expect(word.group.scale.x).toBe(direct.group.scale.x);
    expect(word.group.position.y).toBe(direct.group.position.y);
  });

  it('is halfway between the two at progress 0.5', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    const before = word.group.scale.x;
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const after = word.group.scale.x;
    word.setFitProgress(0.5);
    expect(word.group.scale.x).toBeCloseTo((before + after) / 2);
  });

  it('clamps a progress the caller overshoots, so a delayed clock cannot overscale', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const settled = word.group.scale.x;
    word.setFitProgress(1.8);
    expect(word.group.scale.x).toBeCloseTo(settled);
  });

  it('reports y against the settled fit once the tween completes', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      NO_CTX,
    );
    // One line of survivors: its own centre.
    expect(seen[0]?.y).toBeCloseTo(-0.35);
  });
});

describe('tint as a function', () => {
  /** Body colour per drawn cell, in layout order. */
  function bodyColors(word: Word): number[] {
    const inner = word.group.children[0] as THREE.Group;
    return inner.children.map((cell) => {
      const mesh = drawn(cell as THREE.Group).children[0] as THREE.Mesh;
      return (mesh.material as THREE.MeshPhysicalMaterial).color.getHex();
    });
  }

  it('colours only the letters the rule selects', () => {
    const plain = bodyColors(new Word('AB', stubFont(), 'gold', ROOMY));
    const ruled = bodyColors(
      new Word('AB', stubFont(), 'gold', ROOMY, false, (l) =>
        l.column === 0 ? 0xff0000 : undefined,
      ),
    );
    expect(ruled[0]).toBe(0xff0000);
    expect(ruled[1]).toBe(plain[1]);
  });

  it("is handed each letter's laid-out position", () => {
    const seen: LetterInfo[] = [];
    new Word('AB', stubFont(), 'gold', ROOMY, false, (l) => {
      seen.push({ ...l });
      return undefined;
    });
    expect(seen[0]?.x).toBeCloseTo(-STEP);
    expect(seen[0]?.index).toBe(0);
    expect(seen[1]?.index).toBe(1);
  });

  it('still accepts a plain number for the whole word', () => {
    const colors = bodyColors(new Word('AB', stubFont(), 'gold', ROOMY, false, 0x00ff00));
    expect(colors).toEqual([0x00ff00, 0x00ff00]);
  });
});

describe('positional gradient bounds', () => {
  const RADIUS = 0.04;
  const tubeLook = (gradient?: GradientSpec): LookSpec => ({
    decoration: {
      kind: 'tube',
      radius: RADIUS,
      segments: 8,
      spacing: 0.03,
      surfaces: ['front'],
      level: 0,
      runs: 4,
      minRun: 0.05,
      select: { by: 'seed', amount: 1 },
      colors: [0xff2d95],
      gradient,
      look: { emissive: 0xff2d95 },
      dark: { color: 0x1a0010 },
    },
  });
  const SWEPT = tubeLook({
    domain: { of: 'axis' },
    stops: [0xff2d95, 0x2de0ff],
    mode: 'replace',
  });
  const FLAT = tubeLook();

  /** The lit and dark run material a letter's decoration meshes share. */
  function decorMaterial(cell: THREE.Group): THREE.Material {
    return (drawn(cell).children[1] as THREE.Mesh).material as THREE.Material;
  }

  /**
   * Read off the compiled uniform rather than out of userData, so an update that reassigns instead
   * of mutating is visible here: a compiled letter holds the object it was handed.
   */
  function boundsOf(cell: THREE.Group): THREE.Vector4 {
    return uniformsOf(cell).uGradBounds?.value as THREE.Vector4;
  }

  function originOf(cell: THREE.Group): THREE.Vector2 {
    return uniformsOf(cell).uGradOrigin?.value as THREE.Vector2;
  }

  /** Settles the cells onto their laid-out positions, which a regroup leaves to the next pose. */
  function settle(word: Word): void {
    word.apply(
      timelineOf(() => ({})),
      0,
      NO_CTX,
    );
  }

  /** Runs the tint's shader patch against a stand-in shader and returns the uniforms it registered. */
  function uniformsOf(cell: THREE.Group): Record<string, { value: unknown }> {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <begin_vertex>\n',
      fragmentShader: '#include <emissivemap_fragment>\n',
    };
    decorMaterial(cell).onBeforeCompile?.(shader as never, undefined as never);
    return shader.uniforms;
  }

  /**
   * The letter's run centrelines in placement space, read back off what was actually swept: the
   * mesh spans one tube radius past the path on every side.
   */
  function runsOf(cell: THREE.Group): THREE.Box2 {
    const swept = new THREE.Box3();
    for (const child of drawn(cell).children.slice(1)) {
      const geo = (child as THREE.Mesh).geometry;
      geo.computeBoundingBox();
      swept.union(geo.boundingBox as THREE.Box3);
    }
    return new THREE.Box2(
      new THREE.Vector2(
        swept.min.x + RADIUS + cell.position.x,
        swept.min.y + RADIUS + cell.position.y,
      ),
      new THREE.Vector2(
        swept.max.x - RADIUS + cell.position.x,
        swept.max.y - RADIUS + cell.position.y,
      ),
    );
  }

  /** The union of every drawn letter's runs, in placement space. */
  function wordRuns(word: Word): THREE.Box2 {
    const box = new THREE.Box2();
    for (const cell of groups(word)) box.union(runsOf(cell as THREE.Group));
    return box;
  }

  it('spans every letter, not just the one the material belongs to', () => {
    const word = new Word('AB', stubFont(), SWEPT, ROOMY);
    const want = wordRuns(word);

    for (const cell of groups(word)) {
      const bounds = boundsOf(cell as THREE.Group);
      expect(bounds.x).toBeCloseTo(want.min.x, 5);
      expect(bounds.y).toBeCloseTo(want.min.y, 5);
      expect(bounds.z).toBeCloseTo(want.max.x, 5);
      expect(bounds.w).toBeCloseTo(want.max.y, 5);
    }
    // Wider than one letter by exactly the advance between them: a per-letter box would not be.
    const [a, b] = groups(word) as THREE.Group[];
    const single = runsOf(a as THREE.Group);
    expect(want.max.x - want.min.x).toBeCloseTo(
      single.max.x - single.min.x + ((b as THREE.Group).position.x - (a as THREE.Group).position.x),
      5,
    );
  });

  it('gives every letter the same bounds but its own offset', () => {
    const word = new Word('AB', stubFont(), SWEPT, ROOMY);
    const [a, b] = groups(word) as THREE.Group[];

    expect(boundsOf(a as THREE.Group).toArray()).toEqual(boundsOf(b as THREE.Group).toArray());
    expect(originOf(a as THREE.Group).toArray()).toEqual([
      (a as THREE.Group).position.x,
      (a as THREE.Group).position.y,
    ]);
    expect(originOf(b as THREE.Group).toArray()).toEqual([
      (b as THREE.Group).position.x,
      (b as THREE.Group).position.y,
    ]);
    expect(originOf(a as THREE.Group).x).not.toBe(originOf(b as THREE.Group).x);
  });

  it('keeps the per-letter boxes indexed by slot across a blank glyph', () => {
    const word = new Word('A B', stubFont(), SWEPT, ROOMY);
    const want = wordRuns(word);
    const bounds = boundsOf(groups(word)[0] as THREE.Group);

    // A slot the space failed to take would pair a letter's box with its neighbour's offset,
    // sliding the union by a whole advance.
    expect(bounds.x).toBeCloseTo(want.min.x, 5);
    expect(bounds.z).toBeCloseTo(want.max.x, 5);
    expect(word.letterCount).toBe(3);
  });

  it('excludes the fit, so a resize cannot slide the sweep across the sign', () => {
    const roomy = new Word('AB', stubFont(), SWEPT, ROOMY);
    const cramped = new Word('AB', stubFont(), SWEPT, { width: 1, height: 1 });

    expect(cramped.group.scale.x).not.toBeCloseTo(roomy.group.scale.x, 3);
    for (let i = 0; i < 2; i++) {
      const a = groups(roomy)[i] as THREE.Group;
      const b = groups(cramped)[i] as THREE.Group;
      expect(boundsOf(b).toArray()).toEqual(boundsOf(a).toArray());
      expect(originOf(b).toArray()).toEqual(originOf(a).toArray());
    }
  });

  it('bakes one ramp for the whole word', () => {
    const word = new Word('ABC', stubFont(), SWEPT, ROOMY);
    const ramps = groups(word).map((cell) => uniformsOf(cell as THREE.Group).uGradRamp?.value);

    expect(ramps).toHaveLength(3);
    expect(new Set(ramps).size).toBe(1);
    expect(ramps[0]).toBeInstanceOf(THREE.DataTexture);
  });

  it('disposes that ramp with the word', () => {
    const word = new Word('AB', stubFont(), SWEPT, ROOMY);
    const ramp = uniformsOf(groups(word)[0] as THREE.Group).uGradRamp?.value as THREE.Texture;
    const spy = vi.spyOn(ramp, 'dispose');

    word.dispose();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('follows the letters through a regroup, which does move them', () => {
    const word = new Word('ABCD', stubFont(), SWEPT, ROOMY);
    settle(word);
    const [a, b] = groups(word) as THREE.Group[];
    const bounds = boundsOf(a as THREE.Group);
    const origin = originOf(a as THREE.Group);
    const before = bounds.toArray();

    word.regroup((letter) => letter.index < 2, 'stack');
    settle(word);

    const want = new THREE.Box2().union(runsOf(a as THREE.Group)).union(runsOf(b as THREE.Group));
    expect(bounds.toArray()).not.toEqual(before);
    expect(bounds.x).toBeCloseTo(want.min.x, 5);
    expect(bounds.y).toBeCloseTo(want.min.y, 5);
    expect(bounds.z).toBeCloseTo(want.max.x, 5);
    expect(bounds.w).toBeCloseTo(want.max.y, 5);
    // Not toEqual: a settled cell holds +0 where the layout wrote -0.
    expect(origin.x).toBeCloseTo((a as THREE.Group).position.x, 10);
    expect(origin.y).toBeCloseTo((a as THREE.Group).position.y, 10);
    expect(originOf(b as THREE.Group).x).toBeCloseTo((b as THREE.Group).position.x, 10);
    expect(originOf(b as THREE.Group).y).toBeCloseTo((b as THREE.Group).position.y, 10);
    expect(origin.y).not.toBeCloseTo(originOf(b as THREE.Group).y, 3);
  });

  it('spans the letters a regroup kept, not the ones it dropped', () => {
    const word = new Word('ABCD', stubFont(), SWEPT, ROOMY);
    settle(word);
    const cells = groups(word) as THREE.Group[];
    const leaving = cells[3] as THREE.Group;
    const leavingOrigin = originOf(leaving);
    const before = leavingOrigin.toArray();
    const bounds = boundsOf(cells[0] as THREE.Group);

    word.regroup((letter) => letter.index < 2);
    settle(word);

    const want = new THREE.Box2()
      .union(runsOf(cells[0] as THREE.Group))
      .union(runsOf(cells[1] as THREE.Group));
    expect(bounds.x).toBeCloseTo(want.min.x, 5);
    expect(bounds.z).toBeCloseTo(want.max.x, 5);
    // A dropped letter stands where it stood until it retires, and reads the ramp from there.
    expect(leavingOrigin.toArray()).toEqual(before);
    expect(bounds.z).toBeLessThan(leaving.position.x);
  });

  it('keeps the slots aligned when a regroup carries a blank glyph', () => {
    const word = new Word('AB CD', stubFont(), SWEPT, ROOMY);
    settle(word);
    const cells = groups(word) as THREE.Group[];
    const bounds = boundsOf(cells[0] as THREE.Group);

    word.regroup((letter) => letter.index < 3, 'stack');
    settle(word);

    const want = new THREE.Box2()
      .union(runsOf(cells[0] as THREE.Group))
      .union(runsOf(cells[1] as THREE.Group));
    expect(word.letterCount).toBe(5);
    expect(bounds.x).toBeCloseTo(want.min.x, 5);
    expect(bounds.y).toBeCloseTo(want.min.y, 5);
    expect(bounds.z).toBeCloseTo(want.max.x, 5);
    expect(bounds.w).toBeCloseTo(want.max.y, 5);
  });

  it('leaves a look without a gradient entirely alone', () => {
    const word = new Word('AB', stubFont(), FLAT, ROOMY);
    const uniforms = uniformsOf(groups(word)[0] as THREE.Group);

    expect(uniforms.uGradRamp).toBeUndefined();
    expect(uniforms.uGradBounds).toBeUndefined();
  });
});

describe('frame-owned material properties', () => {
  /** The lit-run material of the first letter: the tube meshes follow the body in the cell. */
  function litTubeMaterial(word: Word): THREE.MeshPhysicalMaterial {
    const runs = drawn(groups(word)[0] as THREE.Group).children.slice(1);
    const materials = runs.map((run) => (run as THREE.Mesh).material as THREE.MeshPhysicalMaterial);
    const lit = materials.find((material) => material.emissive.getHex() !== 0x000000);
    if (!lit) throw new Error('the word has no lit tube run to measure');
    return lit;
  }

  function runOneFrame(word: Word): void {
    word.apply(
      timelineOf(() => ({})),
      50,
      NO_CTX,
    );
  }

  it('carries a look emissiveIntensity onto the material without any frame having run', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);

    expect(materialOf(word).emissiveIntensity).toBe(3.2);
  });

  // Poisoned first: asserting the value after a frame without disturbing it passes whether or
  // not the frame writes anything, since construction already put it there.
  it('rewrites the body emissiveIntensity every frame, not only at construction', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);
    const material = materialOf(word);
    material.emissiveIntensity = 999;

    runOneFrame(word);

    expect(material.emissiveIntensity).toBe(3.2);
  });

  // REST.opacity is 1, so the bare base is the at-rest value rather than a guess at a pose.
  it('seeds the base opacity at construction, before any pose exists', () => {
    const word = new Word('A', stubFont(), { opacity: 0.4 }, ROOMY);

    expect(materialOf(word).opacity).toBe(0.4);
  });

  it('leaves a look that declares none at the default', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    expect(materialOf(word).emissiveIntensity).toBe(1);
  });

  // A tube is lit by white x runColor x emissiveIntensity and its body is a backing declaring no
  // emissive at all, so resolving only the body base would leave the sign dark.
  it('carries a decoration emissiveIntensity onto the lit tube material', () => {
    const word = new Word('A', stubFont(), 'tubing', ROOMY);

    expect(litTubeMaterial(word).emissiveIntensity).toBe(3.4);
  });

  it('rewrites the lit tube emissiveIntensity every frame, not only at construction', () => {
    const word = new Word('A', stubFont(), 'tubing', ROOMY);
    const material = litTubeMaterial(word);
    material.emissiveIntensity = 999;

    runOneFrame(word);

    expect(material.emissiveIntensity).toBe(3.4);
  });
});

/**
 * The whole chain, end to end: a cursor over a letter on screen has to reach that letter's ink.
 * The unit tests either side of the mapping can both pass while the pair disagrees.
 */
describe('a cursor lands on the letter it is over', () => {
  const CANVAS = { left: 0, top: 0, width: 800, height: 400 };
  const CAMERA = { fov: 90, cameraZ: 4, aspect: 2, depth: 0, bevel: 0 };

  it.each([0, 1, 2, 3])('letter %i', (i) => {
    const word = new Word('HELLO', stubFont(), 'gold', { width: 6, height: 2 });
    const readout = word.readout();
    const projected = projectLetters({
      ...readout,
      ...CAMERA,
      width: CANVAS.width,
      height: CANVAS.height,
      baselineRatio: 0,
    });
    const box = projected.boxes[i] as { left: number; top: number };

    const frame = pointerFrame(
      CANVAS,
      { x: box.left, y: box.top },
      { fit: word.placement, ...CAMERA },
    );
    const aimed = frame.pointerInWord as { x: number; y: number };

    // The nearest part to where the cursor mapped is the one drawn under it.
    const parts = word.partsOf('body');
    const distances = parts.map((p) =>
      Math.hypot((p.ink.minX + p.ink.maxX) / 2 - aimed.x, (p.ink.minY + p.ink.maxY) / 2 - aimed.y),
    );
    const nearest = distances.indexOf(Math.min(...distances));

    expect(nearest).toBe(i);
  });
});

describe('part pool', () => {
  it('has one body part per drawn letter, numbered across the word', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const parts = word.partsOf('body');

    expect(parts.map((p) => p.index)).toEqual([0, 1]);
    expect(parts.every((p) => p.count === 2)).toBe(true);
    expect(parts[0]?.letter.index).toBe(0);
    expect(parts[1]?.letter.index).toBe(1);
  });

  it('draws no body part for a glyph with no outline', () => {
    expect(new Word('A B', stubFont(), 'gold', ROOMY).partsOf('body')).toHaveLength(2);
  });

  it('has no run parts on a look with no tube', () => {
    expect(new Word('A', stubFont(), 'gold', ROOMY).partsOf('run')).toHaveLength(0);
  });

  // A lamp measures to `ink`, so runs sharing one box means it can only light whole letters.
  it("gives each run part its own ink rather than the whole letter's", () => {
    const runs = new Word('A', stubFont(), 'tubing', ROOMY).partsOf('run');
    const key = (p: PartInfo) => `${p.ink.minX}|${p.ink.maxX}|${p.ink.minY}|${p.ink.maxY}`;

    expect(runs.length).toBeGreaterThan(1);
    expect(new Set(runs.map(key)).size).toBeGreaterThan(1);
  });

  it('makes at least one run narrower than the letter it belongs to', () => {
    const word = new Word('A', stubFont(), 'tubing', ROOMY);
    const extent = word.partExtent() as { minX: number; maxX: number };
    const narrowest = Math.min(...word.partsOf('run').map((p) => p.ink.maxX - p.ink.minX));

    expect(narrowest).toBeLessThan(extent.maxX - extent.minX);
  });

  it('numbers run parts across the whole word, not per letter', () => {
    const word = new Word('AA', stubFont(), 'tubing', ROOMY);
    const parts = word.partsOf('run');

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.index)).toEqual(parts.map((_, n) => n));
    expect(new Set(parts.map((p) => p.letter.index))).toEqual(new Set([0, 1]));
  });

  it("carries each part's own ink, offset by its origin", () => {
    const parts = new Word('AA', stubFont(), 'gold', ROOMY).partsOf('body');
    const [a, b] = parts as [PartInfo, PartInfo];

    // Same line, so the origins share a y and only x steps; the ink follows the origin.
    expect(a.y).toBe(b.y);
    expect(b.ink.minX - a.ink.minX).toBeCloseTo(b.x - a.x, 5);
    expect(a.ink.minY).toBeCloseTo(b.ink.minY, 5);
    expect(a.ink.maxY).toBeCloseTo(b.ink.maxY, 5);
  });

  // The whole point of the field: a lamp measuring to origins on a single line has one y to
  // measure against, and the letters stand well above it.
  it('gives the ink a height the origins on one line do not have', () => {
    const parts = new Word('AA', stubFont(), 'gold', ROOMY).partsOf('body');

    expect(new Set(parts.map((p) => p.y)).size).toBe(1);
    for (const part of parts) expect(part.ink.maxY - part.ink.minY).toBeGreaterThan(0);
  });

  it('drops the ink of a descender below the ink of one that sits on the baseline', () => {
    const parts = new Word('ag', stubFont(), 'gold', ROOMY).partsOf('body');
    const [flat, drops] = parts as [PartInfo, PartInfo];

    expect(drops.ink.minY).toBeLessThan(flat.ink.minY);
  });

  it("unions the parts' ink into exactly the pool extent", () => {
    const word = new Word('Ag', stubFont(), 'tubing', ROOMY);
    const extent = word.partExtent();
    const parts = [...word.partsOf('body'), ...word.partsOf('run')];

    expect(extent).toEqual({
      minX: Math.min(...parts.map((p) => p.ink.minX)),
      maxX: Math.max(...parts.map((p) => p.ink.maxX)),
      minY: Math.min(...parts.map((p) => p.ink.minY)),
      maxY: Math.max(...parts.map((p) => p.ink.maxY)),
    });
  });

  it('gives every run part a share of the pool extent that sums to one', () => {
    const parts = new Word('AA', stubFont(), 'tubing', ROOMY).partsOf('run');
    const total = parts.reduce((a, p) => a + p.span, 0);

    expect(total).toBeCloseTo(1, 5);
  });

  it('pairs a lit mesh with a lit run for every letter of both tube looks', () => {
    for (const look of ['tubing', 'piping'] as const) {
      for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        expect(() => new Word(char, stubFont(), look, ROOMY)).not.toThrow();
      }
    }
  });

  it('shares the pool extent by arc length, so a longer run takes more of it', () => {
    const word = new Word('AA', stubFont(), 'tubing', ROOMY);
    const parts = word.partsOf('run');
    // Lit meshes come first in a cell and share one material; pool order walks the cells in turn.
    const lit = groups(word).flatMap((cell) => {
      const litMaterial = (drawn(cell).children[1] as THREE.Mesh).material;
      return (drawn(cell).children.slice(1) as THREE.Mesh[]).filter(
        (m) => m.material === litMaterial,
      );
    });
    const extent = lit.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      return (mesh.geometry.boundingBox as THREE.Box3).getSize(new THREE.Vector3()).length();
    });

    expect(lit).toHaveLength(parts.length);
    const longest = extent.indexOf(Math.max(...extent));
    const shortest = extent.indexOf(Math.min(...extent));
    expect(parts[longest]?.span).toBeGreaterThan((parts[shortest]?.span as number) * 1.5);
  });

  it('is a construction-time snapshot a regroup re-lays the letters around', () => {
    const word = new Word('ABCD', stubFont(), 'gold', ROOMY);
    const before = word
      .partsOf('body')
      .map((p) => [p.index, p.count, p.letter.count, p.x] as const);
    const { delta } = word.regroup((l) => l.index < 2, 'line');

    // The survivors really did move, so the pool holding still is the snapshot and not a no-op.
    expect(delta[0]?.[0]).not.toBe(0);
    expect(
      word.partsOf('body').map((p) => [p.index, p.count, p.letter.count, p.x] as const),
    ).toEqual(before);
  });

  it('carries its letter grid position, so a radial stagger has something to read', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    // Middle row, left column: off centre on the grid, but near the middle in reading order.
    const part = word.partsOf('body')[2] as PartInfo;

    expect([part.line, part.column, part.lineCount, part.columnCount]).toEqual([1, 0, 3, 2]);
    expect(orderKey(part, { grid: true, from: 'center' })).not.toBeCloseTo(
      orderKey(part, { from: 'center' }),
      5,
    );
  });
});

describe('effects', () => {
  const STILL = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });
  /** A fixed gain on every part it is handed, so these assert routing rather than a waveform. */
  const half: EffectPiece = { duration: 1000, at: () => ({ gain: 0.5 }) };
  /** The pool's first part, in its own numbering. */
  const FIRST = { by: 'index', count: 1 } as const;

  function tubingWith(effects: LookSpec['effects']): Word {
    return new Word('AA', stubFont(), { ...specOf('tubing'), effects }, ROOMY);
  }

  /** Lit runs in pool order: they follow the body in each cell and share that cell's material. */
  function runColorOf(word: Word, ordinal: number, channel: 'r' | 'g' | 'b' = 'r'): number {
    const meshes = groups(word).flatMap((cell) => {
      const lit = (drawn(cell).children[1] as THREE.Mesh).material;
      return (drawn(cell).children.slice(1) as THREE.Mesh[]).filter((m) => m.material === lit);
    });
    const mesh = meshes[ordinal];
    if (!mesh) throw new Error(`the word has no run ${ordinal}`);
    const runColor = mesh.geometry.getAttribute('runColor');
    if (channel === 'g') return runColor.getY(0);
    return channel === 'b' ? runColor.getZ(0) : runColor.getX(0);
  }

  /** The crawl buffer only exists where the look declared a gradient. */
  function crawlOf(word: Word, ordinal: number): number | null {
    const meshes = groups(word).flatMap((cell) => {
      const lit = (drawn(cell).children[1] as THREE.Mesh).material;
      return (drawn(cell).children.slice(1) as THREE.Mesh[]).filter((m) => m.material === lit);
    });
    const mesh = meshes[ordinal];
    if (!mesh) throw new Error(`the word has no run ${ordinal}`);
    const a = mesh.geometry.getAttribute('crawlT');
    return a ? a.getX(0) : null;
  }

  const RAMP: GradientSpec = {
    domain: { of: 'run' },
    stops: [0xff0000, 0x0000ff],
    mode: 'replace',
  };

  function gradientTubingWith(effects: LookSpec['effects']): Word {
    const base = specOf('tubing');
    const decoration = { ...base.decoration, gradient: RAMP } as LookSpec['decoration'];
    return new Word('AA', stubFont(), { ...base, decoration, effects }, ROOMY);
  }

  it('gives a gradient look a crawl buffer, and a flat one none', () => {
    expect(crawlOf(gradientTubingWith(undefined), 0)).toBe(0);
    expect(crawlOf(tubingWith(undefined), 0)).toBeNull();
  });

  it('drives the crawl buffer from an effect that writes the channel', () => {
    const slide: EffectPiece = { duration: 1000, at: () => ({ crawl: 0.25 }) };
    const word = gradientTubingWith([{ piece: slide, target: { kind: 'run', ...FIRST } }]);
    word.apply(STILL, 0, NO_CTX);
    expect(crawlOf(word, 0)).toBeCloseTo(0.25, 6);
  });

  it('leaves the crawl buffer at rest for a part no effect targets', () => {
    const slide: EffectPiece = { duration: 1000, at: () => ({ crawl: 0.25 }) };
    const word = gradientTubingWith([{ piece: slide, target: { kind: 'run', ...FIRST } }]);
    word.apply(STILL, 0, NO_CTX);
    expect(crawlOf(word, 1)).toBe(0);
  });

  // The tint used to be written to the decoration material's emissive, which tintByRunColor then
  // set to white so the run attribute could drive the channel exactly. It never reached a frame.
  it('tints a tube look by recolouring the runs, not the material', () => {
    const plain = new Word('AA', stubFont(), 'tubing', ROOMY);
    const tinted = new Word('AA', stubFont(), 'tubing', ROOMY, false, 0x22d3ee);

    expect(runColorOf(plain, 0)).not.toBeCloseTo(runColorOf(tinted, 0), 6);
  });

  it('gives a tinted tube run exactly the colour asked for', () => {
    const tinted = new Word('AA', stubFont(), 'tubing', ROOMY, false, 0x22d3ee);
    const want = new THREE.Color(0x22d3ee);

    expect(runColorOf(tinted, 0)).toBeCloseTo(want.r, 5);
  });

  it('leaves every part alone when a look declares no effects', () => {
    const word = tubingWith(undefined);
    const before = [runColorOf(word, 0), runColorOf(word, 1)];

    word.apply(STILL, 0, NO_CTX);

    expect([runColorOf(word, 0), runColorOf(word, 1)]).toEqual(before);
  });

  it('scales a targeted run by the gain and leaves an untargeted one at its own colour', () => {
    const word = tubingWith([{ piece: half, target: { kind: 'run', ...FIRST } }]);
    const before = [runColorOf(word, 0), runColorOf(word, 1)];

    word.apply(STILL, 0, NO_CTX);

    expect(runColorOf(word, 0)).toBeCloseTo((before[0] as number) * 0.5, 6);
    expect(runColorOf(word, 1)).toBe(before[1]);
  });

  // Composing from the buffer instead of from the part's own colour passes the test above and
  // fades the sign to black over a few seconds; this is the one that catches it.
  it('does not compound across frames', () => {
    const word = tubingWith([{ piece: half, target: { kind: 'run', ...FIRST } }]);

    word.apply(STILL, 0, NO_CTX);
    const once = runColorOf(word, 0);
    word.apply(STILL, 16, NO_CTX);
    word.apply(STILL, 32, NO_CTX);

    expect(runColorOf(word, 0)).toBe(once);
  });

  it('layers two effects onto the part they both target', () => {
    const word = tubingWith([
      { piece: half, target: { kind: 'run', ...FIRST } },
      { piece: half, target: { kind: 'run', ...FIRST } },
    ]);
    const before = runColorOf(word, 0);

    word.apply(STILL, 0, NO_CTX);

    expect(runColorOf(word, 0)).toBeCloseTo(before * 0.25, 6);
  });

  it('drives a body through emissiveIntensity rather than through the attribute', () => {
    const word = new Word(
      'A',
      stubFont(),
      { ...specOf('neon'), effects: [{ piece: half, target: { kind: 'body', ...FIRST } }] },
      ROOMY,
    );

    word.apply(STILL, 0, NO_CTX);

    expect(materialOf(word).emissiveIntensity).toBeCloseTo(1.6, 6);
  });

  const lamplight: EffectPiece = {
    duration: 1000,
    at: () => ({ light: { color: 0xffffff, amount: 0.5 } }),
  };

  // A `hue` piece and a `lamp` on one run: the light has to tint by the colour the run is showing,
  // or the lit pool keeps adding the original tube colour while the base sweeps away from it.
  it('lights a recoloured run in the colour it is showing, not the one it was built with', () => {
    const bluedAndLit: EffectPiece = {
      duration: 1000,
      at: () => ({ color: 0x0000ff, light: { color: 0xffffff, amount: 1 } }),
    };
    const word = tubingWith([{ piece: bluedAndLit, target: { kind: 'run', ...FIRST } }]);

    word.apply(STILL, 0, NO_CTX);

    expect(runColorOf(word, 0, 'r')).toBe(0);
    expect(runColorOf(word, 0, 'g')).toBe(0);
  });

  function extentOf(text: string): { minX: number; maxX: number; minY: number; maxY: number } {
    const extent = new Word(text, stubFont(), 'gold', ROOMY).partExtent();
    if (!extent) throw new Error(`'${text}' has no parts`);
    return extent;
  }

  it('has no part extent at all for a word with nothing to draw', () => {
    expect(new Word('  ', stubFont(), 'gold', ROOMY).partExtent()).toBeNull();
  });

  // Origins alone give a single-line sign a box of zero height: placement puts every letter on a
  // line at the same baseline, and a pointer mapped into that box could never move vertically.
  it('measures the part extent by a glyph ink rather than by its origin or its advance', () => {
    const one = extentOf('A');

    expect(one.maxY - one.minY).toBeGreaterThan(0);
    expect(one.maxY - one.minY).toBeLessThan(LINE_HEIGHT_EM);
    expect(one.maxX - one.minX).toBeLessThan(STEP);
  });

  // Relating the shapes pins the baseline and the advance without pinning the extrusion's bevel.
  it('grows the part extent by an advance for a letter and a line height for a line', () => {
    const one = extentOf('A');
    const row = extentOf('AA');
    const stack = extentOf('A\nA');

    expect(row.maxX - row.minX).toBeCloseTo(one.maxX - one.minX + STEP, 6);
    expect(row.maxY - row.minY).toBeCloseTo(one.maxY - one.minY, 6);
    expect(stack.maxY - stack.minY).toBeCloseTo(one.maxY - one.minY + LINE_HEIGHT_EM, 6);
  });

  it('lights every body part off its own letter, blanks in the word included', () => {
    const word = new Word(
      'A B',
      stubFont(),
      { ...specOf('neon'), effects: [{ piece: lamplight, target: { kind: 'body', by: 'index' } }] },
      ROOMY,
    );
    const unlit = new THREE.Color(0xff2d95);

    word.apply(STILL, 0, NO_CTX);

    const green = meshes(word).map((m) => (m.material as THREE.MeshPhysicalMaterial).emissive.g);
    expect(green).toHaveLength(2);
    for (const g of green) expect(g).toBeGreaterThan(unlit.g);
  });

  it('reflects the tint a look was given rather than the colour the tint replaced', () => {
    const word = new Word(
      'A',
      stubFont(),
      { ...specOf('neon'), effects: [{ piece: lamplight, target: { kind: 'body', by: 'index' } }] },
      ROOMY,
      false,
      0x008000,
    );

    word.apply(STILL, 0, NO_CTX);

    const emissive = materialOf(word).emissive;
    expect(emissive.r).toBe(0);
    expect(emissive.g).toBeGreaterThan(new THREE.Color(0x008000).g);
  });

  // tubing's runs are 0xff2d95, so red is already saturated and clamping cannot raise it: a lamp
  // this test can see has to be read off green or blue.
  it('adds lamp light into a run colour', () => {
    const word = tubingWith([{ piece: lamplight, target: { kind: 'run', by: 'index' } }]);
    const before = runColorOf(word, 0, 'g');

    word.apply(STILL, 0, NO_CTX);

    expect(runColorOf(word, 0, 'g')).toBeGreaterThan(before);
  });

  it('lets a lamp go when a regroup drops the letter it was lighting', () => {
    const word = new Word(
      'AB',
      stubFont(),
      { ...specOf('neon'), effects: [{ piece: lamplight, target: { kind: 'body', ...FIRST } }] },
      ROOMY,
    );
    const unlit = new THREE.Color(0xff2d95);

    word.apply(STILL, 0, NO_CTX);
    const lit = materialOf(word).emissive.g;
    word.regroup((letter) => letter.index === 1, 'line');
    word.apply(STILL, 0, NO_CTX);

    expect(lit).toBeGreaterThan(unlit.g);
    expect(materialOf(word).emissive.g).toBeCloseTo(unlit.g, 6);
  });

  it('skips a run whose material came from a debug override and has no run-colour contract', () => {
    const lit = new THREE.MeshBasicMaterial();
    const word = new Word(
      'AA',
      stubFont(),
      { ...specOf('tubing'), effects: [{ piece: half, target: { kind: 'run', ...FIRST } }] },
      ROOMY,
      false,
      undefined,
      { tubeMaterial: (which) => (which === 'lit' ? lit : new THREE.MeshBasicMaterial()) },
    );
    const before = runColorOf(word, 0);

    word.apply(STILL, 0, NO_CTX);

    expect(runColorOf(word, 0)).toBe(before);
  });

  it('stops writing a part whose letter a regroup dropped', () => {
    const word = new Word(
      'AB',
      stubFont(),
      { ...specOf('neon'), effects: [{ piece: half, target: { kind: 'body', ...FIRST } }] },
      ROOMY,
    );

    word.apply(STILL, 0, NO_CTX);
    const driven = materialOf(word).emissiveIntensity;
    word.regroup((letter) => letter.index === 1, 'line');
    word.apply(STILL, 0, NO_CTX);

    expect(driven).toBeCloseTo(materialOf(word).emissiveIntensity * 0.5, 6);
  });

  it('never consults a piece whose target came up empty', () => {
    const at = vi.fn<EffectPiece['at']>(() => ({ gain: 0.5 }));
    const word = tubingWith([
      { piece: { duration: 1000, at }, target: { kind: 'run', by: 'index', count: 0 } },
    ]);
    const before = [runColorOf(word, 0), runColorOf(word, 1)];

    word.apply(STILL, 0, NO_CTX);

    expect(at).not.toHaveBeenCalled();
    expect([runColorOf(word, 0), runColorOf(word, 1)]).toEqual(before);
  });

  // The premise the whole approach rests on: an effect is a write into what the look already
  // built, so declaring one costs no material, no mesh and so no extra compiled program.
  it('adds no material and no mesh, however many parts it drives', () => {
    const plain = census(new Word('AA', stubFont(), specOf('tubing'), ROOMY));
    const driven = census(tubingWith([{ piece: half, target: { kind: 'run', by: 'index' } }]));

    expect(driven).toEqual(plain);
    // Without this the assertion above would also pass a word that gave every part its own
    // material, since both sides would have done it.
    expect(plain.materials).toBeLessThan(plain.meshes);
  });

  it('offsets a targeted part on the mesh, so it composes with the pose on the cell', () => {
    const lift: EffectPiece = { duration: 1000, at: () => ({ position: [0, 0.25, 0] }) };
    const word = tubingWith([{ piece: lift, target: { kind: 'run', ...FIRST } }]);

    const cell = groups(word)[0] as THREE.Group;
    const rest = cell.position.x;

    word.apply(
      timelineOf(() => ({ position: [1, 0, 0] })),
      50,
      NO_CTX,
    );

    const run = drawn(cell).children[1] as THREE.Mesh;
    expect(cell.position.x).toBeCloseTo(rest + 1, 10);
    expect([run.position.x, run.position.y]).toEqual([0, 0.25]);
  });
});

describe('readout', () => {
  it('reports one entry per live letter, with the fit that maps em to world', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    const out = word.readout();

    expect(out.chars).toEqual(['A', 'B']);
    expect(out.x).toHaveLength(2);
    expect(out.y).toHaveLength(2);
    expect(out.line).toEqual([0, 0]);
    expect(out.fit.scale).toBeGreaterThan(0);
  });

  it('reports which line each letter is on, so a caller can break the text between them', () => {
    const out = new Word('AB\nCD', stubFont(), 'gold', ROOMY).readout();

    expect(out.chars).toEqual(['A', 'B', 'C', 'D']);
    expect(out.line).toEqual([0, 0, 1, 1]);
  });

  it('drops a letter a regroup retired', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.regroup((l) => l.index === 0, 'line');

    expect(word.readout().chars).toEqual(['A']);
  });
});

describe("a run's size", () => {
  /** Halves the second letter, the way a `size: 0.5` run does. */
  const HALF = (slot: number) => (slot === 1 ? 0.5 : 1);

  function sizedWord(): Word {
    return new Word(
      'AB',
      stubFont(),
      'gold',
      ROOMY,
      false,
      undefined,
      undefined,
      null,
      undefined,
      HALF,
    );
  }

  it('scales a run below the cell the pose writes', () => {
    const cell = groups(sizedWord())[1] as THREE.Group;

    expect(cell.scale.x).toBe(1);
    expect(drawn(cell).scale.x).toBeCloseTo(0.5);
  });

  it('keeps a sized letter at rest, so the selectable layer still aligns', () => {
    const word = sizedWord();
    word.apply(
      timelineOf(() => ({})),
      50,
      NO_CTX,
    );

    expect(word.atRest()).toBe(true);
  });

  it('survives a pose, which writes the cell scale every frame', () => {
    const word = sizedWord();
    word.apply(
      timelineOf(() => ({})),
      50,
      NO_CTX,
    );

    expect(drawn(groups(word)[1] as THREE.Group).scale.x).toBeCloseTo(0.5);
  });
});

describe('atRest', () => {
  /** Leaves every letter on its layout position, the way a finished timeline does. */
  const rest = timelineOf(() => ({}));

  it('is true for a word nothing has posed', () => {
    expect(new Word('AB', stubFont(), 'gold', ROOMY).atRest()).toBe(true);
  });

  it('is false while a piece holds a letter off its layout position', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ position: [0, 1, 0] })),
      0,
      NO_CTX,
    );

    expect(word.atRest()).toBe(false);
  });

  it('is false while a piece spins or grows a letter in place', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ rotation: [0, 0.4, 0] })),
      0,
      NO_CTX,
    );
    expect(word.atRest()).toBe(false);

    word.apply(
      timelineOf(() => ({ scale: 1.5 })),
      0,
      NO_CTX,
    );
    expect(word.atRest()).toBe(false);
  });

  it('is false until a regroup has moved the survivors onto their new positions', () => {
    const word = new Word('ABC', stubFont(), 'gold', ROOMY);
    word.regroup((l) => l.index < 2, 'line');
    word.setFitProgress(1);
    expect(word.atRest()).toBe(false);

    word.apply(rest, 0, NO_CTX);
    expect(word.atRest()).toBe(true);
  });

  it('is false part-way through a fit tween and true once it settles', () => {
    const word = new Word('ABCDE', stubFont(), 'gold', { width: 2, height: 2 });
    word.regroup((l) => l.index < 2, 'line');
    word.apply(rest, 0, NO_CTX);

    word.setFitProgress(0.5);
    expect(word.atRest()).toBe(false);

    word.setFitProgress(1);
    expect(word.atRest()).toBe(true);
  });

  it('ignores a letter the regroup left behind to play its exit', () => {
    const word = new Word('ABC', stubFont(), 'gold', ROOMY);
    word.regroup((l) => l.index < 2, 'line');
    word.setFitProgress(1);
    word.apply(
      timelineOf((_t, letter) => (letter.leaving ? { position: [0, -3, 0] } : {})),
      0,
      NO_CTX,
    );

    expect(word.atRest()).toBe(true);
  });
});

describe('layoutVersion', () => {
  it('changes when a regroup re-lays the letters', () => {
    const word = new Word('ABC', stubFont(), 'gold', ROOMY);
    const before = word.layoutVersion;
    word.regroup((l) => l.index < 2, 'line');

    expect(word.layoutVersion).not.toBe(before);
  });
});

describe('framing alignment', () => {
  /** 'AA' spans 1.2 em of advance; a 1.2-wide budget scales it by 1 and its outline ends at 0.5. */
  const START: Budget = { width: 1.2, height: 100, extent: 4, edge: 'left' };
  const END: Budget = { width: 1.2, height: 100, extent: 4, edge: 'right' };
  /**
   * Cap-bound, so the word is narrower than its budget. A width-bound fit lands the paint on
   * `-width / 2` whatever the letters are, which would leave a regroup nothing to move.
   */
  const LOOSE: Budget = { width: 100, height: 100, extent: 4, edge: 'left' };
  /** The bevel is lit geometry, so the paint runs this much wider than the glyph outline. */
  const BEVEL = DEFAULT_GLYPH_OPTIONS.bevelSize;

  it('leaves a centred word on the origin', () => {
    expect(new Word('AA', stubFont(), 'gold', ROOMY).group.position.x).toBe(0);
  });

  it('puts the leftmost paint on the box edge', () => {
    const word = new Word('AA', stubFont(), 'gold', START);

    expect(word.group.position.x + (-STEP - BEVEL) * word.group.scale.x).toBeCloseTo(-2, 6);
  });

  it('puts the rightmost paint on the box edge', () => {
    const word = new Word('AA', stubFont(), 'gold', END);

    expect(word.group.position.x + (0.5 + BEVEL) * word.group.scale.x).toBeCloseTo(2, 6);
  });

  it('meets the edge with the bevel, not with the outline it swells past', () => {
    const word = new Word('AA', stubFont(), 'gold', START);

    // Aligning the outline alone would leave the lit edge of the sign hanging over the box.
    expect(word.group.position.x + -STEP * word.group.scale.x).toBeGreaterThan(-2);
  });

  it('moves the alignment with the fit across a regroup', () => {
    const word = new Word('AA', stubFont(), 'gold', LOOSE);
    const before = word.group.position.x;
    expect(before + (-STEP - BEVEL) * word.group.scale.x).toBeCloseTo(-2, 6);

    word.regroup((letter) => letter.index === 0);
    word.setFitProgress(0);
    expect(word.group.position.x).toBeCloseTo(before, 6);

    word.setFitProgress(1);
    const after = word.group.position.x;
    // One letter re-centres, so its paint starts half an advance nearer the origin.
    expect(after + (-STEP / 2 - BEVEL) * word.group.scale.x).toBeCloseTo(-2, 6);
    expect(after).not.toBeCloseTo(before, 6);

    word.setFitProgress(0.5);
    expect(word.group.position.x).toBeCloseTo((before + after) / 2, 6);
  });

  it('is not at rest until the alignment has landed', () => {
    const word = new Word('AA', stubFont(), 'gold', LOOSE);
    word.regroup((letter) => letter.index === 0);
    // The survivor onto its new layout position, the way a finished timeline leaves it.
    word.apply(
      timelineOf(() => ({})),
      0,
      NO_CTX,
    );

    word.setFitProgress(0.5);
    expect(word.atRest()).toBe(false);

    word.setFitProgress(1);
    expect(word.atRest()).toBe(true);
  });

  it('reports the offset in the readout the text layer projects from', () => {
    const word = new Word('AA', stubFont(), 'gold', START);

    expect(word.readout().fit.offsetX).toBe(word.group.position.x);
  });
});
