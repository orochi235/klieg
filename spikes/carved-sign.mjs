/**
 * Does a carved letter survive the shipped path — element, `Word`, builder — and still read as the
 * same word?
 *
 *   npm run build -w klieg && node spikes/carved-sign.mjs [--text ICE] [--look chrome]
 *
 * `spikes/plate-stack.mjs` builds the geometry directly and never goes through `Word`, so it cannot
 * show the one line the slice turns on (`word.ts`'s `bodyGeometry?.(char, depth) ?? geo`). This
 * fires two real `<klieg-sign>` elements on the same look, one of them carrying a `'well'`
 * decoration, and shoots them side by side. A carved cell that renders as a plain letter means the
 * builder is being asked for nothing.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { LOOKS } from '../packages/core/dist/render/looks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const TEXT = arg('text', 'ICE');
const LOOK = arg('look', 'chrome');
const OUT = resolve(arg('out', resolve(HERE, 'carved-sign-out')));

const look = LOOKS[LOOK];
if (!look) throw new Error(`no such look '${LOOK}' — one of ${Object.keys(LOOKS).join(', ')}`);
// The look's own decoration is dropped from both cells: two decorations on one letter is a
// different question, and it would put the control and the carved cell on different looks.
const { decoration: _ignored, ...base } = look;

const options = {
  look: base,
  decoration: {
    kind: 'well',
    cutter: 'lattice',
    bezel: Number(arg('bezel', '0.012')),
    floor: Number(arg('floor', '0.09')),
    pitch: Number(arg('pitch', '0.068')),
    size: Number(arg('size', '0.048')),
    look: {},
  },
};

const page$ = readFileSync(resolve(HERE, 'carved-sign.html'), 'utf8')
  .replaceAll('__TEXT__', TEXT)
  .replaceAll('__LOOK__', LOOK)
  .replace('__OPTIONS__', JSON.stringify(options));

const FILES = {
  '/': [Buffer.from(page$), 'text/html'],
  // The standalone bundle, not the compiled tree: it is the one artifact with no bare specifiers,
  // so a script tag can load it without an import map for weasel, opentype and polygon-clipping.
  '/klieg-sign.js': [
    readFileSync(resolve(ROOT, 'packages/core/dist/standalone/klieg-sign.js')),
    'text/javascript',
  ],
  '/font.ttf': [readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf')), 'font/ttf'],
};

const server = createServer((req, res) => {
  const hit = FILES[req.url.split('?')[0]];
  if (!hit) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': hit[1] }).end(hit[0]);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 420 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });

mkdirSync(OUT, { recursive: true });
const file = resolve(OUT, `carved-${TEXT}-${LOOK}.png`);
writeFileSync(file, await page.screenshot());
console.log(`wrote ${file}`);

await browser.close();
server.close();
process.exit(0);
