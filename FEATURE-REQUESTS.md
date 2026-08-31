# Feature requests

Changes consumers have asked klieg for, and the use case behind each. These are requests, not
commitments — nothing here is scheduled.

Nothing is open. The three below are kept as the provenance the
[host-driven effects design](docs/superpowers/specs/2026-08-27-host-driven-effects-design.md)
points at; all three shipped in that branch.

## Shipped

**Asked by:** sherpa, a presentation runtime that plays a flow of independent pages — mostly
separate documents in iframes — and orchestrates the transitions between them. klieg is its first
in-process adapter: the flourish that plays over a page swap.

- **Phase callback on `fire()`.** Cut the page swap at a chosen moment *inside* an effect, once the
  word has landed and is at full presence, so the swap happens behind an established flourish rather
  than during its arrival. Shipped as `onPhase`.

- **Per-fire cancellation.** Abort one running effect when the presenter skips ahead or seeks
  backward, without tearing down the instance and its GL context. Shipped as `signal`.

- **Programmatic advance of a `'click'` hold.** Drive a staged effect from sherpa's own input
  dispatcher, so the presenter's keys and clicks reach klieg the way they reach everything else —
  and so one press does one thing, rather than klieg's global listener dismissing while the host
  advances. Shipped as `dismiss: 'host'` plus `advance()` on the handle.
