/**
 * The extrusion walls against the studio's white balance.
 *
 *   node spikes/studio-warmth.mjs [--warmths 0,0.35,0.7,1] [--targets blue,all] [--looks gold]
 *
 * A letter is one extruded mesh with one material, so its walls differ from its faces only in
 * what they reflect. `environment.ts` lights blue from the left and warm from the right, and a
 * metal reflects `baseColor x envRadiance` — so warm-times-blue desaturates gold's left walls to
 * gray. This warms the studio toward its own warm bar and measures whether the gray goes away.
 *
 * `blue` warms only the bars the `--bluish` ratio counts as fill; `all`
 * rebalances every bar, which also tints the faces. Warmth 0 must reproduce the current studio
 * byte for byte, and the run asserts it — a rewrite that does not is measuring its own damage.
 *
 * Rewrites the colours in `render/environment.ts` and restores them on the way out, including on
 * a crash: check `git diff` if a run is killed.
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

const WARMTHS = arg('warmths', '0,0.35,0.7,1').split(',');
const TARGETS = arg('targets', 'blue,all').split(',');
const LOOKS = arg('looks', 'gold,chrome,velvet,leather').split(',');
const TEXT = arg('text', 'KLIEG');
const OUT = resolve(arg('out', resolve(HERE, 'studio-warmth-out')));
mkdirSync(OUT, { recursive: true });

const ENV_FILE = resolve(ROOT, 'packages/core/src/render/environment.ts');
const ORIGINAL = readFileSync(ENV_FILE, 'utf8');

/** The studio's own warm bar, as a unit-luminance direction to steer the others toward. */
const lumOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const WARM = (() => {
  const rgb = [6, 4.4, 2.2];
  const l = lumOf(rgb);
  return rgb.map((c) => c / l);
})();

/** Holds each bar's brightness and steers only its hue, so warmth never doubles as exposure. */
const warm = (rgb, w) => {
  const l = lumOf(rgb);
  return rgb.map((c, i) => c * (1 - w) + WARM[i] * l * w);
};
// How much bluer than red a bar must be to count as fill rather than as a neutral key: at 1.0 the
// near-white [9, 9, 10] key is swept up with the fill and the whole studio warms.
const BLUISH = Number.parseFloat(arg('bluish', '1'));
// An upper bound keeps the most saturated blue as a cool accent: `oil`'s iridescence reads off
// the studio's hue spread, so warming every blue at once is what flattens it.
const BLUEMAX = Number.parseFloat(arg('bluemax', 'Infinity'));
const isBlue = (rgb) => rgb[2] > rgb[0] * BLUISH && rgb[2] < rgb[0] * BLUEMAX;
const fmt = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(3).replace(/0+$/, ''));

function studio(w, target) {
  let out = ORIGINAL;
  let bars = 0;
  out = out.replace(/rgb: \[([\d.,\s-]+)\]/g, (whole, body) => {
    const rgb = body.split(',').map((n) => Number.parseFloat(n));
    if (target === 'blue' && !isBlue(rgb)) return whole;
    bars += 1;
    return `rgb: [${warm(rgb, w).map(fmt).join(', ')}]`;
  });
  out = out.replace(/new THREE\.Color\(([\d.,\s-]+)\)/g, (whole, body) => {
    const rgb = body.split(',').map((n) => Number.parseFloat(n));
    if (target === 'blue' && !isBlue(rgb)) return whole;
    return `new THREE.Color(${warm(rgb, w).map(fmt).join(', ')})`;
  });
  if (bars === 0) throw new Error(`no bars matched for target ${target} — did the table move?`);
  return out;
}

