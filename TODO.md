# TODO

Work klieg owes that has no other home yet.

## A placed word does not refit when its element resizes

A fire sizes the word once, from `stage.viewportBudget` when it starts. After that, the stage's
`ResizeObserver` only resizes the canvas and its lens, so a word in an element that narrows mid-fire
overflows it, and one in an element that grows stays small. Seen in the composition lab when a
second trial halves the first one's width; the lab works around it by firing again on resize.

## The composition lab cannot turn its sign yet

Built on branch `composition-orbit`, waiting on a weasel release with labkit's orbit capability and
its icon registry; the branch typechecks only once klieg pins that weasel. It maps the trial's
camera onto `FireHandle.turn`: yaw and pitch to a rotation, distance to a uniform scale, target to
a translation. Until the release, run it with `WEASEL=<checkout>`. The tube lab's hand-rolled drag
(`dev/tube-lab/src/App.tsx`) moves onto the same capability after that.
