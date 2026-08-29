import type * as THREE from 'three';
import type { LoadedFont } from '../text/font.js';
import { buildGlyphGeometry, DEFAULT_GLYPH_OPTIONS, EM } from '../text/glyphs.js';
import type { TubeBlueprint, TubeSpec } from './tube/index.js';

/**
 * Object-valued key parts (a loaded font, a tube spec) become numbers, so one flat string key can
 * discriminate them. Weak, because an id outliving its object would hold the object alive.
 */
class Interner {
  private readonly ids = new WeakMap<object, number>();
  private next = 0;

  id(value: object): number {
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(value, id);
    }
    return id;
  }
}

/**
 * The caches that outlive a `Word` and an unmount. A `BufferGeometry` is CPU-side and re-uploads
 * itself to whatever context draws it next, which is the only reason this can be instance-scoped
 * while the renderer is not.
 */
export class WordCaches {
  private readonly interner = new Interner();
  private readonly geometries = new Map<string, THREE.ExtrudeGeometry>();
  private readonly blueprints = new Map<string, { blueprint: TubeBlueprint; leased: boolean }>();
  /** Blueprints built because the cached one was already lent out; disposed on release. */
  private readonly onLoan = new Set<TubeBlueprint>();
  private disposed = false;

  get size(): number {
    return this.geometries.size;
  }

  glyph(font: LoadedFont, char: string, depth: number): THREE.ExtrudeGeometry {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = `${this.interner.id(font)}|${char}|${depth}`;
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth });
      this.geometries.set(key, geo);
    }
    return geo;
  }

  /**
   * A blueprint's lit geometry carries the run-colour buffer a live effect writes every frame, so
   * one blueprint can back one word at a time. A second taker gets its own, kept out of the cache.
   */
  takeBlueprint(
    font: LoadedFont,
    spec: TubeSpec,
    char: string,
    depth: number,
    seed: number,
    tint: number | undefined,
    build: () => TubeBlueprint,
  ): TubeBlueprint {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = [
      this.interner.id(font),
      this.interner.id(spec),
      char,
      depth,
      seed,
      tint ?? 'none',
    ].join('|');

    const entry = this.blueprints.get(key);
    if (!entry) {
      const blueprint = build();
      this.blueprints.set(key, { blueprint, leased: true });
      return blueprint;
    }
    if (!entry.leased) {
      entry.leased = true;
      return entry.blueprint;
    }
    const spare = build();
    this.onLoan.add(spare);
    return spare;
  }

  releaseBlueprint(blueprint: TubeBlueprint): void {
    if (this.onLoan.delete(blueprint)) {
      blueprint.dispose();
      return;
    }
    for (const entry of this.blueprints.values()) {
      if (entry.blueprint === blueprint) {
        entry.leased = false;
        return;
      }
    }
  }

  dispose(): void {
    for (const geo of this.geometries.values()) geo.dispose();
    this.geometries.clear();
    for (const entry of this.blueprints.values()) entry.blueprint.dispose();
    this.blueprints.clear();
    for (const spare of this.onLoan) spare.dispose();
    this.onLoan.clear();
    this.disposed = true;
  }
}
