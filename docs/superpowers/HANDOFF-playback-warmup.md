# Handoff — the three slices from the playback-warmup conversation

**For:** the next session on any of them. **Answers:** which are built, where each one's design
lives, and what was decided in conversation that no document carries.

One conversation produced three slices. They are independent; the ordering note that used to be
here is spent, because the one it constrained is built.

## C — playback warmup and cross-fire caching: **built**

Branch `playback-warmup`, [design](specs/2026-08-28-playback-warmup-design.md),
[plan](plans/2026-08-28-playback-warmup.md). Green: lint, typecheck, 1309 tests / 66 files.
`node spikes/fire-build-cost.mjs` and `apps/lab/mount-cost/` re-derive its numbers.

`WordCaches` keys glyph geometry on the `LoadedFont` object through a `WeakMap` interner, so it
already discriminates fonts correctly — A needs nothing from it.

## A — the font registry: **specced**

[Design](specs/2026-08-28-font-registry-design.md), on branch `font-registry`. Not implemented.

## B — the run model: **not designed**

`fire(TextRun[])` carrying tint, font, size and baseline shift (super/subscript was asked for).
Per-run `look` was cut: bloom is a whole-frame pass, so one run asking for `neon` promotes it for
the whole effect. Needs A underneath it.

Two traps live in `render/word.ts`. A per-letter scale cannot be baked into `cell.scale`, because
motion overwrites it every frame (`:955`); and `atRest()` hardcodes `cell.scale === 1` as the
definition of rest (`:813`), which the selectable DOM layer gates on — so the obvious
implementation leaves that layer silently unaligned rather than erroring.
