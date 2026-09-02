import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SHADE_ATTRIBUTE, shadeByInstance } from '../../src/render/shade.js';

/** The two chunks the patch anchors on, in the order three emits them. */
function shaders() {
  return {
    vertexShader: 'void main(){\n#include <begin_vertex>\n}',
    fragmentShader: 'void main(){\n#include <aomap_fragment>\n}',
    uniforms: {},
  };
}

describe('shadeByInstance', () => {
  it('reads the attribute in the vertex shader and spends it on the indirect light', () => {
    const material = new THREE.MeshPhysicalMaterial();
    shadeByInstance(material);
    const shader = shaders();
    material.onBeforeCompile?.(shader as never, null as never);
    expect(shader.vertexShader).toContain(`attribute float ${CHUNK_SHADE_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`vChunkShade = ${CHUNK_SHADE_ATTRIBUTE};`);
    expect(shader.fragmentShader).toContain('reflectedLight.indirectSpecular *= vChunkShade;');
  });

  // A chunk look may carry a flake spec, and `createMaterial` has already claimed the hook for it.
  it('keeps the handler the material already had', () => {
    const material = new THREE.MeshPhysicalMaterial();
    let ran = 0;
    material.onBeforeCompile = () => {
      ran++;
    };
    shadeByInstance(material);
    material.onBeforeCompile?.(shaders() as never, null as never);
    expect(ran).toBe(1);
  });

  // Metal shows what it reflects, so the diffuse colour is not where a darkening can land.
  it('does not darken the diffuse colour instead', () => {
    const material = new THREE.MeshPhysicalMaterial();
    shadeByInstance(material);
    const shader = shaders();
    material.onBeforeCompile?.(shader as never, null as never);
    expect(shader.fragmentShader).not.toContain('diffuseColor');
  });
});
