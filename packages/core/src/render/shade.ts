import type * as THREE from 'three';

export const CHUNK_SHADE_ATTRIBUTE = 'chunkShade';

/**
 * Folds a per-instance shade into what the environment gives a chunk.
 *
 * It multiplies the indirect terms rather than the diffuse colour, because a chunk look is metal:
 * `sequin`'s discs are `metalness: 1`, so nearly all of what they show is the environment they
 * reflect, and darkening `diffuseColor` there moves almost nothing. This is the occlusion slot —
 * the same place an AO map would land.
 *
 * Wraps whatever handler the material already has instead of replacing it. `createMaterial` sets
 * one for the flake field, and a chunk look may carry a flake spec.
 */
export function shadeByInstance(material: THREE.Material): void {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior?.call(material, shader, renderer);
    shader.vertexShader =
      `attribute float ${CHUNK_SHADE_ATTRIBUTE};\nvarying float vChunkShade;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n  vChunkShade = ${CHUNK_SHADE_ATTRIBUTE};`,
      );
    shader.fragmentShader = `varying float vChunkShade;\n${shader.fragmentShader}`.replace(
      '#include <aomap_fragment>',
      '#include <aomap_fragment>\n' +
        '  reflectedLight.indirectDiffuse *= vChunkShade;\n' +
        '  reflectedLight.indirectSpecular *= vChunkShade;',
    );
  };
  material.needsUpdate = true;
}
