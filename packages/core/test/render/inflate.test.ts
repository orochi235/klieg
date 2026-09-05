import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INFLATE, inflate, PROFILES } from '../../src/render/inflate.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../src/text/glyphs.js';

/** The front face, which the bevel carries `bevelThickness` past the extrusion's own depth. */
const TOP = DEFAULT_GLYPH_OPTIONS.depth + DEFAULT_GLYPH_OPTIONS.bevelThickness;

/** A 0.6 em square, big enough that a 0.09 em reach leaves a flat plateau in the middle. */
function slab(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.6, 0);
  shape.lineTo(0.6, 0.6);
  shape.lineTo(0, 0.6);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: DEFAULT_GLYPH_OPTIONS.depth,
    bevelEnabled: true,
    bevelThickness: DEFAULT_GLYPH_OPTIONS.bevelThickness,
    bevelSize: DEFAULT_GLYPH_OPTIONS.bevelSize,
    bevelOffset: 0,
    bevelSegments: DEFAULT_GLYPH_OPTIONS.bevelSegments,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
  });
  geo.computeVertexNormals();
  return geo;
}

const positionsOf = (geo: THREE.BufferGeometry) =>
  (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

describe('the profiles', () => {
  it('all start at the cap and reach the full rise', () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      expect(profile(0), name).toBeCloseTo(0, 6);
      expect(profile(1), name).toBeCloseTo(name === 'flat' ? 0 : 1, 6);
    }
  });

  // The one constraint the mesher hands back to the design. Refinement is driven by how far a
  // chord falls from the profile, so a vertical tangent at the rim never converges — a circular
  // arc standing straight off the seam costs sixteen times the geometry and still misses by more.
  it('meet the cap with a finite slope', () => {
    const h = 1e-4;
    for (const [name, profile] of Object.entries(PROFILES)) {
      const slope = (profile(h) - profile(0)) / h;
      expect(slope, name).toBeLessThan(10);
    }
    // The arc that was rejected, for contrast: its slope at the seam runs away.
    const pillow = (t: number) => Math.sqrt(Math.max(0, 1 - (1 - t) ** 2));
    expect((pillow(h) - pillow(0)) / h).toBeGreaterThan(100);
  });
});

