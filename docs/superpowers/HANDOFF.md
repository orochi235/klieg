# Handoff — klieg, 2026-08-28

**For:** the next session picking this up. **Answers:** what is on `main`, what each merged branch
learned that its design doc does not carry, and what is worth doing next.

## Branch state

**Host-driven effects are merged.** `fire()` returns a `FireHandle` and takes `onPhase`,
`dismiss` and `signal`. See the [plan](plans/2026-08-27-host-driven-effects.md) and the
[spec](specs/2026-08-27-host-driven-effects-design.md).

The four places the build departs from the spec are listed at the top of the plan. Two were proven
rather than argued, by reverting them and watching the build break: `FireHandle extends
PromiseLike<void>` fails typecheck at `dev/composition-lab/src/Preview.tsx:30`, which calls
`.catch()` on a fire; and dropping the reduced-motion branch in the tick leaves `active` firing and
`exit` never arriving, because that path pins `elapsed` to the settled pose.

**The premise is now evidence, not assertion.** `spikes/double-dispatch.mjs` was aimed at a control
the lab does not have (`acrostic` is an `<h2>`, not a button); repointed at `#holdClick` + `#fire`
it runs and prints `DOUBLE DISPATCH REPRODUCED` — one press on FIRE both dismisses the held effect
and fires a new one. sherpa reached the same conclusion independently and hard-blocked it: its klieg
provider *throws* on `hold: 'click'` or `stages`.

It still prints that after this branch, which is expected rather than a regression: the spike drives
the lab, and the lab has no control for `dismiss: 'host'`, so it exercises the `'window'` path.
Turning it into an after-check means adding that control beside the lab's `hold click` checkbox.
What proves the fix today is the unit test `attaches no window listeners under dismiss: 'host'`,
verified by mutation.

**sherpa has moved on from the snapshot the spec was written against, and it moved toward this
design.** Re-checked at `main` / `923df22`; the spec's "How sherpa consumes this" section carries
the detail. The short version: sherpa already declares klieg's `PhaseEvent` verbatim and routes it
through `PageContext.phase`, so the shape is not up for negotiation. `goto(offset)` is gone,
replaced by `PageHandle.seek(offset)` — "absolute, idempotent, press-space; never a delta" — so
`advance()` is a different verb and the provider does the translation. The undertaking to give
sherpa an `advance` is still open, and nothing in klieg will remind anyone about it.

`FEATURE-REQUESTS.md` is now committed here; sherpa's `docs/upstream-asks.md` is its mirror and
lists the same three asks. Both can be retired once this ships.

**Watch the worktree.** The main checkout at `~/src/klieg` was switched to another branch by a
concurrent session mid-task during this work. Check `git branch --show-current` before committing
there; untracked files survive a switch, staged work is a different matter.


**Most recent work, 2026-08-27 overnight.** `main` is green at **1179 tests**. Two things landed:
`roving` got a permutation walk and a 96-epoch pass (it was visiting 7 parts of 24 and looping),
and the **composition lab** is built — see its entry under "What is worth doing next", which is now
a description rather than a proposal. Every "main is at `<sha>`, green at N tests" claim further
down predates this and should be read as historical.

**`acronym` shipped.** `acronym(text, opts)` returns the arguments to `fire()` for a block whose
capitals are picked out, held, then gathered into a line once the lower case has left — the
README's hand-assembled acrostic, pre-baked. It needed two additive things: `char` on `LetterInfo`
(optional, because a piece can be sampled with no block behind it) and `Arrangement: 'place'`, which
drops letters without moving or refitting the survivors, so the lower case leaving is its own beat.
`caps` and `body` are `LetterStyle` objects rather than colours because per-letter styling is meant
to grow — a per-letter `look` is the intended growth and does not fit yet, `look` being per-fire and
reaching the material pipeline long before a letter is addressable. See
[the design](specs/2026-08-26-acronym-routine-design.md).

**The `spikes/svg-tube/` standalone bundle shipped** (`360334a`). `bundle.mjs` inlines `art.svg`
as a data URI and refuses an `--out` path inside this repo, because that art is a client mark and
this repo is public; `wallpaper.mjs` resizes the drawing buffer only, so a 4K shot comes off the
lab's own renderer without touching the CSS box. A page-initiated download still only works from
a locally-opened file.


