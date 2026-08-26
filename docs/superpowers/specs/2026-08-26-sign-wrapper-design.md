# The sign wrapper — design

**For:** whoever implements `klieg/sign` and `<klieg-sign>`. **Answers:** what a sign is, what the
element exposes, and what core has to grow first.

`createKlieg` + `fire` is the right shape for the case klieg was built for — a burst slammed over a
running app — and the wrong shape for a **sign**: type that stands in for a heading, lights once and
stays. A sign consumer writes the same integration every time, and the portfolio masthead that
prompted this got three things wrong on the way: it holds for 24h because nothing means
"indefinitely", it leaves `selectable` at its default and so puts the word in the accessibility tree
twice, and it compensates for centring in CSS.

Two units ship, plus one addition to core.

## What a sign is

Three `FireOptions` are the wrapper's call rather than the caller's, because varying them makes
the thing something other than a sign:

| | |
|---|---|
| `enter: 'none'` | An anchored canvas crops to its box and every enter piece travels outside it. |
| `hold: 'forever'` | New in core; see below. |
| `selectable` | Derived from where the text came from — see `sign()` below. |

## `sign()`

```ts
export interface SignOptions {
  font: string                    // required; no default
  text?: string                   // defaults to anchor.textContent
  look?: Look
  tint?: number | string          // a CSS color, `currentColor` or `var(--x)`, resolved off `anchor`
  framing?: Framing               // including `align`
  lighting?: LightingSlot
  bloom?: boolean
  effects?: EffectSpec[]
  fire?: FireOptions              // merged over everything above
  onLit?: (lit: boolean) => void
}

export interface Sign {
  readonly lit: boolean
  update(patch: Partial<SignOptions>): void
  destroy(): void
}

export function sign(anchor: HTMLElement, options: SignOptions): Sign
```

`sign()` owns one klieg instance and fires once into it. It resolves the tint against the anchor's
computed style, so a page whose palette lives in a custom property gets a sign that cannot drift from
it. `update()` re-fires; attribute changes on a sign are rare enough that diffing them is not worth
the branch.

**`onLit(true)` fires synchronously before `fire()`, not when pixels land.** Building the word blocks
the main thread for ~460ms and nothing paints during it, so a callback placed after the await arrives
seconds late — measured at 6.1s for a build that ran 0.2s–5.9s. The caller uses it to hide whatever
the type is standing in for, and it has to win that race by starting before the block.

**`selectable` is derived from where the text came from**, because that is what decides whether the
page already carries it:

| text from | mode | why |
|---|---|---|
| `anchor.textContent` | `'none'` | The anchor's own markup is the DOM copy. |
| `options.text` | `'hidden'` | Nothing else carries the word. |

Getting this wrong is invisible on screen and loud in a screen reader. `HIDDEN_CSS` clips rather than
hiding so its node stays in selection, find-in-page and the accessibility tree; a slotted heading
turned transparent stays in all three for the same reason. Both present means the word is announced
twice and matches ⌘F twice.

`font` has no default. Bundling a typeface is a licensing decision the library does not get to make
for its consumers.

## `<klieg-sign>`

```html
<klieg-sign font="/fonts/x.otf" look="tubing" tint="currentColor" bloom>
  <h1>A Name</h1>
</klieg-sign>
```

The consumer's own heading stays in the page: readable before any script runs, selectable, findable,
in the markup a crawler reads. Type size stays the consumer's `font-size` on their own element —
`framing` is a proportion of the anchor, never a size.

Attributes, each observed: `font`, `text`, `look`, `tint`, `framing-width`, `framing-height`,
`align`, `lighting`, `bloom`. Properties `.look`, `.effects` and `.options` carry what an
attribute cannot serialize, `.options` being the full `FireOptions` escape hatch — so a field core
grows later reaches consumers without an element release.

**The module imports nothing from core statically.** `connectedCallback` does `await
import('./sign.js')`. The element is DOM plumbing measured in kilobytes and three.js arrives only
when an element actually connects, so a page that ships the tag on one route does not pay for it on
the others.

One `<style data-klieg-sign>` is appended to `document.head` at registration, once:

