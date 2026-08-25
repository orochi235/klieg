import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rampAt } from '../../../src/render/tube/gradient.js';

describe('rampAt', () => {
  it('returns the only stop when there is one', () => {
    const c = rampAt([0xff2d95], 0.7);
    expect(c.getHex()).toBe(0xff2d95);
  });

  it('returns the endpoints at 0 and 1', () => {
    expect(rampAt([0xff0000, 0x0000ff], 0).getHex()).toBe(0xff0000);
    expect(rampAt([0xff0000, 0x0000ff], 1).getHex()).toBe(0x0000ff);
  });

  it('clamps outside 0..1 rather than extrapolating', () => {
    expect(rampAt([0xff0000, 0x0000ff], -3).getHex()).toBe(0xff0000);
    expect(rampAt([0xff0000, 0x0000ff], 9).getHex()).toBe(0x0000ff);
  });

  it('lands on an interior stop exactly', () => {
    const c = rampAt([0xff0000, 0x00ff00, 0x0000ff], 0.5);
    expect(c.getHex()).toBe(0x00ff00);
  });

  it('interpolates in linear space, not sRGB', () => {
    // The linear midpoint of black and white is mid-grey in LINEAR components, which is
    // 0.5 -> #bcbcbc once written back out as sRGB. An sRGB lerp would give #808080.
    const c = rampAt([0x000000, 0xffffff], 0.5);
    expect(c.r).toBeCloseTo(0.5, 6);
    expect(new THREE.Color().copy(c).getHexString()).toBe('bcbcbc');
  });

  it('falls back to white for an empty stop list, via THREE.Color leaving an undefined stop unset', () => {
    // Not a guarded case: stops[-2] is `undefined` out of bounds, and `new THREE.Color(undefined)`
    // quietly keeps three's own default (white) rather than throwing.
    expect(rampAt([], 0.7).getHex()).toBe(0xffffff);
  });
});

import { perRunT } from '../../../src/render/tube/gradient.js';

describe('perRunT', () => {
  it('spreads runIndex across the lit runs', () => {
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 0, litCount: 5, surface: 'front' }, ['front']),
    ).toBeCloseTo(0, 6);
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 4, litCount: 5, surface: 'front' }, ['front']),
    ).toBeCloseTo(1, 6);
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 2, litCount: 5, surface: 'front' }, ['front']),
    ).toBeCloseTo(0.5, 6);
  });

  it('gives a lone lit run 0 rather than dividing by zero', () => {
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 0, litCount: 1, surface: 'front' }, ['front']),
    ).toBe(0);
  });

  it('spreads surface across the layers the spec enables', () => {
    const layers = ['front', 'back', 'wall'] as const;
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 9, surface: 'front' }, layers),
    ).toBeCloseTo(0, 6);
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 3, litCount: 9, surface: 'back' }, layers),
    ).toBeCloseTo(0.5, 6);
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 7, litCount: 9, surface: 'wall' }, layers),
    ).toBeCloseTo(1, 6);
  });

  it('gives 0 for a lone enabled surface even though it is listed', () => {
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 4, surface: 'front' }, ['front']),
    ).toBe(0);
  });

  it('gives a surface the spec does not list 0', () => {
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 4, surface: 'connector' }, ['front']),
    ).toBe(0);
  });

  it('is null for a domain that is not per run', () => {
    expect(
      perRunT({ of: 'run' }, { litOrdinal: 1, litCount: 4, surface: 'front' }, ['front']),
    ).toBeNull();
    expect(
      perRunT({ of: 'axis' }, { litOrdinal: 1, litCount: 4, surface: 'front' }, ['front']),
    ).toBeNull();
  });
});

import { perVertexT } from '../../../src/render/tube/gradient.js';

