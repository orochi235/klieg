# Engineering notes

**For:** whoever works on klieg's internals and already knows its public surface from the top-level
README. **Answers:** what the code does not say — measured results, decisions taken against an
alternative, and traps that each cost someone a cycle. Current work and open questions are in
[`HANDOFF.md`](../../HANDOFF.md); designs are in [`docs/superpowers/specs/`](../superpowers/specs/).

- [Text, glyphs and placement](text.md)
- [Tubes](tubes.md)
- [Effects and lighting](effects.md)
- [Chunks and `sequin`](chunks.md)
- [Wells, fills and pavé](wells.md)
- [The dev labs](labs.md)

**Build the axis, not the case.** A request here is almost always one setting of a mechanism;
build the mechanism and make the requested behavior one value of it.

The rest of this page is about working in the repo.

## Evidence

- **Verify by mutation.** Delete or break the code under test and watch the test go red; a number
  agreeing with a hypothesis is not evidence until then. Tests here have repeatedly passed with the
  code under test deleted — a seam test on a square whose corners never straddle the seam, a bend
  predicate comparing against the tube radius instead of `ρmin`. When a fix touches several sites,
  mutate each one: `roving` forwards `ctx` at two call sites, a test covered one, and mutating the
  other left the suite green.
- **Assert what reaches the screen, or assert nothing.** Unit tests stub `Stage.mount`, so no unit
  test has seen the selectable text layer exist, and `PartOffset.gain` ran, merged and wrote the
  material while changing no pixel. Rendered proof compares md5s of lamp-on and lamp-off frames.
- **Anything drawn for a human must sit outside anything a machine compares.** A proof script once
  drew a cursor crosshair into the clip it hashed, so frames differing only by the crosshair were
  reported as the lamp landing.
- **Verify prose against the built package.** A throwaway script importing `dist` and asserting each
  sentence caught two false README claims.
- **A consumer repro that does not assign into a typed position proves nothing.** Excess-property
  checking fires only on assignment to a typed target.
- **A vertex is always "removable" when you ask only about its neighbors.** At fine sampling every
  triple is nearly straight (97%), and removals do not compose; Douglas-Peucker answered 36.2%.

## The visual suite

`npm run test:visual` is Playwright against the lab, byte-exact against stored baselines.

- **Under load it lies, and `--workers=1` is not the remedy.** Above a load average of roughly 20
  the renderers are starved and killed, with a different failure set each run. **Read the error,
  not the count:** a starved test never reaches a comparison (`Target page, context or browser has
  been closed`, `Test timeout of 30000ms exceeded`); a pixel regression reports a diff ratio and
  writes an artifact under `test-results/`. Check `uptime`'s 5- and 15-minute averages.
- **A per-pixel `threshold` decides whether a baseline can see a change at all.** Playwright's
  default 0.2 hid bloom entirely. `--update-snapshots=all` rewrites every baseline, so grep to the
  ones that move.
- **A whole-frame ratio cannot guard a one-run effect.** One dark run is 187–258 pixels of an
  800x600 baseline, under the 480 that `maxDiffPixelRatio: 0.001` allows, so the effect shots gate on
  `EFFECT_RATIO` (0.0002). Baselines are `scale: 'css'` at 800x600 while `page.screenshot()`
  defaults to device scale — measure against the stored size.
- **The hold has to dwarf the cold start.** klieg starts the hold's clock at `fire()`, and the first
  canvas attach takes up to 5.8s, so `HOLD_MS` is 30000. Failure messages carry `sampled Nms after
  FIRE, into a Hms hold`.
- **A bloomed look at DPR 2 can exhaust the 5s screenshot budget**; `shoot()` passes 20000.
- **No baseline covers** a lamp, `piping`'s cord (inside the body), a multi-line block's horizontal
  placement, or a gradient on a shipped look.

## Timing

- **Turn a flaky pass/fail into a measurement before bisecting it.** `--repeat-each=3 --workers=1`
  separates cold start from behavior: red then green then green is cold start. Do not use a load
  average as a threshold for whether a failure is real.
- **Sampling throttled frames with `readPixels` costs seconds**, so a second census on one page
  measures much later in the hold. Use a fresh page per condition.
- **`vitest.config.ts` sets no `testTimeout`**, so a test pulling three.js through a cold transform
  with a dynamic `import()` (`effects/pieces.test.ts`, `render/tube/stages.test.ts`) has 5s.
- **`enter pieces > every piece is finite everywhere` flaked once** and passed alone; not chased.

## Test harness traps

- **The second of two concurrent `import()`s of a `vi.mock`'d module never settles** and falls
  through to the real module. Mount the sign elements sequentially; do not fold those tests into one
  `innerHTML`.
- **`document.head` is not reset between tests.** `beforeEach` clears it, or the stylesheet
  idempotence guard short-circuits and both stylesheet tests assert nothing.
- **`spikes/*.test.ts` sit outside vitest's `include`.** A spike needing `vi.spyOn` runs from under
  `packages/*/test/`.
- **A `_` prefix in `spikes/` marks a throwaway script**, deliberately untracked.

## The warm

- **The warm holds its throwaway word until the first fire**, because three refcounts a shader
  program per material: disposing it returned the programs it had just linked, which
  `apps/lab/mount-cost/` reads as `renderer.info.programs` going 0 → 0 rather than 0 → 2.
- **Nobody has shown the warm saving wall-clock.** Under `spikes/warm-cold-run.mjs`, in a browser
  whose GPU shader cache has never seen these programs, every link lands at 10–21ms and the PMREM
  prefilter at 27–35ms, against the 138ms and 296ms the design recorded on a cold process.
- **A cached tube blueprint is lent to one word at a time.** `writePart` writes run colors into
  the blueprint's geometry every frame, so two concurrent words sharing one would write each other's
  colors; a second taker gets a fresh build disposed on release. Its key carries the decoration and
  the per-letter tint, or it returns another look's tube. A store a `Word` borrows is never disposed
  by that word.
- **`WordCaches` keys glyph geometry on the `LoadedFont` object**, and `FontRegistry` memoizes on
  the resolved key, so two names for one face share one cache. `node spikes/fire-build-cost.mjs`
  re-derives the CPU-side numbers.

## Dependencies

- **Bump the `@weasel-js` packages together, to one exact version.** klieg declares `font`, `text`,
  `core`, `labkit` and `ui`; the rest arrive transitively and every package pins its siblings
  exactly. A mixed set fails at install with `ERESOLVE`. When the lockfile still holds the previous
  version's internal packages (`kernel3d`, `loupe`, `svg`), the install fails even with every
  declared version moved; delete the `node_modules/@weasel-js/*` entries from `package-lock.json`
  and reinstall.
- **`@weasel-js/core` pins its own `@msb235/blits`**, so the dev labs can carry a second copy beside
  klieg's.
- **`@types/three` is an optional peer**, and anything a consumer's type checker re-evaluates must
  not depend on it. `LookKey` ships as a literal union; the `Extract<keyof
  THREE.MeshPhysicalMaterial, …>` it was once emitted as collapsed `LookParams` to `{}` for any
  consumer without `@types/three`.

## Releasing

Push a `v*` tag and `release.yml` publishes through npm trusted publishing, after checking the tag
matches `packages/core/package.json`. `npm view` reports a stale version straight after a publish;
read `https://registry.npmjs.org/klieg`. Versioning follows the semver note at the top of
`CHANGELOG.md`.

## The checkout

- **Stage explicit paths, never `git add -A`.** Several sessions often share this checkout.
- **Do not chain `npm run check && git commit` through a `grep`**: the grep succeeds and swallows
  the failed check.
