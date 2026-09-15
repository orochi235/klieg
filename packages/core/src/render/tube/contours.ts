/** Whether a ring is a letter's own outline or a counter punched through it. */
export type ContourRole = 'outline' | 'counter';

/**
 * One step of a rescue. Each field overrides the spec's own for the rescued contour alone; an
 * absent field keeps the spec's.
 */
export interface RescueRung {
  /** Blockout for this contour's corners. 0 turns every return into a cut. */
  blockout?: number;
  /**
   * Glass thickness as a share of the spec's `radius`, or `'fit'`: thin enough that the contour's
   * tightest bend clears the material's limit.
   */
  radius?: number | 'fit';
}

/** What a tube does for the contours of one role. */
export interface ContourPolicy {
  /**
   * Tried in order on a contour whose corners leave it no lightable span of `minRun` or longer,
   * stopping at the first rung that leaves one. Absent or empty rescues nothing.
   */
  rescue?: readonly RescueRung[];
  /** The thinnest glass a rescue may use, as a share of `radius`. Default 0.5. */
  floor?: number;
  /**
   * `'one'` lights a contour's longest lightable run when `select` left every run of it dark.
   * `'select'`, the default, leaves lighting to `select`.
   */
  lit?: 'select' | 'one';
}

export type ContourPolicies = Partial<Record<ContourRole, ContourPolicy>>;

/**
 * Measured across 15 faces at the shipped `tubing` settings (`spikes/counter-rescue.mjs`): turning
 * blockout off at full thickness brings back 22 of the 52 counters that reached the screen with
 * nothing lit, and stepping the glass down to half brings back 13 more.
 */
export const RESCUE_LADDER: readonly RescueRung[] = [
  { blockout: 0 },
  { blockout: 0, radius: 0.85 },
  { blockout: 0, radius: 0.7 },
  { blockout: 0, radius: 0.6 },
  { blockout: 0, radius: 0.5 },
];

export const DEFAULT_FLOOR = 0.5;
