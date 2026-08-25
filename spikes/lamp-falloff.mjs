/**
 * Does a per-part gain multiplier read as a light on each look, and what falloff looks right?
 *
 *   node spikes/lamp-falloff.mjs                       # every look, lamp off vs on
 *   node spikes/lamp-falloff.mjs --mode falloff        # one look, four falloff curves
 *   node spikes/lamp-falloff.mjs --looks gem,tubing --kind run
 *
 * A fixed lamp, not a moving one: the frame must be the same frame every run, and a lamp whose
 * position comes from the clock would be sampled mid-travel.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const KLIEG = resolve(ROOT, 'packages/core/dist/index.js');
const THREE = resolve(ROOT, 'node_modules/three/build/three.module.js');
const FONT = resolve(ROOT, 'apps/lab/public/font.ttf');
const OPENTYPE = resolve(ROOT, 'node_modules/opentype.js/dist/opentype.mjs');
const OUT = resolve(arg('out', resolve(HERE, 'lamp-falloff-out')));

const MODE = arg('mode', 'looks');
const KIND = arg('kind', 'body');
const TEXT = arg('text', 'KLIEG');
const LOOKS = arg('looks', 'gold,chrome,gem,velvet,neon,tubing,piping,sequin').split(',');
const RADIUS = arg('radius', '0.5');
const STRENGTH = arg('strength', '2.5');
const EM = arg('em', null);
const EI = arg('ei', '0.25');

mkdirSync(OUT, { recursive: true });

const TREES = {
  '/klieg/': dirname(KLIEG),
  '/three/': dirname(THREE),
  '/opentype/': dirname(OPENTYPE),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'lamp-falloff.html')), 'text/html'],
  '/font.ttf': [readFileSync(FONT), 'font/ttf'],
};

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const hit = FILES[path];
  if (hit) return res.writeHead(200, { 'content-type': hit[1] }).end(hit[0]);
  for (const [prefix, dir] of Object.entries(TREES)) {
    if (!path.startsWith(prefix)) continue;
    const file = resolve(dir, path.slice(prefix.length));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    let body;
    try {
      body = readFileSync(file);
    } catch {
      return res.writeHead(404).end();
    }
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end(body);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 200 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [console] ${m.text()}`);
});

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function shoot(name, params) {
  const q = new URLSearchParams({ text: TEXT, kind: KIND, ...(EM ? { em: EM, ei: EI } : {}), ...params }).toString();
  await page.goto(`${base}/?${q}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
  const parts = await page.evaluate(() => window.__parts);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1000, height: 200 } });
  writeFileSync(resolve(OUT, `${name}.png`), png);
  return { hash: md5(png), parts };
}

const rows = [];

if (MODE === 'looks') {
  let n = 0;
  for (const look of LOOKS) {
    n += 1;
    const off = await shoot(`${look}-off`, { look, lamp: '0', radius: RADIUS, strength: STRENGTH });
    const on = await shoot(`${look}-on`, { look, lamp: '1', radius: RADIUS, strength: STRENGTH });
    const lit = off.hash !== on.hash;
    rows.push({ look, kind: KIND, lamp: lit ? 'reads' : 'NO-OP' });
    console.log(
      `${n}/${LOOKS.length} ${look.padEnd(8)} ${lit ? 'reads' : 'NO-OP'}` +
        `  parts=${on.parts.n ? `${on.parts.n} x∈[${on.parts.minX.toFixed(2)},${on.parts.maxX.toFixed(2)}] y∈[${on.parts.minY.toFixed(2)},${on.parts.maxY.toFixed(2)}]` : 'none'}`,
    );
  }
} else {
  const look = LOOKS[0];
  const shapes = ['linear', 'smooth', 'gauss', 'inverse'];
  let n = 0;
  for (const shape of shapes) {
    n += 1;
    const on = await shoot(`${look}-${shape}`, {
      look,
      lamp: '1',
      shape,
      radius: RADIUS,
      strength: STRENGTH,
    });
    rows.push({ look, shape, md5: on.hash.slice(0, 8) });
    console.log(`${n}/${shapes.length} ${look} ${shape}`);
  }
}

await browser.close();
server.close();
console.log('');
console.table(rows);
console.log(`shots in ${OUT}`);
