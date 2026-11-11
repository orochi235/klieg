# TODO

Work klieg owes that has no other home yet.

## A wrapped word keeps its line breaks through a resize

A running fire refits to its resized element by scaling the same layout (2026-11-10), so a word
fired with `wrap: true` keeps the breaks it chose for the first box. In a box that turns from
wide to tall it stays on one line and shrinks, where a fresh fire would break it and render larger.
Re-wrapping mid-fire moves letters the way a `stages` regroup does, so it would need the regroup's
part and travel handling.

## The tube lab's orbit has not had the face-pivot fix

The tube lab poses its own three.js groups with `orbitPose` (`dev/shared/orbit.ts`), so the change
that turns a fired word about its ink's face, with translation measured there, did not reach it.
`npm run probe:lab -- tube-lab` reads 4 px of pan overshoot and 2–4 px of turn drift there, by
image match on panels too small to trust it; a zoom reads `LOST`. Give the lab a `pointOn`-style
readout before deciding how much of that is real.

## The tube lab is not a `<Lab>`

The tube lab builds its own page from labkit pieces because every panel shares one tube spec, and
labkit 1.14.2 had no config shared across trials. labkit 1.18.2, which klieg now builds on, has it
(`<Lab over>`, `f.schema(nodes, { over })`, `ctx.over`; 2026-11-10), so nothing blocks moving the
lab onto `<Lab>`, which brings Reset, Clone, add-trial and saved orbit views for free.

## A resize may blank the canvas for a frame

The stage resizes its drawing buffer inside its `ResizeObserver` callback, which runs after the
frame has drawn, and resizing a buffer clears it. So a canvas may show empty for one frame per
resize until the next tick redraws it. Inferred from the order of events while building the refit
(2026-11-10), not seen: headless capture never caught it. Watch a slow resize in a real browser
before deciding whether to redraw inside the callback.
