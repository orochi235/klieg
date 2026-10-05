# TODO

## When klieg moves past @msb235/blits 0.4.0

The next blits release carries three things klieg works around today. Each workaround goes once
klieg depends on it.

- **Drop `hostOf`.** blits types `setting.host` through `mix<I, O, H>`, `Setting<S, H>` and
  `Signal<I, H>` (blits `c033507`). Cue the part and env mixes with `Host` as `H`, type klieg's
  `Signal` as `Signal<PartInfo, Host>`, and read `setting.host` directly. `hostOf` shipped in 0.15.0, so
  removing it is breaking: it goes out in a minor release, 0.16.0 or later.
- **Drop `startAt`.** `slew(of, { from })` and `lag(of, { from })` start a subject at `from` (blits
  `c033507`). `dwell` and `track` use `startAt(0, …)` in `effects/signal.ts` for exactly this.
- **Drop the zero-weight early return** in `effects/frame.ts`'s `voiceOf`. blits skips a patch's
  `at` at weight 0 itself (blits `c6de97e`). Keep the test that counts a stops hinge's patch runs:
  it pins the behavior whichever side provides it.
