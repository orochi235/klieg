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

For a front-on untransformed word every letter shares one z, so the map is a scale and a translate —
a 2D affine, not a per-frame matrix, and a pure function of placement, fit, camera and canvas box
that needs no DOM to test. `placed.x[i]` / `placed.y[i]` (`text/placement.ts`) give per-letter
positions in em; `fit.scale` and `fit.midY` come from `fitOf`. The lens covers
`vh = 2 · tan(fov/2) · d` world units of height at the letters, so `fontSize = fit.scale · height / vh`.

**`d` runs to the front cap, not to the word plane.** `THREE.ExtrudeGeometry` extrudes from `z = 0`
to `z = +depth` and nothing recentres it, so the shape plane is the letter's back and its readable
face is a whole depth nearer: `d = camera.position.z − depth · fit.scale`. Project at the word plane
and the layer comes out a few percent small — near enough to right to read as a rendering bug rather
than a missing term.

**x and y take separate scales.** The camera's aspect need not match the canvas box: fullscreen,
`Stage.measure()` reads `innerWidth`, which counts a classic scrollbar, while the canvas resolves
`width:100%` against the ICB. So x scales by `width / (vh · camera.aspect)` and y by `height / vh`;
one shared figure puts a letter 400px off centre about 4px out.

**The baseline gap is measured, not derived.** CSS positions a box top, the layout gives a baseline,
and the gap at `line-height: 1` is a fixed fraction of the font size — but which fraction depends on
whether the browser takes hhea, OS/2 win or OS/2 typo for the inline box, and that varies by
platform. `measureBaselineRatio` (`text/font-face.ts`) reads it off a hidden probe once per face.

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
