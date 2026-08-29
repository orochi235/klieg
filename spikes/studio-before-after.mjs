/**
 * Every look as it ships today against every look on the working tree, side by side.
 *
 *   node spikes/studio-before-after.mjs [--looks gold,gem] [--out dir]
 *
 * "Before" is `git show HEAD:<file>` for each source file this change touches, written over the
 * tree for one pass and put back afterwards — the lab resolves `klieg` to the workspace source,
 * so that is all it takes. The originals are restored on the way out, including on a crash:
 * check `git status` if a run is killed.
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

const LOOKS = arg(
  'looks',
  'gold,chrome,oil,gem,velvet,neon,flake,glitter,leather,tubing,piping,sequin',
).split(',');
const TEXT = arg('text', 'KLIEG');
const OUT = resolve(arg('out', resolve(HERE, 'studio-before-after-out')));
mkdirSync(OUT, { recursive: true });

const changed = execFileSync('git', ['-C', ROOT, 'diff', '--name-only'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts') && !f.includes('/test/'));
if (changed.length === 0) throw new Error('nothing modified — there is no "after" to render');
console.log(`swapping ${changed.length} files: ${changed.join(', ')}`);

const NOW = Object.fromEntries(changed.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')]));
const HEAD = Object.fromEntries(
  changed.map((f) => [
    f,
    execFileSync('git', ['-C', ROOT, 'show', `HEAD:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 }),
  ]),
);
const useTree = (tree) => {
  for (const [f, body] of Object.entries(tree)) writeFileSync(resolve(ROOT, f), body);
};

const CLIP = { x: 210, y: 78, width: 490, height: 175 };
const port = 5180 + ((createHash('sha1').update(ROOT).digest()[0] ?? 0) % 64) + 1;
console.log(`starting a dev server on ${port}`);
const server = spawn(
  'npm',
  ['run', 'dev', '-w', '@klieg/lab', '--', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
);

const measure = (page, png) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const { data } = c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height);
    let lum = 0;
    let sat = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      sat += max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lit += 1;
    }
    return { lum: lum / lit, sat: sat / lit, coverage: lit };
  }, png.toString('base64'));

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const shots = [];
let n = 0;
const total = 2 * LOOKS.length;

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

  for (const [phase, tree] of [
    ['before', HEAD],
    ['after', NOW],
  ]) {
    useTree(tree);
    await page.waitForTimeout(500);
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
      await page.waitForTimeout(1000);
      await page.addStyleTag({ content: 'main, .dock { display: none; }' });
      const file = `${phase}-${look}.png`;
      writeFileSync(resolve(OUT, file), await page.screenshot());
      const thumb = `thumb-${phase}-${look}.png`;
      writeFileSync(resolve(OUT, thumb), await page.screenshot({ clip: CLIP }));
      await page.addStyleTag({ content: 'html, body { background: transparent; }' });
      const bare = await page.screenshot({ clip: CLIP, omitBackground: true });
      const m = await measure(page, bare);
      if (m.coverage === 0) throw new Error(`${look} measured no ink — background removal failed`);
      shots.push({ phase, look, file, thumb, ...m });
      console.log(`${n}/${total} ${phase} ${look}  lum ${m.lum.toFixed(3)}  sat ${m.sat.toFixed(3)}`);
    }
  }
} finally {
  useTree(NOW);
  await browser.close();
  server.kill();
}

const get = (phase, look) => shots.find((s) => s.phase === phase && s.look === look);
const pct = (a, b) => `${b >= a ? '+' : ''}${(((b - a) / (a || 1)) * 100).toFixed(0)}%`;
const row = (look) => {
  const b = get('before', look);
  const a = get('after', look);
  return `<tr><th>${look}</th>
    <td><a href="${b.file}"><img src="${b.thumb}" alt="${look} before"></a><div>lum ${b.lum.toFixed(3)} · sat ${b.sat.toFixed(3)}</div></td>
    <td><a href="${a.file}"><img src="${a.thumb}" alt="${look} after"></a><div>lum ${a.lum.toFixed(3)} · sat ${a.sat.toFixed(3)}</div></td>
    <td class="delta">lum ${pct(b.lum, a.lum)}<br>sat ${pct(b.sat, a.sat)}</td></tr>`;
};

writeFileSync(
  resolve(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>studio and exposure — before and after</title>
<style>
  body { background:#0b0b0e; color:#d8d8e0; font:14px/1.5 ui-sans-serif,system-ui; margin:24px; }
  h1 { font-size:18px; } p { color:#8a8a98; max-width:74ch; }
  table { border-collapse:collapse; }
  th { text-align:right; padding-right:10px; font-weight:600; white-space:nowrap; }
  thead th { text-align:center; font:13px ui-monospace,monospace; color:#8a8a98; padding:0 0 6px; }
  td { padding:3px; text-align:center; vertical-align:middle; }
  td div { font:11px ui-monospace,monospace; color:#6a6a78; }
  td.delta { font:12px ui-monospace,monospace; color:#8fd68f; padding-left:12px; }
  img { width:340px; display:block; border:1px solid #1e1e26; } a { text-decoration:none; }
</style>
<h1>Every look, before and after</h1>
<p><b>Before</b> is <code>HEAD</code>: exposure pinned at 1 by three, and a blue fill.
<b>After</b> is the authored 2.2 exposure reaching the shader, over a warm-balanced fill.
Click a shot for the full frame.</p>
<table><thead><tr><th></th><th>before</th><th>after</th><th></th></tr></thead>
<tbody>${LOOKS.map(row).join('')}</tbody></table>`,
);

console.log('');
console.table(
  LOOKS.map((look) => {
    const b = get('before', look);
    const a = get('after', look);
    return {
      look,
      lum: `${b.lum.toFixed(3)} → ${a.lum.toFixed(3)}`,
      sat: `${b.sat.toFixed(3)} → ${a.sat.toFixed(3)}`,
    };
  }),
);
console.log(`sheet at ${resolve(OUT, 'index.html')}`);
