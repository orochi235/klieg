// Which inner phases survive an intermittent gate, and whether every burst opens on the same one.
//
//   node spikes/intermittent-phase.mjs
//
// The handoff records this as the trap for a general `intermittent(inner)` wrapper: tie the gate's
// period to `inner.duration` off integer ratios and the surviving windows land on the same phases
// every time, so every burst looks identical while the inner never resets. `roving` already
// answers it and says so above its own arithmetic — the PASS is a whole number of inner passes, so
// the seam is continuous, but the EPOCH inside it deliberately is not, so each handover samples
// somewhere new. This checks that the same split works for a spell/calm gate.

/** How many distinct phases the inner is at when each burst opens, over one pass. */
function openings(duration, cycle, innerDuration) {
  const phases = [];
  for (let ms = 0; ms + cycle <= duration + 1e-9; ms += cycle) {
    phases.push(((ms % innerDuration) / innerDuration + 1e-12) % 1);
  }
  return phases;
}

function distinct(phases, buckets = 100) {
  return new Set(phases.map((p) => Math.floor(p * buckets))).size;
}

const INNER = 1400; // one flicker pass
const SPELL = 4000;
const CALM = 15000;
const WANTED_CYCLE = SPELL + CALM;
const TARGET = 60000; // a minute of sign

/** What roving does: the pass is a whole multiple of the inner, the subdivision is not. */
function rovingStyle() {
  const duration = Math.max(1, Math.round(TARGET / INNER)) * INNER;
  const cycles = Math.max(1, Math.round(duration / WANTED_CYCLE));
  return { duration, cycle: duration / cycles, cycles };
}

/** The trap: force the cycle itself onto a whole number of inner passes. */
function resonant() {
  const cycle = Math.max(1, Math.round(WANTED_CYCLE / INNER)) * INNER;
  const cycles = Math.max(1, Math.round(TARGET / cycle));
  return { duration: cycle * cycles, cycle, cycles };
}

/** A gate on its own clock, ignoring the inner entirely. */
function independent() {
  const cycles = Math.max(1, Math.round(TARGET / WANTED_CYCLE));
  return { duration: WANTED_CYCLE * cycles, cycle: WANTED_CYCLE, cycles };
}

const SCHEMES = [
  ['roving-style (pass ties, cycle does not)', rovingStyle()],
  ['resonant (cycle tied to the inner)', resonant()],
  ['independent (gate on its own clock)', independent()],
];

console.log(`inner ${INNER}ms, spell ${SPELL}ms, calm ${CALM}ms, target ${TARGET}ms\n`);

const results = [];
let done = 0;
for (const [name, plan] of SCHEMES) {
  done++;
  const phases = openings(plan.duration, plan.cycle, INNER);
  const uniq = distinct(phases);
  const seamContinuous = Math.abs(plan.duration % INNER) < 1e-6;
  results.push({ name, ...plan, uniq, count: phases.length, seamContinuous });
  console.log(
    `${done}/${SCHEMES.length}  ${name.padEnd(42)} ` +
      `pass ${String(plan.duration).padStart(6)}ms  cycle ${plan.cycle.toFixed(1).padStart(8)}ms  ` +
      `${plan.cycles} bursts  ${String(uniq).padStart(2)} distinct opening phases  ` +
      `seam ${seamContinuous ? 'continuous' : 'JUMPS'}`,
  );
  console.log(`      opens at: ${phases.map((p) => p.toFixed(3)).join(' ')}`);
}

const winner = results.find((r) => r.name.startsWith('roving-style'));
console.log('');
console.log(
  winner.uniq === winner.count && winner.seamContinuous
    ? 'roving-style holds both: every burst opens on a different phase AND the pass seam is\n' +
        'continuous. The handoff treats these as opposed; they are two different periods.'
    : 'roving-style does NOT hold both — the wrapper needs a different split than roving uses.',
);

const bad = results.find((r) => r.name.startsWith('resonant'));
console.log(
  bad.uniq === 1
    ? `the resonant scheme opens all ${bad.count} bursts on phase ${bad.uniq === 1 ? '0.000' : '?'}` +
        ' — the identical-burst failure the handoff describes, reproduced.'
    : `the resonant scheme spreads over ${bad.uniq} phases, so the trap is not where it was recorded.`,
);
