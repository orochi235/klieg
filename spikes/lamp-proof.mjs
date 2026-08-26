/**
 * Does a lamp reach the screen?
 *
 *   node spikes/lamp-proof.mjs
 *   node spikes/lamp-proof.mjs --looks gold,chrome,gem,velvet,neon,tubing --out spikes/lamp-proof
 *   node spikes/lamp-proof.mjs --only srgb,seam            # one question at a time
 *   node spikes/lamp-proof.mjs --orbit-radii 2,1,0.5,0.4,0.3 --only orbit,orbitr
 *
 * Every claim on this branch is a unit test until something renders. `gain` passed all of them and
 * changed no pixels, so each phase below renders a lamp-on/lamp-off pair and compares md5: two
 * identical PNGs mean the lamp never reached the GPU.
 *
 *   looks    one pair per look, `tubing` on `{ kind: 'run' }` for the vertex-buffer write path
 *   orbit    `lamp({ source: orbit() })` on bare defaults, at eight points around its circle
 *   orbitr   the same sweep per `--orbit-radii`, for choosing the default on data
 *   srgb     mid-grey at full strength against white at half, by mean pixel distance
 *   seam     one lamp against two half lamps whose pools cross, to look at
 *   run      a lamp on runs that `hue` has recoloured, and on both gradient modes
 *   pointer  `fromPointer` at rest, then across a sign that fills the frame
 *   small    the same on a sign that does not fill the frame, where the stretch is visible
 *   regroup  the same after a stage has re-laid the letters under a construction-time part pool
 *
 * The md5-compared frame never carries the crosshair — it is drawn into the same clip, so a pair
 * that differed only by cursor position would read as a working lamp on a dead one. Every check
 * that wants a lamp to have landed also asserts the probe counted a lit part.
 *
 * Exits non-zero when a pair that must differ is byte-identical, when a frame that must be lit
 * counted no lit part, or when the sRGB pair is not the closer of the two candidates.
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
const OUT = resolve(arg('out', resolve(HERE, 'lamp-proof')));
const LOOKS = arg('looks', 'gold,chrome,gem,velvet,neon,tubing').split(',');
const TEXT = arg('text', 'KLIEG');
const ORBIT_RADII = arg('orbit-radii', '')
  .split(',')
  .filter(Boolean);
/** Phase names to run, for iterating on one question without re-rendering the rest. */
const ONLY = arg('only', '')
  .split(',')
  .filter(Boolean);

const W = 1000;
const H = 220;
const SETTLE = 2500;
/** Fractions of one pass, driven into the piece directly. Settling a second apart samples an
 * uncontrolled absolute phase, which is how a sweep lands on four diagonals and misses 0 and 180. */
const PHASES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
const deg = (p) => String(Math.round(p * 360)).padStart(3, '0');

mkdirSync(OUT, { recursive: true });

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>lamp proof</title>
<style>
  body { margin: 0; background: #08090b; }
  #strip { position: relative; width: 100%; height: ${H}px; }
  #cross { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px;
           border: 2px solid #22d3ee; border-radius: 50%; pointer-events: none; display: none;
           transform: translate(var(--cx, 0px), var(--cy, 0px)); z-index: 9; }
  #cross::after { content: ''; position: absolute; left: 11px; top: 11px; width: 4px; height: 4px;
                  background: #22d3ee; border-radius: 50%; }
  body.cross #cross { display: block; }
</style>
<script type="importmap">
  {
    "imports": {
      "three": "/three/three.module.js",
      "klieg": "/klieg/index.js",
      "opentype.js": "/opentype/opentype.mjs"
    }
  }