describe('inflate', () => {
  it('hands the geometry straight back for a flat profile', () => {
    const geo = slab();
    const out = inflate(geo, TOP, { ...DEFAULT_INFLATE, profile: 'flat' });
    expect(out.geometry).toBe(geo);
    expect(out.after).toBe(out.before);
  });

  it('raises the crown by the rise it was given and no further', () => {
    const out = inflate(slab(), TOP, { ...DEFAULT_INFLATE, rise: 0.1 });
    const pos = positionsOf(out.geometry);
    let high = Number.NEGATIVE_INFINITY;
    for (let i = 2; i < pos.length; i += 3) high = Math.max(high, pos[i] as number);
    expect(high).toBeCloseTo(TOP + 0.1, 3);
  });

  // A heightfield drops any cell the boundary crosses, so its crown stops short of the lid and the
  // bevel shows through the gap all the way round. Inheriting the lid's own edge measures zero.
  it('ends the crown exactly where the lid ends', () => {
    const flat = positionsOf(slab());
    let lidMaxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < flat.length; i += 3) {
      if (Math.abs((flat[i + 2] as number) - TOP) > 1e-6) continue;
      lidMaxX = Math.max(lidMaxX, flat[i] as number);
    }

    const out = inflate(slab(), TOP, DEFAULT_INFLATE);
    const pos = positionsOf(out.geometry);
    let crownMaxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pos.length; i += 3) {
      if ((pos[i + 2] as number) < TOP - 1e-5) continue;
      crownMaxX = Math.max(crownMaxX, pos[i] as number);
    }
    expect(crownMaxX).toBeCloseTo(lidMaxX, 6);
  });

  // The bevel grows the solid outward, so the lid is the shape itself and its corner is (0, 0) —
  // the widest cross-section, out at +bevelSize, is the straight wall between the two chamfers.
  it('leaves the rim at the cap, so the crown meets the bevel with no step', () => {
    const out = inflate(slab(), TOP, DEFAULT_INFLATE);
    const pos = positionsOf(out.geometry);
    let onRim = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] as number;
      const y = pos[i + 1] as number;
      if ((pos[i + 2] as number) < TOP - 1e-5) continue;
      const edge = Math.min(x, 0.6 - x, y, 0.6 - y);
      if (edge > 1e-5) continue;
      onRim++;
      expect(pos[i + 2]).toBeCloseTo(TOP, 5);
    }
    expect(onRim).toBeGreaterThan(8);
  });

  it('converges, and refines only where the profile bends', () => {
    const out = inflate(slab(), TOP, DEFAULT_INFLATE);
    expect(out.converged).toBe(true);
    expect(out.after).toBeGreaterThan(out.before);
    // One extra letter's worth of geometry, not an order of magnitude.
    expect(out.after).toBeLessThan(out.before + 12_000);
  });

  it('costs more the tighter the tolerance', () => {
    const loose = inflate(slab(), TOP, { ...DEFAULT_INFLATE, tolerance: 0.01 });
    const tight = inflate(slab(), TOP, { ...DEFAULT_INFLATE, tolerance: 0.0005 });
    expect(tight.after).toBeGreaterThan(loose.after);
  });

  // A face left with two marked edges splits one edge while its neighbour splits another, which
  // tears the mesh. Every vertex a triangle introduces has to be shared by the face across it.
  it('leaves no T-junction — every crown edge is walked from both sides', () => {
    const out = inflate(slab(), TOP, DEFAULT_INFLATE);
    const pos = positionsOf(out.geometry);
    const key = (i: number) =>
      `${Math.round((pos[i] as number) * 1e6)},${Math.round((pos[i + 1] as number) * 1e6)}`;
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.length; i += 9) {
      // Crown triangles only: the walls are a separate surface and open at both caps.
      if ([0, 3, 6].some((k) => (pos[i + k + 2] as number) < TOP - 1e-5)) continue;
      const v = [key(i), key(i + 3), key(i + 6)];
      for (let e = 0; e < 3; e++) {
        const a = v[e] as string;
        const b = v[(e + 1) % 3] as string;
        if (a === b) continue;
        seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
      }
    }
    // Every edge walked only one way must lie on the lid's own outline. An interior one is a
    // T-junction: one face split an edge its neighbour did not.
    let onOutline = 0;
    for (const [edge, n] of seen) {
      const [a, b] = edge.split('|') as [string, string];
      if (n === (seen.get(`${b}|${a}`) ?? 0)) continue;
      const border = (k: string) => {
        const [x, y] = k.split(',').map((v) => Number(v) / 1e6) as [number, number];
        return Math.min(x, 0.6 - x, y, 0.6 - y) < 1e-5;
      };
      expect(border(a) && border(b), `interior edge ${edge} walked once`).toBe(true);
      onOutline++;
    }
    expect(onOutline).toBeGreaterThan(8);
  });

  // Recomputing normals over the whole body welds the bevel's own crease into a smooth ramp, and
  // the bevel highlight is what every look reads by. The walls keep what the extruder gave them.
  it('keeps the walls’ own normals rather than welding the bevel smooth', () => {
    const plain = slab();
    const pos = positionsOf(plain);
    const nrm = (plain.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
    const wall: number[] = [];
    for (let t = 0; t < pos.length; t += 9) {
      if ([0, 3, 6].every((k) => Math.abs((pos[t + k + 2] as number) - TOP) < 1e-6)) continue;
      for (let k = 0; k < 9; k++) wall.push(nrm[t + k] as number);
    }
    const after = (
      inflate(slab(), TOP, DEFAULT_INFLATE).geometry.getAttribute('normal') as THREE.BufferAttribute
    ).array as Float32Array;
    expect(wall.length).toBeGreaterThan(0);
    for (let i = 0; i < wall.length; i++) expect(after[i]).toBeCloseTo(wall[i] as number, 6);
  });
});

describe('a look that asks for a shape', () => {
  it('caches a profile separately from the flat letter, and from another profile', async () => {
    const { WordCaches } = await import('../../src/render/caches.js');
    const { default: opentype } = await import('opentype.js');
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(new URL('../../../../apps/lab/public/font.ttf', import.meta.url));
    const parsed = opentype.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    const font = {
      font: parsed,
      unitsPerEm: parsed.unitsPerEm,
      key: '/f.ttf',
      family: 'inflate-cache',
      metrics: { advanceOf: () => 600, kernOf: () => 0 },
      bytes: new ArrayBuffer(0),
    } as never;

    const caches = new WordCaches();
    const flat = caches.glyph(font, 'I', DEFAULT_GLYPH_OPTIONS.depth);
    const puffed = caches.glyph(font, 'I', DEFAULT_GLYPH_OPTIONS.depth, { profile: 'cushion' });
    const domed = caches.glyph(font, 'I', DEFAULT_GLYPH_OPTIONS.depth, { profile: 'dome' });
    expect(puffed).not.toBe(flat);
    expect(domed).not.toBe(puffed);
    expect(caches.glyph(font, 'I', DEFAULT_GLYPH_OPTIONS.depth, { profile: 'cushion' })).toBe(
      puffed,
    );

    const high = (geo: THREE.BufferGeometry) => {
      const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      let z = Number.NEGATIVE_INFINITY;
      for (let i = 2; i < pos.length; i += 3) z = Math.max(z, pos[i] as number);
      return z;
    };
    expect(high(puffed)).toBeGreaterThan(high(flat) + 0.05);
  });
});