describe('perVertexT', () => {
  const span = { start: 0.25, span: 0.5 };

  it('passes the arc-length fraction straight through, for the run domain', () => {
    expect(perVertexT({ of: 'run' }, 0, span)).toBeCloseTo(0, 6);
    expect(perVertexT({ of: 'run' }, 1, span)).toBeCloseTo(1, 6);
    expect(perVertexT({ of: 'run' }, 0.5, span)).toBeCloseTo(0.5, 6);
  });

  it('places the run inside the glyph, for the letter domain', () => {
    expect(perVertexT({ of: 'letter' }, 0, span)).toBeCloseTo(0.25, 6);
    expect(perVertexT({ of: 'letter' }, 1, span)).toBeCloseTo(0.75, 6);
    expect(perVertexT({ of: 'letter' }, 0.5, span)).toBeCloseTo(0.5, 6);
  });

  it('is null for a domain that is not per vertex', () => {
    expect(perVertexT({ of: 'runIndex' }, 0.5, span)).toBeNull();
    expect(perVertexT({ of: 'radial' }, 0.5, span)).toBeNull();
  });
});

import { RAMP_RESOLUTION, rampTexture } from '../../../src/render/tube/gradient.js';

describe('rampTexture', () => {
  it('is a 256x1 half-float texture', () => {
    const tex = rampTexture([0xff0000, 0x0000ff]);
    expect(tex.image.width).toBe(RAMP_RESOLUTION);
    expect(tex.image.height).toBe(1);
    expect(tex.image.data).toHaveLength(RAMP_RESOLUTION * 4);
    expect(tex.image.data).toBeInstanceOf(Uint16Array);
    expect(tex.type).toBe(THREE.HalfFloatType);
    tex.dispose();
  });

  it('filters linearly, which half float supports without an extension', () => {
    const tex = rampTexture([0xff0000, 0x0000ff]);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    tex.dispose();
  });

  it('is the CPU ramp sampled, so the two cannot drift', () => {
    const stops = [0xff2d95, 0xffd14a, 0x2de0ff];
    const tex = rampTexture(stops);
    const data = tex.image.data as Uint16Array;
    for (const i of [0, 1, 77, 128, 254, 255]) {
      const want = rampAt(stops, i / (RAMP_RESOLUTION - 1));
      // Compared as the stored half floats, so only the storage format may differ, not the ramp.
      expect(data[i * 4]).toBe(THREE.DataUtils.toHalfFloat(want.r));
      expect(data[i * 4 + 1]).toBe(THREE.DataUtils.toHalfFloat(want.g));
      expect(data[i * 4 + 2]).toBe(THREE.DataUtils.toHalfFloat(want.b));
      expect(THREE.DataUtils.fromHalfFloat(data[i * 4 + 3] as number)).toBe(1);
    }
    tex.dispose();
  });

  it('keeps the dark end resolved, where the emissive floor lives', () => {
    const tex = rampTexture([0x000000, 0xffffff]);
    const data = tex.image.data as Uint16Array;
    const lows = [1, 2, 3, 4].map((i) => THREE.DataUtils.fromHalfFloat(data[i * 4] as number));
    // Every near-black step is distinct: an 8-bit ramp would collapse the first several to zero.
    expect(new Set(lows).size).toBe(lows.length);
    for (const v of lows) expect(v).toBeGreaterThan(0);
    tex.dispose();
  });

  it('is not colour-space converted, so the sRGB transfer is not applied twice', () => {
    const tex = rampTexture([0x000000, 0xffffff]);
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    tex.dispose();
  });
});

import type { GradientDomain, GradientSpec } from '../../../src/render/tube/gradient.js';
import { tintByRunColor } from '../../../src/render/tube/tint.js';

/** Runs the material's onBeforeCompile against a stand-in shader and returns what it produced. */
function compiled(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <begin_vertex>\n',
    fragmentShader: '#include <emissivemap_fragment>\n#include <color_fragment>\n',
  };
  material.onBeforeCompile?.(shader as never, undefined as never);
  return shader;
}

/** One uniform the patch registered, so a missing one fails here rather than reading as undefined. */
function uniform(shader: ReturnType<typeof compiled>, name: string): { value: unknown } {
  const found = shader.uniforms[name];
  if (!found) throw new Error(`no uniform ${name}`);
  return found;
}