**`composable-lighting` and `flicker-spell` are both merged into `main` and pushed**, along with
`framing-align` (PR #3), `show-fills-its-frame`, and the tube run-budget fix. `main` is `bab480a`,
green at **1114 tests**. The sections below are what those branches learned; treat every claim about
their *status* as historical.

**The corner stage was the next task and it is largely closed — the defect was mostly not one.**
Branch `corner-carry-through`, 1120 tests green, baselines unmoved. What a letter is missing is the
sharp interior apexes, where an arc at the material's minimum bend radius cannot reach the tip; it
scales with tube radius rather than with anything the stage decides. `TubeSpec.rejoin` now offers
four answers to a fillet that cannot rejoin its leg — `drop` (today, and still the default),
`bridge`, `widen`, `relax` — with each one's number in
[the rejoin design](specs/2026-08-26-corner-rejoin-design.md). Read it before reopening this.

Two earlier accounts of the loss were wrong, and re-deriving them costs a session each. It is not
`dropHead`/`dropTail` after `filletAt` returns null: break drops are 0.85 em across A–Z. It is not
`resumeAt` giving up a leg either — it discards 15.80 em, but make it never walk and `W`'s holes do
not move, because what it gives up it replaces with a chord. `spikes/corner-coverage.mjs` is the
measure, and `OUT=page.html` draws where the bare contour actually is.

**The hairpin ships too, in both constructions.** It is a fourth `CornerWeights` weight, and
`TubeSpec.hairpin` picks the shape: `bisector` takes `W` from 17% bare to **0%** and holds the bend
floor, but stands up to 0.29 em proud and worse as the corner sharpens; `uturn` holds a flat 0.13 em
footprint but eats up to `6 rhoMin` of each leg and leaves 2 of 233 runs marginally under the floor.
Opposite costs, so both are knobs rather than a decision. No shipped look sets a hairpin weight, so
baselines are unmoved. `spikes/hairpin-view.mjs` draws them side by side.

**`spikes/svg-tube/` is the lab for all of this.** `npx vite --port 5199` from the repo root, then
`/spikes/svg-tube/`. It reads a **gitignored `art.svg`** from its own directory — bring your own, or
pass `?svg=name.svg`. Drag to pivot, double-click to reset, and the top bar carries every knob
`buildTubeBlueprint` reads. `svg-shapes.mjs` mirrors `text/glyphs.ts`: same y negation, and hole
nesting by containment depth rather than winding, which is what lets it take art from any tool.
One `<path>` is treated as one letter — that is what keeps `runs` and `seed` meaning what they mean
for text, and it is the shape a real feature would take.

**`sign-wrapper` is merged.** Two entry points over `createKlieg` for a **sign** — type standing
in for a page heading, lit once and held until removed. `klieg/sign` exports `sign(anchor, options)`
framework-free; `klieg/element` registers `<klieg-sign>`, which takes the page's own heading as its
content so the word stays readable and in the accessibility tree whether or not anything renders.
`FireOptions.hold` gains `'forever'`, refused alongside `stages`, which it would never advance past.
See [the design](specs/2026-08-26-sign-wrapper-design.md) and [the plan](plans/2026-08-26-sign-wrapper.md).

**This section was wrong for two days, in both directions.** One version said `v0.8.0` was being
held for the branch; 0.8.0 had already been tagged without it on 2026-08-27, by a session that read
this section only as far as the release note. The correction then claimed the branch carried no
code, which stayed here while the branch grew to 4,183 lines across `element.ts`, `sign/`, five
test files and a lab page. **Read a whole section before acting on it, and re-read the branch before
trusting what a section says about it** — that is the failure that produced this paragraph twice.

The [design](specs/2026-08-26-sign-wrapper-design.md) and [plan](plans/2026-08-26-sign-wrapper.md)
are current and carry every decision. Read them rather than this. What follows is only what they
cannot say.

**Done:** `hold: 'forever'` in core; jsdom per-file; `resolveTint`; `sign()`; `<klieg-sign>` with its
attribute layer; the subpath exports and `sideEffects` (Task 8); the standalone bundle (Task 9).
**Left:** a lab page at `/sign/` (Task 10), the playwright spec (Task 11), README and CHANGELOG
(Task 12).

**`SignOptions.lighting` is `LightingSlot`**, widened when `main` merged in. Reduced motion still
replaces the whole slot with `'static'`, which is `still()` on the composable surface — the sign is
shown and only what moves is stilled.

**`hold: 'forever'` routes to `Timeline`'s `'until-release'` and attaches none of the dismiss
listeners `'click'` attaches.** That difference is the whole feature, and the three sites that read
`hold` use `typeof hold === 'number' ? … : …` rather than a cast so a fourth string cannot fail open.
`fire()` refuses `'forever'` with `stages`: `Sequence.tick` advances on `timeline.isFinished()`,
never true at `Infinity`, so a stage would silently never come.

**It was cut *after* `framing.align` landed and already accounts for it** — the design's complaint
that the portfolio masthead "compensates for centring in CSS" is answered by `align` defaulting to
`'start'` under an element placement, which the design passes through rather than re-solving.

**Three element behaviors are deliberate and undocumented until Task 12.** Removing an attribute
actively *unsets* its setting: the element keeps a ledger of the keys it last sent and patches a
dropped one back to `undefined`, so `toggleAttribute('bloom')` really does turn bloom off rather than
leaving the old value lit. The `look` *property* beats the `look` attribute, so a page driving both
sees the attribute change re-fire with the property's value. And `bloom="false"` means off while any
other value means on — an invented convention, kept because `bloom="${on}"` stringifies to `"false"`
and nothing else could express off.

**`align` is validated in the element; `lighting` deliberately is not.** An unknown align is silently
*wrong* — `edgeFor` resolves it to the right edge in an ltr document rather than the `start` default.
An unknown lighting throws and surfaces as a `console.warn`. Validate where garbage is silently
wrong, pass through where it fails loudly.

**A vitest defect shapes the element tests.** The second of two *concurrent* `import()` calls of a
`vi.mock`'d module never settles, and worse, falls through the mock into the real module graph — which
produced an intermittent `EnvironmentTeardownError` blamed on `element.test.ts`. Mount elements
sequentially, or in the same task only when no dynamic import can start (the `readyState: 'loading'`
trick in the stylesheet test). Do not "simplify" those tests back into one `innerHTML`.

**`document.head` is not reset between tests.** `beforeEach` clears it explicitly; without that the
stylesheet idempotence guard short-circuits and both stylesheet tests silently assert nothing.

**`flicker-spell` — three tasks, merged.** `flicker` gained `spell` and `calm`, and its step count
is derived from the pass rather than fixed at 24. See
[the plan](plans/2026-08-26-flicker-macro-spell.md).

**What the two review gates found, and it is the same lesson twice.** Both were tests that pass
against the defect they name. The design's central claim — that folding the gate into `flicker`
rather than wrapping it means every bout samples a different stretch of the hash — had **no test at
all**: restarting the step index per bout leaves the duration, the calm length and the drop length
all correct, so nothing in a 983-test suite could see it. And the test written to close that gap
sampled at exactly three per step, landing every third sample on a step edge where float residue
alone made byte-identical bouts compare unequal — so it passed against the very defect it named.
Fixed at 2937 samples, filtered to the drops that carry information, with a floor so it cannot pass
vacuously.

**A calm alone used to invent a spell.** `Math.max(1, round(spell / STEP_MS))` conjured a one-step
bout for a caller who named none, so `flicker({ calm: 15000 })` returned a 15050ms pass — ten times
the default — in which eleven of twelve tubes never dropped once. `spell: NaN` poisoned every gain
for the life of the piece by the same route. Both closed by requiring each step count above zero.

**The last four commits had no independent reviewer.** Five consecutive API 529s made dispatching
unreliable, so the coordinator applied the review's fixes and wrote Task 3's prose itself. The
mechanical half was still done, and mutation results do not care who runs them: `STEP_MS = 1400/25`
now turns three tests red including the newly-pinned one, which stayed green before the pin; the
pre-fix gate turns two red at `expected 15050 to be 1400`; `stepsFor(duration)` equals
`cycles * cycleSteps` across 240 gated combinations with no mismatch; and every CHANGELOG figure was
recomputed. **What has had no second pair of eyes is the prose and the shape of the fix** — whether
`finiteMs` is the right seam, whether the CHANGELOG reads well to someone deciding to upgrade.

**One hole the self-check found and closed.** `calm: Infinity` engaged the gate and returned an
infinite pass in which the tube never flickered; `spell: Infinity` took every gain to NaN. Both
fields are new here, so both holes were. `finiteMs` reads a non-finite scale as absent, matching the
guards `track`'s `followMs` and `lamp`'s falloff already carry. `duration: NaN` still poisons, as it
did before this branch — house style in this struct, and left alone.

**Two things left undecided, both cheap and both pre-release.** A reviewer argued `spell` should be
`bout`, since every piece of prose calls it a bout and only the API calls it a spell — kept as
`spell` because that is the name the original ask used, and free to change until this ships. And
`roving(flicker({ spell, calm }))` now nests two quiet effects: `roving`'s epoch floor means its
duration equals the inner pass for any inner over ~17s, so one afflicted tube resting 95% of the
time means nothing in the sign flickers for 15 of every 19 seconds. Legitimate, but not what
"one bad tube that jumps every few seconds" prepares a reader for.

**`composable-lighting` — nine tasks, merged.** Every task passed both gates — spec compliance clean on the first pass, code quality after one fix
round each. Task 1 (`9425be1`, `e637b33`) added the additive `light` channel on `PartOffset` and
summed it in the effects compositor. Task 2 (`13d1c62`, `4a61f72`) added the four light sources —
`fixed`, `fromPointer`, `orbit`, `along` — in the new `effects/lamp.ts`, plus `FrameCtx`. Task 3
(`36511b9`, `7dadd2d`, `1a59f88`, `822afe4`) added the `lamp()` piece, gave `EffectPiece.at` a
required `ctx`, and moved `FrameCtx` into `effects/types.ts`. Task 4 (`61cbfb0`, `0e6f9a0`,
`ee63418`) exported `lightBase`, the emissive and hue a lamp resolves against. Task 5 (`a39aaed`,
`03f59d4`, `789d83b`) landed `litEmissive` and wrote the light onto both a body's emissive and a
run's colour buffer, threaded the `ctx`, and added `partExtent()`. Task 6 (`b883659`, `295bce7`,
`f3d4f5e`) added `EnvPiece`, `mergeEnv` and the `sweep`/`still`/`track` factories. Task 7
(`8a778f9`, `3b69ca8`, `6d3b3d3`, `ad60629`, `5589976`) made `lighting` a slot, built the per-frame
`FrameCtx`, and moved the pointer arithmetic into a new pure `src/pointer.ts`. Task 8 (`4a68519`,
`9bc93a1`, `c50c5b1`, `88aeb0c`) exported the surface, retired `envRotation` and `PointerLight`, and
wrote the CHANGELOG and README. Task 9 (`369b328`, `116fa4f`, `785a475`, `cfbf02b`, `0a4fbd8`) is
the render proof. `npm run check` is green at **1100 tests**, up from 977 at the branch point.

**Task 9 proved it reaches the screen.** `spikes/lamp-proof.mjs` drives a real page for 49 shots and
8 contact sheets: **the lamp reads on all six looks, including `tubing` on `{ kind: 'run' }`**, so the
vertex-buffer path is live and this is not another `gain`. The light channel sums in sRGB as Task 5
labelled it, verified byte-exactly by the one comparison that can tell — a mid-grey lamp at full
strength against a white one at `128/255`, which are the same float and must render identically.
Results and every open question it settled are in
[the findings note](specs/2026-08-25-material-lighting-findings.md), sections 9-13.

**Two things the render proof does not cover.** There is no per-frame cost anywhere in it —
SwiftShader flattens it, so the plan's worry that a lamp on `by: 'all'` re-uploads every run's
vertex buffer each frame is still unmeasured. And every shot is a single-line sign, so `part.y` is 0
on every part in all 49: the y-axis convention Task 7 fixed (`clientY` grows down, layout y grows
up — `effects/types.ts:72-75`) is exercised by no pixel on this branch. The script now asserts that
the light's x centroid rises with the cursor rather than merely differing; the vertical half of that
check wants a multi-line sign, which nothing renders yet.

**The whole-branch review has now run, and its six findings are fixed.** Every one of the nine tasks
passed a spec-compliance review and a code-quality review, so the gap was the seams *between* them;
that pass found no incorrect condition, off-by-one or dropped guard in the new arithmetic. What it
did find: the pointer's canvas box was measured every frame of every sign once the cursor had moved
anywhere on the page, whether or not any piece read it — `FrameCtx.pointer` and `pointerInWord` are
lazy getters now, resolved once a frame and only when something asks. A lamp on a run took its hue
from the colour the run was *built* with rather than the one it is showing, so a `hue` piece and a
lamp on one tube drifted into two colours. `LightPose.direction` was public, documented and read by
nothing, and is gone. `sweep`'s spec is a named, exported `SweepSpec` like its siblings. The rest
were doc fixes, below.
Three findings from Task 9's gate are recorded and deliberately unfixed.

The execution method was subagent-driven — one implementer per task, then a spec-compliance review,
then a code-quality review. Read the plan rather than the design doc: review rounds amended Tasks 5,
7, 8 and 9, and the design predates all of it.

**The lesson of the whole branch: a proof script can reproduce the defect it was written to catch.**
Task 9's first version drew a cursor crosshair into the same clip it md5'd, so four pointer checks
compared frames differing only by where the crosshair sat. Two frames in which the lamp contributed
*nothing* — `lit=0` on both — hashed differently and were reported as `reads`, on `fromPointer`, the
headline source. With the crosshair moved out of the hashed clip those frames collapse to
byte-identical with the unlit frame. **Anything drawn for a human to look at must sit outside
anything a machine compares.**

**Two doc claims the review falsified.** The layering example `['sweep', sweep({ periodMs: 1000 })]`
was described as turning two periods at once. It cannot: both pieces write only `yaw`, `mergeEnv`
sums them, and the result is one uniform turn at the summed rate — 772.7ms, measured, with no seam,
since each piece's wrap is exactly 2pi. Layered env pieces add per axis, so a reader who wants two
layers they can tell apart has to write different axes. And the `lamp` reference documented the
pointer compression but not `stages`: a lamp lights by position against a pool frozen at
construction, so a regroup leaves the light where the letters used to be. Both now say so.

