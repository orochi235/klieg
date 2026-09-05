/**
 * Not a test — a renderer, run through vitest so it can import the package's TypeScript directly.
 * Rasterises the shipped cutter and shell orthographically with flat shading, which is enough to
 * say whether a field reads as pavé. `npx vitest run spikes/pave-render.test.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { it } from 'vitest';
import { WordCaches } from '../packages/core/src/render/caches.js';
import { createMaterial } from '../packages/core/src/render/looks.js';
import { chamfered, DEFAULT_GLYPH_OPTIONS as DEFAULT_GLYPH } from '../packages/core/src/text/glyphs.js';
import { cutterFor } from '../packages/core/src/render/wells/cutters.js';
import { fillFor } from '../packages/core/src/render/wells/fills.js';
import { DEFAULT_INFLATE, inflate } from '../packages/core/src/render/inflate.js';
import { regionOf } from '../packages/core/src/render/wells/region.js';
import { buildShell, DEFAULT_SHELL, openEdges, shellPlanes } from '../packages/core/src/render/wells/shell.js';

const W = 520;
const H = 640;
const LETTER = process.env.PAVE_LETTER ?? 'R';

function loadFont() {
  const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return {
    font,
    unitsPerEm: font.unitsPerEm,
    key: '/f.ttf',
    family: 'render',
    metrics: { advanceOf: () => 600, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  } as never;
}

/** Flat-shaded orthographic z-buffer. One key light, a little fill, no reflections. */
function raster(
  parts: { pos: Float32Array; nrm?: Float32Array; rgb: [number, number, number] }[],
  out: string,
) {
  const box = new THREE.Box3();
  for (const part of parts) {
    for (let i = 0; i < part.pos.length; i += 3) {
      box.expandByPoint(new THREE.Vector3(part.pos[i], part.pos[i + 1], part.pos[i + 2]));
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min((W * 0.86) / size.x, (H * 0.86) / size.y);
  const ox = W / 2 - ((box.min.x + box.max.x) / 2) * scale;
  const oy = H / 2 + ((box.min.y + box.max.y) / 2) * scale;

  const depth = new Float32Array(W * H).fill(Number.NEGATIVE_INFINITY);
  const rgb = new Float32Array(W * H * 3).fill(0.09);
  const key = new THREE.Vector3(-0.35, 0.62, 0.7).normalize();

  for (const part of parts) {
    for (let t = 0; t < part.pos.length; t += 9) {
      const p = [0, 3, 6].map((k) => new THREE.Vector3(part.pos[t + k], part.pos[t + k + 1], part.pos[t + k + 2]));
      const face = new THREE.Vector3()
        .subVectors(p[1] as THREE.Vector3, p[0] as THREE.Vector3)
        .cross(new THREE.Vector3().subVectors(p[2] as THREE.Vector3, p[0] as THREE.Vector3))
        .normalize();
      if (face.z < 0) continue;
      // Gouraud off the geometry's own normals where it has them: shading a smooth crown off face
      // normals renders every triangle it is made of, which is not what the mesh looks like.
      const vn = part.nrm
        ? [0, 3, 6].map((k) =>
            new THREE.Vector3(part.nrm?.[t + k], part.nrm?.[t + k + 1], part.nrm?.[t + k + 2]),
          )
        : [face, face, face];
      const shade = (n: THREE.Vector3) =>
        Math.max(n.dot(key), 0) * 0.82 + 0.18 * Math.max(n.z, 0) + 0.06;
      const lum = vn.map(shade);
      const sx = p.map((v) => v.x * scale + ox);
      const sy = p.map((v) => oy - v.y * scale);
      const minX = Math.max(0, Math.floor(Math.min(...sx)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const minY = Math.max(0, Math.floor(Math.min(...sy)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      const d = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(d) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / d;
          const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / d;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * (p[0] as THREE.Vector3).z + w1 * (p[1] as THREE.Vector3).z + w2 * (p[2] as THREE.Vector3).z;
          const at = y * W + x;
          if (z <= (depth[at] as number)) continue;
          depth[at] = z;
          const lam = w0 * (lum[0] as number) + w1 * (lum[1] as number) + w2 * (lum[2] as number);
          for (let c = 0; c < 3; c++) rgb[at * 3 + c] = Math.min(1, (part.rgb[c] as number) * lam);
        }
      }
    }
  }

  const bytes = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) bytes[i] = Math.round(255 * (rgb[i] as number) ** (1 / 2.2));
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), bytes]));
}

it('renders an inflated letter', () => {
  const shapes = new WordCaches().shapes(loadFont(), LETTER);
  const top = DEFAULT_GLYPH.depth + DEFAULT_GLYPH.bevelThickness;
  const flat = new THREE.ExtrudeGeometry(chamfered(shapes, DEFAULT_GLYPH), {
    depth: DEFAULT_GLYPH.depth,
    bevelEnabled: true,
    bevelThickness: DEFAULT_GLYPH.bevelThickness,
    bevelSize: DEFAULT_GLYPH.bevelSize,
    bevelOffset: 0,
    bevelSegments: DEFAULT_GLYPH.bevelSegments,
    curveSegments: DEFAULT_GLYPH.curveSegments,
  });
  flat.computeVertexNormals();
  const profile = (process.env.PAVE_PROFILE ?? 'cushion') as 'cushion';
  const out = inflate(flat, top, { ...DEFAULT_INFLATE, profile });
  const pos = (out.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  console.log(
    `${LETTER} ${profile} — lid ${out.before} to ${out.after} tris, ` +
      `body ${pos.length / 9} tris, converged=${out.converged}`,
  );
  const nrm = (out.geometry.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  raster([{ pos, nrm, rgb: [1.0, 0.78, 0.34] }], `/tmp/inflate-${LETTER}-${profile}.ppm`);
});

it('renders a paved letter', () => {
  const shapes = new WordCaches().shapes(loadFont(), LETTER);
  const spec = {
    kind: 'well',
    cutter: process.env.PAVE_CUTTER ?? 'pave',
    bezel: 0.028,
    floor: 0.07,
    pitch: 0.055,
    size: 0.048,
    wall: 0.009,
    look: {},
  } as never;

  const cut = cutterFor((spec as { cutter: string }).cutter)(shapes, regionOf(shapes), spec);
  const opts = { ...DEFAULT_SHELL, depth: 0.3, bezel: 0.028, rimBevel: 0.003, rimDrop: 0.003 };
  const body = buildShell(shapes, cut, opts);
  const bodyPos = (body.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

  const planes = shellPlanes(0.3, 0.07, 0.028);
  const filled = fillFor('stone')(
    cut.seats,
    {
      material: () => createMaterial(null),
      faceZ: planes.faceZ,
      floorZ: planes.floorZ,
      girdleZ: planes.faceZ - 0.003,
    } as never,
    spec,
  );
  const stonePos = (filled.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

  console.log(
    `${LETTER} — ${cut.wells.length} pockets, body ${bodyPos.length / 9} tris, ` +
      `stones ${stonePos.length / 9} tris, shell ${openEdges(bodyPos) === 0 ? 'closed' : 'OPEN'}`,
  );
  raster(
    [
      { pos: bodyPos, rgb: [1.0, 0.78, 0.34] },
      ...(filled.placed ? [{ pos: stonePos, rgb: [0.72, 0.86, 1.0] as [number, number, number] }] : []),
    ],
    `/tmp/pave-${LETTER}-${(spec as { cutter: string }).cutter}.ppm`,
  );
});