</script>
<div id="strip"></div>
<div id="cross"></div>
<script type="module">
  import { createKlieg, EFFECTS, fixed, fromPointer, lamp, orbit, specOf } from 'klieg';

  const q = new URLSearchParams(location.search);
  const num = (name, fallback) => {
    const v = q.get(name);
    return v === null ? fallback : Number(v);
  };

  const cross = document.getElementById('cross');
  addEventListener('pointermove', (e) => {
    cross.style.setProperty('--cx', e.clientX + 'px');
    cross.style.setProperty('--cy', e.clientY + 'px');
  }, { passive: true });
  // The crosshair sits inside the screenshot clip, so the runner turns it on only for the
  // look-at frame and never for the one it hashes.
  window.__cross = (on) => { document.body.classList.toggle('cross', on); };

  const probe = { calls: 0, lit: 0, maxAmount: 0, frames: 0, minX: Infinity, maxX: -Infinity,
                  minY: Infinity, maxY: -Infinity, xs: [], pointer: null, pointerInWord: null };
  window.__probe = probe;
  const tick = () => { probe.frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  const seenX = new Set();
  const forced = q.get('phase');

  /** Delegates to the real piece and counts what it returned, so a dark render can say whether
   * the lamp computed nothing or computed something the renderer dropped. Also pins the pass
   * fraction when asked, which is the only way to sample a chosen point of an orbit. */
  const watch = (piece) => ({
    duration: piece.duration,
    at(t, part, ctx) {
      const out = piece.at(forced === null ? t : Number(forced), part, ctx);
      probe.calls += 1;
      probe.minX = Math.min(probe.minX, part.x);
      probe.maxX = Math.max(probe.maxX, part.x);
      probe.minY = Math.min(probe.minY, part.y);
      probe.maxY = Math.max(probe.maxY, part.y);
      if (!seenX.has(part.x)) { seenX.add(part.x); probe.xs = [...seenX].sort((a, b) => a - b); }
      probe.pointer = ctx.pointer;
      probe.pointerInWord = ctx.pointerInWord;
      if (out.light?.amount) {
        probe.lit += 1;
        probe.maxAmount = Math.max(probe.maxAmount, out.light.amount);
      }
      return out;
    },
  });

  const source = (o) => {
    if (o.src === 'orbit') return o.orbit ? orbit(o.orbit) : orbit();
    if (o.src === 'pointer') return fromPointer();
    return fixed(o.x ?? 0, o.y ?? 0);
  };

  // Only the keys a lamp entry actually names are passed, so a bare src:'orbit' entry reaches
  // lamp({ source: orbit() }) on bare defaults rather than on this page's opinions.
  const build = (o) => {
    const spec = { source: source(o) };
    for (const k of ['duration', 'radius', 'strength']) if (o[k] !== undefined) spec[k] = o[k];
    if (o.color !== undefined) spec.color = Number.parseInt(o.color, 16);
    return { piece: watch(lamp(spec)), target: { kind: o.target ?? 'body', by: 'index' } };
  };

  const name = q.get('look') ?? 'gold';
  let look = name;
  if (q.get('gradient') === '1') {
    const base = specOf(name);
    look = { ...base, decoration: { ...base.decoration, gradient: {
      domain: { of: 'run' }, mode: q.get('gradmode') ?? 'replace', stops: [0xff2d95, 0x1848ff],
    } } };
  }

  const lamps = JSON.parse(q.get('lamps') ?? '[]').map(build);
  // span 0 pins the wheel, so a hue-versus-no-hue pair differs by the recolour and not the clock.
  if (q.get('hue') === '1') {
    lamps.unshift({
      piece: EFFECTS.hue({ span: 0, from: 0.45 }),
      target: { kind: 'run', by: 'index' },
    });
  }
  const stages = q.get('stages') === '1'
    ? [{ keep: (l) => l.index >= 6, exit: 'fade', hold: 600_000, tween: { duration: 700 } }]
    : undefined;

  window.__shot = false;
  const klieg = createKlieg({
    fontUrl: '/font.ttf',
    placement: { kind: 'element', el: document.getElementById('strip') },
    framing: { width: num('fw', 0.9), height: num('fh', 0.6) },
  });

  void klieg.fire(q.get('text') ?? 'KLIEG', {
    look,
    // static, so a frame is the same frame every run — sweep would sample mid-rake.
    lighting: 'static',
    enter: 'none',
    hold: stages ? 1200 : 600_000,
    effects: lamps,
    ...(stages ? { stages } : {}),
  });

  setTimeout(() => { window.__shot = true; }, num('settle', ${SETTLE}));
</script>
`;

const TREES = {
  '/klieg/': dirname(KLIEG),
  '/three/': dirname(THREE),
  '/opentype/': dirname(OPENTYPE),
};
const FILES = {
  '/': [Buffer.from(PAGE), 'text/html'],
  '/font.ttf': [readFileSync(FONT), 'font/ttf'],
};

// Port 0: the OS picks a free one, so a spike cannot collide with a test run already holding one.
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

const L = (o) => JSON.stringify(o);
const runKind = (look) => (look === 'tubing' ? 'run' : 'body');

const jobs = [];
const job = (phase, name, query, extra = {}) => {
  if (ONLY.length && !ONLY.includes(phase)) return;
  jobs.push({ phase, name, query, mouse: null, look: false, ...extra });
};

// First of the whole run: `fromPointer` at rest needs a page no pointer has ever moved over.
job('pointer', 'rest', { text: TEXT, look: 'gold', lamps: L([{ src: 'pointer' }]) });

for (const look of LOOKS) {
  const pool = [{ src: 'fixed', x: 0, y: 0, radius: 0.6, strength: 2.5, target: runKind(look) }];
  job('looks', `${look}-off`, { text: TEXT, look, lamps: L([]) });
  job('looks', `${look}-on`, { text: TEXT, look, lamps: L(pool) });
}

job('orbit', 'off', { text: TEXT, look: 'gold', lamps: L([]) });
for (const p of PHASES) {
  job('orbit', `bare-${deg(p)}`, {
    text: TEXT,
    look: 'gold',
    lamps: L([{ src: 'orbit' }]),
    phase: String(p),
  });
}
for (const r of ORBIT_RADII) {
  for (const p of PHASES) {
    job('orbitr', `r${r}-${deg(p)}`, {
      text: TEXT,
      look: 'gold',
      lamps: L([{ src: 'orbit', orbit: { radius: Number(r) } }]),
      phase: String(p),
    });
  }
}

// A mid-grey lamp is 0.502 of white once `rgb()` divides by 255, and 0.216 once a gamma decode
// does. Rendering both candidates is what tells the two schemes apart; strength alone cannot.
const grey = { src: 'fixed', x: 0, y: 0, radius: 0.6, strength: 1, color: '808080' };
job('srgb', 'off', { text: TEXT, look: 'gold', lamps: L([]) });
job('srgb', 'grey-full', { text: TEXT, look: 'gold', lamps: L([grey]) });
job('srgb', 'white-srgb', {
  text: TEXT,
  look: 'gold',
  lamps: L([{ ...grey, strength: 128 / 255, color: 'ffffff' }]),
});
job('srgb', 'white-linear', {
  text: TEXT,
  look: 'gold',
  lamps: L([{ ...grey, strength: 0.2158605, color: 'ffffff' }]),
});

const SEAM = 'ILLUMINATION';
const seam = (x, strength) => ({ src: 'fixed', x, y: 0, radius: 1, strength });
job('seam', 'off', { text: SEAM, look: 'velvet', lamps: L([]) });
job('seam', 'one-full', { text: SEAM, look: 'velvet', lamps: L([seam(0, 0.9)]) });
job('seam', 'two-half', {
  text: SEAM,
  look: 'velvet',
  lamps: L([seam(-0.5, 0.45), seam(0.5, 0.45)]),
});

const RUNS = L([{ src: 'fixed', x: 0, y: 0, radius: 0.9, strength: 1.2, target: 'run' }]);
job('run', 'lamp-only', { text: TEXT, look: 'tubing', lamps: RUNS });
// `hue` on both sides, so the pair differs by the lamp and not by the recolour.
job('run', 'hue-only', { text: TEXT, look: 'tubing', lamps: L([]), hue: '1' });
job('run', 'hue-lamp', { text: TEXT, look: 'tubing', lamps: RUNS, hue: '1' });
for (const mode of ['replace', 'modulate']) {
  const g = { text: TEXT, look: 'tubing', gradient: '1', gradmode: mode };
  job('run', `${mode}-off`, { ...g, lamps: L([]) });
  job('run', `${mode}-on`, { ...g, lamps: RUNS });
}
// The control for the pre-existing part: `hue` writes the same vertex attribute a lamp does.
job('run', 'replace-hue', {
  text: TEXT,
  look: 'tubing',
  gradient: '1',
  gradmode: 'replace',
  lamps: L([]),
  hue: '1',
});

const POINTER = L([{ src: 'pointer', radius: 0.5, strength: 2.5 }]);
const SMALL = { fw: 0.3, fh: 0.3 };
const REGROUP = { text: 'KLIEG NOW', look: 'gold', stages: '1', settle: '4200' };

job('small', 'dark', { text: TEXT, look: 'gold', lamps: L([]), ...SMALL });
job('regroup', 'dark', { ...REGROUP, lamps: L([]) });

for (const [name, fx] of [
  ['left', 0.25],
  ['mid', 0.5],
  ['right', 0.75],
]) {
  const mouse = [W * fx, H * 0.5];
  job('pointer', name, { text: TEXT, look: 'gold', lamps: POINTER }, { mouse, look: true });
  job('small', name, { text: TEXT, look: 'gold', lamps: POINTER, ...SMALL }, { mouse, look: true });
}

for (const [name, fx] of [
  ['left', 0.2],
  ['mid', 0.5],
  ['right', 0.8],
]) {
  job('regroup', name, { ...REGROUP, lamps: POINTER }, { mouse: [W * fx, H * 0.5], look: true });
}
// The one that answers the open question: the cursor placed on the ink the regroup left behind,
// found from the unlit frame rather than assumed.
job(
  'regroup',
  'over',
  { ...REGROUP, lamps: POINTER },
  { mouse: () => centreOfInk('regroup/dark'), look: true },
);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [console] ${m.text()}`);
});
page.on('requestfailed', (r) => console.log(`  [reqfail] ${r.url()} ${r.failure()?.errorText}`));

