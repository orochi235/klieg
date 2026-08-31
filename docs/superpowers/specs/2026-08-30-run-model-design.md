# The run model — design

**What:** `fire()` takes a list of styled runs, so one word can mix fonts, sizes and tints.
**For:** whoever implements slice B in `@klieg/core`.
**Answers:** where the layout comes from, what a run may vary, and what it costs to swap klieg's
layout out.

Slice C (playback warmup) and slice A (the font registry) are on `main`; this is the third and last
of the three. It needs A, because a run naming a font needs an instance that holds several.

## Layout comes from `@weasel-js/text`

klieg takes a runtime dependency on `@weasel-js/text` and deletes its own `layoutLine` and
`layoutBlock`. Every fire routes through `layoutRuns` — the string form becomes a one-run list — so
there is one set of advance, kerning and baseline rules rather than two that drift.

**`wrapBlock` stays, and drives `layoutRuns` rather than replacing it.** Its search is the feature:
it enumerates candidate line widths and keeps the arrangement that maximises `fitScale`, so a sign
fills its box instead of taking the first break that fits. That search now scores each candidate by
laying it out through weasel and measuring the `bounds` that come back. `layoutRuns` therefore runs
once per candidate per fire, which is CPU-only work on an already-cached font.

**The scoring probes call `layoutRuns` directly, not `cachedLayoutRuns`.** That cache holds one
entry per distinct `(maxWidth, lineHeight, align, outline threshold)` and caps variants per runs
array at 8, evicting the whole variant set at once rather than the least recent — so a search
probing more than 8 widths would evict its own set every pass and cost more than not caching.
`cachedLayoutRuns` is for the arrangement the search settles on, which is the one drawn repeatedly.
A cached result is shared: treat `LaidOutRuns` as immutable and never write into one.

That package is a 900-line walk with cross-run kerning, word wrap, alignment, and a shared baseline
across mixed sizes. It is MIT, by the same author, and its only real runtime edge is
`@weasel-js/font`, whose own only dependency is the `opentype.js` klieg already carries; the edges
to `@weasel-js/geom` and `@weasel-js/paint` are type-only in practice. Nothing on the path touches
the DOM at import time, and the package's own suite has a block — *"layoutRuns from a font face
alone"* — covering the case klieg is: font bytes, no atlas, no canvas.

**It is published, as a prerelease.** `@weasel-js/text` is on npm at `1.2.0` and `1.3.0-pre.0`,
the latter under the `pre` tag, and `font` / `geom` / `paint` all match at `1.3.0-pre.0`. Only the
prerelease carries what klieg reads — `1.2.0` predates cells and reading-order alignment.

**Whether klieg pins a prerelease is an open decision.** klieg is itself published, so a `pre`
dependency reaches every consumer transitively. Either klieg waits for a stable `1.3.0`, or it pins
`1.3.0-pre.0` exactly and re-pins on release.

**And this is a real change to klieg's dependency posture,** which is one runtime dependency today.
Measured on the installed tree: `text`'s dist JS imports `@weasel-js/font` and nothing else, so
`geom` and `paint` really are type-only in use. But `text` declares both under `dependencies`, so
npm installs `geom` and its `polygon-clipping` for every consumer regardless — about 460K that no
bundler will ship because nothing imports it. Moving those two to peer or dev dependencies is an
upstream fix, not klieg's.

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

**Readiness is lazy, and only a glyph request starts it.** `registerFontOutlines` returns with the
face `idle` and parses nothing. `layoutRuns` is not the ask that starts it — it finds no face, lays
out nothing, and leaves the status where it was however many times it is called. So the wait has to
be primed: `glyphOutline(family, 400, 'normal', cp)` flips it to `loading`, and
`subscribeGlyphReady` then fires on `ready`.

**And klieg must resolve the same copy of `@weasel-js/font` that `@weasel-js/text` does.** The
registry is a module-global `Map`, so two physical copies are two registries: klieg registers into
one and `layoutRuns` reads the other, every run is skipped, and nothing warns — zero lines and zero
bounds, indistinguishable from a face that failed to load. npm produces exactly that here by
default, because `@weasel-js/ui` (a dev-lab dependency) pins `font` at `1.0.3` and npm hoists it,
nesting the `1.3.0-pre.0` copies separately. The root `package.json` overrides `font` to
`1.3.0-pre.0` tree-wide to collapse it to one copy. That override is load-bearing, not tidiness.

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

**Reading-order alignment comes from weasel.** `align` gains `start` / `end` alongside the absolute
trio, and an optional `direction: 'ltr' | 'rtl'` sits on the layout options; `resolveAlign(align,
direction)` is exported. It is the same split as CSS `text-align` — the relative pair resolves
against direction, the absolute pair does not. So klieg passes its own `Align` straight through and
builds no start/end→left/right mapping.

Direction is an input and is never sniffed, because that package has no DOM. klieg goes on reading
`getComputedStyle(box).direction` and passes what it found.

