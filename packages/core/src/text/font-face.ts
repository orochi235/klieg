/** The CSS family name klieg registers a font under. Deterministic, so two instances share one. */
export function familyFor(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `klieg-${(h >>> 0).toString(36)}`;
}

const registered = new Set<string>();

/**
 * Registers the already-fetched bytes as a CSS face and returns its family. There is no second
 * download. Returns null where the browser has no `FontFace`, which leaves the layer unbuilt
 * rather than mispositioned against a fallback face.
 */
export async function registerFace(url: string, bytes: ArrayBuffer): Promise<string | null> {
  const family = familyFor(url);
  if (registered.has(family)) return family;
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) return null;

  try {
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    registered.add(family);
    return family;
  } catch {
    return null;
  }
}

/**
 * Distance from a span's box top down to its baseline at `line-height: 1`, as a fraction of the
 * font size. Measured rather than derived from the font's metrics: which of hhea, OS/2 win and
 * OS/2 typo a browser uses for the inline box varies by platform, so the same numbers would
 * misplace every letter on some of them.
 */
export function measureBaselineRatio(family: string): number {
  const PROBE = 100;
  const host = document.createElement('div');
  host.style.cssText =
    'position:absolute;visibility:hidden;left:-9999px;top:0;line-height:1;white-space:pre';
  host.style.fontFamily = family;
  host.style.fontSize = `${PROBE}px`;
  const text = document.createElement('span');
  text.textContent = 'Hg';
  // Zero-height and baseline-aligned, so its own top *is* the line box's baseline.
  const strut = document.createElement('span');
  strut.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  host.append(text, strut);
  document.body.appendChild(host);
  const ratio = (strut.getBoundingClientRect().top - host.getBoundingClientRect().top) / PROBE;
  host.remove();
  return ratio;
}
