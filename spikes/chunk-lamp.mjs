/**
 * Does a lamp on `{ kind: 'chunk' }` reach the screen, and does it beat aiming the same lamp at a
 * chunk look's body? A chunk look builds no runs, and its body sits near-black under the field, so
 * `body` is the target someone reaches for and the one that does nothing anyone can see.
 *
 *   npm run build -w klieg && node spikes/chunk-lamp.mjs
 *   node spikes/chunk-lamp.mjs --look glitter --text SEQUIN
 *
 * A fixed lamp, so every shot is the same frame. The ink mask comes from the unlit shot and is
 * reused for the lit ones: a lamp lays glow over the whole strip, and counting that as ink
 * measures the light rather than the word.
 */
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
const W_TEXT = resolve(ROOT, 'node_modules/@weasel-js/text/dist/index.js');
const W_FONT = resolve(ROOT, 'node_modules/@weasel-js/font/dist/index.js');
const OUT = resolve(arg('out', resolve(HERE, 'chunk-lamp-out')));

const LOOK = arg('look', 'sequin');
const TEXT = arg('text', 'KLIEG');
const KINDS = arg('kinds', 'body,chunk').split(',');
const LX = arg('lx', '0');
const LY = arg('ly', '0');
const RADIUS = arg('radius', '0.5');
const STRENGTH = arg('strength', '2');
/** Luminance a pixel must gain to count as inside the lamp's pool, so dither is not the pool. */
const LIT = Number(arg('lit', '2'));

mkdirSync(OUT, { recursive: true });

const TREES = {
  '/klieg/': dirname(KLIEG),
  '/three/': dirname(THREE),
  '/opentype/': dirname(OPENTYPE),
  '/weasel-text/': dirname(W_TEXT),
  '/weasel-font/': dirname(W_FONT),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'chunk-lamp.html')), 'text/html'],
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
const page = await browser.newPage({ viewport: { width: 900, height: 220 } });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [console] ${m.text()}`);
});

async function shoot(name, params) {
  const q = new URLSearchParams({
    look: LOOK,
    text: TEXT,
    lx: LX,
    ly: LY,
    radius: RADIUS,
    strength: STRENGTH,
    ...params,
  }).toString();
  await page.goto(`${base}/?${q}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
  writeFileSync(resolve(OUT, `${name}.png`), await page.screenshot());
  const { width, b64 } = await page.evaluate(() => window.__px());
  return Object.assign(Buffer.from(b64, 'base64'), { width });
}

/** Ink is alpha >= 128: a lit part lays a faint glow over the whole strip. */
const inkMask = (px) => {
  const mask = new Uint8Array(px.length / 4);
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (px[i * 4 + 3] >= 128) {
      mask[i] = 1;
      n++;
    }
  }
  return { mask, n };
};

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const meanOver = (px, mask, n) => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    r += px[i * 4];
    g += px[i * 4 + 1];
    b += px[i * 4 + 2];
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
};

const off = await shoot(`${LOOK}-off`, {});
console.log(`1/${KINDS.length + 1} ${LOOK} lamp off`);
const { mask: ink, n: inkN } = inkMask(off);

const rows = [];
for (let k = 0; k < KINDS.length; k++) {
  const kind = KINDS[k];
  const on = await shoot(`${LOOK}-${kind}`, { kind });

  const pool = new Uint8Array(ink.length);
  let poolN = 0;
  // Where the pool sits, so a run can tell a lamp that lands where it is aimed from one that
  // lifts the whole word — which is what a part whose ink is the same box for every letter does.
  let sumX = 0;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const d = lum([
      on[i * 4] - off[i * 4],
      on[i * 4 + 1] - off[i * 4 + 1],
      on[i * 4 + 2] - off[i * 4 + 2],
    ]);
    if (d > LIT) {
      pool[i] = 1;
      poolN++;
      sumX += i % off.width;
    }
  }
  const a = meanOver(off, pool, poolN);
  const b = meanOver(on, pool, poolN);
  const row = {
    target: kind,
    litPx: poolN,
    // Zero lit pixels is the silent no-op: the effect ran, the frame merged, nothing changed.
    reads: poolN > 0 ? 'yes' : 'NO-OP',
    gain: +lum([b[0] - a[0], b[1] - a[1], b[2] - a[2]]).toFixed(1),
    poolX: poolN ? Math.round(sumX / poolN) : -1,
    offLum: +lum(a).toFixed(1),
    onLum: +lum(b).toFixed(1),
  };
  rows.push(row);
  console.log(
    `${k + 2}/${KINDS.length + 1} ${LOOK} lamp on ${kind.padEnd(6)}` +
      `  ${row.reads.padEnd(5)}  lit=${String(poolN).padStart(6)} of ${inkN} ink` +
      `  gain=${String(row.gain.toFixed(1)).padStart(5)}  poolX=${row.poolX}`,
  );
}

await browser.close();
server.close();
console.log('');
console.table(rows);
writeFileSync(resolve(OUT, 'rows.json'), JSON.stringify(rows, null, 2));
console.log(`shots + rows.json in ${OUT}`);
