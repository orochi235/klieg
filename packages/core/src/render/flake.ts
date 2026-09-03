import * as THREE from 'three';

export interface FlakeSpec {
  /** Fraction of cells that are flakes, 0..1. Zero disables the chunk. */
  density: number;
  /** Cell edge in object-space units — glyphs are built at 1 em. */
  size: number;
  /** How far a flake normal tilts off the surface, 0..1. */
  spread: number;
  /**
   * Roughness a flake takes on, 0..1. Low is the point: a flake is a tiny mirror, and only the
   * few aligned with the environment blaze. Raising it instead lights every flake dimly at once,
   * which reads as suspended grit rather than sparkle.
   */
  gloss?: number;
  /** Flake albedo. Omit to leave the base color alone and sparkle by specular only. */
  color?: number;
  /** How far `color` pulls the base, 0..1. Ignored without a color. */
  colorMix?: number;
  /** Smooth rounded cells (leather grain) instead of flat random facets. */
  bump?: boolean;
}

export interface FlakeUniforms {
  uFlakeDensity: THREE.IUniform<number>;
  uFlakeSize: THREE.IUniform<number>;
  uFlakeSpread: THREE.IUniform<number>;
  uFlakeBump: THREE.IUniform<number>;
  uFlakeColor: THREE.IUniform<THREE.Color>;
  uFlakeColorMix: THREE.IUniform<number>;
  uFlakeGloss: THREE.IUniform<number>;
  uFlakeSeed: THREE.IUniform<number>;
}

export function createFlakeUniforms(): FlakeUniforms {
  return {
    uFlakeDensity: { value: 0 },
    uFlakeSize: { value: 0.02 },
    uFlakeSpread: { value: 0.4 },
    uFlakeBump: { value: 0 },
    uFlakeColor: { value: new THREE.Color(0xffffff) },
    uFlakeColorMix: { value: 0 },
    uFlakeGloss: { value: 0.06 },
    uFlakeSeed: { value: 0 },
  };
}

export function writeFlakeUniforms(u: FlakeUniforms, spec: FlakeSpec | undefined): void {
  u.uFlakeDensity.value = spec ? spec.density : 0;
  if (!spec) return;
  u.uFlakeSize.value = spec.size;
  u.uFlakeSpread.value = spec.spread;
  u.uFlakeBump.value = spec.bump ? 1 : 0;
  u.uFlakeColor.value.set(spec.color ?? 0xffffff);
  // No declared color means no albedo mixing at all. Defaulting it to white instead would wash
  // a dense look — leather sets density 1 — 60% toward white and bury its own color.
  u.uFlakeColorMix.value = spec.color === undefined ? 0 : (spec.colorMix ?? 0.3);
  u.uFlakeGloss.value = spec.gloss ?? 0.06;
}

const COMMON = /* glsl */ `
uniform float uFlakeDensity;
uniform float uFlakeSize;
uniform float uFlakeSpread;
uniform float uFlakeBump;
uniform vec3 uFlakeColor;
uniform float uFlakeColorMix;
uniform float uFlakeGloss;
uniform float uFlakeSeed;
varying vec3 vFlakePos;

vec3 bkHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

vec3 bkCellCoord() { return vFlakePos / uFlakeSize + uFlakeSeed; }

float bkIsFlake(vec3 rnd) { return step(1.0 - uFlakeDensity, rnd.x * 0.5 + 0.5); }

/**
 * Nearest jittered cell centre in the 3x3x3 neighbourhood. A plain floor() lattice sliced by a
 * flat glyph face gives a grid of squares, which reads as a mosaic however it is scaled —
 * offsetting each centre breaks the boundaries out of rows so flakes vary in shape and size.
 */
void bkVoronoi(vec3 coord, out vec3 cell, out vec3 toCentre, out float seam) {
  vec3 base = floor(coord);
  float f1 = 1e9;
  float f2 = 1e9;
  cell = base;
  toCentre = vec3(0.0);

  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 c = base + vec3(float(x), float(y), float(z));
        vec3 centre = c + 0.5 + bkHash3(c + 11.3) * 0.5;
        float d = length(coord - centre);
        if (d < f1) { f2 = f1; f1 = d; cell = c; toCentre = coord - centre; }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  // Gap between nearest and next-nearest: near zero on a boundary between two cells.
  seam = f2 - f1;
}

vec3 bkCell(vec3 coord) {
  vec3 cell;
  vec3 toCentre;
  float seam;
  bkVoronoi(coord, cell, toCentre, seam);
  return cell;
}

// How many cells a pixel spans. Measured per axis: the derivative of length() would track
// distance from the origin rather than cell size, and never engage.
float bkCellsPerPixel(vec3 coord) {
  vec3 d = fwidth(coord);
  return max(d.x, max(d.y, d.z));
}
`;

