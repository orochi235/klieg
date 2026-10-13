import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKlieg, type KliegOptions } from '../../src/index.js';
import { Word } from '../../src/render/word.js';
import {
  calls,
  clock,
  create,
  firstCell,
  flush,
  INSTANT,
  LIT,
  renders,
  runIdle,
  setup,
  stubWebgl,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

describe('the warm', () => {
  it('mounts, renders once and arms the idle teardown', async () => {
    create();
    await runIdle();

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('leaves nothing of its own on the stage', async () => {
    create();
    await runIdle();

    expect(words()).toHaveLength(0);
  });

  it('does not warm an unsupported instance', async () => {
    stubWebgl(false);
    create();
    await runIdle();

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not warm once a fire has already started', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;
    await runIdle();

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('does not arm a teardown against a fire that is still running', async () => {
    const bk = create();
    bk.fire('HI', { ...INSTANT, hold: 5000 });
    await flush();
    await runIdle();

    expect(calls).toEqual(['mount']);
  });

  it('links the bloom quads too when the warmed look asks for bloom', async () => {
    create({ warmLook: 'neon' });
    await runIdle();

    // The word, then the threshold, blur and composite quads — each a program of its own.
    expect(renders).toBe(4);
  });

  it('builds no bloom path for a look that does not bloom', async () => {
    create({ warmLook: 'gold' });
    await runIdle();

    expect(renders).toBe(1);
  });

  it('holds its throwaway word until a fire needs the programs it linked', async () => {
    const spy = vi.spyOn(Word.prototype, 'dispose');
    const bk = create();
    await runIdle();
    // three refcounts a program per material: disposing here would hand back what was just linked.
    expect(spy).not.toHaveBeenCalled();

    const done = bk.fire('HI', INSTANT);
    await flush();

    expect(spy).toHaveBeenCalled();
    clock.advance(16);
    await done;
  });

  it('frees the throwaway on destroy when no fire ever came', async () => {
    const spy = vi.spyOn(Word.prototype, 'dispose');
    const bk = create();
    await runIdle();
    bk.destroy();

    expect(spy).toHaveBeenCalled();
  });

  it('links on demand when the host names the instant', async () => {
    const bk = create();
    await bk.warm('neon');

    // The word, then the threshold, blur and composite quads.
    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(4);
  });

  it('warms on demand after a fire, where the automatic one would decline', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;
    const before = renders;

    await bk.warm('gold');

    expect(renders).toBe(before + 1);
  });

  it('arms no teardown when the host warms during a fire', async () => {
    const bk = create();
    const done = bk.fire('HI', LIT);
    await flush();
    clock.advance(16);
    await bk.warm('gold');

    expect(calls).not.toContain('idle');

    clock.advance(5000);
    await done;
    expect(calls.at(-1)).toBe('idle');
  });

  it('warms the configured look when the host names none', async () => {
    const bk = create({ warmLook: 'neon' });
    await bk.warm();

    expect(renders).toBe(4);
  });

  it('resolves without touching the stage when unsupported', async () => {
    stubWebgl(false);
    const bk = create();
    await bk.warm('neon');

    expect(calls).toEqual([]);
  });

  it('resolves without touching the stage after destroy', async () => {
    const bk = create();
    bk.destroy();
    await bk.warm('neon');

    // The unmount destroy() schedules has not landed yet; the point is that the warm added nothing.
    expect(calls).toEqual([]);
  });

  it('destroys cleanly when the warm never ran', () => {
    const bk = create();

    expect(() => bk.destroy()).not.toThrow();
  });
});

describe('fonts', () => {
  it('sets a fire in the font it names', async () => {
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const done = bk.fire('X', { ...INSTANT, font: 'body' });
    await flush();
    clock.advance(16);
    await done;

    expect(fetched).toEqual(['/b.ttf']);
  });

  it('falls to the first entry when a fire names no font', async () => {
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const done = bk.fire('X', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(fetched).toEqual(['/d.ttf']);
  });

  it('throws at the call site on a font it has not got', () => {
    const bk = create({ fonts: { display: '/d.ttf' } });

    expect(() => bk.fire('X', { font: 'nope' })).toThrow(
      "klieg: no font named 'nope' — registered: display",
    );
  });

  it('throws on an unknown font even where WebGL is missing, so the typo is not machine-specific', () => {
    stubWebgl(false);
    const bk = create({ fonts: { display: '/d.ttf' } });

    expect(() => bk.fire('X', { font: 'nope' })).toThrow("klieg: no font named 'nope'");
  });

  it('refuses fontUrl and fonts together, which disagree about which font is which', () => {
    expect(() => create({ fontUrl: '/a.ttf', fonts: { a: '/a.ttf' } })).toThrow(
      'klieg: pass fonts or fontUrl, not both',
    );
  });

  it('refuses neither', () => {
    expect(() => createKlieg({ clock } as KliegOptions)).toThrow('klieg: fonts is required');
  });

  it('takes the deprecated fontUrl, warning once for the instance rather than once per fire', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = createKlieg({ fontUrl: '/f.ttf', clock });

    const first = bk.fire('X', INSTANT);
    await flush();
    clock.advance(16);
    await first;
    const second = bk.fire('Y', INSTANT);
    await flush();
    clock.advance(16);
    await second;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'klieg: fontUrl is deprecated — pass fonts: { display: url } instead',
    );
    warn.mockRestore();
  });
});

describe('firing styled runs', () => {
  const stubFetch = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as Response),
    );

  it('fires a list of runs', async () => {
    stubFetch();
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });

    const done = bk.fire([{ text: 'A' }, { text: 'B', font: 'body', size: 0.5 }], INSTANT);
    await flush();

    expect(words()).toHaveLength(1);
    clock.advance(16);
    await done;
  });

  it('preheats a named face, fetching it before any fire asks for it', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });

    await bk.preheat('AB', 'body');

    expect(fetched).toEqual(['/b.ttf']);
  });

  // Same stance as `fire`: a name the instance does not hold is a typo in the host's own code, and
  // it belongs at the call site rather than in a rejection handler.
  it('throws where preheat was called for a font it does not hold', () => {
    stubFetch();
    const bk = create({ fonts: { display: '/d.ttf' } });
    expect(() => bk.preheat('AB', 'nope')).toThrow("klieg: no font named 'nope'");
  });

  it('loads every font its runs name, not just the fire-wide one', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });

    const done = bk.fire([{ text: 'A' }, { text: 'B', font: 'body' }], INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(fetched.sort()).toEqual(['/b.ttf', '/d.ttf']);
  });

  it('lays a string and one run of the same text out identically', async () => {
    stubFetch();
    const bk = create();

    bk.fire('AB', INSTANT);
    await flush();
    const fromString = firstCell().position.x;
    clock.advance(16);
    await flush();

    bk.fire([{ text: 'AB' }], INSTANT);
    await flush();

    expect(firstCell().position.x).toBeCloseTo(fromString);
  });

  it("carries a run's size on the node the pose does not write", async () => {
    stubFetch();
    const bk = create();

    const done = bk.fire([{ text: 'A' }, { text: 'B', size: 0.5 }], INSTANT);
    await flush();
    const cells = firstCell().parent?.children ?? [];

    expect((cells[1] as THREE.Group).scale.x).toBe(1);
    expect(((cells[1] as THREE.Group).children[0] as THREE.Group).scale.x).toBeCloseTo(0.5);
    clock.advance(16);
    await done;
  });

  it("lets a run's tint beat the fire's", async () => {
    stubFetch();
    const bk = create();

    const done = bk.fire([{ text: 'A' }, { text: 'B', tint: 0x00ff00 }], {
      ...INSTANT,
      tint: 0xff0000,
    });
    await flush();
    const cells = firstCell().parent?.children ?? [];
    const colorOf = (cell: THREE.Object3D) =>
      (((cell as THREE.Group).children[0] as THREE.Group).children[0] as THREE.Mesh)
        .material as THREE.MeshPhysicalMaterial;

    expect(colorOf(cells[0] as THREE.Object3D).color.getHex()).not.toBe(
      colorOf(cells[1] as THREE.Object3D).color.getHex(),
    );
    clock.advance(16);
    await done;
  });
});
