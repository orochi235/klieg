# Selectable text — design

**For:** whoever implements text selection over klieg's canvas. **Answers:** what to build, what
already exists to build on, and which traps are silent.

## The problem

klieg renders text as WebGL geometry and creates exactly one DOM element — a `<canvas>` at
`pointer-events:none`. There is no DOM text anywhere, so the rendered word is invisible to
selection, copy-paste, Ctrl+F, screen readers and crawlers. For a headline rendered through
`placement: element`, the accessibility and indexing half of that is the larger hole.

## Two tiers

**Tier 1 — a visually-hidden text node.** Copy-paste, Ctrl+F, screen readers, indexing. Puts no
selection highlight on the glyphs. Independent of everything below.

**Tier 2 — an aligned transparent text layer.** Per-letter absolutely-positioned spans in the real
face, transparent fill, `::selection` visible — the PDF.js text-layer approach. This is what makes a
drag-select land on the letters.

A third tier that follows `transform` and per-frame motion with `matrix3d` is out of scope:
alignment drifts under animation, and a highlight sliding around under moving 3D text reads worse
than no selection at all.

## The option

One value on `FireOptions`, defaulting to `'hidden'`:

```ts
selectable?: 'hidden' | 'layer' | 'none';
```

**Exactly one text source exists in the DOM at a time.** `'layer'` does not add tier 1 underneath it;
its spans carry the text. Two sources double every Ctrl+F hit and every copy, and `aria-hidden`
suppresses neither.

`'none'` is why this is not a boolean: an `element` placement rendered over a real `<h1>` already has
its text in the page, and a hidden copy duplicates it.

`'layer'` is opt-in because it accepts pointer events, and the shipped guarantee —
`apps/lab/test/visual.spec.ts`, *"the overlay does not intercept clicks meant for the page beneath
it"* — holds for everyone who does not ask. The container stays `pointer-events:none` and only the
spans take `auto`, so the gaps between letters stay click-through and only a click on a letter is
captured.

## Where the layer lives

A sibling of the canvas in the same parent, built by `Stage.mount()` and removed by `unmount()`, so
`claimAnchor` and the placement CSS already cover it. `layerCss(placement)` mirrors `canvasCss`:
fullscreen carries `z-index: 2147483001`, one above the canvas; the anchored case needs none, since
paint order settles it. A child of the canvas is not possible, and a wrapper around both would
change the DOM shape every current consumer sees.

## The projection

For a front-on untransformed word every letter shares one z, so the map is a uniform scale and a
translate — a 2D affine, not a per-frame matrix. It is a pure function of placement, fit, camera and
canvas box, and needs no DOM to test.

`Stage.viewportBudget` (`render/stage.ts`) already derives `vh = 2 · tan(fov/2) · camera.position.z`,
the world height visible at the word plane; pixels per world unit is `canvas.clientHeight / vh`.
`placed.x[i]` / `placed.y[i]` (`text/placement.ts`) give per-letter positions in em, with `fit.scale`
and `fit.midY` from `fitOf`, so `fontSize = fit.scale · pxPerWorld`.

**A letter's front face sits at `+depth/2`, not at the word plane.** Project at `z = 0` and the layer
comes out a few percent small — near enough to right to read as a rendering bug rather than a
missing term. `DEFAULT_GLYPH_OPTIONS.depth` is constant, so the correction is
`camera.position.z − depth/2`.

**CSS positions a box top; the layout gives a baseline.** At `line-height: 1` the gap between them is
`halfLeading + ascender · fontSize / unitsPerEm`, both metrics already on `LoadedFont`. Guessing it
puts every letter a few pixels off — invisible until someone drags across the word.

## The font is not a CSS font

`loadFont` (`text/font.ts`) hands bytes to opentype.js; the browser never registers the face. The
layer needs `new FontFace(name, buffer)` and `document.fonts.add()`, reusing the `ArrayBuffer`
already fetched — so there is no second download. The family name is a deterministic hash of the font
URL, registered once and shared by every instance on that font, so nothing new reaches the public
API. Nobody styles a transparent layer by name.

## When the layer is dropped

`'layer'` falls back to `'hidden'`, with one console warning naming the cause, when `transform` is
set or a motion piece actually moves letters. `lighting: 'static'` is not the constraint — it only
pins the highlight. What tier 2 requires is no `transform` and no motion.

Motion is measured, not named: `MotionPiece.offset(t, letter)` is a pure function, so the resolved
pieces are sampled across a few `t` and checked for a varying pose channel. A caller's own piece is
judged the same way a built-in is, and `none` costs nothing.

A `stages` regroup sets the layer `visibility:hidden` at tween start and rebuilds it from the new
placement once the fit settles; the letters move for the length of the tween, and a stale layer would
be visibly wrong. Under `'hidden'` the node carries the whole fired string for the effect's life and
never churns, so a screen reader is not re-interrupted at every stage.

## Tests

- Unit: the projection, against hand-computed pixel boxes; the motion sampler, against a moving
  piece, a still one and `none`.
- Playwright: a drag across the word, asserting `getSelection().toString()`; a click on a letter
  captured under `'layer'`; the existing click-through test unchanged and still passing under the
  default.
