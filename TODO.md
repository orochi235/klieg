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

## Word caches grow without bound for the life of an instance

`packages/core/src/render/caches.ts:WordCaches` keeps glyph geometries (keyed by font, character,
depth, and inflation), contours, tube blueprints, and baked sheets until `destroy()`; nothing evicts
an entry, and the stage idling or unmounting leaves the maps full. A long-lived instance that fires
many distinct looks, parameters, or scripts accumulates GPU and heap assets while it looks idle.
The fix needs a design choice: an entry or memory budget with leases protecting what live words
hold, or a documented safe reset at an idle boundary. Inferred from the source; no memory
measurement was taken. (filed 2026-11-15 from automated review)

## Concurrent sweep effects fight over one environment rotation

`packages/core/src/api.ts` (the `policy` option's doc comment) says `concurrent` is unsound for the
`sweep` lighting: every live effect writes the shared environment rotation from its own elapsed
time, so the highlight sawtooths between their phases. The API still accepts that combination, so a
valid-looking call gives unstable output. Pick one contract: per-effect lighting isolation,
instance-owned lighting that effects do not drive, or rejecting a concurrent `sweep` fire at the
call site. (filed 2026-11-15 from automated review)

## Geometry that weasel's `geom` could own

Found while sizing up what to share with weasel (2026-11-25); read from names and docstrings, not
diffed. klieg has more than one copy of some ring helpers: `render/tube/resample.ts` and
`render/wells/rings.ts` each have `resample` and `smooth`, and `tube/offset.ts` `orientRings`
repeats `wells/rings.ts` `orient`. `@weasel-js/geom` already has `ringSignedArea`,
`polygonContainsPoint` and an exact arc-length query (`along`) that would replace the hand-rolled
sums in `tube/legs.ts` and `tube/wander.ts`. `text/sfnt.ts` copies `@weasel-js/font`'s internal
`outline/sfnt.ts` and `dataFork.ts`, which the font package doesn't export. Weasel has no signed
distance field, isocontour or rotation-minimizing-frame code, so `tube/field.ts` and
`tube/frames.ts` would be new to it.

## The logo lab needs a public tube API

`~/src/pw/logo` can't tube the logo until klieg exports what its spike deep-imports from `dist`
(`spikes/svg-tube/main.js:16–20`): `buildTubeBlueprint`, `tintByRunColor`, `tintChannelOf`,
`createMaterial`, `applyLook`, `Stage`, `BloomPath`, `glyphToShapes`. The public index exports only
`specOf`, the tube types and the break presets (`index.ts:151–166`). Read 2026-11-25. Closes when
the logo lab builds on public imports only.

## Crossfades on blits' `mix.arc`

The motion compositor works out its enter/active/exit crossfade weights itself
(`packages/core/src/motion/compositor.ts`, `weightAt`), although blits' `mix.arc` took its ramp from
here. This comes before klieg moves onto blits' show schema, which compiles slots to `mix.arc`.
Closes when the compositor cues arcs and keeps no weights of its own.

## One glyph pipeline with weasel

klieg parses fonts with opentype.js (`src/text/font.ts:77`) and hands weasel the parsed font through
a custom parser (`outline-face.ts:57`), which skips weasel's GPOS kerning. It kerns with
`getKerningValue` instead, and keeps a drifted copy of weasel's `sfnt.ts`.

**klieg doesn't kern at all today.** On Inter, `getKerningValue` gives 0 for AV, To, AT, LT, Yo, ov
and rn. weasel's GPOS reader gives AV −140, To −160, AT −174, LT −197, Yo −157, ov −40, rn +32 font
units (measured 2026-11-26).

weasel's side is built and unreleased (weasel batch 2026-11-26): `registerFontOutlines(…, { parsed })`
plus exported `isFontCollection`, `isDataForkFont`, `sfntFromCollection`, `collectionNamesOf` and
`openTypeModuleOf`. weasel's `sfnt.ts` already has every fix klieg's copy has. Once a weasel release
carries it:
1. Delete `packages/core/src/text/sfnt.ts` and import the collection helpers from `@weasel-js/font`.
2. In `font.ts`, replace lines 7–11 with `const { parse } = openTypeModuleOf(opentype);`.
3. In `resolveFace`:
   - Use `collectionNamesOf` in place of `collectionFaces`. It returns `null` for an unnamed member.
   - Note that weasel's `sfntFromCollection` returns `bytes: null` on an unknown name, rather than the
     first member.
   - Decide whether to keep refusing `.dfont`, which weasel now opens.
4. In `outline-face.ts`, call `registerFontOutlines(family, {}, loaded.bytes, { parsed: loaded.font })`
   and delete `faceOf` and its unused `glyphD`.
5. Kern from weasel's face (`kernOf`/`advanceOf` on `outlineFace(family, 400, 'normal')`) instead of
   `getKerningValue`. This step is the one that brings in kerning.

Closes when klieg reads glyphs and kerning through weasel and `sfnt.ts` is gone.

## The fullscreen overlay is written twice

klieg's stage (`packages/core/src/render/stage.ts`) and magicsmoke's `src/canvas.ts` each build the
same fixed, transparent, z 2147483000 overlay canvas with DPR capped at 2 and window resize. Closes
when one owns it and the other uses it.

## Move onto blits' show schema

blits `main` has `@msb235/blits/show` (merged 2026-11-26, unreleased): a plain-data `Show` of `Cue`s,
and `play(mix, show, kinds)`, which cues each one on a mix. Slot cues compile to `mix.arc`. The
planned order across repos is x-xstitch and x-pcb, then beamos, then blinken, then klieg. blits'
`docs/show.md` rewrites this repo's schema as a `Show` and lists what doesn't fit. Its crossfades move onto `mix.arc` first ("Crossfades on blits' mix.arc" above). Custom `MotionPatch`es, looks, lighting, tint and transform aren't data, so they stay registered kinds. Closes when this
repo schedules through `play`.
