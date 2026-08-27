import * as THREE from 'three';

interface Bar {
  pos: [number, number, number];
  size: [number, number];
  rot: number;
  rgb: [number, number, number];
}

// RGB values above 1.0 are the point — these are lights, not surfaces.
//
// The fill is warm-balanced and the two keys are white. A blue fill is what made the extrusion
// walls read as cement: faces and walls share one material, so a metal's walls show only what
// they reflect, and warm base colour times blue radiance is gray.
const BARS: Bar[] = [
  { pos: [-9, 7, -6], size: [26, 2.2], rot: 0.3, rgb: [9, 9, 10] },
  { pos: [11, 4, -4], size: [20, 1.4], rot: -0.22, rgb: [9.043, 7.372, 5.246] },
  { pos: [-6, -8, 6], size: [22, 3.0], rot: 0.12, rgb: [3.118, 2.538, 1.899] },
  { pos: [14, -3, 8], size: [14, 5.0], rot: -0.55, rgb: [6, 4.4, 2.2] },
  { pos: [-14, -1, -9], size: [12, 4.0], rot: 0.48, rgb: [4.274, 3.806, 3.403] },
  { pos: [0, 13, 4], size: [16, 2.0], rot: 0, rgb: [10, 10, 10] },
];

/** Radians of blur applied before prefiltering. */
const BLUR_SIGMA = 0.03;

function buildShell(): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0.072, 0.06, 0.057) },
        bottom: { value: new THREE.Color(0.013, 0.01, 0.01) },
      },
      vertexShader: `
        varying vec3 vP;
        void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
        void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-20.0, 20.0, vP.y)), 1.0); }`,
    }),
  );
}

function buildBar(bar: Bar): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(bar.size[0], bar.size[1]),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(...bar.rgb),
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.set(...bar.pos);
  mesh.lookAt(0, 0, 0);
  mesh.rotateZ(bar.rot);
  return mesh;
}

/**
 * A synthetic photo studio: dark shell plus bright bars, turned into a reflection probe. The
 * render target is returned rather than its texture — disposing a render target's texture frees
 * nothing, so only the caller holding the target can release the GPU memory.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const meshes = [buildShell(), ...BARS.map(buildBar)];
  for (const mesh of meshes) scene.add(mesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, BLUR_SIGMA);
  pmrem.dispose();

  for (const mesh of meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  return target;
}
