# `attach` and `pointOn` — design

**For:** whoever maintains klieg's frame loop, or wires something that draws into it. **Answers:**
how an outside object draws in klieg's scene, and how a client position finds the type.

**Status: built** on `attach-point`, 2026-09-15, for magicsmoke's sparks on the portfolio masthead.
What a caller sees is in the README's "Drawing in the type's scene"; this holds what the code does
not say.

## `attach`

- **One clock subscription for as long as any layer is attached**, not only while one is live. A
  layer can start something with no call into klieg — magicsmoke's faults discharge on their own —
  and nothing would wake a stopped loop. The price is a frame callback reading `live`.
- **Whoever is already drawing draws the layers.** A fire's tick steps them, once per `now`, before
  it renders. The layer loop renders only while no fire holds a subscription and nothing has drawn
  at this `now`, so a fire never costs two renders a frame.
- **Idle teardown.** A fire's settle does not arm it while a layer is live; the layer loop arms it on
  the frame the layers go quiet, after drawing one clearing frame. The scene, and the layer's object
  with it, survives an unmount, so a layer going live again only needs `Stage.mount()`.
- **No bloom between fires.** A `BloomPath` belongs to a fire and is disposed when it settles.
- **A layer whose `update` throws is detached**, and the error rethrown in a microtask as `RafClock`
  does for a subscriber. Left attached it would throw every frame.

## `pointOn`

- **A raycast against the fired words, not `layoutFromNdc`.** The layout mapping ignores `transform`,
  pose, effect offsets and `eye`; the raycast follows all of them and yields a depth, which the pixel
  ratio needs.
- **Meshes with a hidden ancestor or no opacity are skipped**, since a letter mid-exit keeps its
  geometry. The sheet look's carrier disables its layers, which three's raycaster already honors.
- **The hero only.** A backdrop row showing between the hero's letters would answer with a point far
  behind the type.
- **`unitsPerPx`** is the frustum's height at the hit's depth over the canvas' CSS height. An
  off-center eye skews the frustum without changing that height.

## Not verified

Nothing has drawn a layer on a real WebGL canvas. The tests raycast real three geometry and drive
the frame gating with `ManualClock`, under a stubbed renderer.
