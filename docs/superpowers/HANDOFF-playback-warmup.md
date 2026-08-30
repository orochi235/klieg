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

## B — the run model: **designed, not implemented**

[Design](specs/2026-08-30-run-model-design.md). `fire(TextRun[])` carrying tint, font and size.

The borrow question resolved differently than this file used to guess. `@weasel-js/text` does have
the layout, and klieg takes it as a runtime dependency and deletes its own `layoutLine` /
`layoutBlock` / `wrapBlock` — one engine, every fire through it. But it is used for **positions
only**: its outline tier emits SVG `d` strings, and klieg keeps its own glyph pipeline rather than
reopening the nesting problem A just fixed.

Two of its gaps are being fixed upstream and picked up later — per-run baseline shift, so
super/subscript is **out of this slice**, and the module-global font registry, which klieg works
around meanwhile by namespacing family names per instance.

Per-run `look` was cut: bloom is a whole-frame pass, so one run asking for `neon` promotes it for
the whole effect.

Two traps live in `render/word.ts`, now at `:969` and `:827`, and three shipped behaviours the
engine swap can silently drop — reading-order alignment under RTL, per-line alignment, and a letter
slot for every code point including the blank ones. The design carries all five.
