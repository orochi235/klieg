import type * as THREE from 'three';
import type { PartInfo, ResolvedOffset } from '../../effects/types.js';
import type { LoadedFont } from '../../text/font.js';
import type { WordCaches } from '../caches.js';
import type { DecorationSpec } from '../decoration.js';
// Type-only, and must stay so: word.ts imports this module for real, so a value import here
// would close the cycle. A type-only one is erased at compile time.
import type { WordDebugHooks } from '../word.js';
import { ChunksBuilder } from './chunks.js';
import { TubeBuilder } from './tube.js';
import { WellBuilder } from './well.js';

/** What a builder may reach back into on the `Word` that owns it. */
export interface WordBuildContext {
  readonly font: LoadedFont;
  readonly caches: WordCaches;
  readonly debug?: WordDebugHooks;
  /** Letter origins in em, indexed by letter slot. Live for the word's lifetime. */
  readonly baseX: readonly number[];
  readonly baseY: readonly number[];
  /** A fresh material carrying the studio's environment settings. */
  studioMaterial(): THREE.MeshPhysicalMaterial;
  glyph(char: string, depth: number): THREE.ExtrudeGeometry;
  /** This glyph's contours, shared and cached. Clone before mutating. */
  shapes(char: string): THREE.Shape[];
  partInfo(
    kind: PartInfo['kind'],
    ordinal: number,
    of: number,
    slot: number,
    at: number,
    span: number,
    ink?: PartInfo['ink'],
    /** Which registered fill built this part, when one did. */
    fill?: string,
  ): PartInfo;
  meshInk(slot: number, mesh: THREE.Mesh): PartInfo['ink'];
}

/** One part a decoration contributes to the word's pool, in the order the pool takes them. */
export interface DecorationPart {
  info: PartInfo;
  mesh: THREE.Mesh | THREE.InstancedMesh;
  slot: number;
}

export interface DecorationBuilder {
  /** Build letter `index`'s decoration into `sized`. Called once per letter, in slot order. */
  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void;
  /** A letter that drew no ink. Keeps every per-letter slot aligned with the letter pool. */
  skipLetter(index: number): void;
  /**
   * This letter's body geometry, replacing the extruded glyph. Omit it and `Word` uses the cache.
   *
   * Disposal is the reverse of `ctx.glyph()`'s: what this answers is the builder's own and the
   * builder must free it in `dispose()`, where `ctx.glyph()`'s belongs to the cache and must never
   * be freed by a builder. Keyed on the char rather than the letter slot, because a letter's wells
   * cannot depend on its neighbours — so one geometry serves every letter of that char.
   */
  bodyGeometry?(char: string, depth: number): THREE.BufferGeometry;
  /** The parts this decoration contributes, once every letter is built. */
  collectParts(): DecorationPart[];
  /** Per-frame material writes for letter `index`; `opacity` is the pose's own. */
  frame(index: number, opacity: number): void;
  /**
   * The effect write for one part this decoration contributed, as the builder handed it over.
   * `Word` owns transform; this owns colour. Taking the part rather than its letter slot is what
   * lets a builder carry per-part state on its own `DecorationPart` instead of a side table.
   */
  writePart(part: DecorationPart, out: ResolvedOffset): void;
  /** This letter's decoration bounds in its own em space, or null. Drives the gradient span. */
  boundsAt(index: number): THREE.Box2 | null;
  /** The live letters' union bounds, once known, so a positional gradient can be mapped. */
  applyGradientBounds(word: THREE.Box2): void;
  dispose(): void;
}

type BuilderFactory = (spec: never, ctx: WordBuildContext) => DecorationBuilder;

const REGISTRY = new Map<string, BuilderFactory>();

export function registerDecoration<K extends DecorationSpec['kind']>(
  kind: K,
  make: (spec: Extract<DecorationSpec, { kind: K }>, ctx: WordBuildContext) => DecorationBuilder,
): void {
  REGISTRY.set(kind, make as BuilderFactory);
}

export function decorationBuilderFor(
  spec: DecorationSpec | undefined,
  ctx: WordBuildContext,
): DecorationBuilder | null {
  if (!spec) return null;
  const make = REGISTRY.get(spec.kind);
  if (!make) throw new Error(`no decoration builder registered for kind '${spec.kind}'`);
  return make(spec as never, ctx);
}

registerDecoration('chunks', (spec, ctx) => new ChunksBuilder(spec, ctx));
registerDecoration('tube', (spec, ctx) => new TubeBuilder(spec, ctx));
registerDecoration('well', (spec, ctx) => new WellBuilder(spec, ctx));