describe('tintByRunColor with a gradient', () => {
  it('reads the attribute for a per-vertex domain', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', {
      domain: { of: 'run' },
      stops: [0xff0000, 0x0000ff],
      mode: 'replace',
    });
    const s = compiled(m);
    expect(s.vertexShader).toContain('attribute float gradientT');
    expect(s.vertexShader).not.toContain('uGradBounds');
    expect(s.fragmentShader).toContain('uGradRamp');
  });

  it('computes t from position for a positional domain', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', {
      domain: { of: 'axis', angle: 90 },
      stops: [0xff0000, 0x0000ff],
      mode: 'replace',
    });
    const s = compiled(m);
    expect(s.vertexShader).toContain('uGradBounds');
    expect(s.vertexShader).toContain('uGradOrigin');
    expect(s.vertexShader).not.toContain('attribute float gradientT');
    expect(s.uniforms.uGradBounds).toBeDefined();
    expect(s.uniforms.uGradOrigin).toBeDefined();
    expect(s.uniforms.uGradRamp).toBeDefined();
  });

  it('multiplies rather than replaces under modulate', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'run' }, stops: [0xffffff], mode: 'modulate' });
    expect(compiled(m).fragmentShader).toContain('vRunColor * ');
  });

  it('keeps a different domain on a different compiled program', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshPhysicalMaterial();
    tintByRunColor(a, 'emissive', { domain: { of: 'run' }, stops: [0xff0000], mode: 'replace' });
    tintByRunColor(b, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    expect(a.customProgramCacheKey?.()).not.toBe(b.customProgramCacheKey?.());
  });

  it('is unchanged when no gradient is given', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive');
    const s = compiled(m);
    expect(s.fragmentShader).toContain('totalEmissiveRadiance *= vRunColor;');
    expect(s.fragmentShader).not.toContain('uGradRamp');
  });
});

describe('tintByRunColor emits the pre-gradient GLSL verbatim without a gradient', () => {
  // Byte-for-byte golden strings. 24 Playwright baselines depend on no shipped look's GLSL moving,
  // and no shipped look sets `gradient`.
  it('for the emissive channel', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive');
    const s = compiled(m);
    expect(s.vertexShader).toBe(
      'attribute vec3 runColor;\nvarying vec3 vRunColor;\n#include <begin_vertex>\n  vRunColor = runColor;\n',
    );
    expect(s.fragmentShader).toBe(
      'varying vec3 vRunColor;\n#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vRunColor;\n#include <color_fragment>\n',
    );
    expect(Object.keys(s.uniforms)).toEqual([]);
    expect(m.emissive.getHex()).toBe(0xffffff);
  });

  it('for the colour channel', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'color');
    const s = compiled(m);
    expect(s.vertexShader).toBe(
      'attribute vec3 runColor;\nvarying vec3 vRunColor;\n#include <begin_vertex>\n  vRunColor = runColor;\n',
    );
    expect(s.fragmentShader).toBe(
      'varying vec3 vRunColor;\n#include <emissivemap_fragment>\n#include <color_fragment>\n  diffuseColor.rgb *= vRunColor;\n',
    );
    expect(Object.keys(s.uniforms)).toEqual([]);
    expect(m.color.getHex()).toBe(0xffffff);
  });
});

