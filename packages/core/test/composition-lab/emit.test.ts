import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPOSITION } from '../../dev/composition-lab/src/composition.js';
import { emit } from '../../dev/composition-lab/src/emit.js';
import { EFFECTS } from '../../src/effects/pieces.js';
import { roving } from '../../src/effects/roving.js';
import type { EffectSpec } from '../../src/effects/types.js';

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
  it('runs, and builds the piece the composition described', () => {
    const out = run(
      emit({
        ...DEFAULT_COMPOSITION,
        text: 'NEON',
        effects: [
          {
            id: 'a',
            kind: 'flicker',
            enabled: true,
            params: { duration: 1400, unrest: 0.4 },
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
    expect((spec as EffectSpec).piece).toHaveProperty('duration', 1400);
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
            params: { duration: 1400 },
            target: 'run',
            amount: 1,
            seed: 0,
            roving: { dwell: 3200, seed: 1, epochs: 96 },
          },
        ],
      }),
    );
    const piece = out.options.effects?.[0]?.piece;
    expect(piece).toBeDefined();
    expect((piece as { duration: number }).duration).toBeGreaterThan(100000);
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

  // klieg exports `roving` by name but reaches the built-in pieces only through `EFFECTS`, so a
  // bare `flicker(...)` is not something the person pasting this can compile.
  it('reaches a built-in piece the way the package actually exports it', () => {
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
