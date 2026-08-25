/**
 * How should a lamp's light combine with the material under it?
 *
 *   node spikes/lamp-blend.mjs
 *   node spikes/lamp-blend.mjs --looks gold,gem --strength 2
 *
 * Renders each look under every candidate blend so they can be judged side by side. Additive white
 * washes gold toward gray; the question is which blend keeps a material's own character while
 * still reading as more light.
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
const OUT = resolve(arg('out', resolve(HERE, 'lamp-blend-out')));

const TEXT = arg('text', 'KLIEG');
const LOOKS = arg('looks', 'gold,chrome,gem,velvet').split(',');
const BLENDS = arg('blends', 'none,add,albedo,env,albedoenv,screen').split(',');
const STRENGTH = arg('strength', '1');
const LAMP = arg('lamp', 'ffffff');

mkdirSync(OUT, { recursive: true });

const TREES = {
  '/klieg/': dirname(KLIEG),
  '/three/': dirname(THREE),
  '/opentype/': dirname(OPENTYPE),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'lamp-blend.html')), 'text/html'],
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
const rows = [];
let n = 0;
const total = LOOKS.length * BLENDS.length;

for (const look of LOOKS) {
  for (const blend of BLENDS) {
    n += 1;
    const q = new URLSearchParams({
      text: TEXT,
      look,
      blend,
      strength: STRENGTH,
      lamp: LAMP,
    }).toString();
    await page.goto(`${base}/?${q}`);
    await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1000, height: 200 } });
    writeFileSync(resolve(OUT, `${look}-${blend}.png`), png);
    rows.push({ look, blend, md5: md5(png).slice(0, 8) });
    console.log(`${n}/${total} ${look}-${blend}`);
  }
}

await browser.close();
server.close();
console.log('');
console.table(rows);
console.log(`shots in ${OUT}`);
