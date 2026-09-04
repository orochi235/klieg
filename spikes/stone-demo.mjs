/**
 * What a stone-set sign looks like playing, as an animation rather than a still.
 *
 *   npm run build -w klieg && node spikes/stone-demo.mjs [--text JACKPOT!] [--look gold]
 *
 * Fires a real `<klieg-sign>` whose look carries a `'well'` decoration with a `stone` fill, steps
 * its clock a frame at a time, and encodes the frames with ffmpeg. The clock is the page's, not the
 * wall's — see `stone-demo.html` — so the same frames come out of a loaded box as an idle one.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const TEXT = arg('text', 'JACKPOT!');
const LOOK = arg('look', 'gold');
const OUT = resolve(arg('out', resolve(HERE, 'stone-demo-out')));
const FPS = Number(arg('fps', '25'));
const FRAMES = Number(arg('frames', '100'));
const WIDTH = Number(arg('width', '1100'));
const HEIGHT = Number(arg('height', '420'));

const base = LOOKS[LOOK];
if (!base) throw new Error(`no such look '${LOOK}' — one of ${Object.keys(LOOKS).join(', ')}`);
// The look's own decoration is replaced, not added to: two decorations on one letter is a
// different question from what this shows.
const { decoration: _replaced, ...metal } = base;

const options = {
  look: {
    ...metal,
    decoration: {
      kind: 'well',
      cutter: 'lattice',
      bezel: Number(arg('bezel', '0.012')),
      floor: Number(arg('floor', '0.09')),
      pitch: Number(arg('pitch', '0.068')),
      size: Number(arg('size', '0.048')),
      look: {},
      fill: 'stone',
      tint: Number(arg('tint', '0.5')),
      sink: Number(arg('sink', '0.25')),
    },
  },
  fire: {
    enter: arg('enter', 'spin'),
    active: arg('active', 'shimmer'),
    exit: arg('exit', 'fade'),
    hold: Number(arg('hold', '1600')),
  },
};

const page$ = readFileSync(resolve(HERE, 'stone-demo.html'), 'utf8')
  .replaceAll('__TEXT__', TEXT)
  // `--anchor`, not `--size`: `size` is the well spec's own — a well's full diagonal in em — and
  // sharing the flag cut wells hundreds of em across, which the region rejected every one of. The
  // sign then rendered as plain metal, which looks like the decoration never arrived.
  .replace('__SIZE__', arg('anchor', '200'))
  .replace('__FW__', arg('framing-width', '0.94'))
  .replace('__FH__', arg('framing-height', '0.82'))
  .replace('__OPTIONS__', JSON.stringify(options));

const FILES = {
  '/': [Buffer.from(page$), 'text/html'],
  // The standalone bundle: the one artifact with no bare specifiers, so a script tag can load it.
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
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => console.log(`  [console:${m.type()}] ${m.text()}`));
const LIVE = process.argv.includes('--live');
await page.goto(`http://127.0.0.1:${server.address().port}/${LIVE ? '?clock=live' : ''}`);
if (LIVE) await page.waitForTimeout(4000);

const STEP = Math.round(1000 / FPS);
// `--live` leaves the page on the real clock, which is how to tell a bug in the sign from a bug in
// the clock this installs over it.
const step = LIVE
  ? () => page.waitForTimeout(STEP)
  : () => page.evaluate((ms) => window.__step(ms), STEP);

// The `lit` attribute, which `element.ts` toggles — klieg dispatches no events at all. Waiting is
// real-time and steps no frames: the font fetch and the first build are promises, and advancing
// the clock to wait for them would play the effect out before the first frame is captured.
await page.waitForSelector('klieg-sign[lit]', { timeout: 60_000 });

const dir = resolve(OUT, 'frames');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (let f = 0; f < FRAMES; f++) {
  await step();
  writeFileSync(resolve(dir, `f${String(f).padStart(4, '0')}.png`), await page.screenshot());
  if ((f + 1) % 10 === 0) console.log(`  ${f + 1}/${FRAMES} frames`);
}
await browser.close();
server.close();

// Two passes: one palette for the whole clip, so a gem's highlights do not swim between frames.
const stem = `stone-${TEXT.replace(/[^\w]/g, '')}-${LOOK}`;
const palette = resolve(dir, 'palette.png');
const gif = resolve(OUT, `${stem}.gif`);
const mp4 = resolve(OUT, `${stem}.mp4`);
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
ff(['-i', resolve(dir, 'f%04d.png'), '-vf', 'palettegen=stats_mode=diff', palette]);
ff([
  '-framerate', String(FPS),
  '-i', resolve(dir, 'f%04d.png'),
  '-i', palette,
  '-lavfi', `scale=${Math.round(WIDTH * 0.72)}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a`,
  gif,
]);
ff([
  '-framerate', String(FPS),
  '-i', resolve(dir, 'f%04d.png'),
  '-pix_fmt', 'yuv420p',
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  mp4,
]);
console.log(`wrote ${gif}`);
console.log(`wrote ${mp4}`);
process.exit(0);
