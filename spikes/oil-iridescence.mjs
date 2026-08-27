/**
 * `oil`'s thin film against the warm studio.
 *
 *   node spikes/oil-iridescence.mjs [--thick 400,640,900,1300,1800] [--ior 1.4,1.8,2.4]
 *
 * `oil` is a near-black metal, so what you see is reflected light tinted by a thin film. Its
 * colour therefore came from the studio being two-toned rather than from the film, and warming
 * the fill flattened it. Thickness sets how fast the film's hue cycles with view angle, so a
 * thicker film makes the hue range the look's own property instead of the room's.
 *
 * `before` is rendered from `git show HEAD:` for both files — the old studio and the old spec —
 * so the sweep is judged against what actually shipped, not against the flattened version.
 *
 * Rewrites `oil`'s spec in `render/looks.ts` and restores it on the way out, including on a
 * crash: check `git status` if a run is killed.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
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

// Two axes chosen by name, so the same grid can ask about film, reflectance or exposure.
//   --rows ior --rowvals 1.4,1.8   --cols thick --colvals 400,640
const PROPS = {
  ior: (v) => ['iridescenceIOR', v],
  thick: (v) => ['iridescenceThicknessRange', `[100, ${v}]`],
  env: (v) => ['envMapIntensity', v],
  color: (v) => ['color', v],
  rough: (v) => ['roughness', v],
};
const ROWKEY = arg('rows', 'ior');
const COLKEY = arg('cols', 'thick');
const ROWVALS = arg('rowvals', '1.4,1.8,2.4').split(',');
const COLVALS = arg('colvals', '400,640,900,1300,1800').split(',');
const FIXED = (arg('fixed', '') ? arg('fixed', '').split(',') : []).map((kv) => kv.split('='));
for (const k of [ROWKEY, COLKEY, ...FIXED.map((f) => f[0])]) {
  if (!PROPS[k]) throw new Error(`unknown property ${k} — try ${Object.keys(PROPS).join(', ')}`);
}
const TEXT = arg('text', 'KLIEG');
const OUT = resolve(arg('out', resolve(HERE, 'oil-iridescence-out')));
mkdirSync(OUT, { recursive: true });

const LOOKS_FILE = resolve(ROOT, 'packages/core/src/render/looks.ts');
const ENV_FILE = resolve(ROOT, 'packages/core/src/render/environment.ts');

// Every changed file, not just these two: a half-swapped tree is not the shipped one. Leaving the
// new stage.ts over HEAD's looks.ts sets `scene.environmentIntensity` from a `DEFAULTS` that has
// no `envMapIntensity` yet, and the whole sign renders black.
const CHANGED = execFileSync('git', ['-C', ROOT, 'diff', '--name-only'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts') && !f.includes('/test/'))
  .map((f) => resolve(ROOT, f));
if (!CHANGED.includes(LOOKS_FILE)) CHANGED.push(LOOKS_FILE);
const NOW = Object.fromEntries(CHANGED.map((f) => [f, readFileSync(f, 'utf8')]));
const HEAD = Object.fromEntries(
  CHANGED.map((f) => [
    f,
    execFileSync('git', ['-C', ROOT, 'show', `HEAD:${f.slice(ROOT.length + 1)}`], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    }),
  ]),
);
const useTree = (tree) => {
  for (const [f, body] of Object.entries(tree)) writeFileSync(f, body);
};

const OIL_BLOCK = /(\n  oil: \{[\s\S]*?\n  \},)/;
if (!OIL_BLOCK.test(NOW[LOOKS_FILE])) throw new Error('oil block not found — did LOOKS move?');

/**
 * Rewrites the property if the spec already names it, and adds it if it does not. Matches to end
 * of line rather than to the first comma: a bracketed value like `[100, 640]` contains one.
 */
const setProp = (block, name, value) => {
  const has = new RegExp(`(\\n\\s+)${name}: [^\\n]*,`);
  if (has.test(block)) return block.replace(has, `$1${name}: ${value},`);
  return block.replace(/(\n(\s+)color: [^\n]*,)/, `$1\n$2${name}: ${value},`);
};
const withOil = (pairs) =>
  NOW[LOOKS_FILE].replace(OIL_BLOCK, (block) =>
    pairs.reduce((acc, [k, v]) => setProp(acc, ...PROPS[k](v)), block),
  );

