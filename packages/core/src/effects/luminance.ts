/** Rec.709 luma, the same dot product `bloom.ts` thresholds on. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Fully saturated RGB for a hue in turns. */
function wheel(turn: number): [number, number, number] {
  const h = (((turn % 1) + 1) % 1) * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  if (h < 1) return [1, x, 0];
  if (h < 2) return [x, 1, 0];
  if (h < 3) return [0, 1, x];
  if (h < 4) return [0, x, 1];
  if (h < 5) return [x, 0, 1];
  return [1, 0, x];
}

function channel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n * 255)));
}

/**
 * A hue in turns at a fixed Rec.709 luma, packed 0xRRGGBB. A hue brighter than the target scales
 * toward black and keeps its saturation; one darker mixes toward white, which is why blues and
 * violets come out pale. Holding luma is what keeps a sweep on one side of the bloom threshold the
 * whole way round instead of dropping out through the dark half of the wheel.
 */
export function hueColor(turn: number, target: number): number {
  const [r, g, b] = wheel(turn);
  const y = luma(r, g, b);
  let nr: number;
  let ng: number;
  let nb: number;
  if (y >= target) {
    const k = y > 0 ? target / y : 0;
    nr = r * k;
    ng = g * k;
    nb = b * k;
  } else {
    const k = (target - y) / (1 - y);
    nr = r + (1 - r) * k;
    ng = g + (1 - g) * k;
    nb = b + (1 - b) * k;
  }
  return (channel(nr) << 16) | (channel(ng) << 8) | channel(nb);
}