/** A second page does the image arithmetic, so a measurement can be taken mid-run without
 * navigating the page that is rendering. */
const util = await browser.newPage({ viewport: { width: 940, height: 600 } });

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const shots = new Map();

const pixels = (png) => `data:image/png;base64,${png.toString('base64')}`;

/** Mean and worst per-channel distance between two shots, plus the count, box and intensity
 * centroid of the pixels that moved, in CSS pixels. md5 says "not identical"; this says how far
 * apart and where — the sRGB question, and the is-the-light-under-the-cursor question. */
const analyze = async (a, b) =>
  util.evaluate(
    async ([da, db, scale]) => {
      const get = (d) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = d;
        });
      const [ia, ib] = await Promise.all([get(da), get(db)]);
      const c = document.createElement('canvas');
      c.width = ia.width;
      c.height = ia.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(ia, 0, 0);
      const A = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(ib, 0, 0);
      const B = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      let max = 0;
      let count = 0;
      let moved = 0;
      let weight = 0;
      let wx = 0;
      let wy = 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < A.length; i += 4) {
        let d = 0;
        for (let k = 0; k < 3; k++) {
          const v = Math.abs(A[i + k] - B[i + k]);
          sum += v;
          count += 1;
          if (v > max) max = v;
          if (v > d) d = v;
        }
        if (d <= 8) continue;
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        moved += 1;
        weight += d;
        wx += px * d;
        wy += py * d;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      const s = c.width / scale;
      const out = { mean: sum / count, max, moved };
      if (moved > 0) {
        out.cx = wx / weight / s;
        out.cy = wy / weight / s;
        out.box = [x0 / s, y0 / s, x1 / s, y1 / s].map((v) => Math.round(v));
      }
      return out;
    },
    [pixels(shots.get(a).png), pixels(shots.get(b).png), W],
  );