describe('positional gradient GLSL', () => {
  const vertexFor = (domain: GradientDomain, mode: GradientSpec['mode'] = 'replace') => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain, stops: [0xff0000, 0x0000ff], mode });
    return compiled(m).vertexShader;
  };

  it('reads position in letter-placement space, not world space', () => {
    expect(vertexFor({ of: 'axis' })).toContain('vec2 gp = position.xy + uGradOrigin;');
  });

  it('sweeps along +x at the default angle of 0 degrees', () => {
    // A GLSL int literal here would not compile: cos(0) has no float overload in GLSL ES 1.00.
    expect(vertexFor({ of: 'axis' })).toContain('vec2 dir = vec2(cos(0.0), sin(0.0));');
  });

  it('bakes the angle as radians, not degrees', () => {
    const glsl = vertexFor({ of: 'axis', angle: 90 });
    expect(glsl).toContain(`cos(${Math.PI / 2})`);
    expect(glsl).not.toContain('cos(90');
  });

  it('projects all four bounds corners onto the axis', () => {
    const glsl = vertexFor({ of: 'axis', angle: 45 });
    expect(glsl).toContain('dot(vec2(lo.x, lo.y), dir)');
    expect(glsl).toContain('dot(vec2(hi.x, lo.y), dir)');
    expect(glsl).toContain('dot(vec2(lo.x, hi.y), dir)');
    expect(glsl).toContain('dot(vec2(hi.x, hi.y), dir)');
  });

  it('guards an axis whose extent collapses to a point', () => {
    expect(vertexFor({ of: 'axis' })).toContain('phi > plo ?');
  });

  it('centres a radial by default, as a fraction of the bounds', () => {
    expect(vertexFor({ of: 'radial' })).toContain('mix(lo, hi, vec2(0.5, 0.5))');
  });

  it('places an off-centre radial at the given fraction of the bounds', () => {
    expect(vertexFor({ of: 'radial', at: [0.25, 1] })).toContain('mix(lo, hi, vec2(0.25, 1.0))');
  });

  it('normalises a radial by the farthest corner, not half the diagonal', () => {
    const glsl = vertexFor({ of: 'radial', at: [0, 0] });
    expect(glsl).toContain('max(');
    expect(glsl).toContain('length(vec2(hi.x, hi.y) - at)');
    expect(glsl).toContain('far > 0.0 ?');
  });

  it('clamps t before handing it to the fragment stage', () => {
    expect(vertexFor({ of: 'radial' })).toContain('vGradT = clamp(gt, 0.0, 1.0);');
    expect(vertexFor({ of: 'run' })).toContain('clamp(gradientT, 0.0, 1.0)');
  });

  // A run's last vertex sits at gradientT 1.0 exactly, and fract(1.0) is 0.0 — wrapping
  // unconditionally would snap every ramp's end back to its start.
  it('wraps t only where a crawl is running, and clamps it otherwise', () => {
    const glsl = vertexFor({ of: 'run' });
    expect(glsl).toContain('crawlT == 0.0');
    expect(glsl).toContain('fract(gradientT + crawlT)');
    expect(glsl.indexOf('clamp(gradientT, 0.0, 1.0)')).toBeLessThan(
      glsl.indexOf('fract(gradientT + crawlT)'),
    );
  });

  it('defaults the uniforms to a unit box at the origin', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    const s = compiled(m);
    expect((uniform(s, 'uGradBounds').value as THREE.Vector4).toArray()).toEqual([0, 0, 1, 1]);
    expect((uniform(s, 'uGradOrigin').value as THREE.Vector2).toArray()).toEqual([0, 0]);
  });

  it('registers no positional uniforms for an attribute-driven domain', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'letter' }, stops: [0xff0000], mode: 'replace' });
    const s = compiled(m);
    expect(s.uniforms.uGradBounds).toBeUndefined();
    expect(s.uniforms.uGradOrigin).toBeUndefined();
    expect(s.uniforms.uGradRamp).toBeDefined();
  });

  it('treats the per-run domains as attribute-driven too', () => {
    for (const of of ['runIndex', 'surface'] as const) {
      const glsl = vertexFor({ of });
      expect(glsl).toContain('attribute float gradientT');
      expect(glsl).not.toContain('uGradBounds');
    }
  });
});

describe('tintByRunColor gradient on the colour channel', () => {
  it('replaces the base colour with the ramp', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'color', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    const s = compiled(m);
    expect(s.fragmentShader).toContain(
      'diffuseColor.rgb *= texture2D(uGradRamp, vec2(vGradT, 0.5)).rgb;',
    );
    expect(s.fragmentShader).not.toContain('totalEmissiveRadiance');
  });

  it('modulates the run colour by the ramp', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'color', { domain: { of: 'radial' }, stops: [0xff0000], mode: 'modulate' });
    expect(compiled(m).fragmentShader).toContain(
      'diffuseColor.rgb *= vRunColor * texture2D(uGradRamp, vec2(vGradT, 0.5)).rgb;',
    );
  });

  it('separates replace from modulate in the program cache key', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshPhysicalMaterial();
    tintByRunColor(a, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    tintByRunColor(b, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'modulate' });
    expect(a.customProgramCacheKey?.()).not.toBe(b.customProgramCacheKey?.());
  });

  it('separates a gradient from no gradient in the program cache key', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshPhysicalMaterial();
    tintByRunColor(a, 'emissive');
    tintByRunColor(b, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    expect(a.customProgramCacheKey?.()).not.toBe(b.customProgramCacheKey?.());
  });
});

