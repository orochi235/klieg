import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import type { SheetSpec } from '../../../src/render/decoration.js';
import { SheetBuilder } from '../../../src/render/decorations/sheet.js';
import type { FlakeUniforms } from '../../../src/render/flake.js';
import type { LookSpec } from '../../../src/render/looks.js';
import { Word } from '../../../src/render/word.js';
import { drawn, groups, meshes, ROOMY, registerStubFace, stubFont } from './harness.js';

beforeAll(registerStubFace);

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

describe('a sheet decoration', () => {
  /** `pave`'s own numbers at twice the pitch, so a bake costs a quarter of the shipped one. */
  const SHEET = {
    kind: 'sheet',
    cutter: 'pave',
    bezel: 0.026,
    floor: 0.07,
    pitch: 0.1,
    wall: 0.012,
    relax: 1,
    edge: 'absorb',
    size: 0.048,
    rimBevel: 0.003,
    rimDrop: 0.003,
    look: {},
    fill: 'stone',
    sink: 0.25,
    facets: 8,
  } as const satisfies SheetSpec;
  const LOOK = { opacity: 1, decoration: SHEET };

  it('hangs the sheet and the rim off every body, on that body material', () => {
    const word = new Word('AB', stubFont(), LOOK, ROOMY);
    for (const body of meshes(word)) {
      expect(body.children).toHaveLength(4);
      for (const child of body.children as THREE.Mesh[]) expect(child.material).toBe(body.material);
    }
    word.dispose();
  });

  it('primes the sheet with every char before any letter is dressed, and bakes it once', () => {
    const prime = vi.spyOn(SheetBuilder.prototype, 'prime');
    const dress = vi.spyOn(SheetBuilder.prototype, 'dressBody');
    const sheet = vi.spyOn(WordCaches.prototype, 'sheet');
    try {
      // 'W' is wider than the sheet 'A' alone bakes, so without the prime this would bake twice.
      const word = new Word('AW', stubFont(), LOOK, ROOMY);
      expect(prime).toHaveBeenCalledWith(['A', 'W']);
      expect(prime.mock.invocationCallOrder[0]).toBeLessThan(
        dress.mock.invocationCallOrder[0] as number,
      );
      expect(new Set(sheet.mock.results.map((r) => r.value)).size).toBe(1);
      word.dispose();
    } finally {
      prime.mockRestore();
      dress.mockRestore();
      sheet.mockRestore();
    }
  });

  it('shares one sheet between words on the same caches', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const make = () => new Word('A', font, LOOK, ROOMY, false, undefined, undefined, null, caches);
    const a = make();
    const b = make();
    const shellOf = (word: Word) =>
      ((meshes(word)[0] as THREE.Mesh).children[0] as THREE.Mesh).geometry;
    expect(shellOf(b)).toBe(shellOf(a));
    a.dispose();
    b.dispose();
    caches.dispose();
  });

  it('contributes one stone part per letter', () => {
    const word = new Word('AB', stubFont(), LOOK, ROOMY);
    expect(word.partsOf('chunk').map((part) => part.fill)).toEqual(['stone', 'stone']);
    word.dispose();
  });
});
