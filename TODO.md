# TODO

Work klieg owes that has no other home yet.

## A wrapped word keeps its line breaks through a resize

A running fire refits to its resized element by scaling the same layout (2026-11-10), so a word
fired with `wrap: true` keeps the breaks it chose for the first box. In a box that turns from
wide to tall it stays on one line and shrinks, where a fresh fire would break it and render larger.
Re-wrapping mid-fire moves letters the way a `stages` regroup does, so it would need the regroup's
part and travel handling.

## The composition lab drifts 3 px on a turn after a zoom

`npm run probe:lab -- composition-lab` reads 3.2 px on its turn-after-zoom check, over the 3 px
tolerance, on main at 019246e as well as with the tube lab's face-pivot fix (2026-11-10); every
other check holds under 1.5 px. Core's `pointOn` answers the first surface the ray hits, so part of
that may be the reading landing on a tube wall rather than the face. The tube lab's readout
(`dev/tube-lab/src/readout.ts`) reads where the ray crosses the face's plane and holds that lab to
0.0 px; reading the composition lab the same way would say how much of the 3.2 px is real.

## A resize may blank the canvas for a frame

The stage resizes its drawing buffer inside its `ResizeObserver` callback, which runs after the
frame has drawn, and resizing a buffer clears it. So a canvas may show empty for one frame per
resize until the next tick redraws it. Inferred from the order of events while building the refit
(2026-11-10), not seen: headless capture never caught it. Watch a slow resize in a real browser
before deciding whether to redraw inside the callback.

## A hinge's stops never run on blits' lanes

A `hinge(signal, factory)` plays as a `mix.blend` of its stops, and a blend is a role in blits. blits
keeps a role off its lanes when it writes a channel that folds by `last`, and `EffectFrame` declares
every voice as writing all of `PART_CHANNELS`, `color` (an `ink(last())`) among them. So every stop
runs on blits' general path even when no stop writes `color`, whatever the signal. A hinge over a
patch, which plays as one weighted voice, does run on a lane under `level()` (checked 2026-11-12
on blits 1.3.0 by reading the mix's lanes per voice id from `describe()`). Getting stops onto lanes
means declaring what an effect patch writes, which `EffectPatch` has no field for.
