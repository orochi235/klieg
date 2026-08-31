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

klieg pins `1.3.0-pre.0` exactly and **must re-pin when a stable 1.3.0 ships** — klieg is published,
so the pin reaches consumers.

**That re-pin moves eleven packages, not two, and bumping fewer now fails the install.** 1.3.0 makes
`@weasel-js/font` an exact peer of `core`, `hud` and `text`, and `core` an exact peer of `svg`, so a
mixed set stops nesting quietly and starts throwing `ERESOLVE`. klieg's set is mixed today: `font`,
`paint` and `text` are at `1.3.0-pre.0` while `core`, `geom`, `gestures`, `history`, `labkit`,
`modes`, `theme` and `ui` resolve to 1.2.0. Only four are declared here —

    @weasel-js/font    1.3.0-pre.0    @weasel-js/labkit  ^1.1.0  -> 1.2.0
    @weasel-js/text    1.3.0-pre.0    @weasel-js/ui      ^1.0.3  -> 1.2.0

— so the eight at 1.2.0 are mostly transitive and a bump of `text` alone will not move them. The
carets on `labkit` and `ui` are what make the mix easy to miss: the loose-looking pins are the ones
that fail. `npm ls @weasel-js/core @weasel-js/font` before and after is the check.

**Drop the root `overrides` entry in that same change.** It exists to force one `@weasel-js/font`
copy, which is the duplication the peer dependency now prevents outright; kept alongside the peer it
pins a version the resolver is already responsible for.

Two things land in 1.3.0 that klieg is currently working around: the `bounds.width` trailing-space
fix (so `trimmedWidth` can go, though it stays correct either way) and the peer declaration itself.
`@weasel-js/labkit` 1.3.0 also adds `FloatingPanel` and `Legend`, which retires the locally declared
`LegendEntry` in `packages/core/dev/kliegsminister/src/legend.ts` — labkit 1.2.0 exports neither.

**Where the upstream asks landed.** weasel fixed the trailing-space measurement on its `main`:
`bounds.width` folded `line.width` where it should have folded `inkWidth`, one line. It is
**unpublished**, so `trimmedWidth` stays until klieg re-pins — and stays correct either way, since
it measures to the last non-blank cell rather than trusting the engine. `line.x1` still includes a
hung trailing space by design, because it doubles as the caret stop; nothing in klieg reads it
(checked across source, tests and labs), so that is only a hazard for a future reader who reaches
for it as a fit measure.

The `geom`/`paint` ask is refuted, not open: `text`'s published `.d.ts` imports `Rect`, `FillStyle`
and `Stroke` from them, so they are public type surface and have to resolve. The `polygon-clipping`
pull is fixed separately — `geom` marks it an optional peer on weasel `main`, which `1.3.0-pre.0`
predates.

**Still open:** `@weasel-js/text` should declare `@weasel-js/font` as a peer dependency, since a
module-global registry cannot survive duplication. And `layoutRuns` should warn when a run resolves
no metrics (`packages/text/src/layout/layoutRuns.ts:505`) — that one warning would have made the
split above self-diagnosing.

Bidi stays out of scope, and is still a switch rather than a rewrite: `layoutRuns` takes a
`BidiResolver`, `@weasel-js/bidi` implements it, and klieg honours the cell contract that makes
turning it on cheap — a cell's right edge is `x + advance`, never the next cell's `x`.