describe('the program cache key parts what is baked into the GLSL', () => {
  const key = (domain: GradientDomain) => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain, stops: [0xff0000, 0x0000ff], mode: 'replace' });
    return m.customProgramCacheKey?.();
  };

  it('separates two axis angles', () => {
    // The angle is a GLSL literal, so sharing a program here would silently sweep one word the
    // other's way.
    expect(key({ of: 'axis', angle: 0 })).not.toBe(key({ of: 'axis', angle: 90 }));
    expect(key({ of: 'axis' })).toBe(key({ of: 'axis', angle: 0 }));
  });

  it('separates two radial origins', () => {
    expect(key({ of: 'radial', at: [0, 0] })).not.toBe(key({ of: 'radial', at: [1, 1] }));
    expect(key({ of: 'radial' })).toBe(key({ of: 'radial', at: [0.5, 0.5] }));
  });

  it('shares a key across stops, which ride a uniform rather than the source', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshPhysicalMaterial();
    tintByRunColor(a, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    tintByRunColor(b, 'emissive', { domain: { of: 'axis' }, stops: [0x00ff00], mode: 'replace' });
    expect(a.customProgramCacheKey?.()).toBe(b.customProgramCacheKey?.());
  });
});

describe('the positional uniforms survive a recompile', () => {
  it('keeps the value the caller set when onBeforeCompile runs again', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    const first = compiled(m);
    (uniform(first, 'uGradBounds').value as THREE.Vector4).set(-2, -3, 4, 5);
    const second = compiled(m);
    expect((uniform(second, 'uGradBounds').value as THREE.Vector4).toArray()).toEqual([
      -2, -3, 4, 5,
    ]);
    expect(uniform(second, 'uGradBounds')).toBe(uniform(first, 'uGradBounds'));
  });
});

describe('the positional uniforms take their values from the material', () => {
  const patched = (bounds?: THREE.Vector4, origin?: THREE.Vector2) => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    if (bounds) m.userData.uGradBounds = bounds;
    if (origin) m.userData.uGradOrigin = origin;
    return compiled(m);
  };

  it('reads userData at compile time, which is after the caller has set it', () => {
    const s = patched(new THREE.Vector4(-1, -2, 3, 4), new THREE.Vector2(5, 6));
    expect((uniform(s, 'uGradBounds').value as THREE.Vector4).toArray()).toEqual([-1, -2, 3, 4]);
    expect((uniform(s, 'uGradOrigin').value as THREE.Vector2).toArray()).toEqual([5, 6]);
  });

  it('falls back to the unit box when the material carries nothing', () => {
    const s = patched();
    expect((uniform(s, 'uGradBounds').value as THREE.Vector4).toArray()).toEqual([0, 0, 1, 1]);
    expect((uniform(s, 'uGradOrigin').value as THREE.Vector2).toArray()).toEqual([0, 0]);
  });

  it('still hands back one uniform object across recompiles', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    m.userData.uGradBounds = new THREE.Vector4(-1, -2, 3, 4);
    const first = compiled(m);
    const second = compiled(m);
    expect(uniform(second, 'uGradBounds')).toBe(uniform(first, 'uGradBounds'));
    expect(uniform(second, 'uGradOrigin')).toBe(uniform(first, 'uGradOrigin'));
  });

  it('ignores a userData entry of the wrong shape', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    m.userData.uGradBounds = [1, 2, 3, 4];
    expect((uniform(compiled(m), 'uGradBounds').value as THREE.Vector4).toArray()).toEqual([
      0, 0, 1, 1,
    ]);
  });
});

