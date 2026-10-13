import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LetterInfo } from '../../../src/motion/types.js';
import type { PoseDelta } from '../../../src/pose.js';
import { WordCaches } from '../../../src/render/caches.js';
import type { LookSpec } from '../../../src/render/looks.js';
import { Word } from '../../../src/render/word.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../src/text/glyphs.js';
import { compose, fromEuler } from '../../../src/transform.js';
import {
  drawn,
  groups,
  HOST,
  inkCenter,
  inkCenterY,
  inkSpanY,
  materialOf,
  meshes,
  NBSP,
  ROOMY,
  registerStubFace,
  STEP,
  stubFont,
  timelineOf,
  ZWJ,
} from './harness.js';

beforeAll(registerStubFace);

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
      HOST,
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
      HOST,
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
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      50,
      HOST,
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
    const fadeByIndex = (_t: number, letter: LetterInfo): PoseDelta => ({
      opacity: letter.index === 0 ? 1 : 0,
    });

    word.apply(timelineOf(fadeByIndex), 50, HOST);

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
      HOST,
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
      HOST,
    );

    expect(materialOf(word).opacity).toBe(0);
  });

  it('treats a look with no declared opacity as fully opaque', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 0.4 })),
      50,
      HOST,
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

  it('turns about the middle of the ink, so a half roll leaves it where it stood', () => {
    // The descender drops the ink's middle below the baseline, which a turn about the origin misses.
    const word = new Word('Ag', stubFont(), 'gold', ROOMY);
    const middle = () => {
      word.group.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(word.group).getCenter(new THREE.Vector3());
    };
    const before = middle();

    word.transform = fromEuler(0, 0, Math.PI);

    const after = middle();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('yaws and pitches about the face, so the ink there stays where it stood', () => {
    // A roll cannot see depth; a yaw about the extrusion's back plane swings the face sideways.
    const word = new Word('AAAA', stubFont(), 'gold', ROOMY);
    const { fit } = word.readout();
    const face = new THREE.Vector3(fit.midX, fit.midY, DEFAULT_GLYPH_OPTIONS.depth);
    const world = () => {
      word.group.updateMatrixWorld(true);
      return (word.group.children[0] as THREE.Object3D).localToWorld(face.clone());
    };
    const before = world();

    word.transform = fromEuler(0.4, 0.6, 0);

    const after = world();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });

  it('turns about the ink where its pose holds it, not where it rests', () => {
    // An entrance holding the letters deep behind the rest plane flew out of frame on a yaw.
    const word = new Word('AAAA', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ position: [0.5, 0.2, -26], scale: 0.55 })),
      50,
      HOST,
    );
    word.group.updateMatrixWorld(true);
    // The middle of each letter's face, held in the letter's own space so it rides the turn.
    const faces = groups(word).map((cell) => {
      const box = new THREE.Box3().setFromObject(cell);
      const local = cell.worldToLocal(box.getCenter(new THREE.Vector3()));
      return { cell, local: local.setZ(DEFAULT_GLYPH_OPTIONS.depth) };
    });
    const middle = () => {
      word.group.updateMatrixWorld(true);
      const sum = new THREE.Vector3();
      for (const { cell, local } of faces) sum.add(cell.localToWorld(local.clone()));
      return sum.divideScalar(faces.length);
    };
    const before = middle();

    word.transform = fromEuler(0.4, 0.6, 0);

    const after = middle();
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(after.z).toBeCloseTo(before.z, 2);
  });

  it('moves the face by as much of the frame as a move at z = 0 would cover', () => {
    const word = new Word(
      'A',
      stubFont(),
      'gold',
      ROOMY,
      false,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      {
        cameraZ: () => 11,
      },
    );
    const { fit } = word.readout();
    const face = new THREE.Vector3(fit.midX, fit.midY, DEFAULT_GLYPH_OPTIONS.depth);
    const seen = () => {
      word.group.updateMatrixWorld(true);
      const p = (word.group.children[0] as THREE.Object3D).localToWorld(face.clone());
      return p.x / (11 - p.z);
    };
    const before = seen();

    word.transform = compose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1]);

    expect(seen() - before).toBeCloseTo(1 / 11, 6);
  });

  it('moves the word by its translation in world units, whatever the fit', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    expect(word.group.scale.x).not.toBeCloseTo(1, 2);
    const x = () => {
      word.group.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(word.group).getCenter(new THREE.Vector3()).x;
    };
    const before = x();

    word.transform = compose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1]);

    expect(x() - before).toBeCloseTo(1, 6);
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
      HOST,
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
      HOST,
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

  const wordWith = (decoration: LookSpec['decoration']) =>
    new Word('A', stubFont(), { opacity: 1, decoration }, ROOMY);

  it('draws the body from the builder when the decoration supplies one', () => {
    const carved = wordWith({
      kind: 'well',
      cutter: 'lattice',
      bezel: 0.012,
      floor: 0.09,
      pitch: 0.068,
      size: 0.048,
      look: {},
    });
    const plain = wordWith(undefined);

    const bodyOf = (word: Word) =>
      ((groups(word)[0] as THREE.Group).children[0] as THREE.Group).children[0] as THREE.Mesh;

    expect(bodyOf(carved).geometry.getAttribute('position').count).not.toBe(
      bodyOf(plain).geometry.getAttribute('position').count,
    );
    carved.dispose();
    plain.dispose();
  });

  it('drives body and decoration from one pose', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);
    const cell = groups(word)[0] as THREE.Group;
    const rest = cell.position.x;

    word.apply(
      timelineOf(() => ({ position: [3, 0, 0] })),
      50,
      HOST,
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
      HOST,
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
