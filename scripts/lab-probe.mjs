#!/usr/bin/env node
// Drives a running lab's orbit headless and measures, in pixels, how far the ink under each
// gesture's fixed point slid. A lab fix to the orbit is not done until this passes against it.
//
//   node scripts/lab-probe.mjs composition-lab [--tolerance 3] [--no-post] [--url http://…]
//
// Frames land in test-results/lab-probe/<lab>/, which each run empties first. Each frame is also
// posted to the transom wall (zone klieg) unless --no-post. Every run's raw readings land as one
// JSON record in test-results/lab-probe/runs/, which keeps the newest RUNS_KEPT. Exits 1 when any
// drift exceeds the tolerance, 2 when the lab cannot be reached or measured.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, loadavg } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Where each lab draws, and how to bring it to a frame worth measuring. */
const LABS = {
  'composition-lab': {
    port: 5184,
    viewport: '.cl-preview-host',
    // Into the hold, past the entrance, so the word stands still between frames.
    async settle(page) {
      const track = page.locator('[role=slider][aria-label=Position]').locator('..');
      const box = await track.boundingBox();
      if (box) await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
      await page.waitForTimeout(1500);
    },
  },
  'tube-lab': {
    port: 5181,
    viewport: '.panel',
    async settle(page) {
      await page.waitForTimeout(1000);
    },
  },
};

