/**
 * Does a stone seated in a cut well read as set, and what does it cost?
 *
 *   npm run build -w klieg && node spikes/stone-seat.mjs [--letter R] [--out dir]
 *
 * Drives the shipped cutter and plate assembler and seats a brilliant in every well they leave, so
 * the only new thing here is the stone and where it sits. `--sweep` prices the cut's facet count.
 *
 * The seat is not a free choice. `ExtrudeGeometry` bevels a hole outward toward the face, so a
 * well's opening is `bezel + bevelSize` wide at the plate's front and `bezel` wide once the bevel
 * has run out — which means the girdle's radius and its height are one number, not two. Seat the
 * girdle below the bevel and the stone sits in a pit with its crown under the letter's own face;
 * seat it at the face and the bevel is the collar coming up around it, which is what a bezel
 * setting is.
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
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);
const LETTER = arg('letter', 'R');
const OUT = resolve(arg('out', resolve(HERE, 'stone-seat-out')));
/** The plate's thickness — a well's depth — in em. */
const PLATE = Number(arg('plate', '0.09'));
/** How far in from the outline a well may start, in em. Also caps the slab's bevel. */
const MARGIN = Number(arg('margin', '0.012'));
/** Lattice pitch and each well's half-diagonal, in em. */
const PITCH = Number(arg('pitch', '0.068'));
const HALF = Number(arg('half', '0.024'));
/** Girdle points. Four fills a diamond seat corner to corner; eight inscribes an octagon in it. */
const FACETS = Number(arg('facets', '8'));
/** How far down the well's bevel the girdle sits, 0 at the letter's face and 1 below the collar. */
const SINK = Number(arg('sink', '0.25'));
/** Table width and crown height as fractions of the girdle's width, after the round brilliant. */
const TABLE = Number(arg('table', '0.53'));
const CROWN = Number(arg('crown', '0.16'));
/** Pavilion depth as a fraction of the girdle's width. */
const PAVILION = Number(arg('pavilion', '0.43'));

const D = DEFAULT_GLYPH_OPTIONS.depth;
const BEVEL = DEFAULT_GLYPH_OPTIONS.bevelSize;
const BEVEL_Z = DEFAULT_GLYPH_OPTIONS.bevelThickness;

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);
const spec = {
  kind: 'well',
  cutter: 'lattice',
  bezel: MARGIN,
  floor: PLATE,
  pitch: PITCH,
  size: HALF * 2,
  look: {},
};
const cut = cutterFor('lattice')(shapes, regionOf(shapes), spec);

/** A well's centre, which the cutter does not report — it answers outlines. */
function centreOf(path) {
  const points = path.getPoints(1);
  const box = new THREE.Box2();
  for (const p of points) box.expandByPoint(p);
  return box.getCenter(new THREE.Vector2());
}

/**
 * The plate's front face and the slab's, in the merged body's own z. The extruder carries a
 * bevelled face `bevelThickness` past the depth it was asked for, so neither is where the depth
 * alone would put it — a stone seated at `depth` sits 0.055 em inside the letter.
 */
const slabDepth = Math.max(D - PLATE, 0);
const slabBevelZ = (BEVEL_Z * Math.min(BEVEL, MARGIN)) / BEVEL;
const floorZ = slabDepth + slabBevelZ;
const faceZ = D + BEVEL_Z;

/** The girdle's radius follows the height it is seated at: the bevel widens the hole toward the
 * face, so the two are one number. */
const GIRDLE_R = HALF + BEVEL * (1 - SINK);
const GIRDLE_W = GIRDLE_R * 2;

/**
 * A brilliant cut: table, crown, girdle, pavilion, flat-shaded so every facet catches its own
 * highlight. The girdle is inscribed in the well's opening at the height it is seated at.
 */
function brilliant() {
  const girdleR = GIRDLE_R;
  const girdleZ = faceZ - SINK * BEVEL_Z;
  const width = GIRDLE_W;
  const tableZ = girdleZ + CROWN * width;
  const culetZ = girdleZ - PAVILION * width;
  if (culetZ < floorZ) {
    console.log(
      `  note: the culet reaches ${(floorZ - culetZ).toFixed(4)} em below the floor — ` +
        `the plate is thinner than the stone's pavilion`,
    );
  }

  // Four girdle points sit on the seat's corners. Eight alternate corner and edge midpoint, which
  // is the largest octagon the diamond seat holds.
  const ring = (radius, z) => {
    const out = [];
    for (let i = 0; i < FACETS; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / FACETS;
      const corner = FACETS === 4 || i % 2 === 0;
      const r = radius * (corner ? 1 : Math.SQRT1_2);
      out.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    return out;
  };
  const girdle = ring(girdleR, girdleZ);
  const table = ring(girdleR * TABLE, tableZ);
  const culet = new THREE.Vector3(0, 0, culetZ);

  const position = [];
  const push = (...ps) => {
    for (const p of ps) position.push(p.x, p.y, p.z);
  };
  for (let i = 0; i < FACETS; i++) {
    const j = (i + 1) % FACETS;
    push(girdle[i], girdle[j], table[j]);
    push(girdle[i], table[j], table[i]);
    push(girdle[j], girdle[i], culet);
  }
  for (let i = 1; i + 1 < FACETS; i++) push(table[0], table[i], table[i + 1]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.computeVertexNormals();
  return geo;
}

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
  index: geo.getIndex() ? [...geo.getIndex().array] : null,
});

const body = buildPlate(shapes, cut, { depth: D, bezel: MARGIN });
const stone = brilliant();
const seats = cut.wells.map((w) => centreOf(w)).map((c) => [c.x, c.y]);
const bodyVerts = body.getAttribute('position').count;
const stoneVerts = stone.getAttribute('position').count;
console.log(`"${LETTER}" — ${seats.length} seats at a ${MARGIN} em bezel, ${FACETS} girdle facets`);
console.log(`  floor z ${floorZ.toFixed(4)}  face z ${faceZ.toFixed(4)}  plate ${PLATE}`);
console.log(`  body ${bodyVerts} vertices, stone ${stoneVerts} each`);
console.log(`  stones ${stoneVerts * seats.length} vertices as meshes, ${stoneVerts} instanced`);

if (has('no-render')) process.exit(0);

const payload = { letter: LETTER, body: dump(body), stone: dump(stone), seats };
body.dispose();
stone.dispose();

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'stone-seat.html')), 'text/html'],
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
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
// How far light travels through the stone before the look's `attenuationColor` has fully
// developed, as a fraction of the girdle's width. This is the stone's colour knob, not a physical
// constant: at 0.5 the shipped `gem` reads as ruby, at 0.1 as champagne over the plate beneath,
// and at the look's own 1.4 em — tuned for a volume the size of a letter — as black.
for (const look of arg('looks', 'gold').split(',')) {
  for (const tint of arg('tints', '0.5').split(',')) {
    const fill = arg('fill', 'gem');
    const query = `look=${look}&fill=${fill}&thickness=${Number(tint) * GIRDLE_W}`;
    await page.goto(`${base}/?${query}`);
    await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
    const file = resolve(OUT, `stone-${LETTER}-${look}-tint${tint}.png`);
    writeFileSync(file, await page.screenshot());
    console.log(`  wrote ${file}`);
  }
}
await browser.close();
server.close();
process.exit(0);