**Three findings the renders settled, recorded and unfixed.** A cursor anywhere on a **regrouped**
sign lights nothing: the part pool is frozen at construction, so the light lives where the letters
used to be, and only a cursor past the right edge lights a centred `NOW`. A lamp on a
`mode: 'replace'` **gradient** is a total no-op — that shader branch never reads the attribute a lamp
writes — and `hue` rendered as a control is equally dead, so it is pre-existing and not lamp-specific.
And the pointer mapping compresses the cursor's whole travel onto the ink, so the light **leads the
cursor at one end of the sign and lags it at the other** — §9 measures both ends on two framings, and
the README now describes that shape instead of promising a match.

**`orbit`'s default moved 2 → 0.3, and the first justification for it was wrong.** Its table was
sampled at an uncontrolled phase. §12 of the findings note carries the eight-phase replacement, the
two claims of `369b328` it falsifies, and why 0.3 rather than 0.4; the move stands.

**What Task 8 learned: verify your own prose against the built package.** Two claims written in this
task were false and both were caught by a throwaway script that imported `dist` and asserted each
sentence. `duration` is read by `orbit` and `along` only — `fixed` ignores `t` exactly as
`fromPointer` does, and `LampSpec`'s own doc named just one of the two, which is how the wrong
sentence got written. And `lamp({ source: orbit() })` **on bare defaults lights nothing at all**:
`orbit` sits at 2 em, a lamp reaches 0.5 em, and a short sign's parts live inside 1.3 em. Not a
ratio problem — the same 4:1 works at a larger scale. Task 9 renders it and decides whether the
default moves; it has never shipped, so it is free to change now and a breaking change later.

**Two things Task 2 learned that the plan did not say.** The plan's supplied tests are vacuous on
the two things worth testing. `along` is only exercised on a 2-point path, where `last === 1` so the
segment index is always 0 — an `along` that ignored every interior point and lerped first-to-last
passes every assertion the plan gives. `orbit` is only called with its centre defaulted to the
origin, so a transposed `cx`/`cy` passes too. Both gaps were closed in the review round and both new
tests were confirmed red against the defect they target; the suite is 9, not the 7 the plan writes
out. **Assume the same of tasks 3-8** — the plan's test bodies are a floor, and the parameter a test
leaves at its default is the one the implementation gets wrong for free.

**`FrameCtx` moved to `effects/types.ts`, and the plan is amended to match.** The plan's file table
put it in `render/lighting.ts`. Task 3 is the step that would have made `effects/types.ts` — the
module every effects consumer imports — depend on `render/lighting.ts`, whose other export is
`PointerLight`, a class that attaches DOM `pointermove` listeners. `FrameCtx` is a pure data shape
with nothing rendering-specific in it, so it went to `effects/types.ts` alongside `PartInfo` and
`EffectPiece`, and `effects/` now imports nothing from `render/`. Task 6 imports it back when
`EnvPiece` needs it. The plan carries an amendment note under Task 2; read every
`from '../render/lighting.js'` in Task 2's step text as `from './types.js'`.

**Both suites are timing-fragile, and the load numbers this doc used to carry were noise.**

The fragility is bare sleeps. `visual.spec.ts` still has four `page.waitForTimeout` calls (200, 200,
500 and 3000ms) standing in for a condition; a fixed sleep cannot stretch for a slow machine, where
the `expect.poll` assertions elsewhere in the file wait up to `CANVAS_TIMEOUT_MS` /
`LAYER_TIMEOUT_MS` (15s each). Converting the remaining four is the fix.

`vitest.config.ts` sets no `testTimeout`, so the 5s default covers whatever pulls three.js through a cold Vite transform via a dynamic `import('../../src/index.js')` — which is
`effects/pieces.test.ts` (twice) and `render/tube/stages.test.ts`, **not** `motion/enter` or
`motion/exit`, which this doc named for months and which contain no dynamic import at all.

**Do not use a load average to decide whether a failure is real.** This doc previously carried three
thresholds — 12, 97 and 134 — each with a failure count attached. They were single observations of a
nondeterministic thing, they disagree with each other, and the full Playwright suite has since
passed 40/40 at load average 70. Re-run instead, or better, time the operation: `--repeat-each=3
--workers=1` separates cold start from behaviour, and red-then-green-then-green is cold start.

**Three things Task 3 learned, and the first two are about the plan itself.** The plan's `lamp` test
asserted `.light?.amount` where the plan's own literal code returns a shared `REST` — so the spec
could not pass itself. Both are corrected in the plan now; the test gained `?? 0`, matching the
idiom its own fourth case already used. And **"a third parameter is additive" is true of
implementations and false of callers**: `word.ts` and `roving.ts` both call `.at(t, part)` and both
broke the moment `ctx` was required. Do not resolve that by making `ctx` optional — a lamp reached
without a ctx would silently emit nothing, which is this design's own defect class one level up.
`word.ts` passes an explicit placeholder until Task 5 threads the real one, and biome's
`noUnusedVariables` makes forgetting it loud.

**`roving(lamp(...))` does not work, and it is structural.** `holderOf` substitutes `part.index` but
keeps the calling part's `x`/`y`, so `roving`'s holder walk assumes the inner keys off index. `lamp`
reads position. Measured: order-dependent between iteration directions, nothing lit across 16 frames
of a pointer sweep at a narrow radius, and the fault pinned to one part forever at a wide one — at a
wide radius the lamp never rests, so no handover ever defers. Documented on `roving` rather than
fixed, because the honest answer is that a position-dependent piece is not a valid inner. **Task 8
should not export both without that line.**

**A red-then-green claim can be red for the wrong reason.** `roving` forwards `ctx` at two call
sites; a test covered one, and the reported verification mutated only the covered one. Mutating the
other left the suite green. When a review fix claims mutation evidence, mutate the exact `file:line`
the finding names and check each site separately.

**Green units still mean nothing here.** Tasks 1-8 are all pure functions and all unit-testable, and
none of them can show that light reaches the screen. That is Task 9's whole job, and it is the
defect this design exists to fix — `gain` ran, merged, wrote to the material, and changed no pixels.


**`selectable-text` is merged into `main`.** It implements
[the design](specs/2026-08-25-selectable-text-design.md) in full — one `FireOptions.selectable` of
`'hidden' | 'layer' | 'none'`, defaulting to `'hidden'`. Nothing is outstanding on it.

Three things it knows that the design doc does not:

**The Playwright suite is the only evidence any of this works.** The unit harness stubs
`Stage.mount`, so `stage.textLayer` is never set and no unit test has ever seen one of these DOM
nodes exist. Every defect below was found by `npm run test:visual` and none by the 977 unit tests.
Treat a green `npm run check` as meaning nothing here.

**Three of the browser tests were rewritten because they were vacuous.** `document.body.innerText`
contains the lab's own `#log`, which prints `fire "BIG"` — so the obvious `'hidden'` and `'none'`
assertions pass with the feature deleted. The alignment test now reads the drawing buffer's alpha
bounding box and compares span boxes to rendered pixels, because loose viewport fractions passed
with the layer 80px off its glyphs. Span centres agree with ink centres within ~3px.

## Two consumer defects, found from outside, both fixed

Reported by the portfolio session, which builds the michaelbaker.tech masthead against published
klieg. Both shipped in 0.6.0; both are fixed on `main` and independently re-verified by the reporter
against a build of `08316c7`. Kept here because each has a trap that outlives the fix.

**`tint` never reached `tubing`.** The tint went to the decoration material's colour channel, and
`tintByRunColor` sets that channel to white so a run's per-vertex colour multiplies out exactly —
so the tint was gone before the first frame. It now recolours the palette the runs are dealt from,
which is where a tube look's colour actually lives, so it survives by construction rather than by
call order and composes with the effects compositor instead of racing it.

*Not replace-versus-modulate,* which is how the question first arrived. No shipped look sets
`surfaceColors` and both tube looks carry a single-colour palette, so there was no per-surface
shading for `modulate` to protect — it would only have returned a dimmer tint than was asked for.
Checking that collapsed the decision.

**The tint's value does not survive to the screen, and its hue does.** The palette entry is exactly
the tint; the pixels are that through the look's emissive gain and then bloom — a bloomed tube
measures `#5BFDFD` at the blown core and `#227787` along the run for a `0x22d3ee` tint. Do not write
a test, or a doc line, asserting a literal pixel value.

**`LookParams` collapsed to `{}` for any TypeScript consumer.** `looks.d.ts` emitted `LookKey` as a
live `Extract<keyof THREE.MeshPhysicalMaterial, …>`, so the *consumer* re-evaluated it; three ships
no `types` condition in its exports map, so without `@types/three` it resolved to nothing, `keyof`
collapsed, and every material property vanished from `LookSpec`. It ships as a literal union now,
with the `Extract` kept as a repo-side assertion — that check only ever worked where `@types/three`
is installed, which is here and never in a consumer's build. `@types/three` is also an optional peer
dependency.

**A consumer repro that does not assign into a typed position proves nothing.** `const x = { ...look,
emissive: 1 }` typechecks against the *broken* package: excess-property checking only fires on
assignment to a typed target. The first repro written for this passed on 0.6.0 and would have
"verified" a non-fix.

