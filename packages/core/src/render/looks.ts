import * as THREE from 'three';
import type { EffectSpec } from '../effects/types.js';
import { ALL_CONNECT, type DecorationSpec } from './decoration.js';
import {
  createFlakeUniforms,
  type FlakeSpec,
  type FlakeUniforms,
  patchForFlakes,
  writeFlakeUniforms,
} from './flake.js';

export type LookName =
  | 'gold'
  | 'chrome'
  | 'oil'
  | 'gem'
  | 'velvet'
  | 'neon'
  | 'flake'
  | 'glitter'
  | 'leather'
  | 'tubing'
  | 'piping'
  | 'sequin';

/**
 * A literal union rather than `Extract<keyof THREE.MeshPhysicalMaterial, …>`. The emitted `.d.ts`
 * carries this type as written, so a live expression would be re-evaluated against the consumer's
 * three — and three ships no `types` condition in its exports map, so a consumer without
 * `@types/three` resolves it to nothing, `keyof` collapses, and every material property silently
 * vanishes from `LookParams`. `MATERIAL_KEYS` below keeps the typo check that `Extract` gave us.
 */
type LookKey =
  | 'color'
  | 'metalness'
  | 'roughness'
  | 'clearcoat'
  | 'clearcoatRoughness'
  | 'transmission'
  | 'thickness'
  | 'ior'
  | 'attenuationColor'
  | 'attenuationDistance'
  | 'iridescence'
  | 'iridescenceIOR'
  | 'iridescenceThicknessRange'
  | 'sheen'
  | 'sheenColor'
  | 'sheenRoughness'
  | 'anisotropy'
  | 'anisotropyRotation'
  | 'dispersion'
  | 'emissive'
  | 'emissiveIntensity'
  // Both blend toward the base colour by `metalness`, so they do nothing at `metalness: 1` — a
  // tool for `gem` and `velvet`, inert on `gold` and `chrome`. `reflectivity` is deliberately
  // absent: three implements it as a second accessor over `ior`, which is already authorable.
  | 'specularIntensity'
  | 'specularColor'
  // Only reaches the shader because `createMaterial` gives every material the studio as its own
  // `envMap`: three overwrites this uniform with `scene.environmentIntensity` when one is absent.
  | 'envMapIntensity';

// Every LookKey must still name a real material property. This runs where `@types/three` is
// installed — here — rather than in a consumer's build, which is the only place it ever worked.
type MissingFromMaterial = Exclude<LookKey, keyof THREE.MeshPhysicalMaterial>;
const _everyLookKeyIsAMaterialProperty: MissingFromMaterial extends never ? true : never = true;
void _everyLookKeyIsAMaterialProperty;

export type LookParams = {
  [K in LookKey]: K extends 'iridescenceThicknessRange' ? [number, number] : number;
};

/**
 * Properties written every frame from base x pose x effects, on every material `applyLook`
 * touches: body, lit decoration and dark decoration each resolve their own base and each get
 * their own per-frame write. A look still declares the base and `resolveParams` still clamps it;
 * what must not happen is `applyLook` writing a value that the next frame overwrites, which is
 * two writers for one property. `emissive` is the deliberate exception: `Word` rewrites it per
 * frame on the body alone, through a `lightBase` the same `resolveParams` and tint resolved, so
 * the two writers cannot disagree.
 */
const FRAME_OWNED = ['opacity', 'emissiveIntensity'] as const;
type FrameOwned = (typeof FRAME_OWNED)[number];
type AppliedKey = Exclude<LookKey, FrameOwned>;

export const DEFAULTS: LookParams = {
  color: 0xffffff,
  metalness: 0,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  attenuationColor: 0xffffff,
  attenuationDistance: Number.POSITIVE_INFINITY,
  iridescence: 0,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400],
  sheen: 0,
  // three defaults this to black, which mutes the lobe even at sheen: 1. White means a spec
  // that sets only `sheen` gets a visible one.
  sheenColor: 0xffffff,
  sheenRoughness: 1,
  anisotropy: 0,
  anisotropyRotation: 0,
  dispersion: 0,
  emissive: 0x000000,
  emissiveIntensity: 1,
  // three's own defaults, so adding these left every shipped look rendering exactly as it did.
  specularIntensity: 1,
  specularColor: 0xffffff,
  envMapIntensity: 2.2,
};

