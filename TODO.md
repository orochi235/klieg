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

## labkit does not re-measure a trial whose sidebar slides it

In labkit 1.18.2, a trial's Settings sidebar settling after load slides the panel sideways, and the
lab never re-measures the tile, so the tube lab drew every letter about 90 px off its tile (seen
2026-11-11). The tube lab sidestepped it for a while by hiding the per-trial sidebar and putting letter, mode and
ramp source in each trial's toolbar. The sidebar came back on 2026-11-11, and the offset did not
reproduce headless at 1600×1000, so watch for it in a real browser before reporting it to weasel.
