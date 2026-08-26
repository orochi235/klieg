# Material and lighting findings — what to try

**For:** whoever wants to experiment with how klieg's looks respond to light. **Answers:** what is
broken, what is unreachable, and the exact command to see each one.

Everything here was found while designing
[composable lighting](2026-08-25-composable-lighting-design.md) and is verified by rendering, not by
reading. Each item names the spike that proves it.

## The spikes

All three serve klieg's built `dist` over an ephemeral port and drive it headless with
SwiftShader, so results do not depend on the machine. **Run `npm run build -w klieg` first** — they read
`packages/core/dist`, not `src`.

| | |
|---|---|
| `spikes/lamp-falloff.mjs` | Does a per-part brightness change reach the screen on each look? Renders lamp-on and lamp-off and compares md5. Flags: `--kind body\|run`, `--looks`, `--radius`, `--strength`, `--em`, `--ei`, `--out`. |
| `spikes/lamp-blend.mjs` | How should a lamp combine with the material under it? Flags: `--blends`, `--looks`, `--strength`, `--lamp <hex>`, `--env`, `--out`. |
| `spikes/lamp-proof.mjs` | Does `lamp()` reach the screen on every look and every source it claims? A lamp-on/lamp-off pair per look, `orbit` at eight driven phases, and a real pointer swept across a full sign, a small one and a regrouped one. Exits non-zero on a byte-identical pair or on a frame that had to be lit and was not. Writes a contact sheet per group. Flags: `--looks`, `--text`, `--only`, `--orbit-radii`, `--out`. |

`--blends` takes `none`, `add`, `albedo`, `hue`, `screen`, `env`, `envown`, `envtest`, `roughtest`.
They all write PNGs and print a table; identical md5s across two rows mean the change never reached
the GPU.

## 1. `envMapIntensity` has never been applied, on any look

`looks.ts` constructs every material with `envMapIntensity: 2.2`. klieg lights through
`scene.environment`, and that property only scales a material's **own** `envMap` — which none of
them have. Every look has rendered at an effective intensity of 1 since the value was written.

```
node spikes/lamp-blend.mjs --blends envown --looks gold,gem --env 1     # byte-identical to shipped
node spikes/lamp-blend.mjs --blends envown --looks gold,gem --env 2.2   # what was authored
```

Assigning the scene's environment texture to each material makes the knob live. **This moves every
visual baseline**, so it is its own change.

**Worth trying:** the sweep at `0, 1, 2.2, 6, 14`. Gold holds its hue the whole way and simply gets
brighter — a much cleaner "brighter gold" than any emissive add.

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

## 5. The extrusion walls read as cement because the studio is two-toned

Faces and walls share one material: `buildGlyphGeometry` makes a single `ExtrudeGeometry` and klieg
passes one material, so nothing differs in shading. The gray is what they reflect.

A metal reflects `baseColor × envRadiance`, and `render/environment.ts` lights the two sides
differently:

| bar | position | rgb |
|---|---|---|
| left | `x: -14` | `[2.4, 4.0, 7]` — blue |
| left | `x: -6` | `[2.4, 2.6, 3.4]` — blue-gray |
| right | `x: 14` | `[6, 4.4, 2.2]` — warm |

Gold is `0xffc44d`. Warm × blue is desaturated gray, so its left-facing walls go gray-lavender while
the caps and right-facing bevels stay golden. Raising env brightens the cement without warming it.

**Worth trying:** warming the left bars, or the shell (currently `top [0.05, 0.06, 0.12]`,
`bottom [0.01, 0.01, 0.02]` — blue-dominant and nearly uniform, which is what the walls mostly see).
This is environment authoring; no lamp channel can reach it.

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

`pointerInWord` maps the canvas's whole −1..1 onto the word's ink box per axis. The README promises
the light is under the cursor on "a word that fills the frame", which is too generous: the fit is
aspect-limited, so a sign can fill its framing box and still leave most of the canvas empty.
`framing: { width: 0.9, height: 0.6 }` on a 1000×220 strip puts `KLIEG` into 612 of the 1000 px,
and the light leads the cursor by up to 139 px.

| cursor x | 250 | 500 | 750 |
|---|---|---|---|
| light centroid, `framing 0.9 × 0.6` (ink 195..807) | 389 | 579 | 734 |
| light centroid, `framing 0.3 × 0.3` (ink 354..647) | 446 | 538 | 613 |

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
control that shows this is not lamp-specific. `color` and `gain` land in the same place.
`mode: 'modulate'` reads the attribute and both come through. Fixing it is a change to the tube
shader.

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

**Correcting `369b328`.** That commit moved the default on a table built by settling a second apart,
which leaves the absolute phase uncontrolled; its four samples landed on four diagonals and never
came near 0° or 180°. Two of its claims are false against the data above: 0.3 is not "the only one
lit at every phase" (0.4 is too — 0.3 is the brightest at its dimmest phase), and radius 2 did not
"clear them everywhere" (at 180° it passes 0.278 em from the K, inside a 0.5 em reach, and lights it
once per pass). The tell was in the table it printed: with every part on one line, 45° and 315° must
render identically, and its radius-1 row reported 9.6 and 0. The move from 2 to 0.3 stands.
