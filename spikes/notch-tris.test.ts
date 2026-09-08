/**
 * Not a test — a measurement of the fan at the R's bowl-to-leg notch: how many triangles sit
 * there, how thin they are, and how far their normals swing.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { it } from 'vitest';
import { WordCaches } from '../packages/core/src/render/caches.js';
import { cutterFor } from '../packages/core/src/render/wells/cutters.js';
import { regionOf } from '../packages/core/src/render/wells/region.js';
import { buildShell, DEFAULT_SHELL } from '../packages/core/src/render/wells/shell.js';
import { LOOKS } from '../packages/core/src/render/looks.js';
import type { WellSpec } from '../packages/core/src/render/decoration.js';
import { DEFAULT_GLYPH_OPTIONS as GLYPH } from '../packages/core/src/text/glyphs.js';

function loadFont() {
  const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { font, unitsPerEm: font.unitsPerEm, key: '/f.ttf', family: 'render',
    metrics: { advanceOf: () => 600, kernOf: () => 0 }, bytes: new ArrayBuffer(0) } as never;
}

it('measures the fan', () => {
  const shapes = new WordCaches().shapes(loadFont(), 'R');
  const spec = LOOKS.carved.decoration as WellSpec;
  const cut = cutterFor(spec.cutter)(shapes, regionOf(shapes, spec.insets), spec);
  const shell = buildShell(shapes, cut, {
    ...DEFAULT_SHELL, depth: GLYPH.depth, bezel: spec.bezel,
    rimBevel: spec.rimBevel ?? DEFAULT_SHELL.rimBevel, rimDrop: spec.rimDrop ?? DEFAULT_SHELL.rimDrop,
    round: 0, roundOuter: 0,
  });
  const pos = (shell.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const nrm = (shell.geometry.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;

  // Is the buffer flat-shaded? Non-indexed + computeVertexNormals gives every vertex of a triangle
  // the same normal, which is what makes a sliver fan read as stripes rather than as a smooth wedge.
  let flat = 0;
  const total = pos.length / 9;
  for (let t = 0; t < pos.length; t += 9) {
    const a = new THREE.Vector3(nrm[t], nrm[t + 1], nrm[t + 2]);
    const b = new THREE.Vector3(nrm[t + 3], nrm[t + 4], nrm[t + 5]);
    if (a.distanceTo(b) < 1e-6) flat++;
  }

  // The notch, read off the render: the sharp reflex corner on the R's right side.
  const NX = 0.60;
  const NY = 0.30;
  const R = 0.06;
  let near = 0;
  let slivers = 0;
  let area = 0;
  const normals: THREE.Vector3[] = [];
  const aspects: number[] = [];
  for (let t = 0; t < pos.length; t += 9) {
    const p = [0, 3, 6].map((k) => new THREE.Vector3(pos[t + k], pos[t + k + 1], pos[t + k + 2]));
    const cx = (p[0].x + p[1].x + p[2].x) / 3;
    const cy = (p[0].y + p[1].y + p[2].y) / 3;
    if (Math.hypot(cx - NX, cy - NY) > R) continue;
    near++;
    const e = [p[0].distanceTo(p[1]), p[1].distanceTo(p[2]), p[2].distanceTo(p[0])];
    const s = e.reduce((n, v) => n + v, 0) / 2;
    const ar = Math.sqrt(Math.max(s * (s - e[0]) * (s - e[1]) * (s - e[2]), 0));
    area += ar;
    // Longest edge over the height onto it: 1 is equilateral-ish, 20 is a sliver.
    const longest = Math.max(...e);
    const aspect = ar > 0 ? (longest * longest) / (2 * ar) : Number.POSITIVE_INFINITY;
    aspects.push(aspect);
    if (aspect > 10) slivers++;
    const n = new THREE.Vector3()
      .subVectors(p[1], p[0])
      .cross(new THREE.Vector3().subVectors(p[2], p[0]))
      .normalize();
    if (n.z > -0.9) normals.push(n);
  }
  aspects.sort((a, b) => a - b);
  let spread = 0;
  for (const a of normals) for (const b of normals) spread = Math.max(spread, a.angleTo(b));
  console.log(
    `shell: ${total} triangles, ${flat} of them flat-shaded (${((100 * flat) / total).toFixed(0)}%)\n` +
      `notch (r=${R} em about ${NX},${NY}): ${near} triangles, ${slivers} with aspect > 10\n` +
      `  aspect  median ${(aspects[aspects.length >> 1] ?? 0).toFixed(1)}  ` +
      `p90 ${(aspects[Math.floor(aspects.length * 0.9)] ?? 0).toFixed(1)}  ` +
      `max ${(aspects[aspects.length - 1] ?? 0).toFixed(1)}\n` +
      `  total area ${area.toFixed(5)} em^2 over ${near} triangles = ${(area / (near || 1)).toExponential(2)} each\n` +
      `  normals span ${((spread * 180) / Math.PI).toFixed(0)} degrees`,
  );
});