**`spikes/tint-matrix.mjs` is the guard.** It renders every look with and without a tint and compares
md5s — a tint that never reaches the GPU leaves the image byte-identical — and exits non-zero when
any look ignores its tint. It holds the *untinted* renders fixed at the same time, which is what
catches a fix that recolours a look generally rather than only when tinted. `spikes/tint-matrix-0.6.0.md5`
carries the published-0.6.0 hashes as a fixed point; the PNGs are gitignored because the registry
artifact is immutable and the script regenerates them exactly.

## State

**0.8.0 is published and is `latest`**, carrying the `lamp`/`EnvPiece` lighting surface,
`framing.align`, `flicker`'s `spell` and `calm`, `lineAlign`, the `acronym` routine, and per-look
`envMapIntensity` over a warm-balanced studio. Releases are automatic: push a `v*` tag and
`release.yml` publishes through npm trusted publishing, checking first that the tag matches
`packages/core/package.json` and skipping a version already on the registry. `npm view` reports a
stale version straight after a publish — read `https://registry.npmjs.org/klieg` to see what
actually landed.

**`main` is pushed and clean at `9e0ecd8`**, green at 1144 unit tests and 33 visual. `## Unreleased`
is empty — the next change opens it again.

**`main` carries the tube lab, the tube geometry rewrite, the colour gradients, the junction
reconciliation, direct paths by default, element-anchored placement and the effects pipeline, all
merged.** On `main`, `npm run check` is green at **1110 tests across 55 files** and
`npx playwright test` at **33 across 2 files**, both measured at `8c4758e`.
Every count in this doc is measured, not carried over — it has twice claimed a playwright number
one higher than `--list` reports.

**`enter pieces > every piece is finite everywhere` flaked once** in a full `npm test` at `d15979c`
and passed alone and on the next full run. Order-dependent or seeded; not chased.

**A wide anchor takes a longer lens.** An element placement lifts `FIT_CAP` so the word fills its
anchor, and against a masthead strip that put the outer glyphs past 70 degrees off-axis — far enough
that an extruded letter's side wall projects across its neighbour and the word reads as one merged
mass. `lensFor` in `render/stage.ts` grows `z` until the frustum edge falls within
`MAX_HALF_ANGLE_DEG` (35) and narrows `fov` to hold the frustum height at the word's depth, so every
framing fraction keeps its meaning and the type keeps its on-screen size. A box already inside that
angle keeps the base lens exactly, so a fullscreen overlay is byte-identical and no baseline moved.
Shipped in 0.6.0.

**`framing` does nothing a fullscreen overlay has not already hit `FIT_CAP` on.** The fit takes the
smaller of the two budget axes and the cap, and `FIT_CAP` (2.2) is what binds for a short word — so
raising `framing` on a fullscreen placement changes nothing, silently. Only `placement: element`
lifts the cap (`viewportBudget` in `render/stage.ts`). The show page was fullscreen over a
`inset: 0` stage and rendered `klieg` at 46% of viewport width against a 0.84 budget; anchored to
that same stage it renders at 77%, bound by the framing at last.

**[Direct tube paths](specs/2026-08-20-direct-tube-paths-design.md) ships, and is the default.**
`TubeSpec.pathSource` (`field` | `exact` | `direct`) defaults to `direct`, which traces the glyph's
own contour rather than rasterising it to a grid — accurate, and ~95x faster to build. The tube
lab's rail still switches it. The remaining bend-minimum failures are below.

**A run's colour now renders.** `assign` had always set `run.color` and nothing ever read it —
`word.ts` gave every lit run one shared material, and both looks hid it by setting `colors` to the
value the material already carried. The sweep writes a per-vertex `runColor` attribute and
`tint.ts` patches the look's own channel from it: emissive for `tubing`, base colour for `piping`,
since three's `vertexColors` only reaches diffuse. `TubeSpec.surfaceColors` is new public API, a
palette per surface. All 24 baselines pass unchanged, which is the claim that published looks did
not move.

**`TubeSpec.gradient` ships.** A colour sweep with six domains, in `replace` or `modulate`; the
[design](specs/2026-08-20-colour-gradients-design.md) has the domain table. Neither shipped look
sets it, so every run is still flat and all 24 baselines are unmoved. A domain is evaluated wherever
its context already lives: `runIndex` and `surface` resolve in `assign` into `run.color`, touching
neither geometry nor shader; `run` and `letter` write a `gradientT` attribute in `sweep.ts`; `axis`
and `radial` are computed in the vertex shader. All six read one ramp texture, which the `Word` owns
and disposes — `material.dispose()` cannot reach a texture that lives only in a uniform
`onBeforeCompile` added. `spikes/gradient-presets.mjs` draws every preset as an SVG page, and stops
get tuned there before a look changes. With bloom on the glow fills a dim run end, so the
`electrode` preset reads close to flat at panel size; that is the interaction, not the ramp.

The geometry model is in `docs/superpowers/specs/2026-08-19-tube-geometry-design.md`, and its
`## Acceptance, as measured` section has the numbers. In short: the tube holds one diameter, corners
are classified by bend radius and filleted with a tangent arc at the material's minimum, run ends are
sealed, a corner can carry the tube past the light unlit rather than cutting it, and the loop
strategy is gone. One run of 225 on `tubing` and one of 49 on `piping` still bend tighter than
their look's minimum, against every `piping` run clamped before.

**A limb rim ships.** `rim`, 0..1 on a tube decoration's material spec, scales the emissive by
`1 - rim * ndv` over that profile's own mean `1 - rim * pi/4`, so a run reads as a cylinder rather
than a flat ribbon while the tube's width still averages to the emissive the look asked for. Without
the mean the rim sinks all of `tubing` under the bloom threshold. No shipped look sets it; absent or
0 emits the GLSL that shipped byte for byte. The tube lab's rail has the knob.

**The lab runs on labkit now**, which owns the tiling: `WorkspaceGrid` gives it a windease grid with
draggable seams and drag-to-reorder, and klieg's own split tree and direct windease dependency are
gone. The renderer is unchanged — sixteen panels, one WebGL context, a scissor rect each — but the
rects are measured from the tiles rather than read from placements.

**`@weasel-js/labkit` comes from the registry at `^1.0.4`**, which is where the windease tiling
shipped. The `file:` dependency on `~/src/weasel/packages/labkit` is gone, and with it the lab's
vite config: `fs.allow` and the react/react-dom aliases existed only because a linked package
resolves React out of its own tree, which is an "invalid hook call" from inside labkit. `npm
install` here no longer needs a weasel checkout.

**A second lab, `npm run dev:kliegsminister -w klieg`, is where corner work happens now.** It is a
labkit instrument: pick a letter, look and path source, step through that letter's hard corners, and
switch what the corner draws — `built` (what ships), `merge` (leave the path alone), `relax` (push
the vertices out until they clear), `biarc`, `cut`. It reports the glyph's own bend, how far under
the floor it is, the junction chord and radius, and a radius profile either side, all against the
floor circle at true scale. Two static spikes are frozen versions of it and can go once it grows:
`junction-repair.mjs` and `fillet-view.mjs`.

**The corner lab has an ink key now, and labkit is not getting one.** `FloatingPanel` and `Legend`
were **deferred upstream**, so [the legend plan](plans/2026-08-23-corner-lab-legend.md) cannot be run
as written: labkit 1.2.0 published without them, and windease's `floatingStrategy` is built in source
but never released — the registry is at 1.2.1. klieg grew its own `LegendPanel.tsx` instead, static
rather than draggable, with `LegendEntry` declared locally. The plan's header records which of its
tasks are void, so the upstream chain does not need walking again.

`legend.ts` holds the ink table and the key together, and a test asserts every drawn ink has an
entry. It earned itself on the first run: the lab had gained a ninth ink, `frame`, after the plan was
written, and the drift check caught the missing entry.

**labkit 1.1 fixed every gap the corner lab reported**, so the workarounds are gone: `render()` is
now an overlay beside the canvas rather than an alternative to it, layers draw in world coordinates
with the camera already applied, a typed instrument no longer needs a cast, and `styles.css` carries
the host reset its own sizing assumes. 1.1 also renames a lab's tile from workspace to trial, which
is why the tube lab draws `<Workspace>` and styles `.lk-trial-tile`. Two gaps remain open in
`~/src/weasel/packages/labkit/docs/IDEAS.md`, uncommitted: `initialView.pan` is a screen offset an
instrument cannot know, so centring leaks back into the layer.

Run it with `npm run dev:tube-lab -w klieg` — sixteen panels on one WebGL context, one letter
each, `beauty` / `skeleton` / `ramp`, with a rail that tunes the whole `TubeSpec`. Every control
carries a hover hint saying what it does and what it interacts with badly, which is the fastest way
back into the model. Sliders that mark a real boundary have a stop the drag catches.

**Some rail controls are honest about very little, and the hints say so.** `runs` is a request
pinned between the corner count below and `minRun` above — at `bend` 4 it is pinned across its whole
range. `wall depth` and `wall rise` do nothing under either shipped look, both being front-only, and
the `surface` gradient domain is inert for the same reason. A positional gradient's bounds are per
`Word`, and every panel is its own one-letter word, so an `axis` sweep restarts in each panel rather
than running across the grid. `spikes/slider-sensitivity.mjs` sweeps every field and counts distinct
outputs; use it before believing a control does what its name says.

