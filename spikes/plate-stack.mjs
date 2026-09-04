/**
 * Does a plate stacked on a slab still read as one letter, and does a hole in it read as a well?
 *
 *   npm run build -w klieg && node spikes/plate-stack.mjs [--letter R] [--out dir]
 *
 * Drives the shipped cutter and plate assembler, so this is a regression check on them rather than
 * a second implementation. Renders today's letter beside the carved one and reports each one's
 * vertices; `--sweep` counts what the bezel costs in seats.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { buildPlate } from '../packages/core/dist/render/wells/plate.js';
import { regionOf } from '../packages/core/dist/render/wells/region.js';
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
  glyphToShapes,
} from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const LETTER = arg('letter', 'R');
const OUT = resolve(arg('out', resolve(HERE, 'plate-stack-out')));
/** How much of the letter's depth the plate takes; the slab keeps the rest. */
const PLATE = Number(arg('plate', '0.09'));
/** The bezel: how far in from the outline a well may start, in em. Also caps the slab's bevel. */
const MARGIN = Number(arg('margin', '0.05'));
/** Lattice pitch and each diamond's half-diagonal, in em. */
const PITCH = Number(arg('pitch', '0.1'));
const HALF = Number(arg('half', '0.032'));
const D = DEFAULT_GLYPH_OPTIONS.depth;

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const specWith = (bezel) => ({
  kind: 'well',
  cutter: 'lattice',
  bezel,
  floor: PLATE,
  pitch: PITCH,
  size: HALF * 2,
  look: {},
});
const CUT_SPEC = specWith(MARGIN);
const cutOf = (letterShapes, spec = CUT_SPEC) =>
  cutterFor('lattice')(letterShapes, regionOf(letterShapes), spec);

/**
 * How many seats survive as the bezel — and with it the slab's bevel — is reduced. The bezel
 * cannot go below the slab's bevel, because inside that width the slab's front face is a ramp
 * rather than a floor, and a well cut over it has a sloped seat at an unpredictable depth.
 */
if (process.argv.includes('--sweep')) {
  const LETTERS = arg('letters', 'IRHOB').split('');
  const BEVELS = arg('bevels', '0.038,0.03,0.02,0.012,0.006,0').split(',').map(Number);
  console.log(`seats at pitch ${PITCH}, stone half-diagonal ${HALF} em; bezel = the slab's bevel\n`);
  console.log(`  bevel   ${LETTERS.map((l) => l.padStart(5)).join('')}    total`);
  for (const b of BEVELS) {
    const counts = LETTERS.map((letter) => {
      const s = glyphToShapes(font, letter, 1);
      // A zero bezel still has to keep the stone out of the outline itself, so the floor
      // constraint relaxes to nothing but the silhouette one does not.
      return cutOf(s, specWith(Math.max(b, 1e-4))).wells.length;
    });
    const total = counts.reduce((a, c) => a + c, 0);
    console.log(
      `  ${b.toFixed(3)}   ${counts.map((c) => String(c).padStart(5)).join('')}   ${String(total).padStart(6)}`,
    );
  }
  process.exit(0);
}

const shapes = glyphToShapes(font, LETTER, 1);
const cut = cutOf(shapes);

const VARIANTS = {
  // Today's letter, built the way every shipped look builds it. Anything that changes here
  // changes every shipped look.
  today: () => [buildGlyphGeometry(font, LETTER, 1, DEFAULT_GLYPH_OPTIONS)],
  // The design's construction: a slab with a holed plate on its front face.
  wells: () => [buildPlate(shapes, cut, { depth: D, bezel: MARGIN })],
};

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
  index: geo.getIndex() ? [...geo.getIndex().array] : null,
});

console.log(`"${LETTER}" — ${cut.wells.length} seats placed at a ${MARGIN} em bezel\n`);
console.log('  variant             meshes   vertices');
const payload = {
  letter: LETTER,
  variants: Object.entries(VARIANTS).map(([name, make]) => {
    const geos = make();
    const vertices = geos.reduce((n, g) => n + g.getAttribute('position').count, 0);
    console.log(
      `  ${name.padEnd(18)}  ${String(geos.length).padStart(5)}   ${String(vertices).padStart(8)}`,
    );
    const out = { name, meshes: geos.map(dump) };
    for (const g of geos) g.dispose();
    return out;
  }),
};

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'plate-stack.html')), 'text/html'],
  '/geometry.json': [Buffer.from(JSON.stringify(payload)), 'application/json'],
};
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const hit = FILES[path];
  if (hit) return res.writeHead(200, { 'content-type': hit[1] }).end(hit[0]);
  for (const [prefix, dir] of Object.entries(TREES)) {
    if (!path.startsWith(prefix)) continue;
    const file = resolve(dir, path.slice(prefix.length));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    try {
      return res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(file));
    } catch {
      return res.writeHead(404).end();
    }
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 560 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
console.log('');
for (const look of arg('looks', 'gold,chrome').split(',')) {
  await page.goto(`${base}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
  const file = resolve(OUT, `plate-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
server.close();
process.exit(0);
