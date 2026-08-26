/**
 * Does a lamp reach the screen?
 *
 *   node spikes/lamp-proof.mjs
 *   node spikes/lamp-proof.mjs --looks gold,chrome,gem,velvet,neon,tubing --out spikes/lamp-proof
 *   node spikes/lamp-proof.mjs --only srgb,seam            # one question at a time
 *   node spikes/lamp-proof.mjs --orbit-radii 0.4,0.6,1     # phase sweep for choosing a default
 *
 * Every claim on this branch is a unit test until something renders. `gain` passed all of them and
 * changed no pixels, so each phase below renders a lamp-on/lamp-off pair and compares md5: two
 * identical PNGs mean the lamp never reached the GPU.
 *
 *   looks    one pair per look, `tubing` on `{ kind: 'run' }` for the vertex-buffer write path
 *   orbit    `lamp({ source: orbit() })` on bare defaults, at four points of its pass
 *   srgb     mid-grey at full strength against white at half, by mean pixel distance
 *   seam     one lamp against two half lamps whose pools cross, to look at
 *   run      a lamp on runs that `hue` has recoloured, and on both gradient modes
 *   pointer  `fromPointer` at rest, then across the canvas, with a crosshair on the cursor
 *   small    the same on a sign that does not fill the frame, where the stretch is visible
 *   regroup  the same after a stage has re-laid the letters under a construction-time part pool
 *
 * Exits non-zero when a pair that must differ is byte-identical, or the sRGB pair is not the
 * closer of the two candidates.
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
/** One lamp pass is 4000ms, so four settles a second apart land a quarter-turn apart. */
const PHASES = [2500, 3500, 4500, 5500];

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

  if (q.get('cross') === '1') {
    document.body.classList.add('cross');
    const cross = document.getElementById('cross');
    addEventListener('pointermove', (e) => {
      cross.style.setProperty('--cx', e.clientX + 'px');
      cross.style.setProperty('--cy', e.clientY + 'px');
    }, { passive: true });
  }

  const probe = { calls: 0, lit: 0, maxAmount: 0, frames: 0, minX: Infinity, maxX: -Infinity,
                  minY: Infinity, maxY: -Infinity, pointer: null, pointerInWord: null };
  window.__probe = probe;
  const tick = () => { probe.frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  /** Delegates to the real piece and counts what it returned, so a dark render can say whether
   * the lamp computed nothing or computed something the renderer dropped. */
  const watch = (piece) => ({
    duration: piece.duration,
    at(t, part, ctx) {
      const out = piece.at(t, part, ctx);
      probe.calls += 1;
      probe.minX = Math.min(probe.minX, part.x);
      probe.maxX = Math.max(probe.maxX, part.x);
      probe.minY = Math.min(probe.minY, part.y);
      probe.maxY = Math.max(probe.maxY, part.y);
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

  setTimeout(() => { window.__shot = true; }, num('settle', 2500));
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
  jobs.push({ phase, name, query, mouse: null, ...extra });
};

// First of the whole run: `fromPointer` at rest needs a page no pointer has ever moved over.
job('pointer', 'rest', { text: TEXT, look: 'gold', lamps: L([{ src: 'pointer' }]) });

for (const look of LOOKS) {
  const pool = [{ src: 'fixed', x: 0, y: 0, radius: 0.6, strength: 2.5, target: runKind(look) }];
  job('looks', `${look}-off`, { text: TEXT, look, lamps: L([]) });
  job('looks', `${look}-on`, { text: TEXT, look, lamps: L(pool) });
}

job('orbit', 'off', { text: TEXT, look: 'gold', lamps: L([]) });
for (const settle of PHASES) {
  job('orbit', `bare-${settle}`, {
    text: TEXT,
    look: 'gold',
    lamps: L([{ src: 'orbit' }]),
    settle: String(settle),
  });
}
for (const r of ORBIT_RADII) {
  for (const settle of PHASES) {
    job('orbitr', `r${r}-${settle}`, {
      text: TEXT,
      look: 'gold',
      lamps: L([{ src: 'orbit', orbit: { radius: Number(r) } }]),
      settle: String(settle),
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
job('run', 'hue-off', { text: TEXT, look: 'tubing', lamps: RUNS });
job('run', 'hue-on', { text: TEXT, look: 'tubing', lamps: RUNS, hue: '1' });
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
for (const [name, fx] of [
  ['left', 0.25],
  ['mid', 0.5],
  ['right', 0.75],
]) {
  const mouse = [W * fx, H * 0.5];
  job('pointer', name, { text: TEXT, look: 'gold', lamps: POINTER, cross: '1' }, { mouse });
  job(
    'small',
    name,
    { text: TEXT, look: 'gold', lamps: POINTER, cross: '1', fw: 0.3, fh: 0.3 },
    { mouse },
  );
}

for (const [name, fx] of [
  ['left', 0.2],
  ['mid', 0.5],
  ['right', 0.8],
]) {
  job(
    'regroup',
    name,
    { text: 'KLIEG NOW', look: 'gold', lamps: POINTER, cross: '1', stages: '1', settle: '4200' },
    { mouse: [W * fx, H * 0.5] },
  );
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [console] ${m.text()}`);
});
page.on('requestfailed', (r) => console.log(`  [reqfail] ${r.url()} ${r.failure()?.errorText}`));

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const shots = new Map();
let n = 0;

for (const j of jobs) {
  n += 1;
  await page.goto(`${base}/?${new URLSearchParams(j.query)}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 90_000 });
  if (j.mouse) {
    await page.mouse.move(j.mouse[0], j.mouse[1]);
    await page.waitForTimeout(400);
  }
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  const file = `${j.phase}-${j.name}.png`;
  writeFileSync(resolve(OUT, file), png);
  const probe = await page.evaluate(() => window.__probe ?? null);
  const settle = Number(j.query.settle ?? 2500);
  shots.set(`${j.phase}/${j.name}`, { file, md5: md5(png), probe, png, settle });
  const lit = probe ? ` lit=${probe.lit}/${probe.calls} max=${probe.maxAmount.toFixed(3)}` : '';
  console.log(`${n}/${jobs.length} ${file}  ${md5(png).slice(0, 12)}${lit}`);
}

/** Mean and worst per-channel distance between two shots, 0..255. md5 says "not identical";
 * this says how far apart, which is the whole sRGB-versus-linear question. */
const distance = async (a, b) => {
  const url = (k) => `data:image/png;base64,${shots.get(k).png.toString('base64')}`;
  return page.evaluate(
    async ([da, db]) => {
      const load = (d) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = d;
        });
      const [ia, ib] = await Promise.all([load(da), load(db)]);
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
      for (let i = 0; i < A.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(A[i + k] - B[i + k]);
          sum += d;
          if (d > max) max = d;
          count += 1;
        }
      }
      return { mean: sum / count, max };
    },
    [url(a), url(b)],
  );
};

await page.goto('about:blank');
const maybe = async (a, b) => (shots.has(a) && shots.has(b) ? distance(a, b) : null);
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
    orbitLift[key] = (await distance('orbit/off', key)).mean;
  }
}

