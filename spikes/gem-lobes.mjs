/**
 * `gem` has two specular lobes stacked on it — `clearcoat: 1` and `specularIntensity: 1`, both
 * inherited from DEFAULTS — and a lamp's red is reported to disappear under them. This sweeps the
 * pair against envMapIntensity and measures what the lamp actually contributes.
 *
 *   node spikes/gem-lobes.mjs                      # the full cc x si x ei grid
 *   node spikes/gem-lobes.mjs --cc 1,0 --si 1,0    # one row
 *   node spikes/gem-lobes.mjs --look velvet        # the same question of another look
 *
 * A fixed lamp, so every cell is the same frame. The ink mask comes from the lamp-OFF shot and is
 * reused for ON: measuring the lamp's own glow as ink reports the light instead of the word.
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
const nums = (name, fallback) => arg(name, fallback).split(',').map(Number);

const KLIEG = resolve(ROOT, 'packages/core/dist/index.js');
const THREE = resolve(ROOT, 'node_modules/three/build/three.module.js');
const FONT = resolve(ROOT, 'apps/lab/public/font.ttf');
const OPENTYPE = resolve(ROOT, 'node_modules/opentype.js/dist/opentype.mjs');
const W_TEXT = resolve(ROOT, 'node_modules/@weasel-js/text/dist/index.js');
const W_FONT = resolve(ROOT, 'node_modules/@weasel-js/font/dist/index.js');
const OUT = resolve(arg('out', resolve(HERE, 'gem-lobes-out')));

const LOOK = arg('look', 'gem');
const TEXT = arg('text', 'KLIEG');
const CCS = nums('cc', '1,0.5,0.25,0');
const SIS = nums('si', '1,0.5,0.25,0');
const EIS = nums('ei', '0.6,2.2');
/** Hex, no 0x. A white specular lobe is the only gray in the stack; tinting it is the one move
 *  that can raise brightness without costing saturation. */
const SCS = arg('sc', 'look').split(',');
/** The look's own hue, so the sweep can check a fix on gem's red still holds on another stone. */
const AC = arg('ac', null);
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
  '/': [readFileSync(resolve(HERE, 'gem-lobes.html')), 'text/html'],
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
    ...(AC ? { ac: AC } : {}),
    ...params,
  }).toString();
  await page.goto(`${base}/?${q}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
  writeFileSync(resolve(OUT, `${name}.png`), await page.screenshot());
  const { width, height, b64 } = await page.evaluate(() => window.__px());
  return { width, height, px: Buffer.from(b64, 'base64') };
}

/** Ink is alpha >= 128: a lit part lays a faint glow over the whole strip, and counting every
 *  non-transparent pixel measures the light rather than the word. */
const inkMask = ({ px }) => {
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

const meanOver = ({ px }, mask, n) => {
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

/** How coloured a triple is, independent of how bright: 0 is neutral gray, 1 is fully saturated. */
const sat = ([r, g, b]) => {
  const hi = Math.max(r, g, b);
  return hi <= 0 ? 0 : (hi - Math.min(r, g, b)) / hi;
};
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const rows = [];
const cells = CCS.length * SIS.length * EIS.length * SCS.length;
let n = 0;

for (const ei of EIS) {
  for (const cc of CCS) {
    for (const si of SIS) {
     for (const sc of SCS) {
      n += 1;
      const tag = `${LOOK}-ei${ei}-cc${cc}-si${si}-sc${sc}`;
      const scP = sc === 'look' ? {} : { sc };
      const off = await shoot(`${tag}-off`, { lamp: '0', cc, si, ei, ...scP });
      const on = await shoot(`${tag}-on`, { lamp: '1', cc, si, ei, ...scP });
      const { mask, n: ink } = inkMask(off);

      // A lamp lights a pool, not the word, so a mean over all ink reports a tenth of what the eye
      // sees. `lit` is the pool: ink the lamp actually moved.
      const lit = new Uint8Array(mask.length);
      let litN = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const d = lum([
          on.px[i * 4] - off.px[i * 4],
          on.px[i * 4 + 1] - off.px[i * 4 + 1],
          on.px[i * 4 + 2] - off.px[i * 4 + 2],
        ]);
        if (d > LIT) {
          lit[i] = 1;
          litN++;
        }
      }

      const a = meanOver(off, lit, litN);
      const b = meanOver(on, lit, litN);
      const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const row = {
        ei,
        cc,
        si,
        sc,
        litPx: litN,
        // What the pool is worth: how much brighter the lamp made it, and how red that gain is.
        gain: +lum(delta).toFixed(1),
        gainSat: +sat(delta).toFixed(3),
        // The question the two lobes decide. A lamp landing on gem should leave the lit pool MORE
        // saturated than the unlit stone; a specular lobe mirroring gray leaves it less.
        offSat: +sat(a).toFixed(3),
        onSat: +sat(b).toFixed(3),
        offLum: +lum(a).toFixed(1),
        onLum: +lum(b).toFixed(1),
      };
      rows.push(row);
      console.log(
        `${String(n).padStart(2)}/${cells} ei=${String(ei).padEnd(4)} cc=${String(cc).padEnd(4)} si=${String(si).padEnd(4)} sc=${sc}` +
          `  lit=${String(litN).padStart(6)}  gain=${row.gain.toFixed(1).padStart(6)}` +
          `  sat ${row.offSat.toFixed(3)} -> ${row.onSat.toFixed(3)}` +
          `  lum ${row.offLum.toFixed(1)} -> ${row.onLum.toFixed(1)}`,
      );
     }
    }
  }
}

await browser.close();
server.close();
console.log('');
console.table(rows);
writeFileSync(resolve(OUT, 'rows.json'), JSON.stringify(rows, null, 2));
console.log(`shots + rows.json in ${OUT}`);
