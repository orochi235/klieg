import * as THREE from 'three';

const QUAD_VS = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export interface BloomOptions {
  strength: number;
  threshold: number;
  alphaBoost: number;
}

export const DEFAULT_BLOOM: BloomOptions = { strength: 1.1, threshold: 0.72, alphaBoost: 0.9 };

/** A sub-rectangle of the canvas, in three's own bottom-left-origin logical pixels. */
export interface BloomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Sampler = THREE.IUniform<THREE.Texture | null>;

/** Half-res texels per tap, one separable pass each: a tight core under a wider halo. */
const BLUR_RADII = [1, 2.5];

export class BloomPath {
  private sceneRT!: THREE.WebGLRenderTarget;
  private brightRT!: THREE.WebGLRenderTarget;
  private blurRT!: THREE.WebGLRenderTarget;

  private readonly allocated = new THREE.Vector2();
  private readonly drawingBuffer = new THREE.Vector2();
  private readonly canvasSize = new THREE.Vector2();

  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.Camera();
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));

  private readonly thresholdMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;

  private readonly thresholdSrc: Sampler = { value: null };
  private readonly blurSrc: Sampler = { value: null };
  private readonly blurDir: THREE.IUniform<THREE.Vector2> = { value: new THREE.Vector2() };
  private readonly compositeBase: Sampler = { value: null };
  private readonly compositeBloom: Sampler = { value: null };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    opts = DEFAULT_BLOOM,
  ) {
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const common = { depthTest: false, depthWrite: false, blending: THREE.NoBlending };

    this.thresholdMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tDiffuse: this.thresholdSrc, threshold: { value: opts.threshold } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c.rgb * smoothstep(threshold, threshold + 0.35, l) * c.a, 1.0);
        }`,
    });

    this.blurMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tDiffuse: this.blurSrc, dir: this.blurDir },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
        void main(){
          vec4 s = vec4(0.0);
          s += texture2D(tDiffuse, vUv + dir * -4.0) * 0.0162;
          s += texture2D(tDiffuse, vUv + dir * -3.0) * 0.0540;
          s += texture2D(tDiffuse, vUv + dir * -2.0) * 0.1216;
          s += texture2D(tDiffuse, vUv + dir * -1.0) * 0.1946;
          s += texture2D(tDiffuse, vUv)              * 0.2270;
          s += texture2D(tDiffuse, vUv + dir *  1.0) * 0.1946;
          s += texture2D(tDiffuse, vUv + dir *  2.0) * 0.1216;
          s += texture2D(tDiffuse, vUv + dir *  3.0) * 0.0540;
          s += texture2D(tDiffuse, vUv + dir *  4.0) * 0.0162;
          gl_FragColor = s;
        }`,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      ...common,
      transparent: true,
      uniforms: {
        tBase: this.compositeBase,
        tBloom: this.compositeBloom,
        strength: { value: opts.strength },
        alphaBoost: { value: opts.alphaBoost },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tBase, tBloom;
        uniform float strength, alphaBoost;
        varying vec2 vUv;
        void main(){
          vec4 base  = texture2D(tBase,  vUv);
          vec3 bloom = texture2D(tBloom, vUv).rgb * strength;
          // The glow lives outside the letters' silhouette where base.a is 0. Without giving
          // it alpha of its own it renders into a transparent region and is never seen.
          float bl = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(base.rgb + bloom, clamp(max(base.a, bl * alphaBoost), 0.0, 1.0));
          // three encodes for the canvas only through this include, and the scene target is linear.
          #include <colorspace_fragment>
        }`,
    });

    this.resize();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, rect?: BloomRect): void {
    const r = this.renderer;
    this.resize();
    const size = r.getSize(this.canvasSize);

    r.setRenderTarget(this.sceneRT);
    // Owned, not inherited: the composite's setRenderTarget(null) restores the renderer's own
    // viewport and scissor, so a caller who left either armed would clip or squash it.
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.clear();
    // Viewport only, never a scissor: three resolves this target's MSAA buffer with a
    // blitFramebuffer a scissor would clip, stranding a neighbour in the margins for the blur.
    if (rect) r.setViewport(rect.x, rect.y, rect.w, rect.h);
    r.render(scene, camera);

    this.thresholdSrc.value = this.sceneRT.texture;
    this.blit(this.thresholdMat, this.brightRT);

    for (const radius of BLUR_RADII) {
      this.blurSrc.value = this.brightRT.texture;
      this.blurDir.value.set(radius / this.brightRT.width, 0);
      this.blit(this.blurMat, this.blurRT);
      this.blurSrc.value = this.blurRT.texture;
      this.blurDir.value.set(0, radius / this.brightRT.height);
      this.blit(this.blurMat, this.brightRT);
    }

    this.compositeBase.value = this.sceneRT.texture;
    this.compositeBloom.value = this.brightRT.texture;
    r.setViewport(0, 0, size.x, size.y);
    if (rect) {
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.setScissorTest(true);
    }
    this.blit(this.compositeMat, null);
    if (rect) r.setScissorTest(false);
  }

  /**
   * Links the three quad programs without painting. `render` composites to the default
   * framebuffer, which is the canvas the stage has already appended — warming through it would
   * show a frame of bloom over a page that has fired nothing.
   */
  warm(): void {
    this.resize();
    this.thresholdSrc.value = this.sceneRT.texture;
    this.blurSrc.value = this.brightRT.texture;
    this.blurDir.value.set(0, 0);
    this.compositeBase.value = this.sceneRT.texture;
    this.compositeBloom.value = this.brightRT.texture;
    // Into blurRT for all three: it is the one target none of them samples, so no pass reads the
    // texture it is writing.
    for (const material of [this.thresholdMat, this.blurMat, this.compositeMat]) {
      this.blit(material, this.blurRT);
    }
    this.renderer.setRenderTarget(null);
  }

  /** Per frame because the stage resizes the drawing buffer without knowing these targets exist. */
  private resize(): void {
    const size = this.renderer.getDrawingBufferSize(this.drawingBuffer);
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);
    if (this.allocated.x === w && this.allocated.y === h) return;
    this.allocated.set(w, h);

    const opts = {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    } as const;

    this.sceneRT?.dispose();
    this.brightRT?.dispose();
    this.blurRT?.dispose();

    // samples>0 is the ONLY thing that antialiases a render target. The renderer's
    // `antialias: true` applies to the default framebuffer and is ignored here.
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true, samples: 4 });
    this.brightRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, opts);
    this.blurRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, opts);
  }

  private blit(material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    // Redundant while autoClear is on and the quad covers every pixel, and safe only because rect
    // mode arms the scissor first - unscissored it would wipe the panels already drawn.
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCam);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.brightRT.dispose();
    this.blurRT.dispose();
    this.quad.geometry.dispose();
    this.thresholdMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}