describe('the ramp texture a tint samples', () => {
  const gradient: GradientSpec = {
    domain: { of: 'axis' },
    stops: [0xff2d95, 0x2de0ff],
    mode: 'replace',
  };

  it('is the one supplied, rather than a fresh bake per call', () => {
    const shared = rampTexture(gradient.stops);
    const seen = new Set<unknown>();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.MeshPhysicalMaterial();
      tintByRunColor(m, 'emissive', gradient, shared);
      seen.add(uniform(compiled(m), 'uGradRamp').value);
    }
    expect(seen).toEqual(new Set([shared]));
    shared.dispose();
  });

  it('is baked per call when none is supplied, so a direct caller still works', () => {
    const seen = new Set<THREE.Texture>();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.MeshPhysicalMaterial();
      tintByRunColor(m, 'emissive', gradient);
      seen.add(uniform(compiled(m), 'uGradRamp').value as THREE.Texture);
    }
    expect(seen.size).toBe(4);
    for (const tex of seen) tex.dispose();
  });

  it('is not registered at all without a gradient, supplied or not', () => {
    const m = new THREE.MeshPhysicalMaterial();
    const shared = rampTexture([0xff0000]);
    tintByRunColor(m, 'emissive', undefined, shared);
    expect(compiled(m).uniforms.uGradRamp).toBeUndefined();
    shared.dispose();
  });
});

describe('tintByRunColor with a limb rim', () => {
  const fragmentFor = (
    rim?: number,
    gradient?: GradientSpec,
    channel: 'emissive' | 'color' = 'emissive',
  ) => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, channel, gradient, undefined, rim);
    return compiled(m).fragmentShader;
  };

  const runGradient: GradientSpec = {
    domain: { of: 'run' },
    stops: [0xff0000, 0x0000ff],
    mode: 'replace',
  };

  it('emits what no rim at all emits when the rim is 0', () => {
    expect(fragmentFor(0)).toBe(fragmentFor(undefined));
    expect(fragmentFor(0, runGradient)).toBe(fragmentFor(undefined, runGradient));
  });

  it('leaves the vertex shader alone, reading a normal three already interpolates', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshPhysicalMaterial();
    tintByRunColor(a, 'emissive');
    tintByRunColor(b, 'emissive', undefined, undefined, 0.8);
    expect(compiled(b).vertexShader).toBe(compiled(a).vertexShader);
  });

  it('reads the grazing angle from the view-space shading normal', () => {
    expect(fragmentFor(0.8)).toContain('dot(normal, normalize(vViewPosition))');
  });

  it('emits the rim verbatim, scaled and mean-corrected rather than added', () => {
    expect(fragmentFor(0.5)).toBe(
      'varying vec3 vRunColor;\n#include <emissivemap_fragment>\n' +
        '  float rimNdv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);\n' +
        '  totalEmissiveRadiance *= vRunColor * ((1.0 - 0.5 * rimNdv) / 0.6073009183012759);\n' +
        '#include <color_fragment>\n',
    );
  });

  it('samples the ramp once under replace, not once per term', () => {
    const glsl = fragmentFor(0.8, runGradient);
    expect(glsl.split('texture2D(uGradRamp').length - 1).toBe(1);
  });

  it('samples the ramp once under modulate, and still multiplies the run colour', () => {
    const glsl = fragmentFor(0.8, { ...runGradient, mode: 'modulate' });
    expect(glsl.split('texture2D(uGradRamp').length - 1).toBe(1);
    expect(glsl).toContain('vRunColor * texture2D(uGradRamp');
  });

  it('is dropped on the colour channel, which has no shading normal yet and no glowing gas', () => {
    expect(fragmentFor(0.8, undefined, 'color')).toBe(fragmentFor(undefined, undefined, 'color'));
  });

  it('parts the program cache from no rim, and from a different strength', () => {
    const key = (rim?: number) => {
      const m = new THREE.MeshPhysicalMaterial();
      tintByRunColor(m, 'emissive', undefined, undefined, rim);
      return m.customProgramCacheKey?.();
    };
    expect(key(0.8)).not.toBe(key(undefined));
    expect(key(0.8)).not.toBe(key(0.4));
    expect(key(0)).toBe(key(undefined));
  });

  it('clamps rather than emitting a negative core or a NaN', () => {
    expect(fragmentFor(4)).toBe(fragmentFor(1));
    expect(fragmentFor(-2)).toBe(fragmentFor(undefined));
    expect(fragmentFor(Number.NaN)).toBe(fragmentFor(undefined));
  });
});
