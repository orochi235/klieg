import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PartInfo } from '../../../src/effects/types.js';
import { orderKey } from '../../../src/motion/types.js';
import { LOOKS } from '../../../src/render/looks.js';
import { Word } from '../../../src/render/word.js';
import { drawn, groups, HOST, ROOMY, registerStubFace, stubFont, timelineOf } from './harness.js';

beforeAll(registerStubFace);

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

  it('builds one chunk part per drawn letter on a chunk look', () => {
    const parts = new Word('A B', stubFont(), 'sequin', ROOMY).partsOf('chunk');

    expect(parts.map((p) => p.letter.index)).toEqual([0, 2]);
    expect(parts.map((p) => p.index)).toEqual([0, 1]);
    expect(parts.every((p) => p.count === 2)).toBe(true);
  });

  // Derived from LOOKS rather than named, so a look added later is covered without editing this.
  // Builds every look in full, the pavé sheet's bake included, which outlasts the default timeout.
  it('builds chunk parts for exactly the looks that scatter chunks or fill with stones', () => {
    const chunky = (name: keyof typeof LOOKS) => {
      const decoration = LOOKS[name].decoration;
      return (
        decoration?.kind === 'chunks' || (!!decoration && 'fill' in decoration && !!decoration.fill)
      );
    };
    const names = Object.keys(LOOKS) as (keyof typeof LOOKS)[];

    const built = names.filter(
      (name) => new Word('A', stubFont(), name, ROOMY).partsOf('chunk').length > 0,
    );

    expect(built).toEqual(names.filter(chunky));
    expect(built).not.toHaveLength(0);
  }, 20_000);

  // A chunk field covers its whole letter, so unlike a run it has no box of its own to offer.
  it("gives a chunk part its letter's ink", () => {
    const word = new Word('A', stubFont(), 'sequin', ROOMY);
    const [chunk] = word.partsOf('chunk');
    const [body] = word.partsOf('body');

    expect(chunk?.ink).toEqual(body?.ink);
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

  it('keeps the numbering it was built with through a regroup that moves its parts', () => {
    const word = new Word('ABCD', stubFont(), 'gold', ROOMY);
    const numbering = () =>
      word.partsOf('body').map((p) => [p.index, p.count, p.letter.count] as const);
    const before = numbering();
    const was = word.partsOf('body').map((p) => p.x);
    const { delta } = word.regroup((l) => l.index < 2, 'line');

    expect(delta[0]?.[0]).not.toBe(0);
    expect(numbering()).toEqual(before);
    // A survivor's part goes where its letter went; a dropped letter's stays where it stood.
    const now = word.partsOf('body').map((p) => p.x);
    expect(now[0]).toBeCloseTo((was[0] as number) - (delta[0]?.[0] as number));
    expect(now.slice(2)).toEqual(was.slice(2));
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

describe('atRest', () => {
  /** Leaves every letter on its layout position, the way a finished timeline does. */
  const rest = timelineOf(() => ({}));

  it('is true for a word nothing has posed', () => {
    expect(new Word('AB', stubFont(), 'gold', ROOMY).atRest()).toBe(true);
  });

  it('is false while a patch holds a letter off its layout position', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ position: [0, 1, 0] })),
      0,
      HOST,
    );

    expect(word.atRest()).toBe(false);
  });

  it('is false while a patch spins or grows a letter in place', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ rotation: [0, 0.4, 0] })),
      0,
      HOST,
    );
    expect(word.atRest()).toBe(false);

    word.apply(
      timelineOf(() => ({ scale: 1.5 })),
      0,
      HOST,
    );
    expect(word.atRest()).toBe(false);
  });

  it('is false until a regroup has moved the survivors onto their new positions', () => {
    const word = new Word('ABC', stubFont(), 'gold', ROOMY);
    word.regroup((l) => l.index < 2, 'line');
    word.setFitProgress(1);
    expect(word.atRest()).toBe(false);

    word.apply(rest, 0, HOST);
    expect(word.atRest()).toBe(true);
  });

  it('is false part-way through a fit tween and true once it settles', () => {
    const word = new Word('ABCDE', stubFont(), 'gold', { width: 2, height: 2 });
    word.regroup((l) => l.index < 2, 'line');
    word.apply(rest, 0, HOST);

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
      timelineOf((_phase, letter) => (letter.leaving ? { position: [0, -3, 0] } : {})),
      0,
      HOST,
    );

    expect(word.atRest()).toBe(true);
  });
});
