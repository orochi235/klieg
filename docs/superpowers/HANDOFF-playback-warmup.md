# Handoff — the three slices from the playback-warmup conversation

**For:** the next session on any of them. **Answers:** which are built, where each one's design
lives, and what was decided in conversation that no document carries.

One conversation produced three slices. They are independent; the ordering note that used to be
here is spent, because the one it constrained is built.

## C — playback warmup and cross-fire caching: **built**

On `main` (PR #4), [design](specs/2026-08-28-playback-warmup-design.md),
[plan](plans/2026-08-28-playback-warmup.md). `node spikes/fire-build-cost.mjs` re-derives the
CPU-side numbers against the shipped caches; `apps/lab/mount-cost/` measures the GL side.

`WordCaches` keys glyph geometry on the `LoadedFont` object through a `WeakMap` interner, and
`FontRegistry` memoizes on the resolved key so two names for one face share that object — one
cache, not two.

**A follow-up is on `main` too** (merged locally, not yet pushed): the warm now links a bloom look's quads, holds its throwaway word
until the first fire, and gains a host-driven `warm(look?)`. It holds the word because three
refcounts a shader program per material — disposing it returned the programs the warm had just
linked, which `apps/lab/mount-cost/` reads as `renderer.info.programs` going 0 → 0 rather than
0 → 2. Because it adds public API it wants review rather than a quiet merge.

Neither number the design leans on reproduces under `spikes/warm-cold-run.mjs`, which runs that lab
in a browser whose GPU shader cache has never seen these programs: every link lands at 10–21ms and
the PMREM prefilter at 27–35ms, against the 138ms and 296ms recorded on a cold process. Nobody has
shown the warm saving wall-clock; what is demonstrated is that it no longer discards its own work.

## A — the font registry: **built**

On `main` (PR #5), [design](specs/2026-08-28-font-registry-design.md),
[plan](plans/2026-08-28-font-registry.md).

Two things it turned up that its own design did not predict. Unpacking a `.ttc` reaches 40 of the
49 collections in `/System/Library/Fonts`, but not Helvetica, Times, Courier or Menlo — they
unpack and then hit an opentype.js `cmap` limit. And `nest()` classified counters by containment
depth, which fills in any letter a serif face draws as overlapping same-wound strokes; it reads
winding now.

## B — the run model: **built**

[Design](specs/2026-08-30-run-model-design.md). `fire(TextRun[])` carrying tint, font and size.

The borrow question resolved differently than this file used to guess. `@weasel-js/text` does have
the layout, and klieg takes it as a runtime dependency and deletes its own `layoutLine` /
`layoutBlock` / `wrapBlock` — one engine, every fire through it. But it is used for **positions
only**: its outline tier emits SVG `d` strings, and klieg keeps its own glyph pipeline rather than
reopening the nesting problem A just fixed.

[Plan](plans/2026-08-30-run-model.md), all ten tasks done on `run-model` (worktree
`~/src/klieg-worktrees/run-model`), unpushed. `fire()` takes `string | TextRun[]`; every fire routes
through `@weasel-js/text`, and klieg's `layoutLine`, `layoutBlock` and `wrapBlock` are gone. 1435
unit tests and all 40 Playwright baselines green — **no baseline moved**, because klieg feeds weasel
its own advances and kerning through the `parser` hook, so the engine changed and the numbers did
not.

**Two traps this slice actually hit, both silent, both now covered by a test.**

A wrapped line's trailing space was being counted in the width the fit is scored on, which shrank
every wrapped sign by up to 9%. Nothing in the suite caught it — it was found by running 18
text/budget pairs through the old engine on `main` and the new one side by side. `LaidOut.width` now
measures to the last non-blank slot. If the wrap ever looks small again, re-run that comparison
before touching a baseline.

weasel's font registry is a module-global `Map`, so two physical copies of `@weasel-js/font` are two
registries: klieg registers a face into one, `layoutRuns` reads the other, and every run is skipped
with no warning at all — zero lines, zero bounds. npm split it by default here, because
`@weasel-js/ui` pins `font@1.0.3` for the dev labs and npm hoists it. The root `package.json` now
carries an `overrides` entry forcing one copy, and the lockfile had to be regenerated for it to
take. `find . -name package.json -path '*@weasel-js/font/*'` must report exactly one. The CHANGELOG
warns consumers about the same hazard.

Registration lives in `loadFont`, so a face cannot reach layout unregistered. It is lazy: nothing
parses until a glyph is asked for, and `layoutRuns` is not that ask — `registerFace` primes it with
`glyphOutline` before waiting on `subscribeGlyphReady`.

klieg pins `1.3.0-pre.0` exactly and **must re-pin when a stable 1.3.0 ships** — klieg is published,
so the pin reaches consumers.

**Two upstream asks, neither blocking, both still open on weasel `main`.** `@weasel-js/text` should
declare `@weasel-js/font` as a peer dependency, since a module-global registry cannot survive
duplication. And `layoutRuns` should warn when a run resolves no metrics
(`packages/text/src/layout/layoutRuns.ts:505`) — that one warning would have made the split above
self-diagnosing. Separately, `text` declares `geom` and `paint` as dependencies though its shipped
JS imports neither, so every klieg consumer installs `polygon-clipping` for nothing.

What klieg reads from it: `cells: LaidOutCell[]` per line, so slot `i` is `cells[i]` and klieg
reconstructs nothing; and reading-order alignment, so klieg passes its own `start`/`center`/`end`
through with a `direction` it reads off the box. Baseline shift is in too.

Three contracts that produce silent garbage if broken, all in the plan's preamble: a cell's right
edge is `x + advance` and never the next cell's `x`; `drawsInk` is a property of the code point and
face, not of whether geometry was emitted; and `registerFontOutlines` returns before the face is
usable.

Bidi is available but out of scope — `layoutRuns` takes a `BidiResolver` and `@weasel-js/bidi`
implements it, so it is a later switch provided the cell contract is honoured now.

The module-global registry is not being fixed; klieg namespaces family names per instance to dodge
it. weasel's `align` turns out to be klieg's `lineAlign`; klieg's block `align` is a 3D viewport
translate that stays klieg's.

klieg keeps its own `wrapBlock`. Its search is not greedy — it maximises `fitScale`, which is what
makes a sign fill its box — so it stays and scores each candidate by measuring it through
`layoutRuns`.

Per-run `look` was cut: bloom is a whole-frame pass, so one run asking for `neon` promotes it for
the whole effect.

Two traps live in `render/word.ts`, now at `:969` and `:827`, and three shipped behaviours the
engine swap can silently drop — reading-order alignment under RTL, per-line alignment, and a letter
slot for every code point including the blank ones. The design carries all five.