/** Centre of the letters actually on screen, from an unlit frame, in CSS pixels. Where the
 * regrouped word ended up is a layout answer, and reading it beats assuming it. */
const centreOfInk = async (key) =>
  util.evaluate(
    async ([d, scale]) => {
      const get = (u) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = u;
        });
      const img = await get(d);
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const D = g.getImageData(0, 0, c.width, c.height).data;
      let weight = 0;
      let wx = 0;
      let wy = 0;
      for (let i = 0; i < D.length; i += 4) {
        const lum = D[i] + D[i + 1] + D[i + 2] - 24;
        if (lum <= 30) continue;
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        weight += lum;
        wx += px * lum;
        wy += py * lum;
      }
      const s = c.width / scale;
      return weight === 0 ? [scale / 2, 0] : [wx / weight / s, wy / weight / s];
    },
    [pixels(shots.get(key).png), W],
  );

let n = 0;
for (const j of jobs) {
  n += 1;
  await page.goto(`${base}/?${new URLSearchParams(j.query)}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 90_000 });
  let mouse = null;
  if (j.mouse) {
    mouse = (typeof j.mouse === 'function' ? await j.mouse() : j.mouse).map((v) => Math.round(v));
    await page.mouse.move(mouse[0], mouse[1]);
    await page.waitForTimeout(400);
  }
  const clip = { x: 0, y: 0, width: W, height: H };
  const png = await page.screenshot({ clip });
  const file = `${j.phase}-${j.name}.png`;
  writeFileSync(resolve(OUT, file), png);
  let lookFile;
  if (j.look) {
    await page.evaluate(() => window.__cross(true));
    lookFile = `${j.phase}-${j.name}-look.png`;
    writeFileSync(resolve(OUT, lookFile), await page.screenshot({ clip }));
  }
  const probe = await page.evaluate(() => window.__probe ?? null);
  shots.set(`${j.phase}/${j.name}`, { file, lookFile, md5: md5(png), probe, png, mouse });
  const lit = probe ? ` lit=${probe.lit}/${probe.calls} max=${probe.maxAmount.toFixed(3)}` : '';
  console.log(`${n}/${jobs.length} ${file}  ${md5(png).slice(0, 12)}${lit}`);
}

const maybe = async (a, b) => (shots.has(a) && shots.has(b) ? analyze(a, b) : null);
const dSrgb = await maybe('srgb/grey-full', 'srgb/white-srgb');
const dLinear = await maybe('srgb/grey-full', 'srgb/white-linear');
const dLands = await maybe('srgb/off', 'srgb/grey-full');
const seamPools = await maybe('seam/one-full', 'seam/two-half');

// How far each orbit phase moves the image off the unlit frame: the number behind the choice of
// default radius, since a phase that reads as dark is one nobody would call working.
const orbitLift = {};
if (shots.has('orbit/off')) {
  for (const [key] of shots) {
    if (!key.startsWith('orbit/bare-') && !key.startsWith('orbitr/')) continue;
    orbitLift[key] = (await analyze('orbit/off', key)).mean;
  }
}

// Where the light landed against where the cursor was. `pointerInWord` maps the canvas onto the
// word's ink box while a lamp measures from each part's origin, so the two need not agree.
const CONTROL = { pointer: 'pointer/rest', small: 'small/dark', regroup: 'regroup/dark' };
const aim = {};
for (const [key, s] of shots) {
  const control = CONTROL[key.split('/')[0]];
  if (!s.mouse || !control || !shots.has(control)) continue;
  const d = await analyze(control, key);
  aim[key] = {
    cursor: `${s.mouse[0]},${s.mouse[1]}`,
    light: d.moved ? `${d.cx.toFixed(0)},${d.cy.toFixed(0)}` : '',
    dx: d.moved ? Math.round(d.cx - s.mouse[0]) : '',
    dy: d.moved ? Math.round(d.cy - s.mouse[1]) : '',
    movedPx: d.moved,
    lit: s.probe ? `${s.probe.lit}/${s.probe.calls}` : '',
  };
}

const at = (key) => shots.get(key) ?? { md5: 'missing', probe: null };
const isLit = (key) => (at(key).probe?.lit ?? 0) > 0;
const checks = [];
const add = (check, want, verdict, ok) => checks.push({ check, want, verdict, ok });

/** A pair must differ AND every frame in `lit` must have contributed light: the crosshair used
 * to be inside the clip, and a pair that differs only by cursor position is not a lamp. */
const differ = (check, a, b, opts = {}) => {
  if (!shots.has(a) || !shots.has(b)) return;
  const dark = (opts.lit ?? [b]).filter((k) => !isLit(k));
  const bright = (opts.dark ?? []).filter((k) => isLit(k));
  const verdict =
    at(a).md5 === at(b).md5
      ? 'NO-OP: byte-identical'
      : dark.length
        ? `NO-OP: no lit part in ${dark.join(', ')}`
        : bright.length
          ? `lit when it should rest: ${bright.join(', ')}`
          : 'reads';
  add(check, 'differ', verdict, verdict === 'reads');
};

for (const look of LOOKS) {
  differ(`${look} (${runKind(look)})`, `looks/${look}-off`, `looks/${look}-on`, {
    lit: [`looks/${look}-on`],
  });
}
if (shots.has('orbit/off')) {
  const dark = PHASES.filter(
    (p) => at(`orbit/bare-${deg(p)}`).md5 === at('orbit/off').md5 || !isLit(`orbit/bare-${deg(p)}`),
  ).map(deg);
  add(
    `orbit bare defaults, all ${PHASES.length} phases`,
    'differ',
    dark.length ? `NO-OP at ${dark.join(', ')}` : 'reads',
    dark.length === 0,
  );
}
differ('srgb control: lamp lands', 'srgb/off', 'srgb/grey-full', { lit: ['srgb/grey-full'] });
if (dSrgb && dLinear) {
  add(
    `grey@1 nearer white@0.5020 (${dSrgb.mean.toFixed(3)}) than white@0.2159 (${dLinear.mean.toFixed(3)})`,
    'sRGB',
    dSrgb.mean * 10 < dLinear.mean ? 'sRGB' : 'LINEAR',
    dSrgb.mean * 10 < dLinear.mean,
  );
}
differ('fromPointer wakes', 'pointer/rest', 'pointer/mid', {
  lit: ['pointer/mid'],
  dark: ['pointer/rest'],
});
differ('fromPointer tracks', 'pointer/left', 'pointer/right', {
  lit: ['pointer/left', 'pointer/right'],
});
differ('fromPointer on a small sign', 'small/dark', 'small/mid', { lit: ['small/mid'] });
differ('fromPointer tracks on a small sign', 'small/left', 'small/right', {
  lit: ['small/left', 'small/right'],
});
differ('fromPointer after a regroup', 'regroup/dark', 'regroup/right', {
  lit: ['regroup/right'],
});
// Where the light goes after a regroup is a measurement, not a promise this branch makes: the
// part pool is a construction-time snapshot and `FrameCtx` says so. `over` puts the cursor on the
// ink the regroup left on screen, so a lit frame would mean the pool had followed the letters.
if (shots.has('regroup/over')) {
  add(
    'a regroup leaves the light on the old layout',
    'record',
    isLit('regroup/over')
      ? 'the light follows the letters'
      : 'dark under the cursor: the pool is still the original layout',
    true,
  );
}
differ('a lamp on runs under hue', 'run/hue-only', 'run/hue-lamp', { lit: ['run/hue-lamp'] });
// `replace` samples the ramp and never reads the run-colour attribute, so nothing that writes
// that attribute survives — a lamp, `color` and `gain` alike. Recorded, not failed: it predates
// this branch and fixing it is a change to the tube shader.
if (shots.has('run/replace-off')) {
  const noop =
    at('run/replace-off').md5 === at('run/replace-on').md5 &&
    at('run/replace-off').md5 === at('run/replace-hue').md5;
  add(
    'a replace gradient drops the run-colour attribute (pre-existing)',
    'NO-OP',
    noop ? 'NO-OP, lamp and hue alike' : 'reads',
    noop,
  );
}
differ('a lamp on a modulate gradient', 'run/modulate-off', 'run/modulate-on', {
  lit: ['run/modulate-on'],
});

console.log('');
console.table(checks);
console.table(
  [...shots].map(([key, s]) => ({
    shot: key,
    md5: s.md5.slice(0, 12),
    lit: s.probe ? `${s.probe.lit}/${s.probe.calls}` : '',
    max: s.probe ? s.probe.maxAmount.toFixed(3) : '',
    partX: s.probe && s.probe.calls ? `${s.probe.minX.toFixed(2)}..${s.probe.maxX.toFixed(2)}` : '',
    inWord: s.probe?.pointerInWord
      ? `${s.probe.pointerInWord.x.toFixed(2)},${s.probe.pointerInWord.y.toFixed(2)}`
      : '',
  })),
);
console.log('\npixel distance (mean, max per channel out of 255)');
console.table({
  'srgb: off vs grey@1': dLands,
  'srgb: grey@1 vs white@0.5020': dSrgb,
  'srgb: grey@1 vs white@0.2159': dLinear,
  'seam: one full vs two half': seamPools,
});
if (Object.keys(orbitLift).length) {
  console.log('\nmean pixel lift off the unlit frame, per orbit phase');
  console.table(orbitLift);
}
if (Object.keys(aim).length) {
  console.log('\nwhere the light landed against the cursor, CSS px');
  console.table(aim);
}

// The contact sheets are what a human reads, so the script that renders the frames makes them
// too: a sheet nobody can regenerate ages into the same unchecked evidence `gain` had.
const groups = new Map();
for (const [key, s] of shots) {
  const phase = key.split('/')[0];
  if (!groups.has(phase)) groups.set(phase, []);
  groups.get(phase).push([key, s]);
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let sheetN = 0;
for (const [phase, rows] of groups) {
  sheetN += 1;
  const cards = rows
    .map(([key, s]) => {
      const png = s.lookFile ? readFileSync(resolve(OUT, s.lookFile)) : s.png;
      const probe = s.probe ? ` lit=${s.probe.lit}/${s.probe.calls}` : '';
      const cursor = s.mouse ? ` cursor=${s.mouse.join(',')}` : '';
      return `<figure><img src="${pixels(png)}" /><figcaption>${esc(key)} &nbsp; ${s.md5.slice(
        0,
        12,
      )}${esc(probe)}${esc(cursor)}</figcaption></figure>`;
    })
    .join('\n');
  await util.setContent(
    `<style>body{margin:0;padding:14px;background:#0b0c0e;color:#d6d9de;
     font:12px ui-monospace,Menlo,monospace}h1{font-size:13px;margin:0 0 12px;color:#22d3ee}
     figure{margin:0 0 10px}img{display:block;width:100%;border:1px solid #2a2f36}
     figcaption{padding:3px 0}</style><h1>lamp-proof / ${esc(phase)}</h1>${cards}`,
  );
  await util.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const file = `sheet-${phase}.png`;
  writeFileSync(resolve(OUT, file), await util.screenshot({ fullPage: true }));
  console.log(`sheet ${sheetN}/${groups.size} ${file}`);
}

await browser.close();
server.close();

const report = resolve(OUT, 'report.json');
writeFileSync(
  report,
  `${JSON.stringify(
    {
      checks,
      distances: { dLands, dSrgb, dLinear, seamPools, orbitLift },
      aim,
      shots: [...shots].map(([k, s]) => [
        k,
        { file: s.file, lookFile: s.lookFile, md5: s.md5, mouse: s.mouse, probe: s.probe },
      ]),
    },
    null,
    2,
  )}\n`,
);
console.log(`\nshots, contact sheets and report.json in ${OUT}`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `failed: ${failed.map((c) => c.check).join(', ')}` : 'every check held');
process.exitCode = failed.length ? 1 : 0;
