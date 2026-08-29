# Handoff — the three slices from the playback-warmup conversation

**For:** the next session on any of them. **Answers:** which are built, where each one's design
lives, and what was decided in conversation that no document carries.

One conversation produced three slices. They are independent; the ordering note that used to be
here is spent, because the one it constrained is built.

## C — playback warmup and cross-fire caching: **built**

On `main` (PR #4), [design](specs/2026-08-28-playback-warmup-design.md),
[plan](plans/2026-08-28-playback-warmup.md). `node spikes/fire-build-cost.mjs` re-derives the
CPU-side numbers against the shipped caches; `apps/lab/mount-cost/` measures the GL side.

`WordCaches` keys glyph geometry on the `LoadedFont` object through a `WeakMap` interner, so it
already discriminates fonts correctly — A needs nothing from it.

## A — the font registry: **built**

Branch `font-registry`, [design](specs/2026-08-28-font-registry-design.md),
[plan](plans/2026-08-28-font-registry.md).

Two things it turned up that its own design did not predict. Unpacking a `.ttc` reaches 40 of the
49 collections in `/System/Library/Fonts`, but not Helvetica, Times, Courier or Menlo — they
unpack and then hit an opentype.js `cmap` limit. And `nest()` classified counters by containment
depth, which fills in any letter a serif face draws as overlapping same-wound strokes; it reads
winding now.

## B — the run model: **not designed**

`fire(TextRun[])` carrying tint, font, size and baseline shift (super/subscript was asked for).
**weasel has since abstracted this logic out**, and it can be imported as a weasel subpackage
rather than written again — look there before designing.
Per-run `look` was cut: bloom is a whole-frame pass, so one run asking for `neon` promotes it for
the whole effect. Needs A underneath it.

Two traps live in `render/word.ts`. A per-letter scale cannot be baked into `cell.scale`, because
motion overwrites it every frame (`:955`); and `atRest()` hardcodes `cell.scale === 1` as the
definition of rest (`:813`), which the selectable DOM layer gates on — so the obvious
implementation leaves that layer silently unaligned rather than erroring.
