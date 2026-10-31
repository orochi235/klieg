# TODO

Work klieg owes that has no other home yet.

## A placed word does not refit when its element resizes

A fire sizes the word once, from `stage.viewportBudget` when it starts. After that, the stage's
`ResizeObserver` only resizes the canvas and its lens, so a word in an element that narrows mid-fire
overflows it, and one in an element that grows stays small. Seen in the composition lab when a
second trial halves the first one's width; the lab works around it by firing again on resize.

## The tube lab's orbit has not had the face-pivot fix

The tube lab poses its own three.js groups with `orbitPose` (`dev/shared/orbit.ts`), so the change
that turns a fired word about its ink's face, with translation measured there, did not reach it.
`npm run probe:lab -- tube-lab` reads 4 px of pan overshoot and 2–4 px of turn drift there, by
image match on panels too small to trust it; a zoom reads `LOST`. Give the lab a `pointOn`-style
readout before deciding how much of that is real.

## The tube lab is not a `<Lab>`

The tube lab builds its own page from labkit pieces because every panel shares one tube spec, and
labkit 1.14.2 has no config shared across trials. weasel's main has it unreleased (`<Lab over>`,
`f.schema(nodes, { over })`, `ctx.over`; checked 2026-10-31). Once that ships, moving the lab onto
`<Lab>` brings Reset, Clone, add-trial and saved orbit views for free.

## The tube lab's detent sliders are a custom row

labkit 1.14.2's schema slider is a native range input and takes no `stops`, so level, wall depth
and the corner mix draw `rail/DetentRow.tsx` on ui's `Slider`, which does (2026-10-31). It keeps
its own drag draft, since a custom row only gets `setValue`. Once a schema number field takes
`stops`, delete the row and declare them in `rail/schema.ts`.

## A drag on the composition lab's diagram also turns its camera

labkit 1.14.2's `<Orbit>` puts the whole instrument DOM in the orbit camera's input scope, so the
effects diagram's canvas nests under it: a drag or wheel there moves the 3D camera too, and the lab
logs six `[weasel] route conflict` warnings on load. Fixed on weasel's `orbit-trial-gestures` branch
(2026-10-31) with no change needed here; bump `@weasel-js` once a release carries it, and confirm
the warnings are gone.
