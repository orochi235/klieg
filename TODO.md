# TODO

- **Drop `startAt`** once blits' `slew(of, { from })` and `lag(of, { from })` snap to their input
  on a subject's first frame under reduced motion. In 0.5.0 they hold `from` that frame, which
  breaks `dwell`'s and `track`'s reduced-motion tests, so `effects/signal.ts` keeps `startAt(0, …)`
  for both. Filed in blits' HANDOFF loose ends.