// Every look is applied over DEFAULTS, never over the previous look, so switching cannot
// leave a stale transmission or iridescence behind.
export const LOOKS: Record<LookName, LookSpec> = {
  gold: { color: 0xffc44d, metalness: 1, roughness: 0.16, clearcoatRoughness: 0.08 },
  chrome: { color: 0xf2f5fa, metalness: 1, roughness: 0.05, clearcoatRoughness: 0.03 },
  oil: {
    color: 0x0a0a12,
    metalness: 1,
    roughness: 0.12,
    clearcoatRoughness: 0.05,
    // clearcoat sits ABOVE the thin film and flattens it; iridescence needs it off.
    clearcoat: 0,
    iridescence: 1,
    // The film, not the room, is where oil's colour comes from now: a near-black metal shows
    // reflected light tinted by the film, so a two-toned studio used to be doing this work.
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [100, 520],
  },
  gem: {
    color: 0xffffff,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.4,
    ior: 2.2,
    attenuationColor: 0xd4143c,
    attenuationDistance: 0.6,
    clearcoatRoughness: 0.03,
    dispersion: 4,
  },
  velvet: {
    color: 0x7a1030,
    metalness: 0,
    roughness: 0.95,
    // A clearcoat sits above the nap and mirrors over it; the sheen lobe needs it off.
    clearcoat: 0,
    sheen: 1,
    sheenColor: 0xff6ea8,
    sheenRoughness: 0.35,
  },
  neon: {
    color: 0x120018,
    metalness: 0,
    roughness: 0.4,
    clearcoat: 0,
    emissive: 0xff2d95,
    emissiveIntensity: 3.2,
    bloom: true,
  },
  flake: {
    // Sparkle is a contrast effect, so the flecks have to be the only bright pixels: the base
    // stays dark so it cannot drown them, and matte so a coat's own highlight cannot compete.
    color: 0x2b2740,
    metalness: 0.85,
    roughness: 0.7,
    clearcoat: 0,
    flake: { density: 0.8, size: 1 / 100, spread: 1, color: 0xff5ecb, colorMix: 0.12 },
  },
  glitter: {
    color: 0x8a1c2b,
    metalness: 0.9,
    roughness: 0.5,
    clearcoat: 0,
    // 315 cells per em looked right on a retina display but sits past the top of the shader's
    // fade band on a 1x one, where it smooths to a flat sheen. 120 is full strength at DPR 2 and
    // still about two thirds at DPR 1. Density is what carries a denser field: it does not alias.
    flake: { density: 0.96, size: 1 / 120, spread: 0.9, color: 0xffd9c0, colorMix: 0.06 },
  },
  leather: {
    color: 0x5a2f1d,
    metalness: 0,
    roughness: 0.72,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    sheen: 0.35,
    sheenColor: 0xd8a071,
    flake: { density: 1, size: 1 / 7, spread: 0.5, bump: true },
  },
  tubing: {
    // A backing, not a body: what reads as the sign is the tube in front of it.
    color: 0x0a0010,
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0,
    opacity: 0.08,
    bloom: true,
    tintTo: 'decoration',
    decoration: {
      kind: 'tube',
      radius: 0.022,
      bend: 2,
      segments: 10,
      spacing: 0.02,
      surfaces: ['front'],
      level: 0,
      runs: 7,
      minRun: 0.15,
      amplitude: 0.02,
      // Most cuts are returns: a bender paints the tube over a return bend rather than ending it,
      // and a letter has two electrodes rather than thirty.
      blockout: 0.7,
      // Mostly returns — the tube carries through and the light stops — and connects where the
      // glass would take the corner outright.
      corners: { break: 0.7, connect: 0.3 },
      select: { by: 'seed', amount: 0.85 },
      colors: [0xff2d95],
      look: {
        color: 0x1a0010,
        emissive: 0xff2d95,
        emissiveIntensity: 3.4,
        clearcoat: 0,
        roughness: 0.35,
      },
      dark: {
        color: 0x2a1520,
        emissive: 0x000000,
        roughness: 0.25,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      },
    },
  },
  piping: {
    color: 0x5a2f1d,
    metalness: 0,
    roughness: 0.72,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    sheen: 0.35,
    sheenColor: 0xd8a071,
    flake: { density: 1, size: 1 / 7, spread: 0.5, bump: true },
    decoration: {
      kind: 'tube',
      radius: 0.03,
      bend: 2,
      segments: 8,
      spacing: 0.02,
      surfaces: ['front'],
      // Cord bulges proud of the seam rather than riding it: tangent to the silhouette (-radius)
      // would leave nothing protruding, so this sits halfway to that floor.
      level: -0.015,
      runs: 1,
      minRun: 0.05,
      // Fabric cord bends around every corner; only neon glass needs the mandatory break.
      corners: ALL_CONNECT,
      select: { by: 'seed', amount: 1 },
      colors: [0xe8c9a0],
      look: { color: 0xe8c9a0, roughness: 0.55, clearcoat: 0.4, sheen: 0.5 },
      dark: { color: 0xe8c9a0, roughness: 0.55, clearcoat: 0.4, sheen: 0.5 },
    },
  },
  sequin: {
    color: 0x2a0f1c,
    metalness: 0.6,
    roughness: 0.7,
    clearcoat: 0,
    tintTo: 'decoration',
    decoration: {
      kind: 'chunks',
      count: 520,
      size: 0.062,
      shape: 'disc',
      align: 0,
      // Not 1: discs that lie perfectly flat are parallel mirrors showing the same reflection, so
      // the field reads as one dull sheet. The last degrees of tilt are what make them catch light.
      lie: 0.88,
      cluster: 0,
      // Not 0: a disc lying exactly in the surface z-fights with it along its whole face.
      proud: 0.08,
      faceBias: 16,
      bedding: {
        angle: 15,
        spacing: 0.055,
        thickness: 0.055,
        scatter: 1,
        pitch: 0.055,
        jitter: 0.2,
      },
      look: { color: 0xffd9c0, metalness: 1, roughness: 0.18, clearcoat: 1 },
    },
  },
};

