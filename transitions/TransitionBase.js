import * as THREE from 'three';

/**
 * Transition base class.
 * A transition is a full-screen visual effect that plays during scene changes.
 * It operates on an overlay plane in front of the 3D scene.
 *
 * Lifecycle:
 *   start(renderer, camera, context) -> called once when transition begins
 *   update(t, renderer, camera, context) -> called every frame, t = 0..1
 *   end(renderer, camera, context) -> called once when transition completes
 */
export class TransitionBase {
  constructor(options = {}) {
    this.name = this.constructor.name;
    this.duration = options.duration ?? 0.5;
    this.started = false;
    this.ended = false;
    this.overlay = null; // THREE.Mesh for full-screen quad
  }

  /**
   * Create a full-screen overlay mesh with a ShaderMaterial.
   * Subclasses can override to provide custom shaders.
   */
  createOverlayMaterial() {
    // Default: simple fade to black
    return new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0.0 },
        uColor: { value: new THREE.Color(0x000000) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uProgress;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(uColor, uProgress);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  start(renderer, camera, context) {
    this.started = true;
    if (!this.overlay) {
      const geometry = new THREE.PlaneGeometry(2, 2);
      const material = this.createOverlayMaterial();
      this.overlay = new THREE.Mesh(geometry, material);
      this.overlay.renderOrder = 9999;
    }
    // Add overlay to a dedicated scene for post-processing
    if (!context.transitionScene) {
      context.transitionScene = new THREE.Scene();
    }
    context.transitionScene.add(this.overlay);
  }

  update(t, renderer, camera, context) {
    if (this.overlay && this.overlay.material.uniforms.uProgress) {
      this.overlay.material.uniforms.uProgress.value = t;
    }
  }

  end(renderer, camera, context) {
    this.ended = true;
    if (this.overlay && context.transitionScene) {
      context.transitionScene.remove(this.overlay);
    }
  }

  /**
   * Easing functions
   */
  static easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  static easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  static easeInQuad(t) {
    return t * t;
  }
}
