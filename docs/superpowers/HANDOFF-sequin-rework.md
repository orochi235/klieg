# Handoff — sequin rework, 2026-08-24

**For:** the next session on this branch. **Answers:** what is on `sequin-rework`, what is left, and
the two decisions made in conversation that are not visible in the diff.

The durable writeups are [the design](specs/2026-08-24-sequin-rework-design.md) and the `sequin`
section of [HANDOFF.md](HANDOFF.md). This says only what those cannot: branch state and the traps.

## Where it is

**Branch `sequin-rework`, pushed, 11 commits ahead of `main`.** Worktree
`.claude/worktrees/vertex-provenance`. Green: **787 vitest**, typecheck and biome clean, **23/23
playwright at `--workers=1`**, with only `look-sequin`'s baseline re-recorded.

**Not merged, and no PR opened** — that needs your say-so.

Two of the eleven commits are unrelated to sequin and were asked for separately:

- `484692b` gives each worktree its own visual-suite port. `portfolio-14` asked for this fix and
  said it would take it.
- The three merge commits land `drop-pyrite-respec`, `legend-palette` and `corner-lab-minimap`,
  which were already pushed to `main` as `0607dc5`.

## What is left

- **Merge it.** Nothing blocks this but review.
- **`FrontSide` at `lie: 1`** — measured, deliberately not wired. See the handoff's sequin section.
- **`pyrite-respec` can be deleted once this merges.** Its two generic commits (`ffc7c45`,
  `7ed4bb0`) are cherry-picked onto this branch; the other four are pyrite-specific and the look is
  gone. It still has a worktree at `/private/tmp/.../pyrite-wt`. **Do not delete it before this
  merges** — the cherry-picks are the only copy.
- **`tube-geometry`'s worktree is stale** — its branch is fully merged.

## Decisions made in conversation

**Both spacing modes are supported, on one parameter.** Omitting `pitch` leaves bedding's free
placement along a bed; setting it gives the staggered lattice. This was an explicit ask, not a
default.

**`pyrite-respec` was rescued rather than rebuilt.** It was minutes from deletion as a dead branch;
it turned out to hold most of the placement machinery this rework needed, including the fix for the
quadratic pool that the old handoff named as the blocker. Two commits cherry-picked, four dropped.

## Traps

**A worktree's visual run can be answered by another worktree's dev server.** This cost real work:
four baselines reported as failures were another tree's code judged against this tree's baselines,
and two sessions were making appearance judgments off contaminated runs. Fixed in `484692b`, but any
worktree without that commit is still exposed.

**`visual.spec.ts` is flaky under parallel load.** `bloom path` and `two-line block` fail
intermittently in the full suite and pass in isolation; it predates this work. **Run the visual suite
with `--workers=1`** or you will chase it.

**`git checkout <file>` after a mutation test discards uncommitted work.** Restore a mutated file
from a copy, not from git, while there are uncommitted changes in it.

**The chunk generator's knobs must not consume a random number when they are off.** An unused draw
reseeds every other look's scatter. `lie` obeys this by turning the rotation the tumble already
drew rather than drawing a frame of its own; anything added here needs the same care.

**`glyphToShapes(font, char, size)` takes a size, and a spike that omits it silently builds the
glyph in font units** — about 53x too large. Every spec number is written at 1 em; build geometry
with `buildGlyphGeometry(font, char, 1, DEFAULT_GLYPH_OPTIONS)`, which is what the renderer does.

**Classify a cap by its normal, not by z.** The bevel stands proud of the cap plane, so a z cutoff
files bevel samples as band and reports a lattice far worse than it is. This produced a wrong
measurement mid-session before it was caught.
