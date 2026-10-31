import { f } from '@weasel-js/labkit';
import { detent } from './DetentRow.js';

export const PERCENT = { suffix: '%', scale: 0.01, precision: 0 };

/** The tube section: the geometry every panel is built from. */
export function tubeRows() {
  return {
    radius: f
      .number(0.04)
      .range(0.001, 0.12)
      .step(0.001)
      .suffix('em')
      .section('tube')
      .describe('Tube radius in em. Held exactly — the corner stage bends the path to carry it.'),
    bend: f
      .number(2)
      .range(1.25, 4)
      .step(0.05)
      .suffix('×r')
      .section('tube')
      .describe(
        'Minimum bend radius, as a multiple of radius, floored at 1.25. Sets the fillet setback rather than the corner classification: raise it and more fillets are rejected, so more corners break and the runs floor rises to meet it. Watch the skeleton panel’s rejected-fillet count, not its corner count.',
      ),
    segments: f
      .number(8)
      .range(3, 32)
      .step(1)
      .label('ring segments')
      .section('tube')
      .describe(
        'Sides of the tube’s circular cross-section, around the tube rather than along it. Inscribed in the radius, so fewer segments make a genuinely thinner tube: 3 is 83% of the round width, 8 is 97%. Flat emissive hides the faceting, so this reads only as glow.',
      ),
    spacing: f
      .number(0.02)
      .range(0.002, 0.08)
      .step(0.001)
      .suffix('em')
      .section('tube')
      .describe(
        'Arc length in em between points along the centerline, along the tube rather than around it. Load-bearing: bend radius is measured from it, so coarse spacing hides corners entirely.',
      ),
    level: f
      .number(0)
      .range(-0.12, 0.12)
      .step(0.001)
      .suffix('em')
      .section('tube')
      .render(detent([0]))
      .describe(
        'Isocontour level in em: negative insets, 0 rides the outline, positive stands off. Topological rather than a scale — contours merge, counters close and thin strokes vanish as it moves, so the contour count steps instead of sliding. 0 is the only level with a geometric meaning.',
      ),
    blockout: f
      .number(0)
      .range(0, 1)
      .step(0.01)
      .unit(PERCENT)
      .section('tube')
      .describe(
        'How often a corner that would cut instead carries the tube past the light unlit. Those runs never light whatever `lit` picks, so blockout caps what `lit` can reach: at 70% the most `lit` can do is 92% of tubing’s length.',
      ),
    runs: f
      .number(4)
      .range(1, 24)
      .step(1)
      .section('tube')
      .describe(
        'Requested runs per glyph, not a count. Bounded below by the corner count — a corner that breaks is a cut, asked for or not — and above by min run. Usually pinned across most of its range, and at bend 4 pinned across all of it.',
      ),
    minRun: f
      .number(0.05)
      .range(0, 0.3)
      .step(0.005)
      .suffix('em')
      .label('min run')
      .section('tube')
      .describe(
        'Runs shorter than this are dropped and left dark. The ceiling `runs` pushes against from above.',
      ),
    amplitude: f
      .number(0)
      .range(0, 0.08)
      .step(0.001)
      .suffix('em')
      .section('tube')
      .describe(
        'How far a front or back run wanders off its flat plane, in em. Applied after the corner stage, so it is the one thing that can re-bend a run nothing checks again. 0 is exactly planar.',
      ),
    wallDepth: f
      .number(0.5)
      .range(0, 1)
      .step(0.01)
      .unit(PERCENT)
      .label('wall depth')
      .section('tube')
      .render(detent([0.5]))
      .describe(
        'Where a wall run sits in the extruded side, 0 back to 100 front. Depth plus rise is clamped to the depth, so 50% is the only setting whose rise swings symmetrically — off center, half the perimeter flattens against the clamp. Needs `wall` in surfaces.',
      ),
    wallRise: f
      .number(0)
      .range(0, 1)
      .step(0.01)
      .unit(PERCENT)
      .label('wall rise')
      .section('tube')
      .describe(
        'Peak-to-peak depth swing along a wall run, as a fraction of depth — one sine cycle per trip around the perimeter, so the tube weaves front to back along the letter’s edge. 0 is a flat band. Needs `wall` in surfaces.',
      ),
    select: f
      .group({
        amount: f
          .number(1)
          .range(0, 1)
          .step(0.01)
          .unit(PERCENT)
          .label('lit')
          .describe(
            'Fraction of lightable runs that light. Blockout runs are never lightable, so this cannot reach every run on its own — drop blockout to 0 for a fully lit letter.',
          ),
      })
      .as('fragment')
      .section('tube'),
  };
}
