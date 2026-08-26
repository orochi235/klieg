// Does a macro spell fold into flicker's own single clock?
// Verbatim from packages/core/src/motion/types.ts — the drop counts below are meaningless without it.
const hash01 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const STEP_MS = 1400 / 24;              // today's step, from the shipped constants
const steps = (d) => Math.max(1, Math.round(d / STEP_MS));

console.log('STEPS derived from duration (must be 24 at the 1400 default):');
for (const d of [1400, 3000, 8000, 15000, 30000]) {
  console.log(`  duration ${String(d).padStart(5)}ms -> ${String(steps(d)).padStart(3)} steps, ${(d/steps(d)).toFixed(1)}ms each`);
}

// macro gate: whole number of spells per pass, one clock, no second period
function build(duration, boutMs, calmMs) {
  const cycle = boutMs + calmMs;
  const cycles = Math.max(1, Math.round(duration / cycle));
  const dur = cycles * cycle;           // duration adjusts, as roving does for epochs
  return { dur, cycles, duty: boutMs / cycle };
}

console.log('\nmacro spell fitted to a whole number of cycles:');
const b = build(60000, 4000, 15000);
console.log(`  asked 60000ms, bout 4000 calm 15000 -> duration ${b.dur}ms, ${b.cycles} spells, duty ${(b.duty*100).toFixed(0)}%`);

// walk it: is the micro flicker preserved inside a spell, and is the calm truly still?
const { dur, duty } = b;
const S = steps(dur);
const unrest = 0.18, depth = 0, BITE = 0.35;
const at = (t, index) => {
  const inSpell = ((t * b.cycles) % 1) < duty;
  if (!inSpell) return 1;
  const step = Math.floor(t * S) % S;
  if (hash01(step + index * 977.3) > unrest) return 1;
  return depth + (1 - depth) * hash01(step * 3.7 + index * 131.1) * BITE;
};

let lit = 0, drops = 0, prev = 1;
const runs = [];
let runStart = 0, runLit = true;
for (let i = 0; i < 4000; i++) {
  const t = i / 4000;
  const g = at(t, 0);
  if (g === 1) lit++; else drops++;
  const nowLit = g === 1;
  if (nowLit !== runLit) { runs.push([runLit, (i - runStart) / 4000 * dur]); runStart = i; runLit = nowLit; }
  prev = g;
}
console.log(`  over one pass: ${(drops/4000*100).toFixed(1)}% of samples are drops`);
console.log(`  longest continuously-lit stretch: ${Math.max(...runs.filter(r=>r[0]).map(r=>r[1])).toFixed(0)}ms  (want ~15000 = the calm)`);
console.log(`  shortest drop: ${Math.min(...runs.filter(r=>!r[0]).map(r=>r[1])).toFixed(0)}ms  (want ~58 = one step)`);

// Why is the shortest drop shorter than one step? The spell gate flips on its own schedule,
// so it can cut a drop step in half.
const stepMs = dur / S;
let truncated = 0, total = 0;
for (let i = 1; i < 200000; i++) {
  const t = i / 200000, tp = (i - 1) / 200000;
  const inNow = ((t * b.cycles) % 1) < duty, inPrev = ((tp * b.cycles) % 1) < duty;
  if (inNow === inPrev) continue;
  total++;
  const stepPhase = (t * S) % 1;                    // where in a step the spell boundary landed
  if (stepPhase > 0.02 && stepPhase < 0.98) truncated++;
}
console.log(`\nspell boundaries landing mid-step: ${truncated}/${total}`);
console.log(`one step is ${stepMs.toFixed(1)}ms; a boundary mid-step can clip a drop to a single frame,`);
console.log(`which flicker's own comment says "reads as noise rather than as a failing tube".`);
