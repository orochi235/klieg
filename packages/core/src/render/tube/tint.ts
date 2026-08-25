import * as THREE from 'three';
import {
  CRAWL_ATTRIBUTE,
  GRADIENT_T_ATTRIBUTE,
  type GradientSpec,
  rampTexture,
} from './gradient.js';

/**
 * Which channel a run's colour drives. A tube look is emissive and its base colour is nearly black;
 * a cord look has no emissive at all and carries its colour on the base. Modulating the wrong one
 * either squares the colour or paints a dark body hot.
 */
export type TintChannel = 'emissive' | 'color';

export const RUN_COLOR_ATTRIBUTE = 'runColor';

export const GRADIENT_BOUNDS_UNIFORM = 'uGradBounds';
export const GRADIENT_ORIGIN_UNIFORM = 'uGradOrigin';
const GRADIENT_RAMP_UNIFORM = 'uGradRamp';

/** Domains the shader resolves from the vertex's own position rather than from an attribute. */
export function positionalDomain(gradient: GradientSpec): boolean {
  return gradient.domain.of === 'axis' || gradient.domain.of === 'radial';
}

/** A GLSL float literal. A bare integer would not compile: GLSL ES 1.00 has no implicit int→float. */
function glslFloat(n: number): string {
  const s = String(Number.isFinite(n) ? n : 0);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * `rimNdv`: 1 where the tube faces the camera, 0 at its silhouette. `normal` and `vViewPosition`
 * are three's own — the emissive anchor sits after `normal_fragment_begin`, which resolves the
 * double-sided flip a tube's inside faces need.
 */
const GRAZING = 'float rimNdv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);';

/** The mean of `rimNdv` across a cylinder's projected width: the integral of sqrt(1 - x^2) over 0..1. */
const CROSS_SECTION_MEAN = Math.PI / 4;

/**
 * The emissive scale a limb rim asks for: falling with `rimNdv`, the fraction of the tube's
 * diameter a ray at this angle crosses, over that profile's own mean so the width still averages to
 * the emissive the look asked for.
 *
 * The mean is what keeps a glowing sign glowing — without it the whole tube sinks under the bloom
 * threshold. Scaling rather than adding is what makes the rim visible at all: a tuned look's
 * brightest channels already clip, so a lifted edge moves nothing a dimmed core does not.
 */
function limbFactor(strength: number): string {
  const mean = glslFloat(1 - CROSS_SECTION_MEAN * strength);
  return `((1.0 - ${glslFloat(strength)} * rimNdv) / ${mean})`;
}

/**
 * GLSL assigning `gt`, in letter-placement space. Excludes the group's fit transform deliberately:
 * the fit re-settles on every layout pass, so a gradient riding it would slide on a browser resize.
 */
function positionalT(gradient: GradientSpec): string {
  const head =
    `  vec2 gp = position.xy + ${GRADIENT_ORIGIN_UNIFORM};\n` +
    `  vec2 lo = ${GRADIENT_BOUNDS_UNIFORM}.xy, hi = ${GRADIENT_BOUNDS_UNIFORM}.zw;\n`;

  if (gradient.domain.of === 'radial') {
    const [ax, ay] = gradient.domain.at ?? [0.5, 0.5];
    return (
      head +
      `  vec2 at = mix(lo, hi, vec2(${glslFloat(ax)}, ${glslFloat(ay)}));\n` +
      // The farthest corner, not half the diagonal: an off-centre origin otherwise leaves most of
      // the word in the ramp's tail.
      '  float far = max(max(length(vec2(lo.x, lo.y) - at), length(vec2(hi.x, lo.y) - at)),' +
      ' max(length(vec2(lo.x, hi.y) - at), length(vec2(hi.x, hi.y) - at)));\n' +
      '  float gt = far > 0.0 ? length(gp - at) / far : 0.0;\n'
    );
  }

  const degrees = gradient.domain.of === 'axis' ? (gradient.domain.angle ?? 0) : 0;
  const a = glslFloat((degrees * Math.PI) / 180);
  return (
    head +
    `  vec2 dir = vec2(cos(${a}), sin(${a}));\n` +
    '  float p0 = dot(vec2(lo.x, lo.y), dir), p1 = dot(vec2(hi.x, lo.y), dir);\n' +
    '  float p2 = dot(vec2(lo.x, hi.y), dir), p3 = dot(vec2(hi.x, hi.y), dir);\n' +
    '  float plo = min(min(p0, p1), min(p2, p3));\n' +
    '  float phi = max(max(p0, p1), max(p2, p3));\n' +
    '  float gt = phi > plo ? (dot(gp, dir) - plo) / (phi - plo) : 0.0;\n'
  );
}

/**
 * Drives `channel` from the per-vertex run colour instead of the material's own.
 *
 * Not `vertexColors`, which always modulates diffuse and so cannot reach an emissive look. The
 * material's own channel is set to white so the modulation is exact rather than compounding: the
 * emissive uniform already carries `emissiveIntensity`, so white times the run colour reproduces
 * the colour a look with a matching palette had before.
 *
 * With a `gradient`, the ramp is sampled from a texture baked by `rampTexture` and `t` comes either
 * from the `gradientT` attribute or, for a positional domain, from the vertex's own position.
 *
 * `ramp` lets a caller bake that texture once and share it across the letters of a word; the caller
 * then owns it. Without one this bakes its own, which nothing can reach to dispose — a shared ramp
 * is the supported path for anything that outlives a test.
 *
 * `rim` (0..1, emissive only) moves that fraction of the emissive off the tube's face and out to
 * its silhouette, so the glass reads as a lit cylinder rather than a ribbon. Absent or 0 emits the
 * GLSL this shipped with, byte for byte.
 */
export function tintByRunColor(
  material: THREE.Material,
  channel: TintChannel,
  gradient?: GradientSpec,
  ramp?: THREE.Texture,
  rim?: number,
): void {
  // Emissive only. `color_fragment` runs before three has a shading normal, and a cord is a solid
  // body rather than a column of gas, so a rim there would be a knob with nothing behind it.
  const limb =
    channel === 'emissive' && Number.isFinite(rim) ? Math.min(Math.max(rim as number, 0), 1) : 0;
  const target = material as THREE.MeshPhysicalMaterial;
  if (channel === 'emissive') target.emissive = new THREE.Color(0xffffff);
  else target.color = new THREE.Color(0xffffff);

  const texture = gradient ? (ramp ?? rampTexture(gradient.stops)) : undefined;
  const onPosition = gradient !== undefined && positionalDomain(gradient);
  // Held across compiles: three re-runs onBeforeCompile on every needsUpdate, and rebuilding these
  // would silently discard the bounds the caller had set.
  const boundsUniform = { value: new THREE.Vector4(0, 0, 1, 1) };
  const originUniform = { value: new THREE.Vector2(0, 0) };

  let head = `attribute vec3 ${RUN_COLOR_ATTRIBUTE};\nvarying vec3 vRunColor;\n`;
  let body = `#include <begin_vertex>\n  vRunColor = ${RUN_COLOR_ATTRIBUTE};`;
  if (gradient) {
    head += 'varying float vGradT;\n';
    if (onPosition) {
      head += `uniform vec4 ${GRADIENT_BOUNDS_UNIFORM};\nuniform vec2 ${GRADIENT_ORIGIN_UNIFORM};\n`;
      body += `\n${positionalT(gradient)}  vGradT = clamp(gt, 0.0, 1.0);`;
    } else {
      head += `attribute float ${GRADIENT_T_ATTRIBUTE};\nattribute float ${CRAWL_ATTRIBUTE};\n`;
      // `fract` only where a crawl is actually running. A run's last vertex sits at gradientT 1.0
      // exactly, and fract(1.0) is 0.0 — applied unconditionally it would snap every ramp's end
      // back to its start and move every gradient that never asked to crawl.
      body +=
        `\n  vGradT = ${CRAWL_ATTRIBUTE} == 0.0` +
        `\n    ? clamp(${GRADIENT_T_ATTRIBUTE}, 0.0, 1.0)` +
        `\n    : fract(${GRADIENT_T_ATTRIBUTE} + ${CRAWL_ATTRIBUTE});`;
    }
  }

  const sample = `texture2D(${GRADIENT_RAMP_UNIFORM}, vec2(vGradT, 0.5)).rgb`;
  const tinted = !gradient
    ? 'vRunColor'
    : gradient.mode === 'modulate'
      ? `vRunColor * ${sample}`
      : sample;
  const fragHead = gradient
    ? `varying vec3 vRunColor;\nvarying float vGradT;\nuniform sampler2D ${GRADIENT_RAMP_UNIFORM};\n`
    : 'varying vec3 vRunColor;\n';
  const anchor =
    channel === 'emissive' ? '#include <emissivemap_fragment>' : '#include <color_fragment>';
  const write =
    channel === 'emissive'
      ? limb > 0
        ? `${GRAZING}\n  totalEmissiveRadiance *= ${tinted} * ${limbFactor(limb)};`
        : `totalEmissiveRadiance *= ${tinted};`
      : `diffuseColor.rgb *= ${tinted};`;

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `${head}${shader.vertexShader}`.replace('#include <begin_vertex>', body);
    shader.fragmentShader = `${fragHead}${shader.fragmentShader}`.replace(
      anchor,
      `${anchor}\n  ${write}`,
    );
    if (texture) {
      shader.uniforms[GRADIENT_RAMP_UNIFORM] = { value: texture };
      if (onPosition) {
        // Read here, not at patch time: the word sets these after every letter exists, which is
        // after tintByRunColor has run and before the first compile.
        const bounds = material.userData[GRADIENT_BOUNDS_UNIFORM];
        const origin = material.userData[GRADIENT_ORIGIN_UNIFORM];
        if (bounds instanceof THREE.Vector4) boundsUniform.value = bounds;
        if (origin instanceof THREE.Vector2) originUniform.value = origin;
        shader.uniforms[GRADIENT_BOUNDS_UNIFORM] = boundsUniform;
        shader.uniforms[GRADIENT_ORIGIN_UNIFORM] = originUniform;
      }
    }
  };
  // Two materials patched differently must not share a compiled program. `stops` is absent because
  // it rides a uniform, but the angle and origin are baked into the GLSL and so must part the cache.
  const baked =
    gradient?.domain.of === 'axis'
      ? `-${gradient.domain.angle ?? 0}`
      : gradient?.domain.of === 'radial'
        ? `-${(gradient.domain.at ?? [0.5, 0.5]).join(',')}`
        : '';
  material.customProgramCacheKey = () =>
    `klieg-run-${channel}-${gradient ? `${gradient.domain.of}-${gradient.mode}${baked}` : 'flat'}${
      limb > 0 ? `-rim${limb}` : ''
    }`;
  material.needsUpdate = true;
}

/** The channel a look carries its colour on. */
export function tintChannelOf(look: { emissive?: number }): TintChannel {
  return look.emissive === undefined ? 'color' : 'emissive';
}
