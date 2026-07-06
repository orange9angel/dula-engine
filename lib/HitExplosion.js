import * as THREE from 'three';

/**
 * HitExplosion — 命中爆炸光效
 *
 * 多层效果：
 * 1. 核心白光球（快速膨胀然后消失）
 * 2. 外发光球（较大，较慢消散）
 * 3. 火花粒子（向外散射）
 */
export class HitExplosion {
  constructor(options = {}) {
    this.position = options.position || new THREE.Vector3();
    this.color = options.color || 0xffaa33;
    this.coreColor = options.coreColor || 0xffffff;
    this.duration = options.duration ?? 0.35;
    this.maxRadius = options.maxRadius ?? 0.45;
    this.sparkCount = options.sparkCount ?? 12;

    this.group = new THREE.Group();
    this.group.name = 'hitExplosion';
    this._age = 0;
    this._done = false;

    this._build();
  }

  _build() {
    this.group.position.copy(this.position);

    // 核心白光球
    const coreGeo = new THREE.SphereGeometry(0.1, 12, 12);
    const coreMat = new THREE.MeshBasicMaterial({
      color: this.coreColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.group.add(this.coreMesh);

    // 外发光球
    const glowGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.group.add(this.glowMesh);

    // 火花
    this.sparks = [];
    const sparkGeo = new THREE.CylinderGeometry(0.003, 0.001, 0.15, 4);
    for (let i = 0; i < this.sparkCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? this.coreColor : this.color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      const angle = (i / this.sparkCount) * Math.PI * 2 + Math.random() * 0.5;
      const pitch = (Math.random() - 0.5) * Math.PI * 0.6;
      const speed = 2 + Math.random() * 4;
      mesh.rotation.z = Math.PI / 2;
      mesh.rotation.y = angle;
      mesh.userData = {
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(pitch) * speed,
          Math.sin(pitch) * speed,
          Math.sin(angle) * Math.cos(pitch) * speed
        ),
      };
      this.group.add(mesh);
      this.sparks.push(mesh);
    }
  }

  addTo(scene) {
    if (this.group) scene.add(this.group);
  }

  update(delta) {
    if (this._done) return true;
    this._age += delta;
    const p = Math.min(1, this._age / this.duration);

    // 核心球：快速膨胀 + 快速消失
    const corePhase = Math.min(1, p * 3);
    const coreScale = corePhase * (this.maxRadius * 0.4 / 0.1);
    this.coreMesh.scale.setScalar(coreScale);
    this.coreMesh.material.opacity = 0.95 * (1 - Math.pow(p, 0.5));

    // 外发光球：较慢膨胀 + 较慢消散
    const glowPhase = Math.min(1, p * 2);
    const glowScale = glowPhase * (this.maxRadius / 0.2);
    this.glowMesh.scale.setScalar(glowScale);
    this.glowMesh.material.opacity = 0.6 * (1 - p);

    // 火花：物理散射 + 淡出
    for (const spark of this.sparks) {
      const v = spark.userData.velocity;
      spark.position.x += v.x * delta;
      spark.position.y += v.y * delta;
      spark.position.z += v.z * delta;
      v.y -= 4.0 * delta; // 重力
      spark.material.opacity = 0.85 * (1 - p);
      spark.lookAt(
        spark.position.x + v.x,
        spark.position.y + v.y,
        spark.position.z + v.z
      );
    }

    if (p >= 1) {
      this.dispose();
      this._done = true;
    }
    return this._done;
  }

  dispose() {
    this.group?.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    if (this.group?.parent) this.group.parent.remove(this.group);
  }
}

/**
 * Shockwave — 地面冲击波环
 *
 * 从命中点向外扩散的环形波，配合镜头震动使用。
 */
export class Shockwave {
  constructor(options = {}) {
    this.position = options.position || new THREE.Vector3();
    this.color = options.color || 0xffffff;
    this.duration = options.duration ?? 0.5;
    this.maxRadius = options.maxRadius ?? 2.0;
    this.ringWidth = options.ringWidth ?? 0.15;

    this.group = new THREE.Group();
    this.group.name = 'shockwave';
    this._age = 0;
    this._done = false;

    this._build();
  }