The spikes are the fast way back into any of it: `bend-acceptance.mjs` is the invariant across the
alphabet, `where-under-bend.mjs <look> <letters>` says whether a bad bend is inside a fillet, at a
join, or on plain path, `run-vertices.mjs` dumps one run, `corner-width.mjs` measures corner
stretches against a synthetic control, and `fillet-view.mjs` draws the corner stage's decisions as an
SVG page. For the path source work: `join-geometry.mjs` dumps a failing run per vertex,
`source-shootout.mjs` is the acceptance across all three sources, and `run-decomposition.mjs` shows
how the source changes the cut. The spec lists the rest.

**`crawl` shipped, and the design was wrong twice.** A `chase` piece drives it and the offset reaches
the shader as a per-vertex float beside `gradientT`, not as the uniform the design specified — a
uniform is per-material and every lit run of a letter shares one, so a per-part crawl cannot be one.
And the ramp is `ClampToEdgeWrapping` with the shader clamping, so the design's crawl would have
pinned a run to the ramp's last colour within half a cycle and stayed there. It wraps with `fract`,
**conditional on a non-zero crawl**: a run's last vertex sits at `gradientT` 1.0 exactly and
`fract(1.0)` is 0.0, so wrapping unconditionally snaps every ramp's end to its start and moves every
baseline. Both faults came out of running it; neither was visible in the prose.

**Crawl is inert on both shipped looks**, which declare no `gradient`. No visual baseline can show it
working — it needs a caller-supplied `TubeSpec.gradient`.

## What is worth doing next

Roughly in order of value; the items are independent of each other.

- ~~**Selectable text**~~ — built and merged into `main`.

- **Composable lighting is merged.** `LightingSlot` is on `main`; `PointerLight` and
  `slotDrivesEnv` are gone and the `aimAt` viewport bug with them.

  **Two spikes are the evidence, and they re-run.** `spikes/lamp-falloff.mjs` proves
  `PartOffset.gain` is a byte-identical no-op on seven of eight looks; `spikes/lamp-blend.mjs`
  compares five ways to combine a lamp with the material under it. Both compare lamp-on and lamp-off
  renders by md5, which is the only thing that caught the no-op — the effect ran, the compositor
  merged, the material was written, and the image did not change.

- **The rendered word does not register against the text it stands in for. Asked for directly.**
  Two settings, one theme: klieg replaces real DOM text and does not currently agree with it.

  **Both alignment halves shipped.** `framing.align` places the block, measured against the painted
  edge (bevel included), at whatever size the framing fractions chose; an anchored word defaults to
  the page's text edge. `lineAlign` ranges the lines inside it. Both are `Align`
  (`'start' | 'center' | 'end'`), and the `selectable` layer follows for free — `projectLetters`
  reads the placement `placeBlock` already shifted.

  **`lineAlign` now defaults to `'start'`** (`2491378`, unreleased in 0.10.0), because centred lines
  scatter an acrostic's initials across as many x positions as there are lines. A single-line word
  does not move — ranging it and then re-centring the block lands where centring does — so all 40
  Playwright baselines passed unchanged, and no image baseline covers a multi-line block's
  horizontal placement. The stage and placement unit tests are the guard.

  **`apps/lab` now decodes a missing `lines` to `'start'` too**, so a lab link and a bare `fire()`
  of the same text agree. A multi-line link written before this re-ranges its lines; single-line
  links do not move. The encoder is symmetric off `resolveConfig({})`, so `ln=center` is now the
  thing written out and `ln=start` the thing omitted.

  **The neon does not render smaller than the fallback, and the trim knob would be the wrong fix.**
  Measured by `node spikes/fallback-gap.mjs`, which fires into an anchor beside the heading it
  replaces and compares painted ink to painted ink. Across three framings and four strings the neon
  came out **larger** every time — ×1.25 at the default framing, ×2.11 at the reporter's 0.78×0.55.

  What actually drives it is the string, not a missing constant. Holding the anchor and the
  fallback fixed and growing the name, the neon's ink falls 47 → 47 → 27 → 25 → 15 px while the
  fallback holds at 21: short names are **height-bound** and clamp at exactly the height budget
  (0.55 × 86 = 47), long ones go **width-bound** and lose height per letter added. It passes under
  the fallback at 23 characters. A sign fits its box; a fallback keeps its CSS size — so any single
  scale trim is correct at one name length and wrong at every other, which is why the knob this
  entry used to propose should not be built. **`framing.width` is the size lever for a width-bound
  anchor**, and `align` is the position lever; the original report conflated them.

  Two traps the instrument hit first, both of which reported the gap backwards. Ink is
  `alpha >= 128`, not `alpha > 0` — a lit tube lays a faint glow over the whole anchor (13,477
  pixels under alpha 32 against 3,200 over 224), so counting every non-transparent pixel measures
  the light and reports the word as tall as its box. And the strip lab's FIRE button fires the
  literal `'klieg'` whatever the heading says, so driving it measures one word against four
  fallbacks; the spike carries its own fixture under `spikes/fallback-gap/` for that reason.

- **A macro spell for `flicker` is built** — `FlickerSpec.spell` and `.calm` in
  `effects/pieces.ts`, so a tube stops flickering for a stretch and starts again. `calm: 0` is the
  default and today's behaviour, so no existing caller moved. Two things it had to get right, both
  of which the file now carries: `STEP_MS` is derived (`1400 / 24`) rather than a fixed 24 steps, or
  a long pass stretches each step into a multi-second strobe; and the pass lengthens to whole cycles
  of `spell` + `calm`, so a bout boundary falls on a step edge instead of clipping a drop to a
  single frame.

  **The general `intermittent(inner, { spell, calm, bouts })` wrapper is built**, covering the
  pieces `flicker`'s own pair cannot — `roving` and `hue` among them.

  The constraint this entry used to record as a contradiction is two different periods, and
  `roving` already had the answer above its own arithmetic. The **pass** is a whole number of inner
  passes, which keeps the inner's phase continuous across the loop seam. The **bout** deliberately
  is not: tie that to the inner as well and every bout opens on phase 0, so they all look identical
  while the inner genuinely never resets. `node spikes/intermittent-phase.mjs` prints all three
  readings — the built scheme opens three bouts at phases 0.000/0.333/0.667 with a continuous seam,
  the resonant one opens all three at 0.000, and a gate on its own clock spreads the phases but
  jumps the seam.

  The test that pins it is `opens every bout on a different phase of the inner`, and it is
  verified by mutation: swapping the arithmetic for the resonant version fails that test alone and
  leaves the other five green.

