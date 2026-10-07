# Chunks and `sequin`

**For:** whoever changes the chunk generator (`render/decorations/chunks.ts`) or tunes a chunk
look. **Answers:** why `sequin` ships at the numbers it does, and which of them cannot be the ideal.

- **Measure coverage, never a render diff.** `poolFor` derives the pool from `count`, so a changed
  count reseeds the whole arrangement. `node spikes/sequin-coverage.mjs` rasterizes every disc's
  footprint into one mask: 520 paints 77% of a letter, 1040 paints 96% for 14ms more over seven
  letters, 2080 spills past the silhouette for 170ms. `sequin` ships at 1040.
- **`relief` darkens a chunk by the surface normal**, folded into the indirect terms where an AO map
  would land — a disc at `metalness: 1` shows what it reflects, so diffuse color cannot carry it.
  `sequin` ships at 0.7: at 1 a disc facing away reads as a hole, at 0.5 the silhouette does not
  separate. It is baked per instance in letter space, so it turns with the word like paint, not like
  a lamp.
- **`lie` must not be 1.** Perfectly flat discs are parallel mirrors returning one reflection, and
  the field reads as a dull sheet. `sequin` ships at 0.88.
- **`proud` must not be 0**, or a disc z-fights the surface across its whole face. It ships at 0.08.
- **`lie` lays a chunk onto the outward normal**, so the field is `FrontSide`-safe from 0.8 up. Reach
  that normal by the near side of the plane: `Quaternion.setFromUnitVectors` loses precision near
  antiparallel, which placed chunks differently on macOS and Linux CI. The placement pin catches it,
  and only on CI.
- **`jitter` is a second dial on the cap/band split.** Too tight a stray rejects cap draws until the
  sampler hits a band triangle, so cap samples fall from 1236 at 0.5 to 51 at 0.05.
  `spikes/bed-lattice.mjs` measures both.
- **The lattice governs the caps only.** A bed is in word space; projected onto the extrusion band it
  smears, so the band keeps free placement.
- **A `flake` is a zero-thickness quad** drawn `DoubleSide`; thinness was never what was missing.
- **The back-cap waste is not worth fixing.** About a quarter of `sequin`'s chunks land on the back
  cap, but real-GPU frame time was 2.2–2.3ms whether a look drew 55 chunks or 1, and the back cap is
  on screen during two shipped enters.
- **A lab control that clamps below a spec value measures the clamp.** The tube lab's count slider
  was `max="512"` while `sequin` asked for 520; `setRange` now warns.
