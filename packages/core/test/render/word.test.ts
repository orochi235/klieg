import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '../../src/motion/compositor.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import { NONE } from '../../src/motion/types.js';
import type { PoseOffset } from '../../src/pose.js';
import type { FlakeUniforms } from '../../src/render/flake.js';
import type { LookSpec } from '../../src/render/looks.js';
import type { GradientSpec } from '../../src/render/tube/gradient.js';
import { Word } from '../../src/render/word.js';
import type { LoadedFont } from '../../src/text/font.js';
import type { Budget } from '../../src/text/layout.js';
import { fromEuler } from '../../src/transform.js';

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
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: BLANK.has(char)
          ? []
          : boxPath(0.5 * size, 0.7 * size, DESCENDS.has(char) ? -0.2 * size : 0),
      }),
    }),
  } as unknown as Font;

  return {
    font,
    unitsPerEm: UPEM,
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
  };
}

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

function meshes(word: Word): THREE.Mesh[] {
  return groups(word).map((g) => g.children[0] as THREE.Mesh);
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

    word.apply(timelineOf(fadeByIndex), 50);

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
    );

    expect(materialOf(word).opacity).toBe(0);
  });

  it('treats a look with no declared opacity as fully opaque', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 0.4 })),
      50,
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

    expect(groups(word)[0]?.children.length).toBeGreaterThan(1);
  });

  it('drives body and decoration from one pose', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);
    const cell = groups(word)[0] as THREE.Group;
    const rest = cell.position.x;

    word.apply(
      timelineOf(() => ({ position: [3, 0, 0] })),
      50,
    );

    expect(cell.position.x).toBeCloseTo(rest + 3, 5);
    // The pose lands once, on the cell: body and decoration ride it rather than being posed apart.
    for (const child of cell.children) expect(child.position.x).toBe(0);
  });

  it('fades body and decoration to their own base opacities', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);

    word.apply(
      timelineOf(() => ({ opacity: 0.5 })),
      50,
    );

    const group = groups(word)[0] as THREE.Group;
    const body = (group.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const decor = (group.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(body.opacity).toBeCloseTo(0.05, 10);
    expect(decor.opacity).toBeCloseTo(0.5, 10);
  });

  it('disposes decoration materials and the decoration cache', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);
    const group = groups(word)[0] as THREE.Group;
    const decor = (group.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const spy = vi.spyOn(decor, 'dispose');

    word.dispose();

    expect(spy).toHaveBeenCalled();
  });

  it('disposes every tube run geometry along with its per-letter blueprint', () => {
    const word = new Word('AB', stubFont(), TUBE, ROOMY);
    const spies = groups(word).map((group) =>
      group.children.slice(1).map((child) => vi.spyOn((child as THREE.Mesh).geometry, 'dispose')),
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
    const instanced = (groups(word)[0] as THREE.Group).children[1] as THREE.InstancedMesh;

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
    const instanced = (groups(word)[0] as THREE.Group).children[1] as THREE.InstancedMesh;
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
    return cell.children
      .slice(1)
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
    const decorMeshes = (cell as THREE.Group).children.slice(1) as THREE.Mesh[];

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
    const decor = (cell as THREE.Group).children[1] as THREE.Mesh;

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
        ((cell.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial).userData
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
    );
    expect((seen[0]?.y as number) - (seen[1]?.y as number)).toBeCloseTo(1.1);
  });
});

describe('regroup', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;

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
    );
    word.regroup(firstOfLine, 'line');
    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
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
    );

    const direct = new Word('NEO', stubFont(), 'gold', ROOMY);
    const plain: number[] = [];
    direct.apply(
      timelineOf((_t, letter) => {
        plain.push(letter.x as number);
        return {};
      }),
      0,
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
      const mesh = (cell as THREE.Group).children[0] as THREE.Mesh;
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
    return (cell.children[1] as THREE.Mesh).material as THREE.Material;
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
    for (const child of cell.children.slice(1)) {
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
    const runs = (groups(word)[0] as THREE.Group).children.slice(1);
    const materials = runs.map((run) => (run as THREE.Mesh).material as THREE.MeshPhysicalMaterial);
    const lit = materials.find((material) => material.emissive.getHex() !== 0x000000);
    if (!lit) throw new Error('the word has no lit tube run to measure');
    return lit;
  }

  function runOneFrame(word: Word): void {
    word.apply(
      timelineOf(() => ({})),
      50,
    );
  }

  it('carries a look emissiveIntensity onto the material without any frame having run', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);

    expect(materialOf(word).emissiveIntensity).toBe(3.2);
  });

  // Poisoned first: asserting the value after a frame without disturbing it passes whether or
  // not the frame writes anything, since construction already put it there.
  it('rewrites it every frame, not only at construction', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);
    const material = materialOf(word);
    material.emissiveIntensity = 999;

    runOneFrame(word);

    expect(material.emissiveIntensity).toBe(3.2);
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

  it('rewrites the lit tube intensity every frame', () => {
    const word = new Word('A', stubFont(), 'tubing', ROOMY);
    const material = litTubeMaterial(word);
    material.emissiveIntensity = 999;

    runOneFrame(word);

    expect(material.emissiveIntensity).toBe(3.4);
  });
});
