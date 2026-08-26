import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as bk from '../src/index.js';

/**
 * The README teaches an API by name. A rename that misses the prose leaves a copy-pasteable
 * example that throws, which no other test would notice.
 */
describe('documented surface', () => {
  it('exports everything the README tells people to import', () => {
    for (const name of [
      'createKlieg',
      'transition',
      'cycle',
      'spring',
      'stagger',
      'ManualClock',
      'ENTER_NAMES',
      'ACTIVE_NAMES',
      'EXIT_NAMES',
      'LOOK_NAMES',
      'POLICY_NAMES',
      'sweep',
      'still',
      'track',
      'lamp',
      'fixed',
      'orbit',
      'along',
      'fromPointer',
      'linear',
      'easeOutCubic',
      'easeInCubic',
      'easeInOutCubic',
      'backOut',
    ]) {
      expect(bk, name).toHaveProperty(name);
    }
  });

  it('exports the sign the README teaches', async () => {
    const mod = await import('../src/sign/index.js');
    expect(mod).toHaveProperty('sign');
  });

  it('builds the README motion example', () => {
    const swoop = bk.transition(800, {
      from: { position: [0, -6, 0], opacity: 0 },
      ease: bk.spring({ stiffness: 180, damping: 11 }),
      stagger: { each: 0.06, from: 'center' },
    });

    expect(swoop.duration).toBe(800);
    expect(swoop.offset(0, { index: 0, count: 4 }).opacity).toBeCloseTo(0, 6);
    expect(swoop.offset(1, { index: 0, count: 4 }).opacity).toBeCloseTo(1, 6);
  });
});

describe('the published surface', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, unknown>;
    sideEffects: unknown;
  };

  it('publishes the sign and the element as their own subpaths', () => {
    expect(pkg.exports['./sign']).toEqual({
      types: './dist/sign/index.d.ts',
      default: './dist/sign/index.js',
    });
    expect(pkg.exports['./element']).toEqual({
      types: './dist/element.d.ts',
      default: './dist/element.js',
    });
    expect(pkg.exports['./element/standalone']).toBe('./dist/standalone/klieg-sign.js');
  });

  it('declares the element as having side effects, because registering one is', () => {
    // `sideEffects: false` lets a bundler drop a module nothing imports a binding from, which is
    // exactly how the element is used: imported for the registration and nothing else. The source
    // path is named too, for a consumer aliasing `klieg/element` to this workspace's `src`.
    expect(pkg.sideEffects).toEqual([
      './dist/element.js',
      './dist/standalone/klieg-sign.js',
      './src/element.ts',
    ]);
  });
});
