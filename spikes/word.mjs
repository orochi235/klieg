/**
 * Several set letters laid out as words, one word per line.
 *
 *   npm run build -w klieg && node spikes/word.mjs --text "FUCK YOU TRAVIS" --gems diamond
 *
 * Every letter is built by `spikes/hollow.mjs --dump`, one process each, and this places them on
 * the font's own advances and merges them into one body and one mesh per gem. Anything it does not
 * recognise is passed straight through, so `--setting`, `--pitch`, `--cuts` and the rest mean here
 * what they mean there. Built letters are kept under `word-out/cache`, keyed by those arguments and
 * by `hollow.mjs` itself; `--rebuild` ignores them. The geometry is not what a run costs — twelve
 * letters take about as long as the browser spends on one frame of transmissive gems.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const TEXT = arg('text', 'FUCK YOU TRAVIS');
const OUT = resolve(arg('out', resolve(HERE, 'word-out')));
const LOOKS = arg('looks', 'gold');
/** Baseline to baseline, in em. */
const LEADING = Number(arg('leading', '0.92'));
const TILT = Number(arg('tilt', '0.28'));
const WIDTH = Number(arg('width', '1400'));
const HEIGHT = Number(arg('height', '1000'));

/** Everything this script does not read is what a letter is built with. */
const MINE = new Set(['text', 'out', 'looks', 'leading', 'tilt', 'width', 'height', 'fill', 'tag']);
const passthrough = [];
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (!flag.startsWith('--')) continue;
  if (MINE.has(flag.slice(2))) {
    i++;
    continue;
  }
  passthrough.push(flag);
  if (process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--')) {
    passthrough.push(process.argv[++i]);
  }
}

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const lines = TEXT.split(/\s+/).filter(Boolean);
const letters = [...new Set(lines.join('').split(''))];

// A letter is worth keeping: it depends only on the arguments it was built with and on the builder
// itself, so both go in the key and an edit to either invalidates every letter at once.
const stamp = createHash('sha1')
  .update(JSON.stringify(passthrough))
  .update(String(statSync(resolve(HERE, 'hollow.mjs')).mtimeMs))
  .digest('hex')
  .slice(0, 10);
const cache = resolve(HERE, 'word-out', 'cache');
mkdirSync(cache, { recursive: true });

console.log(`"${TEXT}" — ${lines.length} line(s), ${letters.length} letter(s)`);
const built = new Map();
for (const [n, letter] of letters.entries()) {
  const file = resolve(cache, `${stamp}-${letter.charCodeAt(0)}.json`);
  const started = Date.now();
  const kept = existsSync(file) && !process.argv.includes('--rebuild');
  if (!kept) {
    execFileSync(
      process.execPath,
      [resolve(HERE, 'hollow.mjs'), '--letter', letter, '--dump', file, ...passthrough],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  built.set(letter, data);
  const faces = data.stones.reduce((t, g) => t + g.position.length / 9, 0);
  console.log(
    `  ${n + 1}/${letters.length} ${letter}: ${data.body.position.length / 9} triangles, ` +
      `${faces} stone faces, ` +
      (kept ? 'cached' : `${((Date.now() - started) / 1000).toFixed(1)}s`),
  );
}

// ---------------------------------------------------------------------------------------------
// The layout. A glyph is drawn at its own pen origin, so the font's advances are the spacing and
// the only thing left to choose is where each line starts.

const advance = (letter) => font.getAdvanceWidth(letter, 1);
const widths = lines.map((line) => [...line].reduce((w, c) => w + advance(c), 0));
const widest = Math.max(...widths);

const body = { position: [], normal: [] };
const gems = new Map();
for (const [row, line] of lines.entries()) {
  let x = (widest - widths[row]) / 2;
  const y = -row * LEADING;
  for (const letter of line) {
    const data = built.get(letter);
    const shift = (into, from, dx, dy) => {
      for (let i = 0; i < from.length; i += 3) {
        into.push(from[i] + dx, from[i + 1] + dy, from[i + 2]);
      }
    };
    shift(body.position, data.body.position, x, y);
    for (let i = 0; i < data.body.normal.length; i++) body.normal.push(data.body.normal[i]);
    for (const { gem, spec, position } of data.stones) {
      const held = gems.get(gem) ?? { gem, spec, position: [] };
      shift(held.position, position, x, y);
      gems.set(gem, held);
    }
    x += advance(letter);
  }
}

const stones = [...gems.values()];
console.log(
  `  laid out ${widest.toFixed(2)} em wide, ${(lines.length * LEADING).toFixed(2)} em tall: ` +
    `${body.position.length / 9} triangles and ${stones.reduce((t, g) => t + g.position.length / 9, 0)} stone faces`,
);

const payload = {
  letter: TEXT,
  body,
  tilt: TILT,
  stones,
  fill: Number(arg('fill', '2.95')),
  // The words are the picture here, so the corner label would only sit on top of them.
  tag: process.argv.includes('--tag'),
};
mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'hollow.html')), 'text/html'],
  '/geometry.json': [Buffer.from(JSON.stringify(payload)), 'application/json'],
};


// Served by intercepting the page's own requests rather than over a socket: the page has to fetch
// its modules over http because `import` does not work from `file://`, but nothing about that
// needs a listening port — and a loopback that intermittently answers EADDRNOTAVAIL was failing
// runs after all the geometry was built.
const ORIGIN = 'http://klieg.spike';
async function serve(page) {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const hit = FILES[path];
    if (hit) return route.fulfill({ body: hit[0], contentType: hit[1] });
    for (const [prefix, dir] of Object.entries(TREES)) {
      if (!path.startsWith(prefix)) continue;
      const file = resolve(dir, path.slice(prefix.length));
      if (!file.startsWith(dir)) return route.fulfill({ status: 403, body: '' });
      try {
        return route.fulfill({ body: readFileSync(file), contentType: 'text/javascript' });
      } catch {
        return route.fulfill({ status: 404, body: '' });
      }
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
await serve(page);
const slug = TEXT.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const look of LOOKS.split(',')) {
  await page.goto(`${ORIGIN}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 300_000 });
  const file = resolve(OUT, `${slug}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
process.exit(0);
