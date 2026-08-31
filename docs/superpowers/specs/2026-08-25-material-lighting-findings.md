# Material and lighting findings — what to try

**For:** whoever wants to experiment with how klieg's looks respond to light. **Answers:** what is
broken, what is unreachable, and the exact command to see each one.

Everything here was found while designing
[composable lighting](2026-08-25-composable-lighting-design.md) and is verified by rendering, not by
reading. Each item names the spike that proves it.

**Items 1 and 5 shipped in `deebe56`, after this file was written.** A struck heading means the
finding is fixed and the item is kept only for the mechanism under it. Re-read the code before
acting on any item here: the file is dated, the tree is not.

## The spikes

All three serve klieg's built `dist` over an ephemeral port and drive it headless with
SwiftShader, so results do not depend on the machine. **Run `npm run build -w klieg` first** — they read
`packages/core/dist`, not `src`.

| | |
|---|---|
| `spikes/lamp-falloff.mjs` | Does a per-part brightness change reach the screen on each look? Renders lamp-on and lamp-off and compares md5. Flags: `--kind body\|run`, `--looks`, `--radius`, `--strength`, `--em`, `--ei`, `--out`. |
| `spikes/lamp-blend.mjs` | How should a lamp combine with the material under it? Flags: `--blends`, `--looks`, `--strength`, `--lamp <hex>`, `--env`, `--out`. |
| `spikes/lamp-proof.mjs` | Does `lamp()` reach the screen on every look and every source it claims? A lamp-on/lamp-off pair per look, `orbit` at eight driven phases, and a real pointer swept across a full sign, a small one and a regrouped one. Exits non-zero on a byte-identical pair, on a frame that had to be lit and was not, and on a pointer sweep whose light does not move the way the cursor did. Writes a contact sheet per group. Flags: `--looks`, `--text`, `--only`, `--orbit-radii`, `--out`. |

`--blends` takes `none`, `add`, `albedo`, `hue`, `screen`, `env`, `envown`, `envtest`, `roughtest`.
They all write PNGs and print a table; identical md5s across two rows mean the change never reached
the GPU.

## 1. ~~`envMapIntensity` has never been applied~~ — fixed in `deebe56`

**Shipped.** Materials carry the studio as their own `envMap` now, which makes the authored value
live and makes `envMapIntensity` a `LookKey` a look can set for itself. Every look renders at its
authored exposure rather than at an effective 1.

The mechanism is worth keeping because it generalizes: three overwrites `envMapIntensity` with
`scene.environmentIntensity` on any material that has no `envMap` of its own, so a property can be
set, read back correctly, and never reach a pixel. The test that covered it asserted
`envMapIntensity === 2.2` on the material it had just constructed and stayed green for the whole
life of the bug. **Assert what reaches the screen, or assert nothing.**

## 2. A brightness multiplier is a no-op on seven of eight looks

`PartOffset.gain` multiplies `emissiveIntensity`, and `DEFAULTS.emissive` is black.

```
node spikes/lamp-falloff.mjs --kind body    # only `neon` responds
node spikes/lamp-falloff.mjs --kind run     # only `tubing` and `piping`
```

`tubing` and `piping` respond only because their decoration borrows `neon`'s emissive. Anything that
lights a letter by scaling what is already there will hit this.

## 3. If a lamp writes emissive, multiply it by the look's hue

```
node spikes/lamp-blend.mjs --blends none,add,albedo,hue --looks gold,chrome,gem,velvet
```

`add` (flat white) washes gold to cream and gem to white. `hue` multiplies the lamp by whichever
property carries that look's colour — `tintTargetOf`'s rule — and gold lights gold, chrome keeps its
blue-steel, and **gem comes back crimson** because its red lives in `attenuationColor`, not `color`.

A baseline emissive that gain scales is wrong in a different way: it is present on every part whether
the lamp reaches it or not, and flattens gold to gray plastic.

## 4. `gem` cannot be lit with one knob

At `env=0` gem reads red — the attenuation is working as authored. Raising env lays specular
reflection *over* it and the red washes to blue-gray. Red-but-dark, or bright-but-gray, with nothing
between.

```
for E in 0 1 2.2 6 14; do node spikes/lamp-blend.mjs --blends envown --looks gem --env $E --out spikes/lamp-env; done
```

**Two specular lobes stack on it, and both must come down.** `gem` inherits `clearcoat: 1` from
`DEFAULTS`, and clearcoat is a separate lobe that `specularIntensity` does not touch. Tested at
`env=6`:

```
node spikes/lamp-blend.mjs --blends envown --looks gem --env 6 --over clearcoat:0
node spikes/lamp-blend.mjs --blends envown --looks gem --env 6 --over clearcoat:0,specularIntensity:0
```

