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

**A follow-up is on `main` too**: the warm now links a bloom look's quads, holds its throwaway word
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

[Plan](plans/2026-08-30-run-model.md), all ten tasks done, merged to `main`. `fire()` takes `string | TextRun[]`; every fire routes
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

**klieg is on `@weasel-js` 1.3.0, every package pinned to that one exact version.** The root
`overrides` entry is gone with it: it existed to force one `@weasel-js/font` copy, which the peer
declaration in 1.3.0 now guarantees. `npm ls @weasel-js/font` reports one entry with both other
paths deduped, and there is one `package.json` on disk.

**Bump all four declared packages together or not at all.** `font`, `text`, `labkit` and `ui` are
what klieg declares; the other eight arrive transitively, and every package in the group pins its
siblings exactly, so the four determine the closure. The failure is loud now rather than silent: a
mixed set gives `ERESOLVE` at install, which is what the caret ranges on `labkit` and `ui` used to
hide by quietly nesting a second font registry.

Two things that fix landed with, both of which klieg had worked around. `bounds.width` no longer
counts a wrapped line's trailing space — `trimmedWidth` in `text/layout.ts` is kept anyway, because
it measures to the last non-blank slot and so guards klieg's fit against the engine rather than
trusting it, which is what a silent 9% shrink earned. And `layoutRuns` now warns when a run resolves
no metrics, which is the warning that would have made the duplicate-registry split self-diagnosing.

`labkit` 1.3.0 brings `FloatingPanel`, `Legend` and `LegendEntry`. kliegsminister's `legend.ts` takes
its `LegendEntry` from labkit now; the `Legend` and `FloatingPanel` components are available and the
lab still renders its own.

Bidi stays out of scope, and is still a switch rather than a rewrite: `layoutRuns` takes a
`BidiResolver`, `@weasel-js/bidi` implements it, and klieg honours the cell contract that makes
turning it on cheap — a cell's right edge is `x + advance`, never the next cell's `x`.
