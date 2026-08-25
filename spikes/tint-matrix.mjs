/**
 * Renders every look with and without a tint, and prints an md5 per shot.
 *
 * A tint that reaches the GPU changes the image; one that is overwritten before the first frame
 * leaves it byte-identical. That is the whole test — `tubing` shipped 0.6.0 with tinted and
 * untinted rendering to the same md5.
 *
 *   node spikes/tint-matrix.mjs                        # against packages/core/dist
 *   node spikes/tint-matrix.mjs --klieg <path-to-index.js> --out <dir>
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

const KLIEG = resolve(arg('klieg', resolve(ROOT, 'packages/core/dist/index.js')));
const THREE = resolve(arg('three', resolve(ROOT, 'node_modules/three/build/three.module.js')));
const FONT = resolve(arg('font', resolve(ROOT, 'apps/lab/public/font.ttf')));
const OPENTYPE = resolve(
  arg('opentype', resolve(ROOT, 'node_modules/opentype.js/dist/opentype.mjs')),
);
const OUT = resolve(arg('out', resolve(HERE, 'tint-matrix-out')));
const TINT = arg('tint', '22d3ee');
const LOOKS = (arg('looks', 'gold,piping,sequin,tubing')).split(',');

mkdirSync(OUT, { recursive: true });

// Neither dist is one bundle — klieg re-exports across its tree and three.module.js pulls
// three.core.js — so each is served as a directory rather than a file.
const TREES = {
  '/klieg/': dirname(KLIEG),
  '/three/': dirname(THREE),
  '/opentype/': dirname(OPENTYPE),
};

const FILES = {
  '/': [readFileSync(resolve(HERE, 'tint-matrix.html')), 'text/html'],
  '/font.ttf': [readFileSync(FONT), 'font/ttf'],
};

// Port 0: the OS picks a free one. playwright.config.ts derives its port from the checkout path,
// and a spike must not collide with whatever a test run already owns.
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const hit = FILES[path];
  if (hit) return res.writeHead(200, { 'content-type': hit[1] }).end(hit[0]);
  for (const [prefix, dir] of Object.entries(TREES)) {
    if (!path.startsWith(prefix)) continue;
    const file = resolve(dir, path.slice(prefix.length));
    // Confined to the tree: a spike still should not serve the whole disk.
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    // Read before writing the header: writeHead(200) followed by a throwing readFileSync sends
    // the 200 and then fails the 404 with ERR_HTTP_HEADERS_SENT, which reads as a crash, not a miss.
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

// SwiftShader so the result does not depend on which machine ran it.
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 200 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`); });
page.on('requestfailed', (r) => console.log(`  [reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) console.log(`  [http ${r.status()}] ${r.url()}`); });

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const rows = [];
let n = 0;
const total = LOOKS.length * 2;

for (const look of LOOKS) {
  const shots = {};
  for (const tint of [null, TINT]) {
    n += 1;
    const q = `look=${look}${tint ? `&tint=${tint}` : ''}`;
    await page.goto(`${base}/?${q}`);
    await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
    const png = await page.screenshot({ clip: { x: 0, y: 30, width: 1200, height: 140 } });
    const name = `${look}-${tint ?? 'none'}.png`;
    writeFileSync(resolve(OUT, name), png);
    shots[tint ?? 'none'] = md5(png);
    console.log(`${n}/${total} ${name}  ${md5(png)}`);
  }
  const tinted = shots[TINT] !== shots.none;
  rows.push({ look, tint: tinted ? 'applied' : 'IGNORED', md5Untinted: shots.none });
}

await browser.close();
server.close();

console.log('');
console.table(rows);
const broken = rows.filter((r) => r.tint === 'IGNORED').map((r) => r.look);
console.log(broken.length ? `tint ignored by: ${broken.join(', ')}` : 'tint reaches every look');
process.exitCode = broken.length ? 1 : 0;