`clearcoat:0` alone still mirrors gray. So does `specularIntensity:0` alone. **Both together bring
the red back** — and it is red *and dark*, because transmitted light has nothing behind the letters
to pick up. Saturation is recoverable through the material; brightness is not. That half is a
backdrop problem: `transmission` samples the scene behind the glass, and klieg renders on a
transparent overlay over an empty one.

`--over` takes any `LookKey`, as `key:value` pairs, with `#` for hex — `--over clearcoat:0,color:#ff0000`.

## 5. ~~The extrusion walls read as cement~~ — fixed in `deebe56`

**Shipped, and it had to ship with item 1.** Raising exposure alone made the walls worse: faces and
walls share one `ExtrudeGeometry` and one material, so a metal's walls show only what they reflect,
and a blue fill against a warm base colour is gray. The fill bars and shell are warm-balanced at 0.7
toward the studio's own warm bar, holding each bar's luminance.

A deliberate warm/neutral asymmetry remains — the bar at `x: 14` is warmer than the one at `x: -14`
— so a wide sign still reads brighter on its right. That is studio lighting, not the cement bug, and
a left-to-right falloff across a long word is not evidence of a regression.

## 6. Specular is authorable now; `reflectivity` stays out

~~`specularIntensity` and `specularColor` are absent from `LookKey`~~ — **added**. `reflectivity`
was deliberately left out.

The addition moved no baseline: three's defaults are `1` and `0xffffff`, and `gold`, `chrome`, `gem`
and `velvet` all render to the same md5 as before the change.

**They only bite on non-metals.** The shader ends with
`specularColorBlended = mix(specularColor, diffuseColor, metalnessFactor)`, so at `metalness: 1` the
specular colour *is* the base colour and both knobs do nothing. That makes them a `gem` and `velvet`
tool, and inert on `gold`, `chrome` and `oil`.

**Do not add `reflectivity`.** In three it is an accessor over `ior` — the same underlying value
through a second name. With `ior` already authorable, adding it means whichever is applied last
silently wins.

## 7. `sequin` is unreachable by any effect

Run parts are built only from the tube pipeline, so `sequin` — decoration `kind: 'chunks'` —
produces **zero** of them, and a run-targeted effect never lands. Its `body` is the wrong target too:
a near-black `0x2a0f1c` backing under the disc field that carries the whole look.

Reaching it means a `'chunk'` `PartKind` addressing the letter's `InstancedMesh`. Cheaper than it
sounds — `createMaterial()` runs per letter, so each letter's chunk field already owns its material.
Only lighting *individual* sequins needs `instanceColor`.

## 8. Layout space is not centred on zero

`KLIEG` gives `x ∈ [-1.72, 0.89]` and `y = 0` on every part. Anything mapping a pointer or a path
into the word must read the real extent rather than assume a symmetric range, and `y` only earns its
keep on multi-line blocks.

## 9. A lamp sits under the cursor only when the word's ink fills the canvas

`pointerInWord` maps the canvas's whole −1..1 onto the word's ink box per axis, so the cursor's
whole travel compresses onto the letters: the light leads the cursor at the left of the sign and
lags it at the right, and matches only where the ink fills the canvas. The fit is aspect-limited, so
a sign can fill its framing box and still leave most of the canvas empty — on a 1000×220 strip
`framing: { width: 0.9, height: 0.6 }` is limited by the height and puts `KLIEG` into 612 of the
1000 px.

| cursor x | 250 | 500 | 750 |
|---|---|---|---|
| light centroid, `framing 0.9 × 0.6` (ink 195..807) | 389 (+139) | 579 (+79) | 734 (−16) |
| light centroid, `framing 0.3 × 0.3` (ink 354..647) | 446 (+196) | 538 (+38) | 613 (−137) |

On the small sign the sweep starts and ends off the letters entirely and the light still crosses the
whole word — that is the stretch, and it is the larger of two offsets.

The second is that a lamp measures from each part's **origin** while the cursor is mapped into the
**ink** box, and those are different frames. In y it is exact and it is large: a cursor at the
vertical middle of the letters maps to `y = 0.344` em while every part sits at `y = 0`, so 69% of a
lamp's 0.5 em reach is spent before any horizontal distance is counted. The strongest reading a
`fromPointer` lamp at `strength: 2.5` produced anywhere was `amount` 0.565. In x it is about half a
glyph, since a part's origin is its left edge.

Closing either one is its own change: `projectLetters` in `text/projection.ts` is a true inverse and
`index.ts` already drives it for the DOM layer, and the y term wants a part's ink rather than its
origin.

