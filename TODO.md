# TODO

Work klieg owes that has no other home yet.

- **Move the effect rig's `color` channel off blits' deprecated `hex()`.** In
  `packages/core/src/effects/rig.ts`, `color: hex()` becomes `color(last(), { lerp: 'oklch' })`.
  It replaces, and it interpolates in OKLCH, just as `hex` does, but holds OKLab `[L, a, b, 1]`
  rather than `0xrrggbb`. So authored colors go through blits' `oklab(0xrrggbb)`, and a pose's color
  is written back with `toHex(pose)` or `css(pose)`. This waits on the blits release that carries
  `color()`, which is unreleased on blits' `color` branch as of 2026-10-07. It should move no
  pixels, since every klieg effect voice plays at full weight with no locus and so never
  interpolates a color. That is inferred from the code, not run: check the Playwright specs before
  claiming it.
