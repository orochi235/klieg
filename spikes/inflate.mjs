/**
 * What else can a letter be inflated into?
 *
 *   npm run build -w klieg && node spikes/inflate.mjs [--letter R] [--out dir]
 *
 * Everything klieg draws is one linear push along z with a bevel at each end. The wells-and-fills
 * model says what to carve out of a solid and never says how the solid got its shape, so this is
 * the other half: a profile that maps how deep inside the outline a point is to how far it stands
 * proud. Today's flat cap is the profile `z = 0`.
 *
 * The distance is the tube pipeline's own signed distance field, which is the point — the machinery
 * for "how far inside the letter is this" already ships, and an inflation is a function of it.
 * Builds the meshes here, renders them in a row, and writes a PNG.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const LETTER = arg('letter', 'R');
const OUT = resolve(arg('out', resolve(HERE, 'inflate-out')));
const RESOLUTION = Number(arg('resolution', '384'));
/** How far in from the outline the inflation reaches full height, in em. */
const REACH = Number(arg('reach', '0.09'));
/** How far the crown stands above the flat cap, in em. */
const RISE = Number(arg('rise', '0.1'));

/**
 * Each profile takes `t`, the fraction of `REACH` a point sits inside the outline, and answers how
 * far above the flat cap it stands. `flat` is what ships.
 */
const PROFILES = {
  flat: () => 0,
  pillow: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)),
  dome: (t) => Math.sin((Math.PI * t) / 2),
  ridge: (t) => t,
};

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

/** Every ring of the glyph, outlines and counters alike — the field takes them all. */
const polygons = [];
for (const shape of shapes) {
  polygons.push(shape.getPoints(64).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) polygons.push(hole.getPoints(64).map((p) => ({ x: p.x, y: p.y })));
}
const field = signedDistanceField(polygons, { resolution: RESOLUTION, pad: 0.05 });

/**
 * The crown: a grid over the field, a vertex wherever the glyph is solid, and a quad only where all
 * four corners are. A boundary cell is dropped rather than clipped, which leaves a rim one cell
 * wide — 1/384 em here, and the extruded body underneath shows through it rather than a gap.
 */
function crown(profile) {
  const { size, data, emPerCell, originX, originY } = field;
  const index = new Int32Array(size * size).fill(-1);
  const position = [];
  const top = DEFAULT_GLYPH_OPTIONS.depth;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const d = data[gy * size + gx];
      if (d >= 0) continue;
      const t = Math.min(-d / REACH, 1);
      index[gy * size + gx] = position.length / 3;
      position.push(originX + gx * emPerCell, originY + gy * emPerCell, top + RISE * profile(t));
    }
  }
  const indices = [];
  for (let gy = 0; gy + 1 < size; gy++) {
    for (let gx = 0; gx + 1 < size; gx++) {
      const a = index[gy * size + gx];
      const b = index[gy * size + gx + 1];
      const c = index[(gy + 1) * size + gx + 1];
      const e = index[(gy + 1) * size + gx];
      if (a < 0 || b < 0 || c < 0 || e < 0) continue;
      indices.push(a, b, c, a, c, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const body = new THREE.ExtrudeGeometry(shapes, { ...DEFAULT_GLYPH_OPTIONS, bevelEnabled: true, bevelOffset: 0 });
const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
  index: geo.getIndex() ? [...geo.getIndex().array] : null,
});

const payload = {
  letter: LETTER,
  body: dump(body),
  crowns: Object.entries(PROFILES).map(([name, profile]) => {
    const geo = crown(profile);
    const out = { name, ...dump(geo), vertices: geo.getAttribute('position').count };
    console.log(`  ${name.padEnd(7)} crown ${out.vertices} vertices`);
    geo.dispose();
    return out;
  }),
};
body.dispose();

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'inflate.html')), 'text/html'],
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
const page = await browser.newPage({ viewport: { width: 1600, height: 520 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
for (const look of arg('looks', 'gold,chrome').split(',')) {
  await page.goto(`${base}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
  const file = resolve(OUT, `inflate-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
server.close();
process.exit(0);