## 10. After a regroup the light stays on the layout the sign was built with

Both the part pool and the extent `pointerInWord` maps into are construction-time snapshots. Fire
`KLIEG NOW` and let a stage keep `index >= 6`: the surviving `NOW` re-centres to x 267..746 on
screen, and a cursor anywhere on those letters lights **nothing**. The only cursor position that
lights them is x 800 — past the right edge of the ink — because that is where `NOW` sat in the
original layout.

So a pointer lamp is only honest on a sign that has not regrouped. Reaching the current layout means
rebuilding the pool and the extent when a stage re-lays the letters; it is its own change.

## 11. A `replace` gradient drops the run-colour attribute

`mode: 'replace'` samples the ramp in the tube shader and never reads the run-colour vertex
attribute, so nothing that writes that attribute survives. A lamp on every run of a `tubing`
`KLIEG` renders byte-identical to no lamp, and `hue` on the same runs is byte-identical too — the
control that shows this is not lamp-specific. `color` and `gain` land in the same place. Fixing it
is a change to the tube shader.

`mode: 'modulate'` reads the attribute, and the lamp comes through — but not as one hotspot under
it. The light multiplies a blueprint stop while the pixel colour comes from the ramp, so it arrives
as a different colour at each ramp position: on `tubing` `KLIEG` the pink-stop segments take their
light almost entirely in blue (mean +17 counts, against +4 green and 0 red) and the blue-violet ones
take theirs in green (+5, against +2 blue). It reads as a hue shift spread along the word rather
than a light on part of it.

## 12. `orbit`'s default radius is six tenths of a lamp's reach

Every part of a single-line sign sits on `y = 0`, so at the top and bottom of its circle an orbit's
whole distance to the parts is vertical. A circle as wide as the lamp's reach is therefore exactly
dark there, and anything wider is dark for most of the pass. Mean per-channel pixel lift off the
unlit frame, gold `KLIEG`, with the pass fraction driven into the piece rather than sampled by
letting the clock run:

| radius | 0° | 45° | 90° | 135° | 180° | 225° | 270° | 315° |
|---|---|---|---|---|---|---|---|---|
| 2 | 0 | 0 | 0 | 0 | 8.8 | 0 | 0 | 0 |
| 1 | 14.2 | 0 | 0 | 0 | 8.0 | 0 | 0 | 0 |
| 0.5 | 5.8 | 1.1 | 0 | 0.9 | 4.3 | 0.9 | 0 | 1.1 |
| 0.4 | 10.0 | 5.7 | 0.5 | 3.0 | 5.1 | 3.0 | 0.5 | 5.7 |
| 0.3 | 11.7 | 10.6 | 4.4 | 5.2 | 5.6 | 5.2 | 4.4 | 10.6 |

```
node spikes/lamp-proof.mjs --only orbit,orbitr --orbit-radii 2,1,0.5,0.4,0.3
```

0.3 and 0.4 both light something at every phase; 0.5 and wider do not. 0.3 is the default because it
is the one with margin — at its dimmest phase it delivers 23% of the lamp's centre strength against
4.8% for 0.4.

**Correcting `369b328`.** Its table sampled an uncontrolled absolute phase, and two of its claims
are false against the data above. 0.3 is not "the only one lit at every phase" — 0.4 is lit at every
phase too, and 0.3's distinction is being brightest at its dimmest one. And radius 2 does not "clear
them everywhere": at 180° it passes 0.278 em from the K, inside a 0.5 em reach, and lights it once
per pass. The move from 2 to 0.3 stands.

## 13. What the seam and the recoloured run look like

`node spikes/lamp-proof.mjs --only seam,run` renders both; the sheets are `sheet-seam.png` and
`sheet-run.png` under `--out`.

**Two half lamps crossing is not a seam with a notch in it.** One lamp at strength 0.9 on
`ILLUMINATION` against two at 0.45 placed ±0.5 em either side: where the pools cross each half lamp
is at half its reach and so gives half its strength, and the pair lands at 7.8 mean per-channel lift
on the ink against the single lamp's 15.1 at its centre — half, as the arithmetic says. It also
spreads that light over about twice the width. Over the whole frame the two differ by a mean of 0.49
per channel and a worst of 25, in an 87 px band about the word's centre.

**A lamp on a `hue()`-recoloured run reflects the colour the run started with.** `hue({ span: 0,
from: 0.45 })` turns `tubing` `KLIEG` cyan, and the lamp's spot on it comes out white-magenta rather
than brighter cyan: the added light averages rgb 164/60/78, which is the blueprint's magenta and not
anything on screen. A lamp on a run passes the run's own colour as the hue, and `hue` writes that
same attribute without changing what the blueprint says.