export const COLOR_KEYS = new Set<LookKey>([
  'color',
  'attenuationColor',
  'sheenColor',
  'emissive',
  'specularColor',
]);

export type TintTarget = 'color' | 'attenuationColor' | 'emissive' | 'sheenColor';

/**
 * Which property carries a look's hue. Not always `color`: `gem` is clear stone at
 * `color: 0xffffff` and its red is what light picks up passing through it, and `neon` is a
 * near-black body whose color is entirely its emissive. `sheenColor` is reachable only by
 * declaring it — a velvet reads by its body, and tinting only the highlight would answer
 * "make it red" with red-lit maroon.
 */
export function tintTargetOf(params: LookParams, declared?: TintTarget): TintTarget {
  if (declared) return declared;
  if (params.transmission > 0) return 'attenuationColor';
  if (params.emissive !== 0x000000) return 'emissive';
  return 'color';
}

/**
 * `tintTo` only means anything when there is a second material to route to; a look without
 * decoration silently keeps its tint on the body rather than dropping it.
 */
export function tintMaterialOf(spec: LookSpec): 'body' | 'decoration' {
  return spec.decoration && spec.tintTo === 'decoration' ? 'decoration' : 'body';
}

/**
 * A material of your own, in plain numbers. No THREE type appears here: three is a peer
 * dependency and an implementation detail, and accepting a MeshPhysicalMaterial instead would
 * put its types in every consumer's signatures and its churn in this package's compatibility
 * range.
 */
export interface LookSpec extends Partial<LookParams> {
  tintTarget?: TintTarget;
  /** Turns the bloom pass on for this look unless the caller says otherwise. */
  bloom?: boolean;
  flake?: FlakeSpec;
  /** Base opacity of the body, 0..1. Pose opacity multiplies it. */
  opacity?: number;
  /** Which material `tint` recolors. Default 'body'. */
  tintTo?: 'body' | 'decoration';
  decoration?: DecorationSpec;
  /** Appearance driven over time, below the level of a letter. Absent or empty renders statically. */
  effects?: EffectSpec[];
}

