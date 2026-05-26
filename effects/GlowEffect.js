import * as THREE from 'three';

/**
 * GlowEffect — 通用发光光效组件
 *
 * 封装一个可复用的发光球体/椭球体，用于角色武器、道具、身体部位的发光效果。
 * 替代角色 build() 里手动创建 glow mesh 的重复代码。
 *
 * Usage in CharacterBase.build():
 *   this.swordGlow = new GlowEffect({ color: 0x88ccff, size: 0.3, intensity: 0.1 });
 *   this.swordGroup.add(this.swordGlow.mesh);
 */

export class GlowEffect {
  constructor(options = {}) {
    const {
      color = 0xffffff,
      size = 0.3,
      intensity = 0.1,
      scaleY = 1.0,
      pulseSpeed = 3.0,
      pulseRange = 0.05,
    } = options;

    this.color = color;
    this.size = size;
    this.intensity = intensity;
    this.scaleY = scaleY;
    this.pulseSpeed = pulseSpeed;
    this.pulseRange = pulseRange;
    this.time = 0;

    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: intensity,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.y = scaleY;
  }

  update(time, delta) {
    this.time += delta;
    const pulse = this.intensity + Math.sin(this.time * this.pulseSpeed) * this.pulseRange;
    this.mesh.material.opacity = Math.max(0, pulse);
    const scalePulse = 1 + Math.sin(this.time * this.pulseSpeed) * 0.15;
    this.mesh.scale.setScalar(scalePulse);
    this.mesh.scale.y = this.scaleY * scalePulse;
  }

  setColor(color) {
    this.mesh.material.color.setHex(color);
  }

  setIntensity(v) {
    this.intensity = v;
  }

  setVisible(v) {
    this.mesh.visible = v;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
