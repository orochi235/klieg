# The acronym routine — design

**For:** whoever builds this in `packages/core/src`. Assumes you know `fire()` plays enter, active
and exit over a word, and that `stages` can drop letters and lay the survivors out again.
**Answers:** what `acronym` is, and the two things missing from `stages` that it needs.

## What it is

Type a multiline string with the acronym's letters capitalised. The block renders with the capitals
picked out, waits, the lower-case letters leave, and the capitals gather into a line and stay up
until dismissed.

```ts
await bk.fire(...acronym(`Keep
Lighting
Interesting, Every
Glowing letter`));
```

`stages` already does the hard part — the README's acrostic example is this effect assembled by
hand. `acronym` is the pre-baked version, and it is composition, not new machinery.

## The two gaps

**`LetterInfo` carries no character.** `keep` and `tint` are handed `index`, `line`, `column`, `x`
and `y`, so "is this capital?" cannot be asked. A caller can index the original string by `index`,
but that is a trap the moment whitespace and line breaks are counted differently than they expect.
`char` goes on `LetterInfo`, populated where the block is laid out.

**`Arrangement` is `'line' | 'stack'`, with no way to stay put.** The effect has two beats — the
lower-case letters leave *in place*, then the capitals travel — and without a third arrangement they
collapse into one move. `'place'` keeps the survivors on the layout they already have.

Both are additive. Nothing existing changes.

## The routine

```ts
export function acronym(text: string, options?: AcronymOptions): [string, FireOptions];
```

Returns the arguments to `fire()` rather than firing, so every slot stays overridable and the
routine cannot own the queue policy, the look, or the lighting. `sweep()` and `roving()` set the
precedent for a builder that hands back a value.

| field | default | |
|---|---|---|
| `caps` | `{ tint: … }` | how the capitals are styled, before and after they gather |
| `body` | none | how everything else is styled while it is still up |
| `read` | `'click'` | the pause after the block renders, before the body leaves |
| `settle` | `0` | an extra pause after the body has gone, before the capitals gather |
| `hold` | `'click'` | how long the gathered acronym stays |
| `exit` | `'fade'` | how the lower-case letters leave |
| `active` | `'none'` | what the gathered acronym does while it holds |
| `tween` | none | timing for the gather |

`caps` and `body` are a `LetterStyle`, not a colour, so the styling axis can grow. Today it carries
`tint` alone. A per-letter `look` is the intended growth and does not fit yet: `look` is per-fire and
reaches the material pipeline long before a letter is addressable, so promising it here would be
promising a rewrite. Taking an object now means adding it later is additive.

A capital is a character whose lower case differs from itself — locale-independent, and it drops
digits and punctuation, which is what an acronym wants.

## What it builds

```ts
{
  hold: read,
  tint: (l) => (isCap(l) ? caps.tint : body.tint),
  stages: [
    { keep: isCap, exit, as: 'place', hold: settle, tween: { duration: 0 } },
    { as: 'line', active, hold, tween },
  ],
}
```

## Acceptance

A visual test on a multiline block, sampled at each beat: the capitals tinted in the full block, the
block after the lower case has gone with the capitals still where they were, and the gathered line.
Unit tests cover the predicate against accented capitals, digits and punctuation, and that `'place'`
leaves every survivor's `x` and `y` untouched.