export type Look = LookName | LookSpec;

const RANGES: Partial<Record<LookKey, [number, number]>> = {
  metalness: [0, 1],
  roughness: [0, 1],
  clearcoat: [0, 1],
  clearcoatRoughness: [0, 1],
  transmission: [0, 1],
  iridescence: [0, 1],
  sheen: [0, 1],
  sheenRoughness: [0, 1],
  anisotropy: [0, 1],
  specularIntensity: [0, 1],
  thickness: [0, Number.POSITIVE_INFINITY],
  attenuationDistance: [0, Number.POSITIVE_INFINITY],
  emissiveIntensity: [0, Number.POSITIVE_INFINITY],
  envMapIntensity: [0, Number.POSITIVE_INFINITY],
  ior: [1, 2.333],
  iridescenceIOR: [1, 5],
  dispersion: [0, 10],
};

const PARAM_KEYS = Object.keys(DEFAULTS) as LookKey[];
const FRAME_OWNED_KEYS: ReadonlySet<string> = new Set(FRAME_OWNED);
const APPLIED_KEYS = PARAM_KEYS.filter((key): key is AppliedKey => !FRAME_OWNED_KEYS.has(key));

export function specOf(look: Look): LookSpec {
  return typeof look === 'string' ? LOOKS[look] : look;
}

/** Out of range clamps rather than throws: a bad number should dull a material, not kill an effect. */
function resolveParams(spec: LookSpec): LookParams {
  const params = { ...DEFAULTS };
  for (const key of PARAM_KEYS) {
    const value = spec[key];
    if (value === undefined) continue;
    const range = RANGES[key];
    (params[key] as unknown) =
      range && typeof value === 'number' ? Math.min(Math.max(value, range[0]), range[1]) : value;
  }
  return params;
}

/**
 * The flake chunk is always injected and gated on `uFlakeDensity > 0`, so switching looks never
 * needs a recompile and one program serves every look.
 */
export function createMaterial(envMap: THREE.Texture | null = null): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ envMap });
  const uniforms = createFlakeUniforms();
  material.userData.flake = uniforms;
  material.onBeforeCompile = (shader) => patchForFlakes(shader, uniforms);
  return material;
}

/**
 * Color-valued params are THREE.Color objects. Assigning a hex number over one replaces the
 * object and the material silently stops working, so they must go through .set().
 */
export function applyLook(material: THREE.MeshPhysicalMaterial, look: Look, tint?: number): void {
  const spec = specOf(look);
  const params = resolveParams(spec);
  if (tint !== undefined) params[tintTargetOf(params, spec.tintTarget)] = tint;
  const target = material as unknown as Record<string, unknown>;

  // A fixed key list rather than the resolved object's own keys: that is what drops a key a
  // caller invented from ever reaching the material.
  for (const key of APPLIED_KEYS) {
    const value = params[key];
    if (COLOR_KEYS.has(key)) (material[key] as THREE.Color).set(value as number);
    else if (Array.isArray(value)) target[key] = [...value];
    else target[key] = value;
  }
  writeFlakeUniforms(material.userData.flake as FlakeUniforms, spec.flake);
  material.needsUpdate = true;
}

/** The base a frame-owned property composes from. */
export type FrameOwnedBase = Record<FrameOwned, number>;

export function frameOwnedBase(look: Look): FrameOwnedBase {
  const spec = specOf(look);
  return {
    // resolveParams cannot clamp this one: opacity is a LookSpec field, not a LookKey.
    opacity: Math.min(Math.max(spec.opacity ?? 1, 0), 1),
    emissiveIntensity: resolveParams(spec).emissiveIntensity,
  };
}

export interface LightBase {
  /** The look's own emissive, which lamp light adds onto rather than replacing. */
  emissive: number;
  /** The colour the look reads as, whichever property carries it. What a lamp multiplies against. */
  hue: number;
}

export function lightBase(look: Look, tint?: number): LightBase {
  const spec = specOf(look);
  const params = resolveParams(spec);
  const target = tintTargetOf(params, spec.tintTarget);
  if (tint !== undefined) params[target] = tint;
  return { emissive: params.emissive, hue: params[target] };
}
