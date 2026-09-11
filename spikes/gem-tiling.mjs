/**
 * A gem field laid over a letter and clipped to its outline — no distance field, no iso-contours,
 * no stitched shell.
 *
 *   npm run build -w klieg && node spikes/gem-tiling.mjs [word] [--pitch 0.055] [--wall 0.009]
 *
 * The shipped `well` pipeline spends its time deciding where metal may be removed: it rasterizes a
 * signed distance field, marches iso-contours at several inset levels, and derives a tessellation
 * from them. Profiling puts 29% in `strokeWidths`, 12% in `rasterize` and about 20% in the
 * clipping library, against 27ms for every stone in the word.
 *
 * This asks whether the cheap shape of the same picture works: tile the whole bounding box with
 * hexagons, keep the ones wholly inside the letter, clip only the ones that straddle its edge, and
 * accept the sharp edges that leaves. Interior cells — the large majority — are then never clipped
 * against anything, and nothing is ever rasterized.
 *
 * It answers three questions and no others: what it costs, how many cells survive, and whether the
 * edge reads. It builds footprints, not meshes: a brilliant seated in a footprint is work the
 * shipped `stone` fill already does for 27ms a word, and is not what is in question here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import polygonClipping from 'polygon-clipping';
import playwright from '@playwright/test';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const { chromium } = playwright;

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const WORD = process.argv[2]?.startsWith('--') ? 'FUCK YOU TRAVIS' : (process.argv[2] ?? 'FUCK YOU TRAVIS');
const PITCH = Number(arg('pitch', '0.055'));
const WALL = Number(arg('wall', '0.009'));
/** How far in from the letter's own edge the field stops, in em. */
const BEZEL = Number(arg('bezel', '0.012'));
const OUT = resolve(arg('out', resolve(HERE, 'gem-tiling-out')));

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const f1 = (n, w) => n.toFixed(1).padStart(w);
const pad = (n, w) => String(n).padStart(w);

/**
 * A flat-top hexagon of circumradius `r` centered on (cx, cy). The orientation has to match the
 * lattice step below: pointy-top hexagons on flat-top spacing leave a triangle between every three
 * cells, which is a gap rather than the sliver a pave wall is.
 */
function hexAt(cx, cy, r) {
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return ring;
}

