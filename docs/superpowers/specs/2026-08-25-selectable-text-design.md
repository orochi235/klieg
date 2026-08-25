# Selectable text — design notes

**For:** whoever implements text selection over klieg's canvas. **Answers:** what exists to build on,
what is missing, and which decisions are still open.

Not a settled design. The findings below are measured from the code; the decisions at the end are
not made.

## The problem

klieg renders text as WebGL geometry and creates exactly one DOM element — a `<canvas>` at
`pointer-events:none`. There is no DOM text anywhere. So the rendered text is invisible to selection,
copy-paste, Ctrl+F, screen readers, and crawlers.

The accessibility and SEO half of that is arguably the larger hole: a headline rendered through
`placement: element` is a decorative canvas as far as Google and a screen reader are concerned.

## Two tiers, and why they split

**Tier 1 — a visually-hidden text node.** Gets copy-paste, Ctrl+F, screen readers and indexing. Does
not put a selection highlight on the glyphs. Independent of everything below, and worth doing on its
own merits.

**Tier 2 — an aligned transparent text layer.** Per-letter absolutely-positioned spans in the real
face, transparent fill, `::selection` visible — the PDF.js text-layer approach. This is what makes a
drag-select land on the letters.

A third tier that follows `transform` and per-frame motion is possible with `matrix3d`, and is
deliberately out of scope: alignment drifts under animation, and a selection highlight sliding around
under moving 3D text reads worse than no selection at all.

## What already exists to build on

The layout is already in DOM-friendly terms. `placed.x[i]` / `placed.y[i]` give a per-letter position,
with `fit.scale` and `fit.midY` from `fitOf` (`text/placement.ts`), plus `line` and `column`.

The world-to-pixel conversion is already computed. `Stage.viewportBudget` (`render/stage.ts:159`)
derives `vh = 2 · tan(fov/2) · camera.position.z`, the world height visible at the word plane, so
pixels-per-world-unit is `canvas.clientHeight / vh`.

For a front-on, untransformed word every letter shares one z, so the projection is a uniform scale
plus a translate — a 2D affine map, not a per-frame matrix.

## Three things that bite

**The font is not a CSS font.** `loadFont` (`text/font.ts`) fetches bytes and hands them to
opentype.js; the browser never registers the face. A text layer needs `new FontFace(name, buffer)`
and `document.fonts.add()`. It can reuse the already-fetched `ArrayBuffer`, so there is no second
download — but it adds a font-family name to the public surface.

**Pointer events collide with a shipped guarantee.** Selection requires the layer to accept pointer
events, and `apps/lab/test/visual.spec.ts` asserts the opposite: *"the overlay does not intercept
clicks meant for the page beneath it."* Per-letter spans leave the gaps click-through, but a click on
a letter is captured. This is a real behaviour change for `fullscreen` placement and a mild one for
`element` placement, where klieg already owns its box.

**Extrusion offsets the scale.** A letter's front face sits at `+depth/2`, not at the word plane, so
a layer scaled at `z = 0` comes out a few percent small. A constant correction — and the kind that
looks nearly right and reads as a rendering bug.

## Scope: "static" is narrower than it sounds

`lighting: 'static'` only pins the highlight. What Tier 2 actually requires is **no `transform` and
no motion** — otherwise letter positions move per frame and would have to be mirrored into the DOM.
`transform` is the option someone reaches for on an otherwise-still sign, so the constraint needs
naming precisely rather than implying it.

## Decided

- **Both tiers are wanted**, and they ship together.
- **The tier-2 layer is opt-in, behind a `selectable` flag.** The shipped click-through default and
  the `visual.spec.ts` guarantee that guards it are untouched; a caller asking for selection accepts
  that a click on a letter no longer reaches the page beneath. Rejected: on-by-default everywhere,
  which rewrites that guarantee for everyone, and on-by-default for `element` placement only, which
  makes behaviour depend on placement and is harder to explain than a flag.
- **Tier 1 is on by default.** It has no pointer-events tension — a visually-hidden node is not a hit
  target — and the hole it fills is an accessibility and indexing one that nobody should have to opt
  into.

## Not decided

- **What happens when the constraint is violated** — a `transform` or a live motion piece with
  `selectable` on. Drop the layer, keep it misaligned, or refuse the combination.
- **Where the layer lives in the DOM.** A sibling of the canvas needs the same placement handling
  (`claimAnchor`, the fullscreen `z-index`); a child of the canvas is not possible.
- Whether `regroup` and stages rebuild the layer or drop it.
- Whether the `FontFace` family name is generated or caller-supplied.
