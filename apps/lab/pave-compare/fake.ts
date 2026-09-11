/**
 * Pavé painted on in the fragment shader: Voronoi cells over the letter's front face, a metal wall
 * where two cells meet, and a faceted crown tilting each stone's normal. No geometry — the letter
 * underneath is the plain extruded glyph, which is the cheapest thing klieg builds.
 *
 * Lab-only. It is here to be compared against the real well geometry, not to ship.
 */
import * as THREE from 'three';

export interface FakePave {
  /** Cell size, in em. The real `pave` look's pitch. */
  pitch: number;
  /** Metal between two cells, as a fraction of a cell. */
  wall: number;
  /** Wall color and finish. */
  metal: number;
  metalRoughness: number;
  /** Crown facets around each stone's table. */
  facets: number;
}

const COMMON = /* glsl */ `
uniform float uPvPitch;
uniform float uPvWall;
uniform vec3 uPvMetal;
uniform float uPvMetalRough;
uniform float uPvFacets;
varying vec3 vPvPos;
varying vec3 vPvNrm;
varying vec3 vPvX;
varying vec3 vPvY;

vec2 pvHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

// Distance to the nearest cell border, and the offset from the cell's seed — the two-pass form, so
// the wall is a true band of constant width rather than the f2 - f1 gap, which swells at corners.
vec3 pvVoronoi(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + 0.5 + (pvHash(n + g) - 0.5) * 0.8 - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + 0.5 + (pvHash(n + g) - 0.5) * 0.8 - f;
      if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }
  return vec3(md, mr);
}
`;

const SURFACE = /* glsl */ `
float pvStone = 0.0;
{
  // The front cap only. The chamfer and the sides stay metal, which stands in for the bezel.
  float pvFront = smoothstep(0.92, 0.99, normalize(vPvNrm).z);
  vec3 pvV = pvVoronoi(vPvPos.xy / uPvPitch);
  float pvAa = fwidth(pvV.x);
  pvStone = smoothstep(uPvWall * 0.5 - pvAa, uPvWall * 0.5 + pvAa, pvV.x) * pvFront;

  // A table in the middle, crown facets around it: each sector tilts toward its own direction.
  vec2 pvTo = -pvV.yz;
  float pvR = length(pvTo);
  float pvStep = 6.2831853 / uPvFacets;
  float pvAng = floor(atan(pvTo.y, pvTo.x) / pvStep + 0.5) * pvStep;
  float pvTable = 1.0 - smoothstep(0.16, 0.22, pvR);
  float pvTilt = mix(0.6, 0.0, pvTable);
  vec2 pvDir = vec2(cos(pvAng), sin(pvAng)) * sin(pvTilt);
  vec3 pvFacet = normalize(vPvX * pvDir.x + vPvY * pvDir.y + normal * cos(pvTilt));
  normal = normalize(mix(normal, pvFacet, pvStone));

  diffuseColor.rgb = mix(uPvMetal, diffuseColor.rgb, pvStone);
  metalnessFactor = mix(1.0, metalnessFactor, pvStone);
  roughnessFactor = mix(uPvMetalRough, roughnessFactor, pvStone);
}
`;

/** Chains onto whatever the material already patches in — the flake field — rather than replacing it. */
export function paintPave(material: THREE.MeshPhysicalMaterial, spec: FakePave): void {
  const uniforms = {
    uPvPitch: { value: spec.pitch },
    uPvWall: { value: spec.wall },
    uPvMetal: { value: new THREE.Color(spec.metal) },
    uPvMetalRough: { value: spec.metalRoughness },
    uPvFacets: { value: spec.facets },
  };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `varying vec3 vPvPos;\nvarying vec3 vPvNrm;\nvarying vec3 vPvX;\nvarying vec3 vPvY;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vPvPos = transformed;
      vPvNrm = objectNormal;
      vPvX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
      vPvY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`,
      );
    shader.fragmentShader = `${COMMON}${shader.fragmentShader}`
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SURFACE}`)
      // A wall is metal, and metal does not let light through.
      .replace(
        '#include <transmission_fragment>',
        '#include <transmission_fragment>\nmaterial.transmission *= pvStone;',
      );
  };
  // Three keys a compiled program by its source before the patch runs; without this the painted
  // letter reuses the flake-only program and the patch never appears.
  material.customProgramCacheKey = () => 'fake-pave';
  material.needsUpdate = true;
}
