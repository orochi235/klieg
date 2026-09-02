/**
 * The composition lab's tenure readout and `roving`'s own dwell disagree. This separates the two
 * mechanisms behind that, by measuring three quantities for the same composition:
 *
 *   epoch    what `roving` divides the pass into — `dwell` rounded to fit
 *   holder   how long one part actually keeps the fault, observed rather than re-derived
 *   tenure   what the panel prints: the mean unbroken stretch of `PassSamples.moved`
 *
 *   npm run build -w klieg && node spikes/tenure-vs-dwell.mjs
 *   node spikes/tenure-vs-dwell.mjs --text KLIEG --look piping
 *
 * The holder reading comes from a probe piece wrapped as `roving`'s inner: the wrapper calls the
 * inner last with the holder's substituted index, so the last call of a resolve names the holder.
 * Re-deriving `holderOf` here instead would drift from the wrapper it is measuring.
 *
 * The lab's own modules run off their `.ts` sources, with node stripping the types, so an edit to
 * `tenure.ts` shows up here with no build step. Core comes from `dist` instead: `EffectFrame` uses
 * a constructor parameter property, which node's strip-only mode refuses. Build core first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const DIST = resolvePath(ROOT, 'packages/core/dist');
const LAB = resolvePath(ROOT, 'packages/core/dev/composition-lab/src');
const FONT = resolvePath(ROOT, 'apps/lab/public/font.ttf');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

/** A `.js` specifier TypeScript writes for a `.ts` file on disk. */
const retarget = (url) => {
  if (!url.startsWith('file:') || !url.endsWith('.js')) return url;
  const path = fileURLToPath(url);
  if (existsSync(path)) return url;
  const ts = `${path.slice(0, -3)}.ts`;
  return existsSync(ts) ? pathToFileURL(ts).href : url;
};

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@core/')) {
      const path = resolvePath(DIST, spec.slice('@core/'.length));
      return { url: retarget(pathToFileURL(path).href), shortCircuit: true };
    }
    if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) {
      const url = new URL(spec, ctx.parentURL).href;
      const at = retarget(url);
      if (at !== url) return { url: at, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

// `loadFont` fetches, and undici declines `file:`. Serving the bytes here exercises the real
// loader, registration with the layout engine included, which is what `Word` needs to lay out.
const upstream = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (s.startsWith('file:')) {
    const buf = readFileSync(fileURLToPath(s));
    return new Response(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return upstream(url, init);
};

const { EffectFrame, planEffects } = await import('@core/effects/frame.js');
const { roving } = await import('@core/effects/roving.js');
const { chase, flicker, hue } = await import('@core/effects/pieces.js');
const { loadFont } = await import('@core/text/font.js');
const { realPool } = await import(`${pathToFileURL(LAB).href}/pool.ts`);
const { samplePass } = await import(`${pathToFileURL(LAB).href}/sample.ts`);
const { tenureAndJump } = await import(`${pathToFileURL(LAB).href}/tenure.ts`);

const CTX = { pointer: null, pointerInWord: null, dt: 16.7 };
const DWELL = 3200;
const EPOCHS = 96;
const RATES = [600, 1200, 2400, 4800, 9600];

const INNERS = {
  flicker: () => flicker({ duration: 1400, depth: 0, unrest: 0.18 }),
  chase: () => chase({ duration: 2400, laps: 1, spread: 0 }),
  hue: () => hue({ duration: 6000, from: 0, span: 1, spread: 0, luminance: 0.5 }),
};

/** Records who the wrapper handed the inner. The last call of a resolve is the holder: the
 * rest-checks in the holder walk come first, and only then does `at` call for the holder itself. */
function probed(inner) {
  let last = -1;
  return {
    piece: {
      duration: inner.duration,
      at(t, part, ctx) {
        last = part.index;
        return inner.at(t, part, ctx);
      },
    },
    take: () => {
      const was = last;
      last = -1;
      return was;
    },
  };
}

/** Mean unbroken stretch of one part's holding, over a looping pass, in milliseconds. */
function stretches(held, samples, pass) {
  const cuts = [];
  let start = 0;
  for (let i = 1; i < held.length; i++) {
    if (held[i] !== held[i - 1]) {
      cuts.push({ who: held[start], n: i - start });
      start = i;
    }
  }
  cuts.push({ who: held[start], n: held.length - start });
  if (cuts.length > 1 && cuts[0].who === cuts.at(-1).who) {
    const first = cuts.shift();
    cuts.at(-1).n += first.n;
  }
  const mean = cuts.reduce((a, c) => a + c.n, 0) / cuts.length;
  return { meanMs: (mean / samples) * pass, handovers: cuts.length === 1 ? 0 : cuts.length };
}

const text = arg('text', 'ACRONYM');
const look = arg('look', 'tubing');

const font = await loadFont(pathToFileURL(FONT).href);
const parts = realPool(text, font, look);
const runs = parts.filter((p) => p.kind === 'run').length;
console.log(`pool: ${text} on ${look} — ${parts.length} parts, ${runs} runs\n`);

const names = Object.keys(INNERS);
let step = 0;
const total = names.length * RATES.length;

for (const name of names) {
  const inner = INNERS[name]();
  const probe = probed(inner);
  const piece = roving(probe.piece, { dwell: DWELL, seed: 0, epochs: EPOCHS });
  const pass = piece.duration;

  console.log(
    `${name}: inner ${inner.duration}ms, pass ${(pass / 1000).toFixed(1)}s, ` +
      `${piece.epochs} epochs of ${(piece.epoch / 1000).toFixed(2)}s`,
  );

  for (const rate of RATES) {
    step += 1;
    const specs = [{ piece, target: { kind: 'run', by: 'index', amount: 1 }, seed: 0 }];
    const frame = new EffectFrame(planEffects(specs, parts));

    // Sampled twice: once through the probe for the holder, once for the panel's own reading.
    const held = [];
    for (let s = 0; s < rate; s++) {
      probe.take();
      frame.resolve(parts, (s / rate) * pass, CTX);
      held.push(probe.take());
    }
    const holder = stretches(held, rate, pass);
    const began = performance.now();
    const panel = tenureAndJump(samplePass(frame, parts, pass, rate, CTX), parts, pass);
    const spent = performance.now() - began;

    console.log(
      `  ${step}/${total} ${String(rate).padStart(4)} samples ` +
        `${String(Math.round(spent)).padStart(5)}ms  ` +
        `(${((pass / rate) | 0).toString().padStart(4)}ms step)  ` +
        `holder ${(holder.meanMs / 1000).toFixed(2)}s/${String(holder.handovers).padStart(3)}h   ` +
        `panel ${(panel.meanTenureMs / 1000).toFixed(2)}s/${String(panel.handovers).padStart(3)}h`,
    );
  }
  console.log();
}
