import { type LoadedFont, loadFont } from './font.js';

/** A url, or a url and which face of a collection it should take. */
export type FontSpec = string | { url: string; face?: string };

function urlOf(spec: FontSpec): string {
  return typeof spec === 'string' ? spec : spec.url;
}

function faceOf(spec: FontSpec): string | undefined {
  return typeof spec === 'string' ? undefined : spec.face;
}

/**
 * The fonts one instance can set type in, addressed by name.
 *
 * Per instance rather than module-global: two `createKlieg` calls on one page must not see each
 * other's names. Loads memoize on the file and face rather than the name, so two names for one
 * file share a fetch, a parse and — because `WordCaches` keys on the `LoadedFont` object — a
 * glyph cache.
 */
export class FontRegistry {
  private readonly specs: Map<string, FontSpec>;
  private readonly defaultName: string;
  private readonly loads = new Map<string, Promise<LoadedFont>>();

  constructor(fonts: Record<string, FontSpec>, defaultFont?: string) {
    this.specs = new Map(Object.entries(fonts));
    if (this.specs.size === 0) throw new Error('klieg: fonts is empty');
    if (defaultFont !== undefined && !this.specs.has(defaultFont)) {
      throw new Error(
        `klieg: defaultFont '${defaultFont}' is not one of: ${this.names.join(', ')}`,
      );
    }
    // Object key order, which JS fixes for string keys — so an omitted defaultFont is
    // deterministic, and reordering the literal is what changes it.
    this.defaultName = defaultFont ?? this.names[0];
  }

  /** The registered names, in declaration order. */
  get names(): string[] {
    return [...this.specs.keys()];
  }

  /**
   * Throws synchronously on a name it does not hold — a typo in the host's own code, which a
   * caller wants at the `fire()` call site rather than as a rejection. A load that fails rejects,
   * and is not memoized: one bad fetch must not be permanent for the instance.
   */
  load(name?: string): Promise<LoadedFont> {
    const wanted = name ?? this.defaultName;
    const spec = this.specs.get(wanted);
    if (!spec) {
      throw new Error(`klieg: no font named '${wanted}' — registered: ${this.names.join(', ')}`);
    }

    const url = urlOf(spec);
    const face = faceOf(spec);
    const key = `${url}#${face ?? ''}`;
    const pending = this.loads.get(key);
    if (pending) return pending;

    const load = loadFont(url, face).catch((err) => {
      this.loads.delete(key);
      throw err;
    });
    this.loads.set(key, load);
    return load;
  }
}