const CLIP = { x: 210, y: 78, width: 490, height: 175 };
const port = 5180 + ((createHash('sha1').update(ROOT).digest()[0] ?? 0) % 64) + 1;
console.log(`starting a dev server on ${port}`);
const server = spawn(
  'npm',
  ['run', 'dev', '-w', '@klieg/lab', '--', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
);

/** Decodes in the page: it is a raster PNG by now, not a live GL buffer. */
const measure = (page, png) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const { data } = c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height);
    let sum = 0;
    let sat = 0;
    let gray = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const s = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      sat += s;
      // Near-black is desaturated for trivial reasons; the cement is lit surface with no hue left.
      if (l > 0.05 && s < 0.12) gray += 1;
      lit += 1;
    }
    return { lum: sum / lit, sat: sat / lit, cement: gray / lit, coverage: lit };
  }, png.toString('base64'));

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const shots = [];
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
let n = 0;
const total = TARGETS.length * WARMTHS.length * LOOKS.length;

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

  for (const target of TARGETS) {
    for (const w of WARMTHS) {
      writeFileSync(ENV_FILE, studio(Number.parseFloat(w), target));
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
        const file = `${target}-${look}-w${w}.png`;
        writeFileSync(resolve(OUT, file), await page.screenshot());
        const thumb = `thumb-${target}-${look}-w${w}.png`;
        writeFileSync(resolve(OUT, thumb), await page.screenshot({ clip: CLIP }));
        await page.addStyleTag({ content: 'html, body { background: transparent; }' });
        const bare = await page.screenshot({ clip: CLIP, omitBackground: true });
        const m = await measure(page, bare);
        if (m.coverage === 0) throw new Error(`${look} measured no ink — background removal failed`);
        shots.push({ target, look, w, file, thumb, ...m, md5: md5(bare) });
        console.log(
          `${n}/${total} ${target} ${look} w=${w}  lum ${m.lum.toFixed(3)}  sat ${m.sat.toFixed(3)}  cement ${(m.cement * 100).toFixed(1)}%`,
        );
      }
    }
  }
} finally {
  writeFileSync(ENV_FILE, ORIGINAL);
  await browser.close();
  server.kill();
}

// Warmth 0 is the studio as it stands; if the rewrite moved it, every number above is off its own
// baseline rather than off the shipped one.
for (const look of LOOKS) {
  const seen = TARGETS.map((t) => shots.find((s) => s.target === t && s.look === look && s.w === WARMTHS[0]));
  if (WARMTHS[0] === '0' && new Set(seen.map((s) => s.md5)).size !== 1) {
    throw new Error(`${look} at warmth 0 differs between targets — the rewrite is not faithful`);
  }
}

const cell = (t, look, w) => {
  const h = shots.find((s) => s.target === t && s.look === look && s.w === w);
  return `<td><a href="${h.file}"><img src="${h.thumb}" alt="${look} ${t} ${w}"></a><div>sat ${h.sat.toFixed(3)} · gray ${(h.cement * 100).toFixed(1)}%</div></td>`;
};
const section = (t) => `<h2>${t === 'blue' ? 'warming only the net-blue bars' : 'rebalancing every bar'}</h2>
<div class="scroll"><table><thead><tr><th></th>${WARMTHS.map((w) => `<th>${w}</th>`).join('')}</tr></thead>
<tbody>${LOOKS.map((l) => `<tr><th>${l}</th>${WARMTHS.map((w) => cell(t, l, w)).join('')}</tr>`).join('')}</tbody></table></div>`;

writeFileSync(
  resolve(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>studio white balance</title>
<style>
  body { background:#0b0b0e; color:#d8d8e0; font:14px/1.5 ui-sans-serif,system-ui; margin:24px; }
  h1 { font-size:18px; } h2 { font-size:15px; margin-top:28px; color:#ffd479; }
  p { color:#8a8a98; max-width:74ch; }
  .scroll { overflow-x:auto; padding-bottom:10px; }
  table { border-collapse:collapse; }
  th { text-align:right; padding-right:10px; font-weight:600; white-space:nowrap; }
  thead th { text-align:center; font:13px ui-monospace,monospace; color:#8a8a98; padding:0 0 6px; }
  td { padding:3px; text-align:center; }
  td div { font:11px ui-monospace,monospace; color:#6a6a78; }
  img { width:300px; display:block; border:1px solid #1e1e26; } a { text-decoration:none; }
</style>
<h1>Studio white balance — the cement walls</h1>
<p><b>0</b> is the studio as it stands. Each step steers the bars' hue toward the studio's own warm
bar while holding their brightness, so warmth never doubles as exposure. <b>sat</b> is mean
saturation over the ink; <b>gray</b> is the share of lit ink with almost no hue left — the cement.
Click a thumbnail for the full frame.</p>
${TARGETS.map(section).join('')}`,
);

console.log('');
for (const t of TARGETS) {
  console.log(`\n${t}:`);
  console.table(
    LOOKS.map((look) =>
      Object.fromEntries([
        ['look', look],
        ...WARMTHS.map((w) => {
          const h = shots.find((s) => s.target === t && s.look === look && s.w === w);
          return [`w${w}`, `${h.sat.toFixed(3)} / ${(h.cement * 100).toFixed(1)}%`];
        }),
      ]),
    ),
  );
}
console.log(`sheet at ${resolve(OUT, 'index.html')}`);