const args = process.argv.slice(2);
const lab = LABS[args[0]];
if (!lab) {
  console.error(
    `usage: lab-probe.mjs <${Object.keys(LABS).join('|')}> [--tolerance px] [--no-post]`,
  );
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const tolerance = Number(flag('--tolerance') ?? 3);
const post = !args.includes('--no-post');
const url = flag('--url') ?? `http://localhost:${lab.port}/`;
const out = path.join(ROOT, 'test-results', 'lab-probe', args[0]);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const runs = path.join(ROOT, 'test-results', 'lab-probe', 'runs');
const RUNS_KEPT = 40;

function git(...cmd) {
  try {
    return execFileSync('git', cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** One run's readings as one record; the oldest beyond RUNS_KEPT are deleted. */
function keep(record) {
  mkdirSync(runs, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, '-');
  writeFileSync(
    path.join(runs, `${stamp}-${args[0]}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  const all = readdirSync(runs)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const f of all.slice(0, Math.max(0, all.length - RUNS_KEPT))) rmSync(path.join(runs, f));
}

const transom = [path.join(homedir(), 'src/transom/bin/transom')].find(existsSync) ?? 'transom';
function wall(file) {
  if (!post) return '';
  // transom prints the wall address on stderr.
  const said = spawnSync(transom, ['post', '--zone', 'klieg', file], { encoding: 'utf8' });
  return (
    `${said.stdout ?? ''}${said.stderr ?? ''}`.match(/wall: (\S+)/)?.[1] ?? '(wall post failed)'
  );
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
try {
  await page.goto(url, { timeout: 10000 });
} catch {
  console.error(`lab-probe: nothing answers at ${url} — start the lab first`);
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(3000);
const box = await page.locator(lab.viewport).first().boundingBox();
if (!box) {
  console.error(`lab-probe: no ${lab.viewport} on the page`);
  await browser.close();
  process.exit(2);
}
const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const side = { x: box.x + box.width * 0.22, y: center.y };
const step = Math.min(box.width, box.height) / 14;

let frames = 0;
async function frame(name) {
  await page.waitForTimeout(500);
  const file = path.join(out, `${String(frames++).padStart(2, '0')}-${name}.png`);
  const png = await page.screenshot({ path: file, clip });
  return { file, png, link: wall(file) };
}

async function drag(from, dx, dy, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

async function home() {
  await page.mouse.dblclick(center.x, center.y);
}

// Template-matches a window of `a` around `at`, scaled by `scale` about `at`, against `b` and returns
// where it best lands relative to `at`. Runs in the page, which already has a PNG decoder.
async function slide(a, b, at, { scale = 1, expect = { dx: 0, dy: 0 } } = {}) {
  const local = { x: at.x - box.x, y: at.y - box.y };
  return page.evaluate(
    async ({ a, b, local, scale, expect }) => {
      const gray = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const { data, width, height } = g.getImageData(0, 0, img.width, img.height);
        const v = new Float32Array(width * height);
        for (let i = 0; i < v.length; i++) v[i] = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
        return { v, width, height, img };
      };
      const before = await gray(a);
      const after = await gray(b);
      const cx = Math.round(local.x);
      const cy = Math.round(local.y);
      const half = Math.min(40, Math.floor(Math.min(before.width, before.height) / 4));
      const reach = Math.min(40, half * 2);
      // The ink's own magnification can differ from the chrome's readout (a face nearer the camera
      // than the plane the zoom is anchored on grows faster), so the scale is searched too.
      const scales =
        scale === 1 ? [1] : Array.from({ length: 31 }, (_, i) => scale * (0.8 + i * 0.02));
      let best = { dx: 0, dy: 0, scale: 1, err: Number.POSITIVE_INFINITY };
      let flat = false;
      for (const k of scales) {
        const c = new OffscreenCanvas(before.width, before.height);
        const g = c.getContext('2d');
        g.translate(local.x, local.y);
        g.scale(k, k);
        g.translate(-local.x, -local.y);
        g.drawImage(before.img, 0, 0);
        const d = g.getImageData(0, 0, before.width, before.height).data;
        const want = (x, y) => {
          const i = (y * before.width + x) * 4;
          return d[i] + d[i + 1] + d[i + 2];
        };
        if (k === scales[0]) {
          let lo = Number.POSITIVE_INFINITY;
          let hi = Number.NEGATIVE_INFINITY;
          for (let y = -half; y < half; y += 2)
            for (let x = -half; x < half; x += 2) {
              const v = want(cx + x, cy + y);
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
          flat = hi - lo < 60;
        }
        for (let dy = expect.dy - reach; dy <= expect.dy + reach; dy++) {
          for (let dx = expect.dx - reach; dx <= expect.dx + reach; dx++) {
            let err = 0;
            for (let y = -half; y < half; y += 2) {
              const ty = cy + y + dy;
              for (let x = -half; x < half; x += 2) {
                const tx = cx + x + dx;
                err +=
                  ty < 0 || ty >= after.height || tx < 0 || tx >= after.width
                    ? 765
                    : Math.abs(want(cx + x, cy + y) - after.v[ty * after.width + tx]);
              }
            }
            if (err < best.err) best = { dx, dy, scale: k, err };
          }
        }
      }
      return { dx: best.dx - expect.dx, dy: best.dy - expect.dy, scale: best.scale, flat };
    },
    { a: a.toString('base64'), b: b.toString('base64'), local, scale, expect },
  );
}

// The lab's klieg instance, where it hands one over: the type point under a client position, with
// how far one pixel spans in the word's layout there. Exact where the pixels are not: bloom draws
// its glow in screen pixels, so it does not grow with a zoom and no image match survives one.
const under = (at) =>
  page.evaluate(({ x, y }) => {
    const k = globalThis.kliegLab;
    const a = k?.pointOn(x, y);
    const r = k?.pointOn(x + 1, y);
    const d = k?.pointOn(x, y + 1);
    if (!a || !r || !d) return null;
    return {
      x: a.inWord.x,
      y: a.inWord.y,
      z: a.z,
      perPxX: Math.hypot(r.inWord.x - a.inWord.x, r.inWord.y - a.inWord.y),
      perPxY: Math.hypot(d.inWord.x - a.inWord.x, d.inWord.y - a.inWord.y),
    };
  }, at);
const exact = await page.evaluate(() => typeof globalThis.kliegLab?.pointOn === 'function');

/** The nearest point to `at` with ink under it, for a check that has to hold a point of the type. */
async function inkNear(at) {
  if (!exact) return at;
  for (let r = 0; r <= 80; r += 2)
    for (let k = 0; k < Math.max(1, r * 3); k++) {
      const t = (k / Math.max(1, r * 3)) * 2 * Math.PI;
      const p = { x: Math.round(at.x + r * Math.cos(t)), y: Math.round(at.y + r * Math.sin(t)) };
      if (await under(p)) return p;
    }
  return null;
}

/**
 * Runs `gesture`, then says how far, in pixels, the ink that was under `at` lands from `landing`,
 * where it should be. `scale` is how much the ink should have grown about `at`, for the image match.
 */
async function held(name, at, gesture, landing = at, scale = 1) {
  const a = await frame(`${name}-before`);
  const was = exact ? await under(at) : null;
  await gesture();
  const b = await frame(`${name}-after`);
  if (!exact) {
    const s = await slide(a.png, b.png, at, {
      scale,
      expect: { dx: Math.round(landing.x - at.x), dy: Math.round(landing.y - at.y) },
    });
    return { a, b, dx: s.dx, dy: s.dy, lost: s.flat, how: 'image' };
  }
  const now = was ? await under(landing) : null;
  const raw = { at, landing, was, now };
  if (!now) return { a, b, dx: 0, dy: 0, lost: true, how: 'pointOn', raw };
  return {
    a,
    b,
    dx: (now.x - was.x) / now.perPxX,
    dy: -(now.y - was.y) / now.perPxY,
    lost: false,
    how: 'pointOn',
    raw,
  };
}

/** The middle of whatever differs from the frame's corner, in page pixels; null on a blank frame. */
const inkMiddle = (png) =>
  page.evaluate(
    async ({ b64, origin }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, img.width, img.height);
      const bg = [
        data[(width * 8 + 8) * 4],
        data[(width * 8 + 8) * 4 + 1],
        data[(width * 8 + 8) * 4 + 2],
      ];
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;
      for (let y = 4; y < height - 4; y++)
        for (let x = 4; x < width - 4; x++) {
          const i = (y * width + x) * 4;
          const d =
            Math.abs(data[i] - bg[0]) +
            Math.abs(data[i + 1] - bg[1]) +
            Math.abs(data[i + 2] - bg[2]);
          if (d < 60) continue;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      if (maxX < 0) return null;
      return { x: origin.x + (minX + maxX) / 2, y: origin.y + (minY + maxY) / 2 };
    },
    { b64: png.toString('base64'), origin: { x: box.x, y: box.y } },
  );

async function wheelAt(at, ticks) {
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(60);
  }
}

// Each check names the point that should stay put through its gesture. A turn pivots on the view
// center, so a check that turns first pans a point of the type there. A check marked `opened` runs
// before the lab settles, at whatever pose it opens on: an entrance can hold the letters far from
// where they rest, and a pivot that only works at rest throws them out of frame there.
const checks = [
  {
    name: 'turn as opened',
    opened: true,
    why: 'a drag at the opening pose turns the ink in place',
    async run() {
      // Hovered in both frames: a panel can draw chrome under the pointer, and ink middle reads it.
      await page.mouse.move(center.x, center.y);
      const a = await frame('opened-before');
      await drag(center, step * 1.5, step * 0.5);
      const b = await frame('opened-after');
      const was = await inkMiddle(a.png);
      const now = await inkMiddle(b.png);
      if (!was || !now) return { a, b, dx: 0, dy: 0, lost: true, how: 'ink middle' };
      return { a, b, dx: now.x - was.x, dy: now.y - was.y, lost: false, how: 'ink middle' };
    },
  },
  {
    name: 'pan',
    why: 'Shift+drag carries the ink with the pointer',
    async run() {
      await home();
      const at = await inkNear(center);
      const by = Math.round(step * 3);
      return held('pan', at, () => drag(at, by, 0, ['Shift']), { x: at.x + by, y: at.y });
    },
  },
  {
    name: 'turn',
    why: 'a drag turns the ink about the view center',
    async run() {
      await home();
      const at = await inkNear(center);
      await drag(at, center.x - at.x, center.y - at.y, ['Shift']);
      return held('turn', center, () => drag(center, step * 1.5, step * 0.5));
    },
  },
  {
    name: 'zoom',
    why: 'the wheel magnifies the ink about the pointer',
    async run() {
      await home();
      const at = await inkNear(side);
      return held('zoom', at, () => wheelAt(at, 4), at, 1.82);
    },
  },
  {
    name: 'turn after zoom',
    why: 'a drag after a zoom still turns the ink about the view center',
    async run() {
      const at = await inkNear(center);
      await drag(at, center.x - at.x, center.y - at.y, ['Shift']);
      return held('zoomed-turn', center, () => drag(center, step * 1.5, step * 0.5));
    },
  },
];

// The matcher against a frame scaled and shifted by known amounts, so a reading can be trusted.
if (args.includes('--selftest')) {
  await lab.settle(page);
  await home();
  const a = await frame('selftest');
  const known = { dx: 5, dy: -3, scale: 1.82 };
  const local = { x: side.x - box.x, y: side.y - box.y };
  const b64 = await page.evaluate(
    async ({ a, local, known }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${a}`;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.fillStyle = '#888';
      g.fillRect(0, 0, img.width, img.height);
      g.translate(local.x + known.dx, local.y + known.dy);
      g.scale(known.scale, known.scale);
      g.translate(-local.x, -local.y);
      g.drawImage(img, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (const x of bytes) bin += String.fromCharCode(x);
      return btoa(bin);
    },
    { a: a.png.toString('base64'), local, known },
  );
  const s = await slide(a.png, Buffer.from(b64, 'base64'), side, { scale: known.scale });
  const good = s.dx === known.dx && s.dy === known.dy && Math.abs(s.scale - known.scale) < 0.011;
  console.log(
    `selftest ${good ? 'ok' : 'FAIL'}: put (${known.dx}, ${known.dy}) ×${known.scale}, read (${s.dx}, ${s.dy}) ×${s.scale.toFixed(2)}`,
  );
  await browser.close();
  process.exit(good ? 0 : 1);
}

let failed = 0;
const record = {
  at: new Date().toISOString(),
  lab: args[0],
  url,
  commit: git('rev-parse', 'HEAD'),
  dirty: Boolean(git('status', '--porcelain')),
  host: hostname(),
  loadavg: loadavg(),
  renderer: 'chromium headless, swiftshader',
  viewport: box,
  tolerance,
  measuredBy: exact ? 'pointOn' : 'image match',
  checks: [],
};
console.log(
  `lab-probe: ${args[0]}, measured by ${exact ? 'pointOn' : 'image match'}, tolerance ${tolerance}px`,
);
let settled = false;
for (const [i, check] of checks.entries()) {
  if (!check.opened && !settled) {
    await home();
    await lab.settle(page);
    settled = true;
  }
  const r = await check.run();
  const drift = Math.hypot(r.dx, r.dy);
  const verdict = r.lost ? 'LOST' : drift > tolerance ? 'FAIL' : 'ok';
  if (verdict !== 'ok') failed++;
  record.checks.push({
    name: check.name,
    verdict,
    how: r.how,
    drift,
    dx: r.dx,
    dy: r.dy,
    ...(r.raw ? { raw: r.raw } : null),
  });
  const f = (v) => v.toFixed(1).padStart(6);
  console.log(
    `${i + 1}/${checks.length} ${verdict.padEnd(4)} ${check.name.padEnd(15)} drift ${f(drift)}px` +
      ` (dx ${f(r.dx)}, dy ${f(r.dy)})  — ${check.why}`,
  );
  if (r.a.link || r.b.link) console.log(`      before ${r.a.link}\n      after  ${r.b.link}`);
}
await browser.close();
keep(record);
console.log(failed ? `lab-probe: ${failed} of ${checks.length} failed` : 'lab-probe: all held');
process.exit(failed ? 1 : 0);