- **The composition lab is built and on `main`.** `npm run dev:composition-lab -w klieg`, port 5183.
  You build a whole `fire()` in the rail — look, hold, effect layers with their params, targeting,
  and a `roving` wrapper — and watch it render live on a clock the lab owns. Playing advances the
  clock; scrubbing backward remounts the fire and jumps straight to the target, which
  `spikes/seek-rebuild/` measures as byte-identical to playing there at 60fps. The **part × time
  raster** is the panel worth knowing about: it strikes through every part no layer ever moved, and
  drops the `epochs` slider to 8 to watch 18 of 24 parts go untouched. The rail warns when a
  layer's target kind resolves to an empty pool, which is not hypothetical — only `tubing` and
  `piping` build `run` parts, and a run-targeted layer on the other ten looks does nothing silently.
  The emit panel prints a pasteable `fire()` call with its own import line.

  **It is honest about time and dishonest about intensity.** No bloom threshold reaches the plots,
  so a `gain` of 0.65 plots as 0.65 whether or not it reads as a dropout. Judge timing off the
  raster and the plot; judge depth off the render above them. Where the two disagree is the
  threshold, and that gap is information.

  **Nothing in the lab reimplements targeting, `stagger` or merging** — `effects/frame.ts` holds
  `planEffects` and `EffectFrame`, `Word` calls them, and so does the lab. That extraction is the
  point: an instrument that re-derives what happens *around* a piece drifts and then reports
  confident wrong answers, which is the failure the tube lab already documents as "the instrument
  cannot know".

  **One trap it already fell into, and the shape generalizes.** `EffectFrame` writes every
  *targeted* part whether or not a layer moved it, so a coverage readout keyed on "did the frame
  write this" marks the whole pool covered under `roving` — which addresses everything and afflicts
  one part. The lab shipped that bug for about ten minutes and it was invisible in the UI until the
  count refused to move with `epochs`. `samplePass` counts *moved*, and
  `packages/core/test/composition-lab/sample.test.ts` pins it.

  See [the design](specs/2026-08-27-composition-lab-design.md) and
  [the plan](plans/2026-08-27-composition-lab.md). The plan's Tasks 1–11 are done; its self-review
  section lists what was deliberately deferred — timeline lanes, the swatch grid, a tenure/jump
  readout, a param sweep, and the draft editing pane. `draft.ts` compiles a hand-authored piece
  already; only its editing UI is missing.

  It is a **different lab** from **kliegsminister**, the stage-and-repair lab in
  [the pipeline lab design](specs/2026-08-23-pipeline-lab-design.md) — that one is about tube
  geometry, this one about time.

  **kliegsminister is under way, in three slices, on branch `kliegsminister`.** The design's
  prerequisite shipped long ago: `markAuthored`'s `WeakSet` is gone, `Run.from` provenance replaced
  it, and the lab's `scene.ts` already finds its run through it. **Slice 1 is done** —
  `buildTubeBlueprint` folds over `TUBE_STAGES` (`render/tube/stages.ts`) over the ids `generate`,
  `wander`, `cut`, `assign`, `sweep`, with `stages` naming which run and `onStage(id, state, ran)`
  reporting each. 1162 tests, 33 visual, look snapshots byte-identical. See
  [the plan](plans/2026-08-27-tube-stage-registry.md), whose "Left for slice 2" section names what
  it inherits. **Slice 2 is `CUT_REPAIRS` and it is the hard one:** `mergeArc` interleaves the
  bridge, relax and resume paths with the arc push. It has been measured, the design corrected, and
  **[the slice 2 plan](plans/2026-08-27-cut-repairs-registry.md) is written and ready to execute —
  ten tasks, start at Task 1.** Read the revised "The two registries" before writing any of it: it
  is not a fold and it does not live in `mergeArc`. Three of the six repairs never enter that
  function, `close` and `return` are span-*list* operations, `stretch` is two implementations with
  different floors under one name, and `hairpin` is a seventh repair the six ids never named. The
  plan carries those five reasons at its top for that reason — the function names read as a fold.

  **The seed-stream desync is fixed on `cut-repairs`.** `stitchPath` used to take its second
  `draw()` only when a corner broke, so switching the `fillet` repair off shifted the stream for
  every later corner in the glyph; each corner's two draws now key on its own index. The design's
  claim that forcing the draw unconditionally would preserve shipped output was wrong — the two are
  the same change and produce byte-identical geometry — so `tubing` re-rendered and its five
  baselines are re-taken. **The second defect is fixed too:** `relaxOnto`'s cloned window resolved
  to `null` in `Run.from` and read as fillet-built, so `rejoin: 'relax'` quietly stopped those
  vertices being smoothed; each copy now inherits its leg vertex's provenance through an `inherit`
  callback threaded from `cutIntoRuns`. Both were latent because `DEFAULT_REJOIN` is `drop` and no
  look overrides it — which stops being true the moment the lab exposes the knob. Both landed on
  `main`, along with the slice 2 plan; `cut-repairs` and `main` are the same commit.

  **Slice 2 is done.** `CUT_REPAIRS` landed as three registries in `render/tube/repairs.ts` —
  `CORNER_REPAIRS` run twice per corner inside `mergeArc`, `SPAN_REPAIRS` at the `stitchPath`
  level, and `fillet` and `hairpin` gated where the decision is made. `cutIntoRuns` takes
  `repairs` and `onRepair`; `buildTubeBlueprint` forwards both. Slice 3 is the lab.

  Two things that stay true and shape how the lab reads. **`resume`'s `ran: false` lies under
  `bridge`/`relax`** — the blend is applied regardless; the toggle gates only the walk's trim
  (comment sits on `ranResume` in `runs.ts`), so a resume ghost under those rejoins would draw
  points already in the path. **Some toggles are geometry-invisible on typical paths**: `setback`
  and the corner-side `stretch` are subsumed by downstream walks under most rejoins (the repair
  tests document which rejoin makes each one bite — `relax` for exit-setback, triple-off for
  stretch), so switching them off moves the ghost layer without moving the built run. Two test
  fixtures are traps: a square never hairpins (use `sharpV` in `repairs.test.ts`) and `openLPath`'s
  0.1 sampling registers no corner (use `fineOpenL` in `runs.test.ts`).

  **Slice 3 is done and kliegsminister is built.** `dev/corner-lab` is now `dev/kliegsminister`
  (`npm --prefix packages/core run dev:kliegsminister`, port 5182), and its `junction` instrument
  drives `stages`, `draw at`, seven repair toggles, `rejoin` and `subject` off the registries
  through `src/pipeline.ts` — the graph `@weasel-js/diagram` reads when it ships. The lab's own
  `blendAcross`/`relaxAcross` are deleted rather than moved: core draws all of it. See
  [the plan](plans/2026-08-28-kliegsminister-lab.md).

  **Every reporting gap slice 2 listed is closed.** `RepairSite` carries `removed` and `side`, the
  exit-side `resume` gates and reports, and `hairpin`, the blockout fillet, the `return` it would
  have carried, and the break-side `stretch` all report now. `test/render/tube/reports.test.ts`
  pins it across twelve letters at both tube looks, including that all-repairs-on stays
  byte-identical to repairs-absent. Gating the exit-side resume moved three off-state counts on the
  test square: resume-off at `drop` 217 → **225**, and the stretch-off pair 225/229 → **241/245**.

  **Left for whoever picks this up.** The `setback`-off-under-`rejoin: 'bridge'` cascade is **2769
  points against 241**, not the 1505 recorded before; the leg-room math assumes the trim happened.
  The lab reaches that combination and draws it without throwing. An exit-side `setback` site
  reports only a cursor index — empty `points` and empty `removed` — so it has no ghost; placing it
  needs the index resolved against the leg it names. **`hairpin`'s toggle is inert in the UI**:
  neither `piping` nor `tubing` weights it and the look control offers nothing else, so the report
  is only reachable from a test with a spec override. And `subject: 'letter'` does not re-zoom —
  labkit's `initialView` is static per instrument, so the whole letter needs zooming out by hand
  from 1600x.

  **The `repair` layer draws the sites that ran**, sourced from the same `ghosts` array the `ghost`
  layer filters the other way; `CornerScene.drawn` is deleted rather than filled, because the
  geometry was already there. It carries the ghost layer's dash grammar in one ink — solid removed,
  dashed added. This matters more than it sounds: with every repair on, *nothing* is skipped, so the
  ghost layer is empty and the default view reported nothing about repairs at all until now.
  `node spikes/repair-layer-ink.mjs <layer>` toggles a layer and md5s the canvas, which is the only
  thing that separates a layer that drew from a legend row that appeared — run it on `ghost` in the
  default view to watch it correctly say `NO INK`.

  It inherits one lie from the report: **`resume`'s `ran: false` under `bridge`/`relax`** (above)
  now hides a site that partly ran, where before it drew a ghost for one.

  **`npm run check` is green, and was not before.** `main` already failed `biome` on a
  `useLiteralKeys` hit in `dev/tube-lab/src/Rail.tsx`; that is fixed here, so a red `check` from now
  on is a real regression rather than the standing state.

  Two things slice 1 learned that its plan did not start with. **`wanderPaths` seeds its rng from
  the path's array index**, so the order paths are concatenated in — contours, then connectors — is
  what keeps every wandered look byte-identical; reordering it re-renders them all with nothing
  thrown. And **`enabled` as one untyped set of strings across both registries is a trap**: a caller
  passing only repair ids would switch off all five stages and get an empty blueprint. Slice 1 types
  the stage set instead, and slice 2 should add `repairs` as its own typed set beside it.

- ~~**An effects pipeline for the tube looks**~~ — shipped, along with `roving` and `hue` on top of
  it. See the `## In flight` section.

- ~~**Playwright reuses whatever owns port 5180**~~ — fixed in `484692b`: `playwright.config.ts`
  derives a port from the checkout's own path and starts vite `--strictPort`. Before that, a run in
  one worktree silently answered from another's dev server and returned confident wrong answers —
  four bogus failures, and two sessions judging appearance off contaminated runs. A checkout without
  that commit is still exposed.
- **Light-up letters — medium priority, and the pile to try next.** See
  [the findings note](specs/2026-08-25-material-lighting-findings.md), which names a spike and its
  flags per item. **Read the code before acting on any of it: the note is dated Aug 25 and its
  items 1 and 5 shipped the next day in `deebe56`.** Exposure and the studio are done — every look
  renders at its authored `envMapIntensity`, which is a `LookKey` now, over a warm-balanced studio.
  A left-to-right falloff across a long word is the studio's remaining deliberate asymmetry, not the
  old cement bug.

  The cursor registration is fixed. What is left is the materials and the tuning:

  **A lamp does not land on every look.** `gem` inherits `clearcoat: 1` from `DEFAULTS` and sets no
  `specularIntensity`, so two specular lobes stack on it: red-but-dark at low env, bright-but-gray
  at high, nothing between. Both lobes must come down together — either alone still mirrors gray.
  That recovers saturation but not brightness, and the brightness half is not a material problem:
  `transmission` samples the scene behind the glass and klieg renders over an empty one. `sequin` is
  unreachable at all — `PartKind` is still `'run' | 'body'`, and a chunk look builds zero run parts
  under a near-black body, so it needs a `'chunk'` kind addressing the letter's `InstancedMesh`.

  **Both halves are fixed.** `node spikes/lamp-registration.mjs [word] [look]` prints the vertical
  one; the 69% this entry once claimed was an understatement of the wrong quantity, the real figure
  being 153% — which is to say *dark*.

  Vertically, `PartInfo` carries `ink` and `lamp` measures to its centre. Before, `PartInfo.x/y` was
  the letter's origin — one shared baseline for a whole line, at every look — while the cursor was
  mapped into the ink box, so the top of every word sat 153% of a lamp's reach from anything it
  could light. It is 80% now, and the middle of the ink went 52% → 1%. The bottom edge is dimmer
  (50% → 91%) because it is the descender region, below the body of every letter that does not
  descend.

  Horizontally, `pointerFrame` takes the fit and camera rather than the ink box, and maps through
  `layoutFromNdc` — the inverse of `projectLetters`, sitting beside it and sharing its `faceHeight`
  so the two cannot drift. It picks up the block's alignment offset with it.

  The guard worth knowing about is `a cursor lands on the letter it is over` in
  `test/render/word.test.ts`: it drives the whole chain, because the unit tests either side of the
  mapping both pass while the pair disagrees. Dropping `aspect` from the inverse sends the outer
  letters to their neighbours and only that test notices.

  **Still open: `ink` resolves per letter, not per part.** `partSlot` indexes the letter, so all 20
  of `tubing`'s parts on `klieg` report the same 5 boxes and a lamp cannot light part of a letter.
  The run meshes carry their own bounds; `Word` keeps only the glyph's.

  `OrbitSpec`'s comment already recorded the baseline collapse for `orbit` (`lamp.ts:29`); nobody
  had connected it to `fromPointer`. No visual baseline covers any of this — no `.spec.ts` names
  `lamp`.

  **The defaults are unsampled.** Radius, strength and falloff were judged at one lamp position on a
  five-letter word — enough to choose a blend, not enough to ship numbers. Worth redoing now rather
  than before: they were chosen against a lamp measuring to baselines through a stretched cursor,
  so they were tuned around the defect as much as around the look.

