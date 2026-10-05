export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;

export const easeInCubic: Easing = (t) => t ** 3;

export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// Overshoots past 1 then settles. The two constants must differ — a single shared c cancels
// at t=0 and flattens the curve to [1.0, 1.281], an entrance that never enters.
export const backOut: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p ** 3 + c1 * p ** 2;
};

export const clamp01 = (t: number): number => (t >= 0 ? (t > 1 ? 1 : t) : 0);

export interface SpringParams {
  stiffness?: number;
  damping?: number;
  mass?: number;
}

/**
 * The step response of a damped harmonic oscillator, in closed form. Closed form rather than an
 * integrator is what keeps it an `Easing`: the compositor samples patches at arbitrary `t`, out of
 * order, several times a frame, which a stateful spring cannot answer.
 */
export function spring({ stiffness = 170, damping = 22, mass = 1 }: SpringParams = {}): Easing {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  const raw = (t: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return (
        1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
      );
    }
    // Critically damped and overdamped both settle without crossing 1; the critical form is
    // close enough past zeta = 1 that a separate overdamped branch buys nothing visible.
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };

  // A spring has not settled at t=1, and enter hands over to active at exactly t=1: the residual
  // would leave every letter permanently short of rest. Correct it away at both ends.
  const residual = 1 - raw(1);
  return (t) => raw(t) + t * residual;
}