// Sub-pixel flakes strobe violently under minification. Contrast fades and roughness widens as a
// cell approaches one pixel, so distant type goes evenly rough instead of boiling.
const PERTURB = /* glsl */ `
if (uFlakeDensity > 0.0) {
  vec3 bkCoord = bkCellCoord();
  vec3 bkCellId;
  vec3 bkToCentre;
  float bkSeam;
  bkVoronoi(bkCoord, bkCellId, bkToCentre, bkSeam);

  vec3 bkRnd = bkHash3(bkCellId);
  float bkFade = 1.0 - smoothstep(0.6, 2.0, bkCellsPerPixel(bkCoord));

  if (uFlakeBump > 0.5) {
    // Upholstery: soft panels rolling into shallow valleys where they meet. The crease band is
    // wide and its falloff gentle on purpose — a narrow band with a strong pull faceted the
    // surface into something closer to armour plate than hide.
    float bkCrease = 1.0 - smoothstep(0.0, 0.55, bkSeam);
    vec3 bkPanel = bkToCentre * 0.5 - bkToCentre * bkCrease * bkCrease * 0.9;
    normal = normalize(normal + bkPanel * uFlakeSpread * bkFade);
    roughnessFactor = clamp(roughnessFactor + bkCrease * 0.1 * bkFade, 0.0, 1.0);
  } else {
    float bkFlake = bkIsFlake(bkRnd) * bkFade;
    normal = normalize(normal + bkRnd * uFlakeSpread * bkFlake);
    // Sharpening the flake is what makes only the few aligned with the environment blaze;
    // widening it lights every flake dimly at once, which reads as suspended grit.
    roughnessFactor = mix(roughnessFactor, uFlakeGloss, bkFlake);
    // Past the point where a cell is smaller than a pixel, widen the lobe instead of aliasing.
    roughnessFactor = clamp(roughnessFactor + (1.0 - bkFade) * 0.25, 0.0, 1.0);
  }
}
`;

const TINT = /* glsl */ `
if (uFlakeDensity > 0.0 && uFlakeColorMix > 0.0) {
  vec3 bkCoord = bkCellCoord();
  vec3 bkRnd = bkHash3(bkCell(bkCoord));
  float bkFade = 1.0 - smoothstep(0.6, 2.0, bkCellsPerPixel(bkCoord));
  diffuseColor.rgb = mix(diffuseColor.rgb, uFlakeColor, bkIsFlake(bkRnd) * uFlakeColorMix * bkFade);
}
`;

export interface PatchableShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

export function patchForFlakes(shader: PatchableShader, uniforms: FlakeUniforms): void {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = `varying vec3 vFlakePos;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvFlakePos = transformed;',
  );

  shader.fragmentShader = `${COMMON}${shader.fragmentShader}`
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${PERTURB}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${TINT}`);
}

/**
 * Offsets a material's flake field so repeated letters do not sparkle in lockstep. Every material
 * a letter owns takes the same offset — body, tube and chunk alike — so a decoration whose look
 * carries a flake spec breaks up along with the body it sits on.
 */
export function seedFlake(material: THREE.Material, i: number): void {
  const flake = material.userData.flake as FlakeUniforms | undefined;
  if (flake) flake.uFlakeSeed.value = i * 17.13;
}