  _build() {
    this.group.position.copy(this.position);
    this.group.position.y = 0.02; // 紧贴地面

    // 主环
    const ringGeo = new THREE.RingGeometry(
      0.1, 0.1 + this.ringWidth, 32
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.group.add(this.ringMesh);

    // 内环（更亮，更细）
    const innerGeo = new THREE.RingGeometry(
      0.08, 0.08 + this.ringWidth * 0.5, 32
    );
    const innerMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.innerRing = new THREE.Mesh(innerGeo, innerMat);
    this.innerRing.rotation.x = -Math.PI / 2;
    this.group.add(this.innerRing);

    // 灰尘粒子（小圆点）
    this.dust = [];
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.03 + Math.random() * 0.04, 6),
        new THREE.MeshBasicMaterial({
          color: 0xdddddd,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
      mesh.userData = { angle, speed: 1 + Math.random() * 2 };
      this.group.add(mesh);
      this.dust.push(mesh);
    }
  }

  addTo(scene) {
    if (this.group) scene.add(this.group);
  }

  update(delta) {
    if (this._done) return true;
    this._age += delta;
    const p = Math.min(1, this._age / this.duration);

    // 环向外扩散
    const currentRadius = p * this.maxRadius;
    const innerR = Math.max(0.01, currentRadius);
    const outerR = innerR + this.ringWidth * (1 - p * 0.5);

    const ringGeo = new THREE.RingGeometry(innerR, outerR, 32);
    this.ringMesh.geometry.dispose();
    this.ringMesh.geometry = ringGeo;
    this.ringMesh.material.opacity = 0.5 * (1 - Math.pow(p, 2));

    const innerGeo = new THREE.RingGeometry(
      innerR * 0.8, innerR * 0.8 + this.ringWidth * 0.5 * (1 - p * 0.5), 32
    );
    this.innerRing.geometry.dispose();
    this.innerRing.geometry = innerGeo;
    this.innerRing.material.opacity = 0.7 * (1 - p);

    // 灰尘扩散
    for (const d of this.dust) {
      const dist = p * this.maxRadius * d.userData.speed * 0.5;
      d.position.x = Math.cos(d.userData.angle) * dist;
      d.position.z = Math.sin(d.userData.angle) * dist;
      d.material.opacity = 0.3 * (1 - p);
      const scale = 1 + p * 2;
      d.scale.setScalar(scale);
    }

    if (p >= 1) {
      this.dispose();
      this._done = true;
    }
    return this._done;
  }

  dispose() {
    this.group?.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    if (this.group?.parent) this.group.parent.remove(this.group);
  }
}

/**
 * ScreenFlash — 屏幕白光闪烁
 *
 * 瞬间全屏白光，模拟强光爆炸。
 * 使用一个大平面放在相机前。
 */
export class ScreenFlash {
  constructor(options = {}) {
    this.color = options.color || 0xffffff;
    this.duration = options.duration ?? 0.08;
    this.intensity = options.intensity ?? 0.6;
    this.camera = options.camera || null;

    this._age = 0;
    this._done = false;
    this.mesh = null;

    if (this.camera) this._build();
  }

  _build() {
    // 创建一个大平面在相机前
    const size = 10;
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: this.intensity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 9999;
    this.mesh.position.set(0, 0, -1);
    this.camera.add(this.mesh);
  }

  update(delta) {
    if (this._done) return true;
    this._age += delta;
    const p = Math.min(1, this._age / this.duration);

    // 快速亮起然后缓慢消退
    let opacity;
    if (p < 0.3) {
      opacity = this.intensity * (p / 0.3);
    } else {
      opacity = this.intensity * (1 - (p - 0.3) / 0.7);
    }

    if (this.mesh) this.mesh.material.opacity = opacity;

    if (p >= 1) {
      this.dispose();
      this._done = true;
    }
    return this._done;
  }

  dispose() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
}
