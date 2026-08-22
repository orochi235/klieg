import { specOf } from '@core/render/looks.js';
import type { TubeSpec } from '@core/render/tube/index.js';

/** The shipped looks that carry a tube decoration — the only ones this lab can tune. */
export const TUBE_LOOKS = ['tubing', 'piping'] as const;
export type TubeLook = (typeof TUBE_LOOKS)[number];

export function isTubeLook(value: unknown): value is TubeLook {
  return TUBE_LOOKS.includes(value as TubeLook);
}

export function tubeSpecOf(name: TubeLook): TubeSpec {
  const decoration = specOf(name).decoration;
  if (decoration?.kind !== 'tube') throw new Error(`corner lab: ${name} has no tube decoration`);
  return decoration;
}
