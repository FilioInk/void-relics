import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import { patchShader } from './glsl.ts';

/**
 * Bloom with one full-resolution pass fewer. UnrealBloomPass ends by blending its glow
 * additively over the whole scene target — a read and a write of every pixel — only for the
 * output pass to read every pixel again. Here the glow stays in its own half-size target and
 * the output pass adds it on the way to the screen, with the same arithmetic as that blend
 * (a plain add: the blend material is premultiplied, so ONE/ONE) and before tone mapping as before.
 */
export class BloomPass extends UnrealBloomPass {
  private readonly quad = new FullScreenQuad();
  private readonly oldClear = new THREE.Color();

  /** The blurred glow; valid after render(). */
  get glow(): THREE.Texture {
    return this.renderTargetsHorizontal[0]!.texture;
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    // Steps 1–3 of UnrealBloomPass.render (three r187), unchanged; step 4 lives in BloomOutputPass.
    renderer.getClearColor(this.oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    const highPass = this.highPassUniforms as Record<string, THREE.IUniform>;
    highPass['tDiffuse']!.value = readBuffer.texture;
    highPass['luminosityThreshold']!.value = this.threshold;
    this.quad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.quad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i]!;
      this.quad.material = blur;
      blur.uniforms['colorTexture']!.value = input.texture;
      blur.uniforms['direction']!.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]!);
      renderer.clear();
      this.quad.render(renderer);
      blur.uniforms['colorTexture']!.value = this.renderTargetsHorizontal[i]!.texture;
      blur.uniforms['direction']!.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]!);
      renderer.clear();
      this.quad.render(renderer);
      input = this.renderTargetsVertical[i]!;
    }

    this.quad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms['bloomStrength']!.value = this.strength;
    this.compositeMaterial.uniforms['bloomRadius']!.value = this.radius;
    this.compositeMaterial.uniforms['bloomTintColors']!.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]!);
    renderer.clear();
    this.quad.render(renderer);

    renderer.setClearColor(this.oldClear, oldAlpha);
    renderer.autoClear = oldAutoClear;
  }

  override dispose(): void {
    super.dispose();
    this.quad.dispose();
  }
}

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

/** OutputPass (tone mapping + sRGB) that first adds the bloom glow. */
export class BloomOutputPass extends OutputPass {
  private readonly bloom: BloomPass;

  constructor(bloom: BloomPass) {
    super();
    this.bloom = bloom;
    this.uniforms['tBloom'] = { value: null };
    this.uniforms['bloomOn'] = { value: 1 };
    this.material.fragmentShader = patchShader(OutputShader.fragmentShader, [
      ['uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;\nuniform float bloomOn;'],
      [
        'gl_FragColor = texture2D( tDiffuse, vUv );',
        'gl_FragColor = texture2D( tDiffuse, vUv );\nvec4 glow = texture2D( tBloom, vUv );\ngl_FragColor.rgb += glow.rgb * bloomOn;',
      ],
    ]);
    this.material.needsUpdate = true;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.uniforms['tBloom']!.value = this.bloom.glow;
    this.uniforms['bloomOn']!.value = this.bloom.enabled ? 1 : 0;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
