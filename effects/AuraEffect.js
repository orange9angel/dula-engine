import * as THREE from 'three';

/**
 * AuraEffect — 通用能量气场组件
 *
 * 封装一个可复用的能量气场（椭球外壳 + 旋转光环 + 漂浮粒子），
 * 用于角色小宇宙、能量爆发、变身等效果。
 *
 * Usage in CharacterBase.build():
 *   this.cosmosAura = new AuraEffect({
 *     color: 0x67d7ff, auraSize: 0.7, ringCount: 3, starCount: 10
 *   });
 *   this.mesh.add(this.cosmosAura.group);
 */

export class AuraEffect {
  constructor(options = {}) {
    const {
      color = 0x67d7ff,
      auraSize = 0.7,
      auraOpacity = 0.1,
      scaleX = 0.8,
      scaleY = 1.5,
      scaleZ = 0.55,
      ringCount = 3,
      ringColor = 0xffffff,
      ringOpacity = 0.3,
      starCount = 10,
      pulseSpeed = 3.2,
      rotationSpeed = 0.5,
    } = options;

    this.color = color;
    this.pulseSpeed = pulseSpeed;
    this.rotationSpeed = rotationSpeed;
    this.time = 0;
    this.active = true;

    this.group = new THREE.Group();

    // Main aura shell
    const auraMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: auraOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const aura = new THREE.Mesh(new THREE.SphereGeometry(auraSize, 20, 16), auraMat);
    aura.position.y = auraSize * 1.35;
    aura.scale.set(scaleX, scaleY, scaleZ);
    this.group.add(aura);
    this.auraMesh = aura;

    // Rotating rings
    this.rings = [];
    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: ringOpacity,
      depthWrite: false,
    });
    for (let i = 0; i < ringCount; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.33 + i * 0.09, 0.005, 8, 40),
        ringMat.clone()
      );
      ring.position.y = auraSize * 1.1 + i * auraSize * 0.37;
      ring.rotation.x = Math.PI / 2 + i * 0.15;
      ring.rotation.z = i * 0.65;
      this.group.add(ring);
      this.rings.push(ring);
    }

    // Floating stars/particles
    this.stars = [];
    const starMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: ringOpacity,
      depthWrite: false,
    });
    for (let i = 0; i < starCount; i++) {
      const star = new THREE.Mesh(
        new THREE.SphereGeometry(0.01 + (i % 3) * 0.002, 8, 8),
        starMat.clone()
      );
      const a = (i / starCount) * Math.PI * 2;
      star.position.set(
        Math.cos(a) * (0.36 + (i % 2) * 0.14),
        auraSize * 0.74 + (i % 5) * auraSize * 0.29,
        Math.sin(a) * 0.16
      );
      star.userData.baseY = star.position.y;
      star.userData.phase = i;
      this.group.add(star);
      this.stars.push(star);
    }
  }

  update(time, delta) {
    this.time += delta;
    if (!this.active) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // Aura pulse
    if (this.auraMesh) {
      const pulse = 0.08 + Math.sin(this.time * this.pulseSpeed) * 0.03;
      this.auraMesh.material.opacity = pulse;
    }

    // Ring rotation
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.rotation.z += delta * (this.rotationSpeed + i * 0.18);
      ring.material.opacity = 0.2 + Math.sin(this.time * 2.4 + i) * 0.07;
    }

    // Star twinkle
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      star.material.opacity = 0.22 + Math.abs(Math.sin(this.time * 4 + star.userData.phase)) * 0.5;
      star.position.y = star.userData.baseY + Math.sin(this.time * 1.7 + star.userData.phase) * 0.008;
    }
  }

  setActive(v) {
    this.active = v;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  dispose() {
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
