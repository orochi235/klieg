import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EffectPatch } from '../../../src/effects/types.js';
import type { LetterInfo } from '../../../src/motion/types.js';
import { type Look, type LookSpec, specOf } from '../../../src/render/looks.js';
import type { GradientSpec } from '../../../src/render/tube/gradient.js';
import { Word } from '../../../src/render/word.js';
import {
  drawn,
  groups,
  HOST,
  materialOf,
  ROOMY,
  registerStubFace,
  STEP,
  stubFont,
  timelineOf,
} from './harness.js';

beforeAll(registerStubFace);

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
      HOST,
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
      HOST,
    );
  }

  it('carries a look emissiveIntensity onto the material without any frame having run', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);

    expect(materialOf(word).emissiveIntensity).toBe(1.9);
  });

  // Poisoned first: asserting the value after a frame without disturbing it passes whether or
  // not the frame writes anything, since construction already put it there.
  it('rewrites the body emissiveIntensity every frame, not only at construction', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);
    const material = materialOf(word);
    material.emissiveIntensity = 999;

    runOneFrame(word);

    expect(material.emissiveIntensity).toBe(1.9);
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

    expect(litTubeMaterial(word).emissiveIntensity).toBe(2);
  });

  it('rewrites the lit tube emissiveIntensity every frame, not only at construction', () => {
    const word = new Word('A', stubFont(), 'tubing', ROOMY);
    const material = litTubeMaterial(word);
    material.emissiveIntensity = 999;

    runOneFrame(word);

    expect(material.emissiveIntensity).toBe(2);
  });
});

describe('a dimmed word', () => {
  /** The lit tube run's material, which carries the decoration's own frame-owned base. */
  function litTube(word: Word): THREE.MeshPhysicalMaterial {
    const runs = drawn(groups(word)[0] as THREE.Group).children.slice(1);
    const materials = runs.map((run) => (run as THREE.Mesh).material as THREE.MeshPhysicalMaterial);
    const lit = materials.find((material) => material.emissive.getHex() !== 0x000000);
    if (!lit) throw new Error('the word has no lit tube run to measure');
    return lit;
  }

  function dimmed(look: Look, dim: number): Word {
    // biome-ignore format: the trailing options are easier to read against the positional tail
    return new Word('A', stubFont(), look, ROOMY, false, undefined, undefined, null, undefined, undefined, undefined, { dim });
  }

  it('scales the body emissive base, which is what an effect gain then modulates', () => {
    expect(materialOf(dimmed('neon', 0.25)).emissiveIntensity).toBeCloseTo(1.9 * 0.25, 10);
  });

  it('scales the body opacity base', () => {
    expect(materialOf(dimmed({ opacity: 0.8 }, 0.5)).opacity).toBeCloseTo(0.4, 10);
  });

  it('reaches a decoration base too, not only the body', () => {
    expect(litTube(dimmed('tubing', 0.5)).emissiveIntensity).toBeCloseTo(2 * 0.5, 10);
  });

  it('leaves an effect gain to compose on top, so a chase keeps its full contrast', () => {
    const half: EffectPatch = { period: 1000, at: () => ({ gain: 0.5 }) };
    const effects: LookSpec['effects'] = [{ patch: half, target: { kind: 'body', by: 'index' } }];
    const word = dimmed({ ...specOf('neon'), effects }, 0.25);

    word.apply(
      timelineOf(() => ({})),
      50,
      HOST,
    );

    expect(materialOf(word).emissiveIntensity).toBeCloseTo(1.9 * 0.25 * 0.5, 10);
  });

  it('leaves the base alone when no dim is asked for', () => {
    expect(materialOf(new Word('A', stubFont(), 'neon', ROOMY)).emissiveIntensity).toBe(1.9);
  });
});
