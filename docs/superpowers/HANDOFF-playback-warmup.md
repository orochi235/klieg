# Handoff — playback-warmup branch, 2026-08-28

**For:** the next session on this branch. **Answers:** what is committed, what is next, and what
was decided in conversation that the spec does not say.

## State

Branch `playback-warmup`, one commit (`c35fed2`), working tree clean, **no upstream — unpushed**.
Cut from `main` at `57f9023`. Green: lint, typecheck, 1274 tests / 64 files.

The design is [the spec](specs/2026-08-28-playback-warmup-design.md), which carries the numbers and
the reasoning. Two runnable harnesses ship with it and re-derive every claim: `node
spikes/fire-build-cost.mjs` for the CPU-side build, and `apps/lab/mount-cost/` (dev-only, not in
vite's build inputs) for the GL side.

## Next

Write the implementation plan for the spec. Nothing in core has been touched yet.

## Decided in conversation, not in the spec

**This is slice C of three.** The other two came out of the same conversation and have no spec:

- **A — a font registry.** Several fonts per instance, addressable per fire. Its highest-value
  borrow is `outline/sfnt.ts` from `@weasel-js/font` (`~/src/weasel/packages/font`, 234 lines, one
  dependency shared with klieg): it unpacks `.ttc` collections, which opentype.js rejects outright.
  Helvetica, Times, Courier and Menlo are all `.ttc` on macOS, so `loadFont` fails on them today.
  Take the file and the registry's *design* — its registry is module-global, which is wrong inside
  a library that can be constructed twice on one page.
- **B — the run model.** `fire(TextRun[])` carrying tint, font, size and baseline shift
  (super/subscript was asked for). Per-run `look` was cut: bloom is a whole-frame pass, so one run
  asking for `neon` promotes it for the whole effect. Two traps live in `render/word.ts`: a
  per-letter scale cannot be baked into `cell.scale` because motion overwrites it every frame
  (`:955`), and `atRest()` hardcodes `cell.scale === 1` as the definition of rest (`:813`), which
  the selectable DOM layer gates on — so the obvious implementation leaves that layer silently
  unaligned rather than erroring.

**Order matters only in one direction:** A forces C's cache key to become `(font, char, depth)`
anyway, so doing A first costs C nothing. B needs A underneath it.