**Bidi is available, and opt-in.** `layoutRuns` declares a `BidiResolver` interface — `analyze`
per paragraph, `reorder` per line, `mirror` for L4 — and deliberately does not depend on an
implementation, so a consumer rendering no right-to-left text never installs the Unicode tables.
`@weasel-js/bidi` satisfies it structurally and is published alongside.

So klieg *can* have real bidi by installing that package and passing a resolver; without one, cells
carry `level: 0` and the text is laid out logically. That is a later decision, not this slice's —
but the cell contract above must be honoured now, or turning it on later is a rewrite rather than a
switch. Note that reordering still would not make Arabic correct: it needs GSUB joining forms this
walk does not apply.

**The two alignments split differently than klieg's do.** weasel's single `align` is applied per
line against `maxWidth` — that is klieg's `lineAlign`, and it comes for free. klieg's block `align`
resolves to a 3D viewport translate under a camera-Z perspective shrink, which is klieg's own and
stays klieg's, applied after layout.

**One mismatch that bites twice.** weasel measures a line's advance width including a trailing
space where klieg ranges on ink, so a centred line ending in a space sits half a space off. That
half-space is cosmetic and is a known weasel bug — do not chase it as a klieg regression.

The same mismatch in the *fit scoring* is not cosmetic, and it is klieg's to handle: scoring a wrap
candidate on `bounds.width` counts that trailing space, which made every wrapped sign one space
advance narrower and shrank the type by up to 9%. `layoutRunsForKlieg` therefore reports the widest
line measured to its last non-blank slot, not `bounds.width`. Measured against the pre-swap engine
across 18 text/budget pairs, breaks and fitted scale then match exactly.

**A slot for every code point — solved upstream.** klieg keeps a letter slot for each code point,
including the ones that draw nothing, because `letterCount`, `charOf`, the regroup's renumbering and
the selectable DOM layer all index by slot.

`LaidOutLineBox` now carries `cells: LaidOutCell[]` and `srcEnd`, where a cell is
`{ srcIndex, srcEnd, cp, x, advance, level, drawsInk }`. **Slot `i` is `cells[i]`; klieg builds no
reconstruction.** `caretXs` and `caretIndices` are gone — cells subsume both. A code point no tier
can serve takes a zero-advance cell rather than vanishing. A newline still has no cell: it separates
cells rather than being one, and `srcEnd` is what a blank line carries instead. Every line gets a
box including empty ones, so indices line up with the wrap.

**A cell's right edge is `x + advance`, never the next cell's `x`.** Cells stay in logical order and
their x values do not once a bidi engine reorders a line — that is what `advance` and `level` are
for. Any klieg code deriving a line's extent by walking cell positions must use the advance, or it
silently produces garbage the day RTL text arrives.

**`drawsInk` is a property of the code point and the face, not of what got painted.** Deciding it
from whether a quad was emitted is unstable — it flips when a dynamic bake lands or an outline
threshold is crossed, so identical text would report different slots on two calls. The consequence
for klieg: a zero-advance combining mark has `drawsInk: true`, because it inks without advancing.
Any line-ranging that assumes no advance implies no ink is wrong, in both libraries.

## Still to settle

Two upstream changes, in this order. Neither is klieg's to make.

Nothing blocking. Everything klieg reads — outline metrics, cells, reading-order alignment,
baseline shift — is present and correct in `1.3.0-pre.0`. The pin decision stands on its own: pin
the prerelease, or wait for a stable `1.3.0`.

Two things worth sending upstream, neither blocking. `@weasel-js/text` declares `@weasel-js/font`
as an ordinary dependency though that package's contract is a module-global registry — a peer
dependency is what stops npm installing two copies and silently splitting it. And `layoutRuns`
drops a run whose family resolves no metrics without a word; the tier already warns per missing
glyph, and the same warning one level up would have named the duplicate-copy failure immediately.

## Testing

- A string and a single run of the same text lay out identically — the string form is not a
  second path.
- Runs of different fonts kern across their boundary.
- A run's advance scales with its size; the line's glyphs share one baseline.
- A wrapped block breaks inside a run and carries that run's styling onto the next line.
- A word with a sized run reports `atRest()` true once it has settled, and its DOM layer aligns.
- `'A B'` gives three slots, the middle one blank — the same count the string path gives today, and
  the same under `wrap: true`. Note `wrapBlock` normalises whitespace before laying out, so the
  count is against the normalised text, not the fired string.
- A combining mark gets a slot reporting ink despite adding no advance.
- A wrapped sign is laid out at least as large as the same sign is today — the search still wins.
- An `end`-aligned word under `direction: rtl` sits against the same edge it does today.
- Two instances on one page register different faces under one family name without collision.

**Expect the visual baselines to move.** Swapping the layout engine changes kerning and wrap
decisions somewhere in the 40 Playwright cases, and each move needs a human call on whether it is
better or worse — that judgement is the work, not the update.