- **`visual.spec.ts`'s remaining flakiness is the sampled frame, not the wait.** The canvas waits
  were fixed in `e90e7c8` — see the section below. What is left is `bloom path`, `two-line block`
  and `wrap breaks a long line into rows`, which read the whole drawing buffer inside rAF and
  assert on one sampled frame.

  **The one captured artifact says the sample, not the render, is what fails.** On a `wrap breaks a
  long line into rows` failure the error context showed `litBands` returning 0 while the page
  snapshot showed the scene drawn normally. So the frame the assertion read was empty even though a
  correct frame existed — the harness sampled before or between draws rather than the renderer
  producing nothing. That points the fix at how these tests choose their frame, not at the effect.
- **`K` and `k` have non-parallel arm sides, and the bevel is what makes it visible.** In Archivo
  Black's own outline the arm's two long edges are 1.31° apart on `K` and 2.56° on `k`, and both
  terminals are cut flat-horizontal — 39.8° off square to the arm. That is the typeface, not klieg:
  the contour seam is at the inner crotch (295, 394), nowhere near the top-right. But a bevel lays a
  constant-width highlight along each edge, so two edges that diverge by a degree produce a visibly
  tapering strip. Three ways out: swap the face, regularize outlines at load (klieg correcting a
  typeface, and it would touch every glyph), or leave it — in motion at display size it reads as a
  highlight taper rather than a defect.

- **The last bend-minimum failure is a junction defect, and it is wider than three corners.** See
  [tangential junctions](specs/2026-08-22-tangential-junctions-design.md), which has the mechanism,
  the five things tried and what each cost. In short: `resumeAt` clears the invariant by lengthening
  the chord between the leg and the arc, which raises circumradius without touching the direction
  mismatch — filling that chord drops `piping`'s `B` from 2.00r to 0.93r. Admitting only tangential
  junctions fixes every failure and refuses four fillets in five, so it redraws the alphabet;
  everything narrower fixes one corner and opens another. `junctionRadius` and `biarcBlend` are
  built and tested in `bend.ts` but deliberately not wired, and the doc says why.
- **Only `piping`/`direct` `B` fails in a shipped configuration.** The `exact` and `field` failures
  need a lab-only path source, and `tubing`'s `R` at 1.996r is wander — it vanishes at
  `amplitude: 0`.
- **The back-cap chunk waste is not worth fixing — measured, and struck from this list.** About a
  quarter of `sequin`'s chunks land on the back cap (25.1%; the same measurement put the deleted
  `pyrite` at 27.9%), but it costs nothing: real-GPU median frame time was 2.2–2.3 ms whether a
  chunk look drew 55 chunks or 1. Rejecting back-facing samples would raise visible chunks per
  letter by 39% and leave only 8.8% of positions surviving the reseed — a look change dressed as an
  optimization. The back cap is also genuinely on screen during two shipped enters.
## What the studio and exposure change learned

**A green test can be green for the whole life of the bug it covers.** `createMaterial`'s test
asserted `envMapIntensity === 2.2` on the material it had just constructed. three overwrites that
uniform with `scene.environmentIntensity` on every material that has no `envMap` of its own, every
frame, so the property was right and the pixels were never lit by it. Assert the thing that reaches
the screen, or assert nothing.

**Bisecting a timing test reads load, not code.** `an effect held until click stays up` failed on
`main` and passed at `63db866`, which pointed cleanly at two lab commits. Timing the operation says
the opposite — 2486/3972/4519ms on `main` against 5133/5779/5654ms at `0fedd7c`. The first canvas
attach takes 2.5-5.8s against a 5s default expect budget, so the outcome tracked `uptime`. What
settled it was `--repeat-each=3 --workers=1`: first run red, next two green, which is cold start and
cannot be behaviour. **Turn a flaky pass/fail into a measurement before bisecting it.**

**Mean saturation over a dark look measures the dark, not the look.** Judging `oil`'s iridescence by
mean ink saturation ranked a candidate carrying hue over 9.1% of the letter equal to one carrying it
over 19.2%, because ~90% of `oil` is near-black either way. The metric that separates them is the
size of the coloured region and its own saturation — `area` and `satc` in
`spikes/oil-iridescence.mjs`. A hue-bucket count has the mirror flaw: it scored the muddiest
candidate highest, by spreading a small weak region across more buckets.

**A per-look knob does not always mean a per-look answer.** `envMapIntensity` became a `LookKey`,
and it still could not save `oil` — raising exposure collapses hue buckets rather than adding them,
and the one studio bar causing `gold`'s cement was the same bar giving `oil` its colour. The fix had
to move into `oil`'s own film.

## What was learned that is not in the plan

- **`M` and `W` are the worst case, not `N`.** The standing `NSRE` string missed both extremes: `M`
  bends at 0.32 of its own tube radius and `W` at 0.38, against `N`'s 0.44. Every acceptance check
  uses `MWNSRE`. The tube lab's default letters are `MWSB` for the same reason. `piping` wants
  `QXY` instead — it traces inset at `level: -0.015` onto a different contour, so no one string
  serves both looks.
- **`ρmin` sits above `ρstyle`, and the spec's two-class model breaks on it.** At `bend = 2` the
  stylistic band is empty, and a corner between `ρstyle` and `ρmin` is hard yet above the detection
  threshold — never seen, never fixed, silently violating the invariant. 13 such corners on `tubing`
  at `bend = 2`, **174 at `bend = 3`**, widening linearly, so the failure got worse exactly as
  someone tuned toward stiffer material. Detection now runs at `max(ρmin, ρstyle)`. A genuinely
  stylistic class requires `bend < 1.76`, not a change to `ρstyle`.
- **`bend` does not classify — it sets setback.** 2 and 3 give near-identical hard-corner counts.
  What moves is the fillet setback and so the fallback rate. Tune against the rejected-fillet count,
  never the corner count.
- **Filleting is the ordinary path**: 228 hard corners on `tubing` and 244 on `piping`, across all 26
  letters of both. Robustness in the common case, not correctness in the rare one.
- **A corner is a stretch because of resampling, not because of the field.** `spikes/corner-width.mjs`
  measures a square with no distance field anywhere near it: arc-length resampling splits a perfectly
  sharp corner across two vertices whenever a sample does not land on it, which is the generic case.
  The direct contour carries the same stretches, and the same 20-degree shoulder outside them. Group
  filleting is needed at either fidelity, and **path fidelity neither blocks nor is blocked by this
  work** — the ordering question the spec reopened is closed.
- **The corner keeps turning past its stretch.** That shoulder is why a leg direction is averaged over
  four segments rather than taken from the segment next to the corner.
- **The field manufactures corners, so a path source change is a look change.** Its wobble creates
  corners that are not in the glyph, every corner is a candidate break, and stripping it roughly
  halves the corner count. The cut then lands elsewhere and `assign` paints a different lit pattern
  from the identical seed — tubing's `S` goes `OxO.xO` to `OO.OOx`. A look reads differently under a
  different source even though its path is the same shape, so numbers tuned against one do not carry
  to the other. `spikes/run-decomposition.mjs`.

## Traps

**A whole-frame tolerance cannot guard a one-run effect.** One run going dark is 187 to 258 pixels
of an 800x600 baseline, and `looks.spec.ts` gated everything at `maxDiffPixelRatio: 0.001` — 480
pixels — so `effect-flicker` and `effect-roving` passed with their effect deleted. Re-keying the
corner draws exposed it by leaving `effect-roving` byte-identical to `look-tubing` and still green.
The three effect shots now gate on `EFFECT_RATIO`, 0.0002; deleting either effect reddens its test
at 350 and 503 pixels, which is how the fix was checked. Re-pinning could not have fixed it: walking
the whole second roving epoch a flicker step (~58ms) at a time found no pin a look-sized gate would
catch. When measuring these by hand, note the baselines are `scale: 'css'` at 800x600 while
`page.screenshot()` defaults to device scale at 1600x1200 — measure against the stored size or the
count is 4x off and compares to the wrong gate.

