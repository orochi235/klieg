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

**`@weasel-js/text` is not on npm yet.** It 404s while the other 13 weasel packages are at 1.2.0 —
not a config problem: it was extracted after 1.2.0 published, and the changesets version PR that
would release it has been open since 2026-08-24. Merging that PR is the fix, and `@weasel-js/core`
already depends on `text` in-tree, so it cannot ship again without it either. klieg is itself
published and cannot depend on a package a consumer's install cannot resolve, so **this slice is
blocked until that release lands.** One wrinkle to expect: the release publishes via OIDC trusted
publishing, which is configured per package, so a brand-new package may need one manual first
publish to bootstrap.

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

**Baseline shift is in, once the release lands.** It was added upstream after this design was
first written: `StyledRun` gained `script` / `baselineShift` / `fontScale`, and `resolveRuns`
flattens `script` into a baseline and a scale before layout, so the output shape is unchanged — a
superscript is an ordinary run whose glyphs carry a different `baselineY`.

The trap that comes with it: for a shifted run `glyph.baselineY !== line.baselineY`, so glyphs
cannot be grouped onto lines by comparing those two.

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

**The wrap is not the same wrap.** `wrapBlock` (`text/layout.ts:103`) is not a greedy line
breaker: it enumerates candidate line widths and picks the arrangement that maximises `fitScale` —
it breaks lines to make the type as large as the box allows, which is the whole point of a sign.
weasel's wrap is ordinary greedy. Replacing it changes line breaks on **every multi-word fire** and
generally makes the type smaller, and nothing in the suite will call that a failure.

`wrapBlock` also normalises whitespace before laying out (`trim().split(/\s+/)`, rejoined with
single spaces), so under `wrap: true` the slot sequence already comes from normalised text rather
than the fired string.

**Reading-order alignment.** klieg's `Align` is `start | center | end`, resolved against the box's
own computed `direction` — an anchored word meets the page's text edge, and under `rtl` that edge
is the other one. weasel has no `direction`, no `start`/`end` and no bidi, and none is in flight,
so klieg maps start/end to left/right itself before calling or RTL regresses.

**Per-line alignment.** `viewportBudget` carries both an `align` and a `lineAlign`. weasel exposes
one, and a second is not in flight; `lineAlign` is applied klieg-side after layout.

**A slot for every code point.** klieg keeps a letter slot for each code point, including the ones
that draw nothing, because `letterCount`, `charOf`, the regroup's renumbering and the selectable
DOM layer all index by slot. weasel's layout omits cells for **four different reasons**, and
`caretIndices` cannot tell them apart: a code point the face cannot serve is skipped silently; a
**leading space on a line is dropped entirely**, which eats one slot per wrapped line; a newline
never produces a caret stop; and `caretIndices` are UTF-16 offsets while klieg's slots are code
points, so an astral character makes the two numberings diverge rather than merely gap.

There is no shaping, no GSUB and no cluster merging anywhere in that walk, so the mapping is 1:1 by
omission only, never by merging. That is what makes a fix upstream cheap — emit a zero-advance cell
for an unservable code point, keep the leading space, and expose per-cell ink so `drawsInk` comes
from layout. **Do not build the klieg-side reconstruction until that fix is ruled out**; it is the
kind of code that passes every test and breaks selection on a wrapped line.

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