/** Shrink a convex ring toward its centroid, which is what leaves the sliver of metal. */
function shrinkToward(ring, amount, r) {
  const k = Math.max(0, 1 - amount / r);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  return ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

function ringsOfShape(shape) {
  const outer = shape.getPoints(48).map((p) => [p.x, p.y]);
  const holes = shape.holes.map((h) => h.getPoints(48).map((p) => [p.x, p.y]));
  return [outer, ...holes];
}

function bboxOf(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function insideRing(ring, px, py) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Inside the glyph: inside an outer ring and outside every hole of that shape. */
function insideGlyph(polys, px, py) {
  for (const rings of polys) {
    // Cheap reject first: a point outside a ring's box cannot be inside the ring, and most
    // points a bounding-box tiling produces are outside every ring.
    const [bx0, by0, bx1, by1] = rings.bbox;
    if (px < bx0 || px > bx1 || py < by0 || py > by1) continue;
    if (!insideRing(rings[0], px, py)) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) {
      if (insideRing(rings[h], px, py)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * One letter's field. Every hexagon whose vertices all sit inside the letter is kept whole and
 * never touched by the clipper; one with some in and some out is clipped; one with none is
 * dropped on the point test alone.
 */
function fieldFor(char) {
  const shapes = glyphToShapes(font, char, 1);
  const polys = shapes.map((shape) => {
    const rings = ringsOfShape(shape);
    rings.bbox = bboxOf(rings[0]);
    return rings;
  });
  const clipInput = polys.map((rings) => rings.map((r) => [...r, r[0]]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rings of polys) {
    for (const [x, y] of rings[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const r = PITCH / 2;
  const stepX = r * 1.5;
  const stepY = r * Math.sqrt(3);
  const cells = [];
  let whole = 0;
  let clipped = 0;
  let dropped = 0;
  let failed = 0;

  for (let col = 0; (minX + col * stepX) <= maxX + stepX; col++) {
    const cx = minX + col * stepX;
    const offset = col % 2 ? stepY / 2 : 0;
    for (let row = 0; minY + row * stepY + offset <= maxY + stepY; row++) {
      const cy = minY + row * stepY + offset;
      const hex = hexAt(cx, cy, r);
      let inCount = 0;
      for (const [x, y] of hex) if (insideGlyph(polys, x, y)) inCount++;
      if (inCount === 0) {
        dropped++;
        continue;
      }
      const gem = shrinkToward(hex, WALL / 2, r);
      if (inCount === 6) {
        cells.push(gem);
        whole++;
        continue;
      }
      // Only a straddler reaches the clipper, which is the whole point of the classification.
      // Nudged by its own millionth first, as `pave.ts` does: a tiling puts whole rows of cells on
      // one line, and polygon-clipping refuses to close a ring built from coincident edges.
      const nudge = 1 - (cells.length + 1) * 4e-9;
      const gx = gem.reduce((a, p) => a + p[0], 0) / gem.length;
      const gy = gem.reduce((a, p) => a + p[1], 0) / gem.length;
      const nudged = gem.map(([x, y]) => [gx + (x - gx) * nudge, gy + (y - gy) * nudge]);
      let pieces;
      try {
        pieces = polygonClipping.intersection([[...nudged, nudged[0]]], clipInput);
      } catch {
        // A cell the clipper cannot close is dropped rather than guessed at. Counted, so the
        // picture and the numbers both say how often it happens.
        failed++;
        continue;
      }
      for (const poly of pieces) {
        const ring = poly[0].slice(0, -1);
        if (ring.length >= 3) {
          cells.push(ring);
          clipped++;
        }
      }
    }
  }
  const outlinePoints = polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);
  return { cells, whole, clipped, dropped, failed, outlinePoints, bounds: [minX, minY, maxX, maxY] };
}

const chars = [...new Set([...WORD].filter((c) => c.trim()))];
console.log(`word "${WORD}": ${[...WORD].filter((c) => c.trim()).length} letters, ${chars.length} distinct`);
console.log(`pitch ${PITCH}  wall ${WALL}  bezel ${BEZEL}\n`);
console.log(' n/N  ch      ms   cells   whole  clipped  failed  outline');

let total = 0;
let cellCount = 0;
const fields = new Map();
for (const [i, char] of chars.entries()) {
  const t0 = performance.now();
  const field = fieldFor(char);
  const ms = performance.now() - t0;
  total += ms;
  cellCount += field.cells.length;
  fields.set(char, field);
  console.log(
    `${pad(`${i + 1}/${chars.length}`, 4)}  ${char.padEnd(2)} ${f1(ms, 7)}  ${pad(field.cells.length, 5)}  ${pad(field.whole, 6)}  ${pad(field.clipped, 7)}  ${pad(field.failed, 6)}  ${pad(field.outlinePoints, 7)}`,
  );
}

console.log(`\ndistinct total: ${f1(total, 8)}ms, ${cellCount} cells`);
console.log(`shipped pave for the same word: 5691.0ms (region 1966.0 + cut 3697.6 + fill 27.4)`);
console.log(`ratio: ${(5691 / total).toFixed(1)}x faster\n`);

// A picture of one letter, top down: the tessellation and what the outline did to it.
const SHOW = arg('show', chars[0]);
const field = fields.get(SHOW);
if (field) {
  const [minX, minY, maxX, maxY] = field.bounds;
  const scale = 900 / Math.max(maxX - minX, maxY - minY);
  const w = (maxX - minX) * scale + 80;
  const h = (maxY - minY) * scale + 80;
  const px = ([x, y]) => `${(x - minX) * scale + 40},${(maxY - y) * scale + 40}`;
  const paths = field.cells
    .map((ring) => `<polygon points="${ring.map(px).join(' ')}" />`)
    .join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="#0b0d12"/>
<g fill="#3b6fe0" stroke="#9fc0ff" stroke-width="0.6">
${paths}
</g></svg>`;
  mkdirSync(OUT, { recursive: true });
  const svgFile = resolve(OUT, `tiling-${SHOW}.svg`);
  writeFileSync(svgFile, svg);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Math.ceil(w), height: Math.ceil(h) } });
  await page.setContent(svg);
  const pngFile = resolve(OUT, `tiling-${SHOW}.png`);
  writeFileSync(pngFile, await page.screenshot());
  await browser.close();
  console.log(`wrote ${pngFile}  (${field.cells.length} cells, ${field.clipped} clipped at the edge)`);
}
