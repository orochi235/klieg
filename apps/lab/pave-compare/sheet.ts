/**
 * Pavé by composition: one sheet of real wells and stones, baked once, shown through each letter's
 * outline on the GPU, with a raised rim hiding where the sheet is cut.
 *
 * The letter itself is the plain extruded glyph, its front cap opened wherever the sheet shows.
 * Nothing here conforms a cell to a letter — which is what every millisecond of the real pipeline
 * is spent on — so a letter costs its own distance field and one boolean for the rim.
 *
 * Lab-only, for the spin comparison.
 */
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { applyLook, createMaterial, type Look } from '../../../packages/core/src/render/looks.js';
import { isoContours } from '../../../packages/core/src/render/tube/field.js';
import { cutterFor } from '../../../packages/core/src/render/wells/cutters.js';
import { fillFor } from '../../../packages/core/src/render/wells/fills.js';
import { regionOf } from '../../../packages/core/src/render/wells/region.js';
import {
  fromPoints,
  nest,
  type Ring,
  resample,
  smooth,
} from '../../../packages/core/src/render/wells/rings.js';
import {
  buildShell,
  DEFAULT_SHELL,
  shellPlanes,
} from '../../../packages/core/src/render/wells/shell.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../packages/core/src/text/glyphs.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;
/** Where the sheet starts, in em in from the outline: just past the glyph's own rounded bevel. */
const MASK = DEFAULT_GLYPH_OPTIONS.bevelSize + 0.004;
/** The rim's half-width either side of the seam, before its own bevel rounds it outward. */
const RIM_HALF = 0.002;
const RIM_BEVEL = 0.005;
const RIM_HEIGHT = 0.004;

export interface Sheet {
  shell: THREE.BufferGeometry;
  stones: THREE.BufferGeometry;
  stoneMaterial: THREE.MeshPhysicalMaterial;
  ms: number;
}

/** A pavé slab over `box`, through the shipped cutter, shell and fill. Baked once, shared. */
export function bakeSheet(
  box: THREE.Box2,
  spec: Record<string, unknown>,
  env: THREE.Texture,
): Sheet {
  const t = performance.now();
  const rect = new THREE.Shape();
  rect.moveTo(box.min.x, box.min.y);
  rect.lineTo(box.max.x, box.min.y);
  rect.lineTo(box.max.x, box.max.y);
  rect.lineTo(box.min.x, box.max.y);
  rect.closePath();
  const shapes = [rect];

  const cut = cutterFor(spec.cutter as string)(shapes, regionOf(shapes, 'uniform'), spec as never);
  const bezel = (spec.bezel as number) ?? 0.026;
  const shell = buildShell(shapes, cut, {
    ...DEFAULT_SHELL,
    depth: DEPTH,
    bezel,
    rimBevel: (spec.rimBevel as number) ?? DEFAULT_SHELL.rimBevel,
    rimDrop: (spec.rimDrop as number) ?? DEFAULT_SHELL.rimDrop,
  }).geometry;
  const planes = shellPlanes(DEPTH, spec.floor as number, bezel);
  const filled = fillFor(spec.fill as string)(
    cut.seats,
    {
      material: () => createMaterial(env),
      faceZ: planes.faceZ,
      floorZ: planes.floorZ,
      girdleZ: planes.faceZ - 0.003,
    },
    spec as never,
  );
  return {
    shell,
    stones: filled.geometry,
    stoneMaterial: filled.material,
    ms: performance.now() - t,
  };
}

/** A letter's signed distance field as a texture the fragment shader can ask "how far in?". */
export interface Mask {
  texture: THREE.DataTexture;
  /** originX, originY, emPerCell, size — the field's own placement. */
  xf: THREE.Vector4;
  field: ReturnType<typeof regionOf>['field'];
}

