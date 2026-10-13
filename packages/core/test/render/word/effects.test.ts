import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EffectPatch } from '../../../src/effects/types.js';
import { Timeline } from '../../../src/motion/compositor.js';
import { NONE } from '../../../src/motion/types.js';
import type { Vec3 } from '../../../src/pose.js';
import type { ChunkSpec } from '../../../src/render/decoration.js';
import { type LookSpec, lightBase, litEmissive, specOf } from '../../../src/render/looks.js';
import type { GradientSpec } from '../../../src/render/tube/gradient.js';
import { Word } from '../../../src/render/word.js';
import { LINE_HEIGHT_EM } from '../../../src/text/layout.js';
import {
  census,
  decorationOf,
  drawn,
  groups,
  HOST,
  materialOf,
  meshes,
  ROOMY,
  registerStubFace,
  STEP,
  stubFont,
  timelineOf,
} from './harness.js';

beforeAll(registerStubFace);

describe('effects', () => {
  const STILL = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });
  /** A fixed gain on every part it is handed, so these assert routing rather than a waveform. */
  const half: EffectPatch = { period: 1000, at: () => ({ gain: 0.5 }) };
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
    const slide: EffectPatch = { period: 1000, at: () => ({ crawl: 0.25 }) };
    const word = gradientTubingWith([{ patch: slide, target: { kind: 'run', ...FIRST } }]);
    word.apply(STILL, 0, HOST);
    expect(crawlOf(word, 0)).toBeCloseTo(0.25, 6);
  });

  it('leaves the crawl buffer at rest for a part no effect targets', () => {
    const slide: EffectPatch = { period: 1000, at: () => ({ crawl: 0.25 }) };
    const word = gradientTubingWith([{ patch: slide, target: { kind: 'run', ...FIRST } }]);
    word.apply(STILL, 0, HOST);
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

    word.apply(STILL, 0, HOST);

    expect([runColorOf(word, 0), runColorOf(word, 1)]).toEqual(before);
  });

  it('scales a targeted run by the gain and leaves an untargeted one at its own colour', () => {
    const word = tubingWith([{ patch: half, target: { kind: 'run', ...FIRST } }]);
    const before = [runColorOf(word, 0), runColorOf(word, 1)];

    word.apply(STILL, 0, HOST);

    expect(runColorOf(word, 0)).toBeCloseTo((before[0] as number) * 0.5, 6);
    expect(runColorOf(word, 1)).toBe(before[1]);
  });

  // Composing from the buffer instead of from the part's own colour passes the test above and
  // fades the sign to black over a few seconds; this is the one that catches it.
  it('does not compound across frames', () => {
    const word = tubingWith([{ patch: half, target: { kind: 'run', ...FIRST } }]);

    word.apply(STILL, 0, HOST);
    const once = runColorOf(word, 0);
    word.apply(STILL, 16, HOST);
    word.apply(STILL, 32, HOST);

    expect(runColorOf(word, 0)).toBe(once);
  });

  /** A run's darkness: the fill the glow sits in, rather than the glow. */
  function runDarkOf(word: Word, ordinal: number): number {
    const meshes = groups(word).flatMap((cell) => {
      const lit = (drawn(cell).children[1] as THREE.Mesh).material;
      return (drawn(cell).children.slice(1) as THREE.Mesh[]).filter((m) => m.material === lit);
    });
    const mesh = meshes[ordinal];
    if (!mesh) throw new Error(`the word has no run ${ordinal}`);
    return mesh.geometry.getAttribute('runDark').getX(0);
  }

  it('drains a targeted run toward the dark glass and leaves an untargeted one lit', () => {
    const drained = { period: 1000, at: () => ({ dark: 1 }) };
    const word = tubingWith([{ patch: drained, target: { kind: 'run', ...FIRST } }]);

    word.apply(STILL, 0, HOST);

    expect(runDarkOf(word, 0)).toBe(1);
    expect(runDarkOf(word, 1)).toBe(0);
  });

  it('fills a run back in once its darkness falls away', () => {
    let dark = 1;
    const fading = { period: 1000, at: () => ({ dark }) };
    const word = tubingWith([{ patch: fading, target: { kind: 'run', ...FIRST } }]);

    word.apply(STILL, 0, HOST);
    dark = 0;
    word.apply(STILL, 16, HOST);

    expect(runDarkOf(word, 0)).toBe(0);
  });

  it('layers two effects onto the part they both target', () => {
    const word = tubingWith([
      { patch: half, target: { kind: 'run', ...FIRST } },
      { patch: half, target: { kind: 'run', ...FIRST } },
    ]);
    const before = runColorOf(word, 0);

    word.apply(STILL, 0, HOST);

    expect(runColorOf(word, 0)).toBeCloseTo(before * 0.25, 6);
  });

  it('drives a body through emissiveIntensity rather than through the attribute', () => {
    const word = new Word(
      'A',
      stubFont(),
      { ...specOf('neon'), effects: [{ patch: half, target: { kind: 'body', ...FIRST } }] },
      ROOMY,
    );

    word.apply(STILL, 0, HOST);

    expect(materialOf(word).emissiveIntensity).toBeCloseTo(1.9 * 0.5, 6);
  });

  it('stops writing an effect to a letter a regroup dropped, which shows its base again', () => {
    const rising: EffectPatch = { period: 1000, at: (phase) => ({ gain: phase }) };
    const word = new Word(
      'AB',
      stubFont(),
      { ...specOf('neon'), effects: [{ patch: rising, target: { kind: 'body', by: 'index' } }] },
      ROOMY,
    );
    const intensity = () =>
      meshes(word).map((m) => (m.material as THREE.MeshPhysicalMaterial).emissiveIntensity);

    const plain = new Word('AB', stubFont(), 'neon', ROOMY);
    plain.apply(STILL, 0, HOST);
    const base = materialOf(plain).emissiveIntensity;

    word.apply(STILL, 250, HOST);
    const [, lit] = intensity();
    word.regroup((l) => l.index === 0, 'place');
    word.apply(STILL, 750, HOST);
    const [kept, dropped] = intensity();

    expect(lit).not.toBe(base);
    expect(dropped).toBe(base);
    expect(kept).toBeCloseTo(base * 0.75, 6);
  });

  const lamplight: EffectPatch = {
    period: 1000,
    at: () => ({ light: { color: 0xffffff, amount: 0.5 } }),
  };

  // A `hue` patch and a `lamp` on one run: the light has to tint by the colour the run is showing,
  // or the lit pool keeps adding the original tube colour while the base sweeps away from it.
  it('lights a recoloured run in the colour it is showing, not the one it was built with', () => {
    const bluedAndLit: EffectPatch = {
      period: 1000,
      at: () => ({ color: 0x0000ff, light: { color: 0xffffff, amount: 1 } }),
    };
    const word = tubingWith([{ patch: bluedAndLit, target: { kind: 'run', ...FIRST } }]);

    word.apply(STILL, 0, HOST);

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
      { ...specOf('neon'), effects: [{ patch: lamplight, target: { kind: 'body', by: 'index' } }] },
      ROOMY,
    );
    const unlit = new THREE.Color(0xff2d95);

    word.apply(STILL, 0, HOST);

    const green = meshes(word).map((m) => (m.material as THREE.MeshPhysicalMaterial).emissive.g);
    expect(green).toHaveLength(2);
    for (const g of green) expect(g).toBeGreaterThan(unlit.g);
  });

  it('reflects the tint a look was given rather than the colour the tint replaced', () => {
    const word = new Word(
      'A',
      stubFont(),
      { ...specOf('neon'), effects: [{ patch: lamplight, target: { kind: 'body', by: 'index' } }] },
      ROOMY,
      false,
      0x008000,
    );

    word.apply(STILL, 0, HOST);

    const emissive = materialOf(word).emissive;
    expect(emissive.r).toBe(0);
    expect(emissive.g).toBeGreaterThan(new THREE.Color(0x008000).g);
  });

  // The reason the kind exists: a chunk look builds no runs, and its body is near-black under the
  // field, so before this a lamp had nothing on it to land on that anyone could see.
  it('lights a chunk look through its decoration, which has no run to carry the light', () => {
    const word = new Word(
      'A',
      stubFont(),
      {
        ...specOf('sequin'),
        effects: [{ patch: lamplight, target: { kind: 'chunk', by: 'index' } }],
      },
      ROOMY,
    );
    const before = decorationOf(word).emissive.clone();

    word.apply(STILL, 0, HOST);

    expect(decorationOf(word).emissive.r).toBeGreaterThan(before.r);
  });

  // `sequin` tints to its decoration, so the field is tan over a near-black body. Reading the
  // body's base instead of the field's still brightens the material, which is why "the lamp
  // landed" is not an assertion that can tell the two apart — the colour it landed in is.
  it('tints a chunk lamp by the field it lights, not by the body underneath it', () => {
    const spec = specOf('sequin');
    const decoration = spec.decoration as ChunkSpec;
    const word = new Word(
      'A',
      stubFont(),
      { ...spec, effects: [{ patch: lamplight, target: { kind: 'chunk', by: 'index' } }] },
      ROOMY,
    );
    // `lamplight` is white at 0.5, which the compositor folds to this before a material sees it.
    const shed: Vec3 = [0.5, 0.5, 0.5];
    const off = (look: LookSpec) => {
      const base = lightBase(look);
      return litEmissive(base.emissive, base.hue, shed);
    };

    word.apply(STILL, 0, HOST);

    expect(decorationOf(word).emissive.getHex()).toBe(off(decoration.look));
    // The guard on the guard: the line above can only fail on the wrong base if the two differ.
    expect(off(spec)).not.toBe(off(decoration.look));
  });

  // A part resolving to rest is not written at all, so what puts a field back when the lamp moves
  // off it is the per-frame reset — not the write. Comparing against a never-lit word cannot tell.
  it('puts a chunk field back to its own emissive on a frame the lamp has left', () => {
    const passing: EffectPatch = {
      period: 1000,
      at: (phase) => (phase < 0.5 ? { light: { color: 0xffffff, amount: 0.5 } } : {}),
    };
    const word = new Word(
      'A',
      stubFont(),
      {
        ...specOf('sequin'),
        effects: [{ patch: passing, target: { kind: 'chunk', by: 'index' } }],
      },
      ROOMY,
    );
    const rest = lightBase((specOf('sequin').decoration as ChunkSpec).look).emissive;

    word.apply(STILL, 0, HOST);
    const lit = decorationOf(word).emissive.getHex();
    word.apply(STILL, 750, HOST);

    expect(lit).not.toBe(rest);
    expect(decorationOf(word).emissive.getHex()).toBe(rest);
  });

  // sequin's body and its field happen to share an emissiveIntensity, so nothing shipped can tell
  // the two bases apart; a look whose field carries its own is what makes the wrong one visible.
  it("scales a chunk part's gain against the decoration's emissive intensity, not the body's", () => {
    const spec = specOf('sequin');
    const decoration = spec.decoration as ChunkSpec;
    const word = new Word(
      'A',
      stubFont(),
      {
        ...spec,
        emissiveIntensity: 1,
        decoration: { ...decoration, look: { ...decoration.look, emissiveIntensity: 4 } },
        effects: [{ patch: half, target: { kind: 'chunk', by: 'index' } }],
      },
      ROOMY,
    );

    word.apply(STILL, 0, HOST);

    expect(decorationOf(word).emissiveIntensity).toBeCloseTo(2, 6);
  });

  // tubing's runs are 0xa0ff00: green is saturated and the lamp is tinted by a colour with no blue,
  // so red is the one channel a lamp can visibly raise.
  it('adds lamp light into a run colour', () => {
    const word = tubingWith([{ patch: lamplight, target: { kind: 'run', by: 'index' } }]);
    const before = runColorOf(word, 0, 'r');

    word.apply(STILL, 0, HOST);

    expect(runColorOf(word, 0, 'r')).toBeGreaterThan(before);
  });

  it('lets a lamp go when a regroup drops the letter it was lighting', () => {
    const word = new Word(
      'AB',
      stubFont(),
      { ...specOf('neon'), effects: [{ patch: lamplight, target: { kind: 'body', ...FIRST } }] },
      ROOMY,
    );
    const unlit = new THREE.Color(0xff2d95);

    word.apply(STILL, 0, HOST);
    const lit = materialOf(word).emissive.g;
    word.regroup((letter) => letter.index === 1, 'line');
    word.apply(STILL, 0, HOST);

    expect(lit).toBeGreaterThan(unlit.g);
    expect(materialOf(word).emissive.g).toBeCloseTo(unlit.g, 6);
  });

  // The one case the write path cannot cover: a retired part is skipped by resolve, so without the
  // per-frame reset its field keeps the last lamp it saw for as long as it is on screen.
  it('lets a chunk lamp go when a regroup drops the letter it was lighting', () => {
    const word = new Word(
      'AB',
      stubFont(),
      { ...specOf('sequin'), effects: [{ patch: lamplight, target: { kind: 'chunk', ...FIRST } }] },
      ROOMY,
    );
    const rest = lightBase((specOf('sequin').decoration as ChunkSpec).look).emissive;

    word.apply(STILL, 0, HOST);
    const lit = decorationOf(word).emissive.getHex();
    word.regroup((letter) => letter.index === 1, 'line');
    word.apply(STILL, 0, HOST);

    expect(lit).not.toBe(rest);
    expect(decorationOf(word).emissive.getHex()).toBe(rest);
  });

  it('skips a run whose material came from a debug override and has no run-colour contract', () => {
    const lit = new THREE.MeshBasicMaterial();
    const word = new Word(
      'AA',
      stubFont(),
      { ...specOf('tubing'), effects: [{ patch: half, target: { kind: 'run', ...FIRST } }] },
      ROOMY,
      false,
      undefined,
      { tubeMaterial: (which) => (which === 'lit' ? lit : new THREE.MeshBasicMaterial()) },
    );
    const before = runColorOf(word, 0);

    word.apply(STILL, 0, HOST);

    expect(runColorOf(word, 0)).toBe(before);
  });

  it('stops writing a part whose letter a regroup dropped', () => {
    const word = new Word(
      'AB',
      stubFont(),
      { ...specOf('neon'), effects: [{ patch: half, target: { kind: 'body', ...FIRST } }] },
      ROOMY,
    );

    word.apply(STILL, 0, HOST);
    const driven = materialOf(word).emissiveIntensity;
    word.regroup((letter) => letter.index === 1, 'line');
    word.apply(STILL, 0, HOST);

    expect(driven).toBeCloseTo(materialOf(word).emissiveIntensity * 0.5, 6);
  });

  it('never consults a patch whose target came up empty', () => {
    const at = vi.fn<EffectPatch['at']>(() => ({ gain: 0.5 }));
    const word = tubingWith([
      { patch: { period: 1000, at }, target: { kind: 'run', by: 'index', count: 0 } },
    ]);
    const before = [runColorOf(word, 0), runColorOf(word, 1)];

    word.apply(STILL, 0, HOST);

    expect(at).not.toHaveBeenCalled();
    expect([runColorOf(word, 0), runColorOf(word, 1)]).toEqual(before);
  });

  // The premise the whole approach rests on: an effect is a write into what the look already
  // built, so declaring one costs no material, no mesh and so no extra compiled program.
  it('adds no material and no mesh, however many parts it drives', () => {
    const plain = census(new Word('AA', stubFont(), specOf('tubing'), ROOMY));
    const driven = census(tubingWith([{ patch: half, target: { kind: 'run', by: 'index' } }]));

    expect(driven).toEqual(plain);
    // Without this the assertion above would also pass a word that gave every part its own
    // material, since both sides would have done it.
    expect(plain.materials).toBeLessThan(plain.meshes);
  });

  it('offsets a targeted part on the mesh, so it composes with the pose on the cell', () => {
    const lift: EffectPatch = { period: 1000, at: () => ({ position: [0, 0.25, 0] }) };
    const word = tubingWith([{ patch: lift, target: { kind: 'run', ...FIRST } }]);

    const cell = groups(word)[0] as THREE.Group;
    const rest = cell.position.x;

    word.apply(
      timelineOf(() => ({ position: [1, 0, 0] })),
      50,
      HOST,
    );

    const run = drawn(cell).children[1] as THREE.Mesh;
    expect(cell.position.x).toBeCloseTo(rest + 1, 10);
    expect([run.position.x, run.position.y]).toEqual([0, 0.25]);
  });
});
