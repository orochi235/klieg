# TODO

Work klieg owes that has no other home yet.

## The composition lab typechecks only beside a weasel checkout

The lab's effects diagram uses `@weasel-js/diagram` APIs weasel has not released (overlays, hover,
row reorder, refit, `nodeStyle` returning `undefined`), so `dev/composition-lab/tsconfig.json`
maps `@weasel-js/*` to `~/src/weasel`'s `dist` and its dev script serves from there. The root
`tsconfig.json` references the lab, so `npm run typecheck` fails anywhere without that sibling
checkout: CI, Pages and the release workflow, which gates publishing. Once weasel releases those
APIs, pin every `@weasel-js` package to that release, add `@weasel-js/diagram`, and drop the
mapping and the script's `WEASEL` default.

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

