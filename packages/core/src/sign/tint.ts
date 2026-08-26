/**
 * A computed `color` is `rgb(r, g, b)` or `rgba(r, g, b, a)` in every engine that matters. A
 * browser returning `color(srgb …)` for a wide-gamut input falls through to undefined, which
 * leaves the look its own color rather than a wrong one.
 */
function packRgb(css: string): number | undefined {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,]+([\d.]+))?/.exec(css);
  if (!match) return undefined;
  const alpha = match[4];
  if (alpha !== undefined && Number(alpha) === 0) return undefined;
  const parts = [match[1], match[2], match[3]];
  let packed = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value)) return undefined;
    packed = (packed << 8) | (Math.round(value) & 255);
  }
  return packed;
}

/**
 * Resolves a tint the page can express against the anchor it will sit on. A probe carrying the
 * candidate as its own `color` is the only way to get `currentColor` and `var()` resolved: both
 * are answered by the cascade, not by any string the caller could parse.
 */
export function resolveTint(
  anchor: HTMLElement,
  value: number | string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;

  const probe = anchor.ownerDocument.createElement('span');
  // Inline: the measurement is the feature.
  probe.style.display = 'none';
  probe.style.color = value;
  // CSSOM drops a declaration it cannot parse, so an empty inline value is the caller's typo.
  if (probe.style.color === '') return undefined;

  anchor.appendChild(probe);
  try {
    const computed = probe.ownerDocument.defaultView?.getComputedStyle(probe).color ?? '';
    return packRgb(computed);
  } finally {
    probe.remove();
  }
}