export function maskOf(shapes: readonly THREE.Shape[]): Mask {
  const { field } = regionOf(shapes, 'uniform');
  const data = new Float32Array(field.data.length);
  for (let i = 0; i < data.length; i++) data[i] = field.data[i] as number;
  const texture = new THREE.DataTexture(
    data,
    field.size,
    field.size,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return {
    texture,
    xf: new THREE.Vector4(field.originX, field.originY, field.emPerCell, field.size),
    field,
  };
}

/**
 * Keeps fragments by how far inside the letter they are. `inside` keeps only what lies deeper than
 * the mask — the sheet. `cap` drops the front cap exactly there, so the sheet shows through the
 * plain letter and nothing else of it is touched.
 */
export function maskMaterial(
  material: THREE.MeshPhysicalMaterial,
  mask: Mask,
  mode: 'inside' | 'cap',
  shift: THREE.Vector2 = new THREE.Vector2(),
): void {
  const uniforms = {
    uMask: { value: mask.texture },
    uMaskXf: { value: mask.xf },
    uMaskLevel: { value: -MASK },
    // Where this mesh sits in the letter's own space. A sheet slid to show a letter its own patch
    // has to be masked where it lands, not where it was baked.
    uMaskShift: { value: shift },
  };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `varying vec3 vMkPos;\nvarying vec3 vMkNrm;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMkPos = transformed;\nvMkNrm = objectNormal;',
      );
    const test =
      mode === 'inside'
        ? 'if (mkDepth > uMaskLevel) discard;'
        : 'if (normalize(vMkNrm).z > 0.9 && mkDepth <= uMaskLevel) discard;';
    shader.fragmentShader =
      `uniform sampler2D uMask;\nuniform vec4 uMaskXf;\nuniform float uMaskLevel;\nuniform vec2 uMaskShift;\nvarying vec3 vMkPos;\nvarying vec3 vMkNrm;\n${shader.fragmentShader}`.replace(
        'void main() {',
        `void main() {
  vec2 mkUv = ((vMkPos.xy + uMaskShift - uMaskXf.xy) / uMaskXf.z + 0.5) / uMaskXf.w;
  float mkDepth = texture2D(uMask, mkUv).r;
  ${test}`,
      );
  };
  material.customProgramCacheKey = () => `mask-${mode}`;
  material.needsUpdate = true;
}

const clean = (r: { x: number; y: number }[]): Ring => smooth(resample(fromPoints(r), 0.006), 3);

/** The letter inset by `by`, as the multipolygon polygon-clipping takes. */
function insetOf(mask: Mask, by: number): Ring[][] {
  return nest(isoContours(mask.field, -by).map(clean));
}

/**
 * A rounded bead standing on the seam between the plain letter and the sheet: the band between two
 * insets, extruded thin and bevelled round. The only per-letter geometry this path builds.
 */
export function rimOf(mask: Mask): THREE.BufferGeometry {
  const band = polygonClipping.difference(
    insetOf(mask, MASK - RIM_HALF) as never,
    insetOf(mask, MASK + RIM_HALF) as never,
  );
  const shapes: THREE.Shape[] = [];
  for (const poly of band) {
    const [outer, ...holes] = poly as number[][][];
    if (!outer) continue;
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    shapes.push(shape);
  }
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: RIM_HEIGHT,
    bevelEnabled: true,
    bevelThickness: RIM_BEVEL,
    bevelSize: RIM_BEVEL * 0.8,
    bevelSegments: 4,
    curveSegments: 1,
  });
  // Seated on the face, its lower bevel buried under it.
  geo.translate(0, 0, DEPTH + DEFAULT_GLYPH_OPTIONS.bevelThickness);
  return geo;
}

/**
 * A fresh stone material matching the sheet's own, so each letter can carry its own mask. Built
 * rather than cloned: a clone round-trips `userData` through JSON and loses the flake uniforms.
 */
export function stoneMaterialOf(
  sheet: Sheet,
  stone: Look,
  env: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  const m = createMaterial(env);
  applyLook(m, stone);
  m.thickness = sheet.stoneMaterial.thickness;
  return m;
}

/** A metal material in a look's own finish, carrying the studio the way a `Word`'s does. */
export function metalOf(look: Look, env: THREE.Texture): THREE.MeshPhysicalMaterial {
  const m = createMaterial(env);
  applyLook(m, look);
  return m;
}