await browser.close();
server.close();

const at = (key) => shots.get(key) ?? { md5: 'missing', probe: null };
const checks = [];
const differ = (check, a, b) => {
  if (!shots.has(a) || !shots.has(b)) return;
  checks.push({ check, want: 'differ', verdict: at(a).md5 !== at(b).md5 ? 'reads' : 'NO-OP' });
};

for (const look of LOOKS) {
  differ(`${look} (${runKind(look)})`, `looks/${look}-off`, `looks/${look}-on`);
}
if (shots.has('orbit/off')) {
  checks.push({
    check: 'orbit bare defaults, every phase',
    want: 'differ',
    verdict: PHASES.every((s) => at(`orbit/bare-${s}`).md5 !== at('orbit/off').md5)
      ? 'reads'
      : 'NO-OP',
  });
}
differ('srgb control: lamp lands', 'srgb/off', 'srgb/grey-full');
if (dSrgb && dLinear) {
  checks.push({
    check: `grey@1 nearer white@0.5020 (${dSrgb.mean.toFixed(3)}) than white@0.2159 (${dLinear.mean.toFixed(3)})`,
    want: 'sRGB',
    verdict: dSrgb.mean * 10 < dLinear.mean ? 'sRGB' : 'LINEAR',
  });
}
differ('fromPointer wakes', 'pointer/rest', 'pointer/mid');
differ('fromPointer tracks', 'pointer/left', 'pointer/right');
differ('fromPointer on a small sign', 'small/left', 'small/right');
differ('fromPointer after a regroup', 'regroup/left', 'regroup/right');
differ('a lamp on runs under hue', 'run/hue-off', 'run/hue-on');
// `replace` samples the ramp and never reads the run-colour attribute, so nothing that writes
// that attribute survives — a lamp, `color` and `gain` alike. Recorded, not failed: it predates
// this branch and fixing it is a change to the tube shader.
checks.push({
  check: 'a replace gradient drops the run-colour attribute (pre-existing)',
  want: 'NO-OP',
  verdict:
    at('run/replace-off').md5 === at('run/replace-on').md5 &&
    at('run/replace-off').md5 === at('run/replace-hue').md5
      ? 'NO-OP, lamp and hue alike'
      : 'reads',
});
differ('a lamp on a modulate gradient', 'run/modulate-off', 'run/modulate-on');

console.log('');
console.table(checks);
console.table(
  [...shots].map(([key, s]) => ({
    shot: key,
    md5: s.md5.slice(0, 12),
    lit: s.probe ? `${s.probe.lit}/${s.probe.calls}` : '',
    fps: s.probe ? (s.probe.frames / (s.settle / 1000)).toFixed(0) : '',
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

const report = resolve(OUT, 'report.json');
writeFileSync(
  report,
  `${JSON.stringify(
    {
      checks,
      distances: { dLands, dSrgb, dLinear, seamPools, orbitLift },
      shots: [...shots].map(([k, s]) => [k, { file: s.file, md5: s.md5, probe: s.probe }]),
    },
    null,
    2,
  )}\n`,
);
console.log(`\nshots and report.json in ${OUT}`);

const failed = checks.filter((c) => c.verdict === 'NO-OP' || c.verdict === 'LINEAR');
console.log(failed.length ? `failed: ${failed.map((c) => c.check).join(', ')}` : 'every check held');
process.exitCode = failed.length ? 1 : 0;
