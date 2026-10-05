import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPOSITION,
  type EffectLayer,
  layerPatch,
} from '../../dev/composition-lab/src/composition.js';
import { emit } from '../../dev/composition-lab/src/emit.js';
import { EFFECTS } from '../../src/effects/patches.js';
import { roving } from '../../src/effects/roving.js';
import type { EffectPatch, EffectSpec, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from '../effects/ctx.js';

/**
 * Runs an emitted snippet against the real `EFFECTS` and `roving`, with a stand-in `klieg`. A
 * containment assertion cannot tell a pasteable call from a plausible-looking string; this can.
 */
function run(source: string): { text: string; options: { effects?: EffectSpec[] } } {
  const body = source.replace(/^import .*\n\n/, '');
  let captured: { text: string; options: { effects?: EffectSpec[] } } | null = null;
  const klieg = {
    fire(text: string, options: { effects?: EffectSpec[] }) {
      captured = { text, options };
    },
  };
  new Function('klieg', 'EFFECTS', 'roving', body)(klieg, EFFECTS, roving);
  if (!captured) throw new Error('emitted source never called fire');
  return captured;
}

describe('the emitted call, run', () => {
  it('runs, and builds the patch the composition described', () => {
    const out = run(
      emit({
        ...DEFAULT_COMPOSITION,
        text: 'NEON',
        effects: [
          {
            id: 'a',
            kind: 'flicker',
            enabled: true,
            params: { period: 1400, unrest: 0.4 },
            target: 'run',
            amount: 1,
            seed: 2,
          },
        ],
      }),
    );
    expect(out.text).toBe('NEON');
    const spec = out.options.effects?.[0];
    expect(spec).toBeDefined();
    expect(spec?.seed).toBe(2);
    expect((spec as EffectSpec).patch).toHaveProperty('period', 1400);
  });

  it('runs when wrapped, and takes the wrapper pass', () => {
    const out = run(
      emit({
        ...DEFAULT_COMPOSITION,
        effects: [
          {
            id: 'a',
            kind: 'flicker',
            enabled: true,
            params: { period: 1400 },
            target: 'run',
            amount: 1,
            seed: 0,
            roving: { dwell: 3200, seed: 1, epochs: 96 },
          },
        ],
      }),
    );
    const patch = out.options.effects?.[0]?.patch;
    expect(patch).toBeDefined();
    expect((patch as { period: number }).period).toBeGreaterThan(100000);
  });

  it('runs with no layers at all', () => {
    expect(run(emit(DEFAULT_COMPOSITION)).options.effects).toBeUndefined();
  });
});

describe('emit', () => {
  it('writes a fire call with the look and hold', () => {
    const out = emit({ ...DEFAULT_COMPOSITION, look: 'piping', hold: 4000 });
    expect(out).toContain("look: 'piping'");
    expect(out).toContain('hold: 4000');
  });

  // klieg exports `roving` by name but reaches the built-in patches only through `EFFECTS`, so a
  // bare `flicker(...)` is not something the person pasting this can compile.
  it('reaches a built-in patch the way the package actually exports it', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'flicker', enabled: true, params: {}, target: 'run', amount: 1, seed: 0 },
      ],
    });
    expect(out).toContain('EFFECTS.flicker(');
  });

  it('imports every name the emitted call uses, and none it does not', () => {
    const plain = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'hue', enabled: true, params: {}, target: 'run', amount: 1, seed: 0 },
      ],
    });
    expect(plain).toContain("import { EFFECTS } from 'klieg';");

    const wrapped = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        {
          id: 'a',
          kind: 'hue',
          enabled: true,
          params: {},
          target: 'run',
          amount: 1,
          seed: 0,
          roving: { dwell: 3200, seed: 0, epochs: 96 },
        },
      ],
    });
    expect(wrapped).toContain("import { EFFECTS, roving } from 'klieg';");

    expect(emit({ ...DEFAULT_COMPOSITION, effects: [] })).not.toContain('import');
  });

  it('writes the factory call for each enabled layer', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        {
          id: 'a',
          kind: 'flicker',
          enabled: true,
          params: { unrest: 0.4 },
          target: 'run',
          amount: 1,
          seed: 0,
        },
      ],
    });
    expect(out).toContain('EFFECTS.flicker({');
    expect(out).toContain('unrest: 0.4');
  });

  it('wraps in roving when the layer does', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        {
          id: 'a',
          kind: 'flicker',
          enabled: true,
          params: {},
          target: 'run',
          amount: 1,
          seed: 0,
          roving: { dwell: 3200, seed: 0, epochs: 96 },
        },
      ],
    });
    expect(out).toContain('roving(EFFECTS.flicker({');
    expect(out).toContain('dwell: 3200');
  });

  it('omits a disabled layer', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'hue', enabled: false, params: {}, target: 'run', amount: 1, seed: 0 },
      ],
    });
    expect(out).not.toContain('EFFECTS.hue(');
  });

  it('emits the target with the by field the type requires, so the paste compiles', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'hue', enabled: true, params: {}, target: 'body', amount: 0.5, seed: 3 },
      ],
    });
    expect(out).toContain("target: { kind: 'body', by: 'index', amount: 0.5 }");
  });
});