const CLIP = { x: 210, y: 78, width: 490, height: 175 };
const port = 5180 + ((createHash('sha1').update(ROOT).digest()[0] ?? 0) % 64) + 1;
console.log(`starting a dev server on ${port}`);
const server = spawn(
  'npm',
  ['run', 'dev', '-w', '@klieg/lab', '--', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
);

/**
 * `hues` is the point: how many 30-degree slices of the wheel the letter actually occupies, over
 * ink that is lit and coloured enough to read as a hue at all. Mean saturation alone scores a
 * uniformly magenta letter as highly as a rainbow one.
 */
const measure = (page, png) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const { data } = c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height);
    const buckets = new Array(12).fill(0);
    let sat = 0;
    let lum = 0;
    let lit = 0;
    let coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sat += s;
      lum += l;
      lit += 1;
      if (s < 0.25 || l < 0.06) continue;
      let h;
      if (max === min) h = 0;
      else if (max === r) h = (60 * ((g - b) / (max - min)) + 360) % 360;
      else if (max === g) h = 60 * ((b - r) / (max - min)) + 120;
      else h = 60 * ((r - g) / (max - min)) + 240;
      buckets[Math.floor(h / 30) % 12] += 1;
      coloured += 1;
    }
    return {
      sat: sat / lit,
      lum: lum / lit,
      coloured: coloured / lit,
      hues: coloured === 0 ? 0 : buckets.filter((n) => n / coloured >= 0.02).length,
      buckets: buckets.map((n) => (coloured ? +(n / coloured).toFixed(3) : 0)),
      coverage: lit,
    };
  }, png.toString('base64'));

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const rows = [];
let n = 0;
const total = 1 + ROWVALS.length * COLVALS.length;

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 320 }, deviceScaleFactor: 2 });
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

  const shoot = async (label, file) => {
    n += 1;
    await open();
    await page.fill('#text', TEXT);
    await page.fill('#hold', '8000');
    await page.fill('#blend', '0');
    await page.selectOption('#enter', 'none');
    await page.selectOption('#active', 'none');
    await page.selectOption('#exit', 'none');
    await page.selectOption('#lighting', 'static');
    await page.selectOption('#look', 'oil');
    await page.click('#fire');
    await page.waitForTimeout(1000);
    await page.addStyleTag({ content: 'main, .dock { display: none; }' });
    writeFileSync(resolve(OUT, `${file}.png`), await page.screenshot());
    writeFileSync(resolve(OUT, `thumb-${file}.png`), await page.screenshot({ clip: CLIP }));
    await page.addStyleTag({ content: 'html, body { background: transparent; }' });
    const m = await measure(page, await page.screenshot({ clip: CLIP, omitBackground: true }));
    // Lit-but-black is the failure a coverage check sails past: a broken tree still draws glyphs.
    if (m.coverage === 0) throw new Error(`${label} measured no ink — background removal failed`);
    if (m.lum === 0) throw new Error(`${label} rendered black — the tree is not in a valid state`);
    console.log(`${n}/${total} ${label}  hues ${m.hues}  sat ${m.sat.toFixed(3)}  lum ${m.lum.toFixed(3)}`);
    return m;
  };

  useTree(HEAD);
  await page.waitForTimeout(500);
  rows.push({ label: 'before (shipped)', file: 'before', ...(await shoot('before (shipped)', 'before')) });

  useTree(NOW);
  for (const rv of ROWVALS) {
    for (const cv of COLVALS) {
      writeFileSync(LOOKS_FILE, withOil([...FIXED, [ROWKEY, rv], [COLKEY, cv]]));
      await page.waitForTimeout(400);
      const label = `${ROWKEY} ${rv} · ${COLKEY} ${cv}`;
      const file = `${ROWKEY}${rv}-${COLKEY}${cv}`.replace(/[^\w.-]/g, '');
      rows.push({ label, file, rv, cv, ...(await shoot(label, file)) });
    }
  }
} finally {
  useTree(NOW);
  await browser.close();
  server.close?.();
  server.kill();
}

const ref = rows[0];
const cell = (r) =>
  `<td><a href="${r.file}.png"><img src="thumb-${r.file}.png" alt="${r.label}"></a>
   <div>hues <b class="${r.hues > ref.hues ? 'up' : r.hues < ref.hues ? 'down' : ''}">${r.hues}</b> · sat ${r.sat.toFixed(3)}</div></td>`;

writeFileSync(
  resolve(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>oil's thin film</title>
<style>
  body { background:#0b0b0e; color:#d8d8e0; font:14px/1.5 ui-sans-serif,system-ui; margin:24px; }
  h1 { font-size:18px; } h2 { font-size:14px; color:#ffd479; margin-top:26px; }
  p { color:#8a8a98; max-width:74ch; }
  .scroll { overflow-x:auto; padding-bottom:10px; }
  table { border-collapse:collapse; } td { padding:3px; text-align:center; }
  th { text-align:right; padding-right:10px; white-space:nowrap; }
  thead th { text-align:center; font:13px ui-monospace,monospace; color:#8a8a98; padding:0 0 6px; }
  td div { font:11px ui-monospace,monospace; color:#6a6a78; }
  b.up { color:#8fd68f; } b.down { color:#e08585; }
  img { width:300px; display:block; border:1px solid #1e1e26; } a { text-decoration:none; }
</style>
<h1>oil — making the hue the film's, not the room's</h1>
<p><b>hues</b> counts how many 30&deg; slices of the colour wheel the letter actually occupies.
The shipped version scored <b>${ref.hues}</b>; green beats it. Click a shot for the full frame.</p>
<h2>before — old studio, old spec</h2>
<div class="scroll"><table><tbody><tr><th>shipped</th>${cell(ref)}</tr></tbody></table></div>
<h2>warm studio, swept film</h2>
<div class="scroll"><table>
<thead><tr><th></th>${COLVALS.map((c) => `<th>${COLKEY} ${c}</th>`).join('')}</tr></thead>
<tbody>${ROWVALS.map(
    (rv) =>
      `<tr><th>${ROWKEY} ${rv}</th>${COLVALS.map((cv) => cell(rows.find((r) => r.rv === rv && r.cv === cv))).join('')}</tr>`,
  ).join('')}</tbody></table></div>`,
);

console.log('');
console.table(rows.map(({ label, hues, sat, lum }) => ({ label, hues, sat: sat.toFixed(3), lum: lum.toFixed(3) })));
console.log(`sheet at ${resolve(OUT, 'index.html')}`);
