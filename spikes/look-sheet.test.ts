/**
 * Not a test — a contact sheet. Builds each named look through the shipped `WellBuilder` and
 * rasterises it, so what is on the sheet is what the look actually produces rather than a
 * re-derivation of it. `LOOK_SHEET=pave,bezel npx vitest run --config spikes/vitest.render.config.ts look-sheet`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { it } from 'vitest';
import { WordCaches } from '../packages/core/src/render/caches.js';
import { WellBuilder } from '../packages/core/src/render/decorations/well.js';
import type { WordBuildContext } from '../packages/core/src/render/decorations/registry.js';
import { createMaterial, LOOKS, type LookName } from '../packages/core/src/render/looks.js';
import type { WellSpec } from '../packages/core/src/render/decoration.js';
import { DEFAULT_GLYPH_OPTIONS as GLYPH } from '../packages/core/src/text/glyphs.js';
import { cutterFor } from '../packages/core/src/render/wells/cutters.js';
import { regionOf } from '../packages/core/src/render/wells/region.js';
import { openEdges } from '../packages/core/src/render/wells/shell.js';

const CELL_W = Number(process.env.LOOK_CELL_W ?? 300);
const CELL_H = Number(process.env.LOOK_CELL_H ?? 380);
const WORD = process.env.LOOK_WORD ?? 'RG';

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

/** Enough of the context for `WellBuilder`: it reads shapes, a material factory and part info. */
function contextFor(caches: WordCaches, font: never, inflate?: object): WordBuildContext {
  return {
    font,
    caches,
    inflate,
    baseX: [0],
    baseY: [0],
    studioMaterial: () => createMaterial(null),
    glyph: (char, depth) => caches.glyph(font, char, depth, GLYPH),
    shapes: (char) => caches.shapes(font, char),
    partInfo: () => ({}) as never,
    meshInk: () => undefined as never,
  } as WordBuildContext;
}

interface Part {
  pos: Float32Array;
  nrm?: Float32Array;
  rgb: [number, number, number];
}

/** Flat/Gouraud orthographic z-buffer into one cell of a sheet. Returns nothing; writes pixels. */
function drawInto(
  rgbBuf: Float32Array,
  depthBuf: Float32Array,
  sheetW: number,
  cx: number,
  cy: number,
  parts: Part[],
) {
  const box = new THREE.Box3();
  for (const part of parts) {
    for (let i = 0; i < part.pos.length; i += 3) {
      box.expandByPoint(new THREE.Vector3(part.pos[i], part.pos[i + 1], part.pos[i + 2]));
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min((CELL_W * 0.84) / size.x, (CELL_H * 0.84) / size.y);
  const ox = cx + CELL_W / 2 - ((box.min.x + box.max.x) / 2) * scale;
  const oy = cy + CELL_H / 2 + ((box.min.y + box.max.y) / 2) * scale;
  const key = new THREE.Vector3(-0.35, 0.62, 0.7).normalize();

  for (const part of parts) {
    for (let t = 0; t < part.pos.length; t += 9) {
      const p = [0, 3, 6].map(
        (k) => new THREE.Vector3(part.pos[t + k], part.pos[t + k + 1], part.pos[t + k + 2]),
      );
      const face = new THREE.Vector3()
        .subVectors(p[1] as THREE.Vector3, p[0] as THREE.Vector3)
        .cross(new THREE.Vector3().subVectors(p[2] as THREE.Vector3, p[0] as THREE.Vector3))
        .normalize();
      if (face.z < 0) continue;
      const vn = part.nrm
        ? [0, 3, 6].map(
            (k) => new THREE.Vector3(part.nrm?.[t + k], part.nrm?.[t + k + 1], part.nrm?.[t + k + 2]),
          )
        : [face, face, face];
      const shade = (n: THREE.Vector3) =>
        Math.max(n.dot(key), 0) * 0.82 + 0.18 * Math.max(n.z, 0) + 0.06;
      const lum = vn.map(shade);
      const sx = p.map((v) => v.x * scale + ox);
      const sy = p.map((v) => oy - v.y * scale);
      const minX = Math.max(cx, Math.floor(Math.min(...sx)));
      const maxX = Math.min(cx + CELL_W - 1, Math.ceil(Math.max(...sx)));
      const minY = Math.max(cy, Math.floor(Math.min(...sy)));
      const maxY = Math.min(cy + CELL_H - 1, Math.ceil(Math.max(...sy)));
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
          const z =
            w0 * (p[0] as THREE.Vector3).z + w1 * (p[1] as THREE.Vector3).z + w2 * (p[2] as THREE.Vector3).z;
          const at = y * sheetW + x;
          if (z <= (depthBuf[at] as number)) continue;
          depthBuf[at] = z;
          const lam = w0 * (lum[0] as number) + w1 * (lum[1] as number) + w2 * (lum[2] as number);
          for (let c = 0; c < 3; c++) rgbBuf[at * 3 + c] = Math.min(1, (part.rgb[c] as number) * lam);
        }
      }
    }
  }
}

const hexRgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

it('draws a contact sheet of the well looks', () => {
  const names = (process.env.LOOK_SHEET ?? 'pave,bezel,carved,tiara').split(',') as LookName[];
  const font = loadFont();
  const sheetW = CELL_W * names.length;
  const sheetH = CELL_H;
  const rgbBuf = new Float32Array(sheetW * sheetH * 3).fill(0.09);
  const depthBuf = new Float32Array(sheetW * sheetH).fill(Number.NEGATIVE_INFINITY);

  names.forEach((name, col) => {
    const started = Date.now();
    const spec = LOOKS[name];
    const well = spec.decoration as WellSpec;
    const caches = new WordCaches();
    const ctx = contextFor(caches, font, spec.inflate);
    const builder = new WellBuilder(well, ctx);

    const parts: Part[] = [];
    let advance = 0;
    let open = 0;
    for (const [slot, char] of [...WORD].entries()) {
      const body = builder.bodyGeometry(char, GLYPH.depth);
      const group = new THREE.Group();
      builder.buildLetter(slot, char, group, undefined);

      const shift = (src: Float32Array): Float32Array => {
        const out = new Float32Array(src);
        for (let i = 0; i < out.length; i += 3) out[i] += advance;
        return out;
      };
      const bodyPos = (body.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const bodyNrm = (body.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
      parts.push({ pos: shift(bodyPos), nrm: bodyNrm, rgb: hexRgb(spec.color ?? 0xffffff) });
      // Nothing in a render tells a missing cap from a dark one, so this is the line to read.
      open += openEdges(bodyPos);

      const stones = group.children[0] as THREE.Mesh | THREE.InstancedMesh | undefined;
      if (stones) {
        const sp = (stones.geometry.getAttribute('position') as THREE.BufferAttribute)
          .array as Float32Array;
        // A pave cell is its own stone's girdle, so that fill hands over every stone already
        // placed. `lattice` instances one geometry instead, and reading its buffer alone draws
        // a single stone at the origin — which is what the whole field looked like.
        const instanced = stones as THREE.InstancedMesh;
        if (instanced.isInstancedMesh) {
          const out = new Float32Array(sp.length * instanced.count);
          const m = new THREE.Matrix4();
          const v = new THREE.Vector3();
          for (let n = 0; n < instanced.count; n++) {
            instanced.getMatrixAt(n, m);
            for (let i = 0; i < sp.length; i += 3) {
              v.set(sp[i] as number, sp[i + 1] as number, sp[i + 2] as number).applyMatrix4(m);
              out.set([v.x, v.y, v.z], n * sp.length + i);
            }
          }
          parts.push({ pos: shift(out), rgb: hexRgb(well.stone?.attenuationColor ?? 0xdfe8ff) });
        } else {
          parts.push({ pos: shift(sp), rgb: hexRgb(well.stone?.attenuationColor ?? 0xdfe8ff) });
        }
      }

      const bb = new THREE.Box3().setFromBufferAttribute(
        body.getAttribute('position') as THREE.BufferAttribute,
      );
      advance += bb.max.x - bb.min.x + 0.08;
    }

    // The count the render is actually about. Re-cut rather than read off the builder, which
    // keeps its cuts private — same cutter, same region, same spec, so it cannot disagree.
    const pockets = [...WORD].map((char) => {
      const shapes = ctx.shapes(char);
      return cutterFor(well.cutter)(shapes, regionOf(shapes, well.insets), well).wells.length;
    });
    console.log(
      `${col + 1}/${names.length} ${name} — ${WORD}, pockets ${pockets.join('+')}, ` +
        `${parts.reduce((n, p) => n + p.pos.length / 9, 0)} tris, ` +
        `${parts.length > WORD.length ? 'stones' : 'empty'}, ` +
        `shell ${open === 0 ? 'closed' : `OPEN (${open} edges)`}, ${Date.now() - started}ms`,
    );
    drawInto(rgbBuf, depthBuf, sheetW, col * CELL_W, 0, parts);
    builder.dispose();
    caches.dispose?.();
  });

  const bytes = Buffer.alloc(sheetW * sheetH * 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(255 * (rgbBuf[i] as number) ** (1 / 2.2));
  const out = process.env.LOOK_OUT ?? '/tmp/look-sheet.ppm';
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${sheetW} ${sheetH}\n255\n`), bytes]));
  console.log(`wrote ${out}`);
});
