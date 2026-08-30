# The run model — design

**What:** `fire()` takes a list of styled runs, so one word can mix fonts, sizes and tints.
**For:** whoever implements slice B in `@klieg/core`.
**Answers:** where the layout comes from, what a run may vary, and what it costs to swap klieg's
layout out.

Slice C (playback warmup) and slice A (the font registry) are on `main`; this is the third and last
of the three. It needs A, because a run naming a font needs an instance that holds several.

## Layout comes from `@weasel-js/text`

klieg takes a runtime dependency on `@weasel-js/text` and deletes its own `layoutLine`,
`layoutBlock` and `wrapBlock`. Every fire routes through `layoutRuns` — the string form becomes a
one-run list — so there is one layout engine rather than two that drift.

That package is a 900-line walk with cross-run kerning, word wrap, alignment, and a shared baseline
across mixed sizes. It is MIT, by the same author, and its only real runtime edge is
`@weasel-js/font`, whose own only dependency is the `opentype.js` klieg already carries; the edges
to `@weasel-js/geom` and `@weasel-js/paint` are type-only in practice. Nothing on the path touches
the DOM at import time, and the package's own suite has a block — *"layoutRuns from a font face
alone"* — covering the case klieg is: font bytes, no atlas, no canvas.

**`@weasel-js/text` is not on npm.** `npm view @weasel-js/text` 404s; `@weasel-js/font` resolves at
1.2.0. klieg is itself published, so it cannot depend on a package a consumer's install cannot
resolve — this blocks the design as written until `text` ships. If it is not going to ship, the
fallback is the route slice A already took: vendor the walk with attribution, the way
`text/sfnt.ts` was ported from `@weasel-js/font`.

**And this is a real change to klieg's dependency posture,** which is one runtime dependency today.
Check what `geom` actually pulls at runtime before merging; the report of it being type-only is
about how it is used, not how it is declared.

### klieg keeps its own glyph geometry

weasel is used for **positions only**. Its outline tier hands back SVG path `d` strings, and klieg
has its own opentype→`THREE.Shape` pipeline whose contour nesting was rewritten to winding-based
after the serif bug slice A turned up. Re-parsing `d` strings reopens exactly that.

So the seam is: take each laid-out glyph's `x`, `baselineY` and `scale` (world units per em) and its
character, and feed the character through klieg's existing `WordCaches.glyph`. Every coordinate
weasel emits is origin-relative, which is what a `THREE.Group` transform wants.

### Registration is namespaced, and interim

`layoutRuns` resolves faces through a **module-global** registry keyed by family-name strings —
the design slice A explicitly rejected, because a library can be constructed twice on one page.
Until weasel offers an injectable registry, klieg registers under a name carrying its own instance
counter, so two instances cannot collide, and passes its already-parsed face through
`registerFontOutlines`' documented `opts.parser` hook rather than handing over a URL. That hook
exists for a consumer that already has a parser in its bundle, which klieg does — so there is no
second fetch and no second parse.

Registration resolves asynchronously, and a `layoutRuns` call before it lands silently lays out
nothing. `fire()` already awaits its font, so it must await registration readiness on the same path
rather than laying out and hoping.

## What a run carries

```ts
export interface TextRun {
  text: string;
  /** A name from the instance's `fonts`. Defaults to the fire's own `font`. */
  font?: string;
  /** Multiple of the surrounding size. 1 is the word's own size. */
  size?: number;
  tint?: number;
}

fire(text: string | TextRun[], options?: FireOptions): FireHandle;
```

**Per-run `look` is out.** Bloom is a whole-frame pass, so one run asking for `neon` would promote
the whole effect — a run cannot own it.

**Baseline shift is out of this slice.** Super/subscript was asked for, and weasel has no
per-run vertical offset today. It is being added upstream; klieg picks it up as a `baseline` field
then, rather than growing a klieg-side offset that has to be unwound. Nothing else in this design
depends on it.

## Two traps in `render/word.ts`

Both bite silently, and both are about where a run's size may live.

`applyPose` writes `cell.scale.setScalar(pose.scale)` every frame (`word.ts:969`), so a per-letter
size baked into the cell's scale is overwritten on the first tick. And `atRest()` treats
`cell.scale === 1` as the definition of rest (`word.ts:827`) — a letter standing at size 0.6 is
never at rest, and the selectable DOM layer, which gates on `atRest()`, silently stops aligning
rather than erroring.

So a run's size goes on a node the pose does not own: a scale group inside the letter cell, with the
mesh under it. `Word` already has an `inner` group between the fit and the letters, which is the
pattern to follow.

## What the swap must not lose

Replacing the layout engine puts three shipped behaviours at risk. None is a reason not to do it;
each is a thing that will pass unit tests and break a real page.

**Reading-order alignment.** klieg's `Align` is `start | center | end`, resolved against the box's
own computed `direction` — an anchored word meets the page's text edge, and under `rtl` that edge
is the other one. weasel's align is `left | center | right`, absolute. klieg maps start/end to
left/right itself before calling, or RTL regresses.

**Per-line alignment.** `viewportBudget` carries both an `align` and a `lineAlign` — where the
block sits, and how lines sit within it. weasel exposes one alignment. Confirm whether it can
express both; if not, `lineAlign` is applied klieg-side after layout.

**A slot for every code point.** klieg keeps a letter slot for each code point, including the ones
that draw nothing — a space, `U+00A0`, a ZWJ — because `letterCount`, `charOf`, the regroup's
renumbering and the selectable DOM layer all index by slot, and `drawsInk` is what marks a slot
blank. A layout that emits only glyphs that draw will not hand back those slots. Rebuild the
mapping from `caretIndices`, which carries source offsets, rather than from the glyph list. Getting
this wrong breaks text selection on any word containing a space, and nothing else will report it.

## Testing

- A string and a single run of the same text lay out identically — the string form is not a
  second path.
- Runs of different fonts kern across their boundary.
- A run's advance scales with its size; the line's glyphs share one baseline.
- A wrapped block breaks inside a run and carries that run's styling onto the next line.
- A word with a sized run reports `atRest()` true once it has settled, and its DOM layer aligns.
- `'A B'` gives three slots, the middle one blank — the same count the string path gives today.
- An `end`-aligned word under `direction: rtl` sits against the same edge it does today.
- Two instances on one page register different faces under one family name without collision.

**Expect the visual baselines to move.** Swapping the layout engine changes kerning and wrap
decisions somewhere in the 40 Playwright cases, and each move needs a human call on whether it is
better or worse — that judgement is the work, not the update.