describe('emit for the round-two shapes', () => {
  const base = {
    text: 'HI',
    look: 'tubing' as const,
    hold: 6000,
    enter: 'slam' as const,
    active: 'none' as const,
    exit: 'none' as const,
    pool: 'real' as const,
  };
  const layer = {
    id: 'a',
    enabled: true,
    target: 'run' as const,
    amount: 1,
    seed: 0,
  };

  it('prints a fixed lamp with its position, and imports what it names', () => {
    const out = emit({
      ...base,
      effects: [
        {
          ...layer,
          kind: 'lamp' as const,
          lampSource: 'fixed' as const,
          params: { period: 4000, radius: 0.5, strength: 2, x: 0.4, y: 0.35, sweep: 0.3 },
        },
      ],
    });
    expect(out).toContain('lamp({ source: fixed(0.4, 0.35)');
    expect(out).toContain('period: 4000');
    expect(out).toContain("import { fixed, lamp } from 'klieg';");
  });

  it('runs a draft layer, calling the pane factory for the patch it returns', () => {
    const out = run(
      emit({
        ...base,
        effects: [
          {
            ...layer,
            kind: 'draft' as const,
            params: {},
            source: 'return { period: 1400, at: (phase) => ({ gain: phase }) };',
          },
        ],
      }),
    );
    const patch = out.options.effects?.[0]?.patch as EffectPatch;
    expect(patch.period).toBe(1400);
    expect(patch.at(0.25, {} as PartInfo, NO_CTX)).toEqual({ gain: 0.25 });
  });

  it('prints an orbiting lamp against its sweep rather than its reach', () => {
    const out = emit({
      ...base,
      effects: [
        {
          ...layer,
          kind: 'lamp' as const,
          lampSource: 'orbit' as const,
          params: { period: 4000, radius: 0.5, strength: 2, x: 0, y: 0, sweep: 0.8 },
        },
      ],
    });
    expect(out).toContain('orbit({ radius: 0.8, x: 0, y: 0 })');
  });

  it('drops a stale roving wrapper on a lamp the same way in emit and layerPatch', () => {
    const lampWithStaleRoving: EffectLayer = {
      ...layer,
      kind: 'lamp',
      lampSource: 'fixed',
      params: { period: 4000, radius: 0.5, strength: 2, x: 0.4, y: 0.35 },
      roving: { dwell: 3200, seed: 0, epochs: 96 },
    };

    const out = emit({ ...base, effects: [lampWithStaleRoving] });
    expect(out).not.toContain('roving');

    const patch = layerPatch(lampWithStaleRoving);
    expect(patch).toHaveProperty('period', 4000);
  });

  it('wraps in intermittent outside roving, matching the order layerPatch applies them', () => {
    const out = emit({
      ...base,
      effects: [
        {
          ...layer,
          kind: 'flicker' as const,
          params: { period: 1400 },
          roving: { dwell: 3200, seed: 0, epochs: 96 },
          intermittent: { spell: 4200, calm: 2000, bouts: 3 },
        },
      ],
    });
    expect(out).toContain('intermittent(roving(');
    expect(out).toContain("import { EFFECTS, intermittent, roving } from 'klieg';");
  });
});
