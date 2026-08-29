/**
 * Every look across a sweep of studio exposures, as one contact sheet.
 *
 *   node spikes/env-sweep.mjs [--values 0,1,2.2,6,14] [--looks gold,gem] [--out dir]
 *
 * The lab resolves `klieg` to the workspace source, so this rewrites `DEFAULTS.envMapIntensity`
 * in `render/looks.ts` between passes and reloads rather than rebuilding. The value is restored
 * on the way out, including on a crash — check `git diff` if a run is killed.
 *
 * Mean ink luminance comes from a second screenshot taken with the page background removed, so
 * alpha is exactly the ink. Do not read the drawing buffer with `drawImage` instead: the stage
 * does not preserve it, so outside the drawing frame it reads back empty and every look scores 0.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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

const VALUES = arg('values', '0,0.5,1,1.6,2.2,3,4.5,6,9,14').split(',');
const LOOKS = arg('looks', 'gold,chrome,oil,gem,velvet,leather,neon').split(',');
const TEXT = arg('text', 'KLIEG');
const OUT = resolve(arg('out', resolve(HERE, 'env-sweep-out')));
mkdirSync(OUT, { recursive: true });

const ENV_FILE = resolve(ROOT, 'packages/core/src/render/looks.ts');
const ORIGINAL = readFileSync(ENV_FILE, 'utf8');
if (!/envMapIntensity: [\d.]+,/.test(ORIGINAL)) {
  throw new Error('DEFAULTS.envMapIntensity not found — did it move?');
}
const setIntensity = (v) =>
  writeFileSync(
    ENV_FILE,
    ORIGINAL.replace(/envMapIntensity: [\d.]+,/, `envMapIntensity: ${v},`),
  );

/** The ink sits in the middle of the frame; the rest is empty page and wastes the thumbnail. */
const CLIP = { x: 210, y: 78, width: 490, height: 175 };

const port = 5180 + ((createHash('sha1').update(ROOT).digest()[0] ?? 0) % 64) + 1;
console.log(`starting a dev server on ${port}`);
const server = spawn(
  'npm',
  ['run', 'dev', '-w', '@klieg/lab', '--', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const shots = [];
const md5 = (buf) => createHash('md5').update(buf).digest('hex').slice(0, 8);

/** Decodes in the page rather than in node: it is a raster PNG by now, not a live GL buffer. */
const measure = (page, png) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${b64}`)).blob(),
    );
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const { data } = c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height);
    let sum = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lit += 1;
    }
    return { mean: lit ? sum / lit / 255 : 0, coverage: lit / (bmp.width * bmp.height) };
  }, png.toString('base64'));
let n = 0;
const total = VALUES.length * LOOKS.length;

try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 320 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

  const open = async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 5000 });
        return;
      } catch (err) {
        if (attempt > 40) throw err;
        await page.waitForTimeout(500);
      }
    }
  };
  await open();

  for (const value of VALUES) {
    setIntensity(value);
    await page.waitForTimeout(400);
    for (const look of LOOKS) {
      n += 1;
      await open();
      await page.fill('#text', TEXT);
      await page.fill('#hold', '8000');
      await page.fill('#blend', '0');
      await page.selectOption('#enter', 'none');
      await page.selectOption('#active', 'none');
      await page.selectOption('#exit', 'none');
      await page.selectOption('#lighting', 'static');
      await page.selectOption('#look', look);
      await page.click('#fire');
      await page.waitForTimeout(900);

      await page.addStyleTag({ content: 'main, .dock { display: none; }' });
      const file = `${look}-env${value}.png`;
      writeFileSync(resolve(OUT, file), await page.screenshot());
      const thumb = `thumb-${look}-env${value}.png`;
      const png = await page.screenshot({ clip: CLIP });
      writeFileSync(resolve(OUT, thumb), png);

      // `body { background }` in the lab is a bare element selector, so a later rule wins outright.
      await page.addStyleTag({ content: 'html, body { background: transparent; }' });
      const bare = await page.screenshot({ clip: CLIP, omitBackground: true });
      const lum = await measure(page, bare);
      if (lum.coverage === 0) {
        throw new Error(`${look} @ ${value} measured no ink at all — the background removal failed`);
      }
      shots.push({ look, value, file, thumb, md5: md5(png), lum: lum.mean });
      console.log(
        `${n}/${total} ${look} @ ${value}  lum ${lum.mean.toFixed(3)}  ink ${(lum.coverage * 100).toFixed(1)}%  ${md5(png)}`,
      );
    }
  }
} finally {
  writeFileSync(ENV_FILE, ORIGINAL);
  await browser.close();
  server.kill();
}

const cell = (look, v) => {
  const hit = shots.find((s) => s.look === look && s.value === v);
  return `<td><a href="${hit.file}"><img src="${hit.thumb}" alt="${look} at ${v}"></a><div>${hit.lum.toFixed(3)}</div></td>`;
};
const rows = LOOKS.map(
  (look) => `<tr><th>${look}</th>${VALUES.map((v) => cell(look, v)).join('')}</tr>`,
).join('');

writeFileSync(
  resolve(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>studio exposure sweep</title>
<style>
  body { background:#0b0b0e; color:#d8d8e0; font:14px/1.5 ui-sans-serif,system-ui; margin:24px; }
  h1 { font-size:18px; font-weight:600; }
  p { color:#8a8a98; max-width:70ch; }
  .scroll { overflow-x:auto; padding-bottom:12px; }
  table { border-collapse:collapse; }
  th { text-align:right; padding-right:10px; font-weight:600; white-space:nowrap; }
  thead th { text-align:center; font:13px ui-monospace,monospace; color:#8a8a98; padding:0 0 6px; }
  thead th.on { color:#ffd479; }
  td { padding:3px; text-align:center; }
  td div { font:11px ui-monospace,monospace; color:#6a6a78; }
  img { width:245px; display:block; border:1px solid #1e1e26; }
  a { text-decoration:none; }
</style>
<h1>Studio exposure — <code>scene.environmentIntensity</code></h1>
<p><b>1</b> is what has shipped since the value was written; <b>2.2</b> is what <code>looks.ts</code>
authored and never applied. The number under each shot is mean luminance over the ink only.
Click a thumbnail for the full frame.</p>
<div class="scroll"><table>
<thead><tr><th></th>${VALUES.map(
    (v) => `<th class="${v === '1' || v === '2.2' ? 'on' : ''}">${v}</th>`,
  ).join('')}</tr></thead>
<tbody>${rows}</tbody></table></div>`,
);

console.log('');
console.table(
  LOOKS.map((look) =>
    Object.fromEntries([
      ['look', look],
      // Integer-like keys sort ahead of the rest in console.table, which scrambles the sweep.
      ...VALUES.map((v) => [
        `@${v}`,
        shots.find((s) => s.look === look && s.value === v).lum.toFixed(3),
      ]),
    ]),
  ),
);
console.log(`sheet at ${resolve(OUT, 'index.html')}`);
