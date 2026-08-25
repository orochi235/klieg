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