```css
@layer klieg {
  klieg-sign { display: block; position: relative; }
  klieg-sign[lit] [data-klieg-fallback] { color: transparent; }
}
```

`display` and `position` are not taste: `claimAnchor` rejects `display: contents|inline` and needs a
containing block. `@layer` means a consumer rule beats these without specificity games.

**The element marks its element children `data-klieg-fallback` at connect, before klieg appends
anything.** An element placement appends the canvas and the text layer *into the anchor*, so a
`> *` rule would catch them too.

`[lit]` is set with `setAttribute`, never through a framework's state, for the reason `onLit` gives.

Two builds: `klieg/element` for a bundler, and a prebuilt `klieg/element/standalone` subpath with three
inlined for a `<script type="module">` on a static page. Both subpaths declare their own
`sideEffects` — registering a custom element is one, and core declares `sideEffects: false`.

## The core change: `hold: 'forever'`

`FireOptions.hold` becomes `number | 'click' | 'forever'`. A `'forever'` fire never settles until
`destroy()`, and unlike `'click'` it is legal under an element placement. Both completion paths need
it: `Timeline`/`Sequence`'s `isFinished`, and the reduced-motion branch's `since >= hold`.

It blocks its instance's queue permanently, which is correct — a sign owns its instance and fires
once. A minor, and the wrapper cannot ship before it does.

## Degradation

| | |
|---|---|
| No WebGL | `sign()` returns an inert handle, `lit` stays false, the anchor is never touched. |
| No JS, or the import fails | The slotted heading is simply there. Nothing to detect and nothing to undo. |
| Reduced motion | The sign shows. `effects: []` and `lighting: 'static'` still the one thing that moves. |

Suppressing the sign under reduced motion is the wrong lever: a held pose is a still image, and there
is nothing in it to suppress.

## Testing

`sign()` unit-tests against a stubbed core, no GL: the unsupported path leaves the anchor untouched,
reduced motion strips the effects, `tint: 'currentColor'` resolves off computed style, `destroy()`
during the font load fires nothing. The element goes in the lab's playwright suite: the heading is
readable with JS disabled, `[lit]` appears, the canvas attaches, disconnect frees the context. One
static page with a script tag and no bundler is the only thing that proves the standalone build.

## Out of scope

Other scenario wrappers. A one-shot celebration element is the obvious sibling and has no consumer
asking for it; the `sign()`/adapter split is the seam it would arrive through.

## Decisions not visible in the code

- **The element is an adapter, not the abstraction.** `sign()` is framework-free and testable without
  a custom element registry; the element is attributes in, `sign()` out. A consumer who does not want
  a custom element gets identical behavior from the function.
- **Sign policy does not belong in `createKlieg`.** Which look, when to give up, what reduced motion
  means — core's job is mechanism, and a `mode:` per scenario would grow the entry point once per
  wrapper.
- **`align` is passed through, not compensated for.** `Framing.align` defaults to `'start'` under an
  element placement, so a sign meets its container's text edge with nothing on this side.

- **`lighting` is `LightingSlot`, so a sign composes env pieces exactly as a fire does.** Reduced
  motion still replaces the whole slot with `'static'`, which resolves to `still()` — the sign is
  shown and only what moves is stilled.

- **`sideEffects` must name the source path as well as the built one.** The array listed only
  `./dist/element.js`, so a consumer whose bundler resolves klieg to source — a monorepo alias, the
  lab's own — had rollup read the element as pure and delete the import entirely, shipping a page
  that lit nothing. `./src/element.ts` is listed too; it costs published consumers nothing, since
  `files` never ships `src/`. A unit test asserting the array exactly was what held the bug in
  place.

- **A sign holds a global `pointermove` listener for its lifetime.** `createKlieg` attaches one on
  the first fire and releases it only on `destroy()`, so a fire that never settles keeps it — one
  per sign, freed on disconnect. Verified not to leak, but it is a cost this design did not
  account for.

- **The stylesheet is a `<style>` tag, not `adoptedStyleSheets`.** Constructable-stylesheet support
  is uneven enough that the alternative was a capability branch plus this fallback anyway — two code
  paths to prove instead of one. One rule either way, and `@layer` still puts it under the consumer's.