**Eliminate a cheap hypothesis about render state before an expensive one about geometry.** The tube
vanishing when thinned was diagnosed twice as a geometry bug and was one line of render state: a
`transparent` material still writes depth by default, so tubing's 0.08 backing was culling its own
tube. `519ae45` has the detail.

**`tightestBend` smooths three times before measuring**, calibrated for the distance field's
staircase noise. On a coarsely sampled arc it shrinks the radius about a tenth — enough to fail the
invariant it is checking. Fillets are sampled at half `spacing` for that reason, and authored points
are held out of the smoothing entirely (`markAuthored` / `isAuthored` in `bend.ts`). Anything else
that builds exact geometry into a run needs the same care.

**Smoothing masks raw kinks.** Holding fillet points fixed made joins fail that had looked fine,
because the filter had been rounding them off. A green measurement through a smoother is not evidence
the path is clean.

**A room test measured on geometry the merge does not build passes on nothing.** The fillet was
computed twice from different inputs, so the check validated an arc that was never spliced.

**Trimming a leg back by accumulated step length leaves a point *inside* the setback**, so the path
runs forward to it and then jumps back to the tangent point. That reversal reads as a *tighter* bend
than the corner it replaced. Trim by distance from the corner instead.

**A test fixture's sampling spacing is load-bearing.** Bend radius is `s / (2 sin(θ/2))`, so a 90°
turn at 0.1 spacing is a 0.071 em bend — wider than a 0.03 tube need bend, and no corner is found at
all. Sample fixtures at the pipeline's own 0.02.

**A per-pixel `threshold` is what decides whether a visual baseline can see a change at all**, and
the pixel-count ratio cannot substitute for it. Playwright's default 0.2 hid bloom entirely.
`--update-snapshots=all` rewrites **every** baseline, so grep to the ones that move.

**The visual suite cannot see `piping`'s cord.** It traces inset at `level: -0.015`, so the cord is
inside the letter body in both framings and both its baselines are blind to the change that matters
most for that look. Judge piping by `spikes/bend-acceptance.mjs` or a lab capture.

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the stability
loop waits for two consecutive frames. `shoot()` passes `timeout: 20000`, and an occasional single
failure on `tubing` is this rather than instability — re-run before believing it.

**A positional gradient's bounds must be mutated, not reassigned.** The compiled shader aliases the
`Vector4` and `Vector2` sitting in `material.userData`, so a `regroup()` that hands over fresh
vectors leaves every already-compiled letter reading the pre-regroup mapping.

**The per-vertex gradient parameter is arc length, not ring index.** `ringsOf` domes each end with
4 cap rings covering about one `radius` of length, so a ring-index parameter gave a 25-point run 25%
of its range on caps that are 11% of it, and the share moved with point density. Ring index squeezes
`electrode`'s dim ends onto the domes.

**Never add `opacity` to `LookKey`.** `Word` rewrites `material.opacity` every frame, so a value
applied through `PARAM_KEYS` is gone by the first tick — and it would pass any test that never calls
`apply()`.

**Colour never reaches a `body` part.** `writePart` returns after the brightness write for a body, so
a `hue` effect on `{ kind: 'body' }` is silently inert — no error, no warning, no change on screen.

**`roving` wants `{ amount: 1 }`.** It picks its holder from the whole pool of its kind, because
`at(t, part)` sees pool-wide numbering and cannot know which subset an effect targets. Against a
subset the fault lands on a part the effect does not drive, and the sign shows nothing.

**Do not `git add -A`**, and do not chain `npm run check && git commit` through a `grep` — the grep
succeeds and the failed check is swallowed.

## Verify by mutation

The tube lab plan's two-stage review found a defect on all nine of its tasks, and the single
highest-yield instruction was "verify this by mutation". It has held on everything since:

- Two tests written for the geometry work passed with the code under test **deleted**. A closed-path
  seam test needed a superellipse sampled finely enough that corners span several vertices before it
  could bite; a square with single-vertex corners never straddles the seam at all.
- A `report.ts` predicate comparing bend radius against the *tube radius* instead of `ρmin` returns
  plausible booleans rather than failing, on the very panel used to judge whether the model worked.
  There is now a test whose fixture sits between the two so it discriminates.
- The plan's own mutation instruction for the wander cap had the direction backwards: `budget` is in
  the denominator, so raising it *tightens* the cap. Corrected in the plan.
- The path source work reached both its findings by a wrong turn first: the junction defect read as
  a fidelity problem, and the contour offset's first fix broke the outer contour instead of the
  counter it was aimed at. A number that agrees with the hypothesis is not evidence until the code
  under it has been deleted and the number moved.

## `sequin` is sewn now, and what that cost

Shipped on `sequin-rework`. The chunk generator used to stick a tumbling square on each sampled
point and stand it a third of its own size off the surface; `sequin` is now 520 discs at 0.062 em
lying nearly flat at 0.08, on a lattice pitched at 0.055 so each row overlaps the next. Three
capabilities were added to the generator, each inert at its default, and the two shipped in the
rescued `pyrite` machinery (`faceBias`, `bedding`) carry the rest.

- **`ChunkSpec.lie`, 0..1** — how flat a chunk lies on the surface, applied after `align`. It turns
  the tumbled rotation onto the sample's normal by the shortest arc rather than building a frame
  from it, so the chunk keeps its own spin and the knob costs no random draw.
- **`shape: 'disc'`** — a `CircleGeometry` beside `flake` and `cube`.
- **`BeddingSpec.pitch` / `.jitter`** — sites at a spacing along each bed, alternate beds offset by
  half a pitch. Omit `pitch` and bedding behaves exactly as before.

**Thinness was never the problem.** A `flake` is a `PlaneGeometry(1, 1)` drawn `DoubleSide` — a
zero-thickness quad. The old note here claiming thinness was inexpressible was wrong; what was
missing was roundness and orientation.

**Two values cannot be the ideal, and both bite silently:**

**`lie` must not be 1.** Discs lying perfectly flat are parallel mirrors — every one returns the
same reflection and the field reads as a single dull sheet. It ships at 0.82. Perfecting the
orientation destroys the glitter that is the whole point of the look, which is the opposite of what
the capability appears to promise.

**`proud` must not be 0.** A disc lying exactly in the surface z-fights with it across its whole
face. It ships at 0.08 of an edge.

**`jitter` is a second dial on the cap/band split, against `faceBias`.** A stray too tight to hit
rejects cap draw after cap draw until the sampler happens to draw a band triangle, which it accepts
at once — so tightening it starves the caps rather than sharpening the lattice. Cap samples fall
from 1236 at 0.5 to 51 at 0.05 while the share of them sitting on a site stays at 100% throughout.
`spikes/bed-lattice.mjs` measures both, and `spikes/look-shot.mjs <look> <out.png>` renders one look
for eye-judging on a port derived from the worktree.

**Two traps for anything else that measures this field.** `glyphToShapes(font, char, size)` takes a
size, and omitting it silently builds the glyph in font units — about 53x too large, with every spec
number written at 1 em. Use `buildGlyphGeometry(font, char, 1, DEFAULT_GLYPH_OPTIONS)`, which is what
the renderer does. And classify a cap by its normal, not by z: the bevel stands proud of the cap
plane, so a z cutoff files bevel samples as band and reports a lattice far worse than it is. Both
produced a wrong number mid-session before they were caught.

**The lattice governs the caps only.** A bed is measured in word space, which the caps lie in and
the extrusion band stands perpendicular to, so a grid projected onto the band smears along the
extrusion. The band keeps free placement, told apart by the per-triangle facing `faceBias` already
computes.

**`lie` lays a chunk onto the outward normal, and the field is `FrontSide` from 0.8 up.** The earlier
note here — that a disc only faces outward at `lie: 1` — was wrong, and wrong in a way that hid the
fix: the side a face ends up on was decided by the tumble, not by `lie`, so *no* value of `lie` made
`FrontSide` safe. Only 47.8% of near-cap discs faced outward at any setting, 1 included. Laying
always onto the outward normal makes it 100% from 0.8 up, at the cost of half a turn for the chunks
that leaned the other way — which leaves them less flat, so `sequin` moved from `lie: 0.82` to 0.88
to hold its old tilt spread. Buys nothing measurable in frame time (see the back-cap bullet above);
it is here because a one-faced chunk that lies on a surface should face out of it.

**And it must reach that normal by the near side of the plane, not by aiming at it.** Handing
`Quaternion.setFromUnitVectors` two vectors near antiparallel keeps little of its precision — the
same source placed chunks differently on macOS and on Linux CI, three commits of main went red, and
the local suite passed throughout. Sequin's closest chunk is 3.2e-4 from antiparallel, well clear of
three's degenerate branch at 1e-8, so the guard that looks like it covers this does not. The
placement pin is the only test that catches it, and it only catches it on CI.

## A known limitation of the lab

A spec change rebuilds all sixteen cells, ~1.45s front-only and ~2.85s with `back`/`wall`/
`connectors`. Sliders commit on release, so a drag costs one rebuild rather than twenty — but a single
step still waits. The honest fix is not rebuilding a whole `Word` per cell for a spec change.
