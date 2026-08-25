# Material and lighting findings — what to try

**For:** whoever wants to experiment with how klieg's looks respond to light. **Answers:** what is
broken, what is unreachable, and the exact command to see each one.

Everything here was found while designing
[composable lighting](2026-08-25-composable-lighting-design.md) and is verified by rendering, not by
reading. Each item names the spike that proves it.

## The spikes

Both serve klieg's built `dist` over an ephemeral port and drive it headless with SwiftShader, so
results do not depend on the machine. **Run `npm run build -w klieg` first** — they read
`packages/core/dist`, not `src`.

| | |
|---|---|
| `spikes/lamp-falloff.mjs` | Does a per-part brightness change reach the screen on each look? Renders lamp-on and lamp-off and compares md5. Flags: `--kind body\|run`, `--looks`, `--radius`, `--strength`, `--em`, `--ei`, `--out`. |
| `spikes/lamp-blend.mjs` | How should a lamp combine with the material under it? Flags: `--blends`, `--looks`, `--strength`, `--lamp <hex>`, `--env`, `--out`. |

`--blends` takes `none`, `add`, `albedo`, `hue`, `screen`, `env`, `envown`, `envtest`, `roughtest`.
Both write PNGs and print a table; identical md5s across two rows mean the change never reached the
GPU.

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
