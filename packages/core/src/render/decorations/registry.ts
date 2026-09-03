import type * as THREE from 'three';
import type { PartInfo } from '../../effects/types.js';
import type { LoadedFont } from '../../text/font.js';
import type { WordCaches } from '../caches.js';
import type { DecorationSpec } from '../decoration.js';
import type { LightBase } from '../looks.js';
// Type-only: word.ts imports this module in Task 2, and a type-only import is erased at
// compile time, so this creates no runtime cycle.
import type { WordDebugHooks } from '../word.js';
import { ChunksBuilder } from './chunks.js';

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
  /** A letter playing its exit; its parts are left alone. */
  leavingAt(index: number): boolean;
  partInfo(
    kind: PartInfo['kind'],
    ordinal: number,
    of: number,
    slot: number,
    at: number,
    span: number,
    ink?: PartInfo['ink'],
  ): PartInfo;
  meshInk(slot: number, mesh: THREE.Mesh): PartInfo['ink'];
}

/** One part a decoration contributes to the word's pool, in the order the pool takes them. */
export interface DecorationPart {
  info: PartInfo;
  mesh: THREE.Mesh | THREE.InstancedMesh;
  /** The part's own colour, so an effect composes from the base rather than from last frame. */
  baseColor: number;
  /** Whether `writePart` may drive this part through the run-colour buffer. */
  readsRunColor: boolean;
  slot: number;
}

export interface DecorationBuilder {
  /** Build letter `index`'s decoration into `sized`. Called once per letter, in slot order. */
  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void;
  /** A letter that drew no ink. Keeps every per-letter slot aligned with the letter pool. */
  skipLetter(index: number): void;
  /** The parts this decoration contributes, once every letter is built. */
  collectParts(): DecorationPart[];
  /** Per-frame material writes for letter `index`; `opacity` is the pose's own. */
  frame(index: number, opacity: number): void;
  /** This letter's decoration bounds in its own em space, or null. Drives the gradient span. */
  boundsAt(index: number): THREE.Box2 | null;
  /** The live letters' union bounds, once known, so a positional gradient can be mapped. */
  applyGradientBounds(word: THREE.Box2): void;
  /** The emissive and hue this letter's lamp light resolves against, or null. */
  lightAt(index: number): LightBase | null;
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
// Replaced by the real builder in Task 3.
registerDecoration('tube', () => {
  throw new Error('tube builder not yet implemented');
});
