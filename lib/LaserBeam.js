import * as THREE from 'three';

/**
 * LaserBeam — 激光束可视化
 *
 * 从枪口发射到目标点的能量光束，带核心亮线 + 外发光晕 + 消散动画。
 */
export class LaserBeam {
  constructor(options = {}) {
    this.start = options.start || new THREE.Vector3();
    this.end = options.end || new THREE.Vector3();
    this.color = options.color || 0x00ff88;
    this.coreColor = options.coreColor || 0xffffff;
    this.duration = options.duration ?? 0.15;
    this.width = options.width ?? 0.04;
    this.glowWidth = options.glowWidth ?? 0.12;

    this.group = new THREE.Group();
    this.group.name = 'laserBeam';
    this._age = 0;
    this._done = false;

    this._build();
  }

  _build() {
    const direction = new THREE.Vector3().subVectors(this.end, this.start);
    const length = direction.length();
    if (length < 0.001) return;

    const mid = new THREE.Vector3().addVectors(this.start, this.end).multiplyScalar(0.5);
    this.group.position.copy(mid);
    this.group.lookAt(this.end);

    // 核心亮线
    const coreGeo = new THREE.CylinderGeometry(this.width * 0.5, this.width * 0.5, length, 6, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      color: this.coreColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.coreMesh.rotation.x = Math.PI / 2;
    this.group.add(this.coreMesh);

    // 外发光晕
    const glowGeo = new THREE.CylinderGeometry(this.glowWidth * 0.5, this.glowWidth * 0.5, length, 8, 1, true);
    const glowMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.glowMesh.rotation.x = Math.PI / 2;
    this.group.add(this.glowMesh);

    // 起点端点光晕
    const startGlow = new THREE.Mesh(
      new THREE.SphereGeometry(this.glowWidth, 8, 8),
      new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    startGlow.position.copy(this.start).sub(this.group.position).applyQuaternion(this.group.quaternion.clone().invert());
    this.group.add(startGlow);
    this.startGlow = startGlow;

    // 终点端点光晕
    const endGlow = new THREE.Mesh(
      new THREE.SphereGeometry(this.glowWidth * 1.2, 8, 8),
      new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    endGlow.position.copy(this.end).sub(this.group.position).applyQuaternion(this.group.quaternion.clone().invert());
    this.group.add(endGlow);
    this.endGlow = endGlow;
  }

  addTo(scene) {
    if (this.group) scene.add(this.group);
  }

  update(delta) {
    if (this._done) return true;
    this._age += delta;
    const p = Math.min(1, this._age / this.duration);

    // 快速出现 → 持续 → 快速消散
    let opacity;
    if (p < 0.2) {
      opacity = p / 0.2;
    } else if (p < 0.6) {
      opacity = 1;
    } else {
      opacity = 1 - (p - 0.6) / 0.4;
    }

    if (this.coreMesh) this.coreMesh.material.opacity = opacity * 0.95;
    if (this.glowMesh) this.glowMesh.material.opacity = opacity * 0.4;
    if (this.startGlow) this.startGlow.material.opacity = opacity * 0.6;
    if (this.endGlow) this.endGlow.material.opacity = opacity * 0.8;

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
 * TracerTrail — 飞行物拖尾
 *
 * 为 ProjectileSystem 的飞行物添加连续的短光束段，形成拖尾效果。
 */
export class TracerTrail {
  constructor(options = {}) {
    this.color = options.color || 0x88ffcc;
    this.width = options.width ?? 0.06;
    this.segmentLength = options.segmentLength ?? 0.3;
    this.maxSegments = options.maxSegments ?? 20;
    this.fadeSpeed = options.fadeSpeed ?? 4;

    this.segments = []; // { mesh, opacity, age }
    this.group = new THREE.Group();
    this.group.name = 'tracerTrail';
    this._lastPos = null;
    this._timer = 0;
  }

  addTo(scene) {
    scene.add(this.group);
  }

  /**
   * 在 projectile 当前位置更新拖尾
   * @param {THREE.Vector3} currentPos — 飞行物当前位置
   * @param {THREE.Vector3} prevPos — 上一帧位置
   * @param {number} delta — 时间增量
   */
  emit(currentPos, prevPos, delta) {
    if (!prevPos || !currentPos) return;
    const dist = currentPos.distanceTo(prevPos);
    if (dist < 0.01) return;

    this._timer += delta;
    const interval = this.segmentLength / (dist / delta); // 每段间隔时间
    if (this._timer < interval) return;
    this._timer = 0;

    const direction = new THREE.Vector3().subVectors(currentPos, prevPos).normalize();
    const mid = new THREE.Vector3().addVectors(prevPos, currentPos).multiplyScalar(0.5);
    const length = dist;

    const geo = new THREE.CylinderGeometry(this.width * 0.5, this.width * 0.3, length, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.lookAt(currentPos);
    mesh.rotation.x = Math.PI / 2;

    this.group.add(mesh);
    this.segments.push({ mesh, opacity: 0.7, age: 0 });

    // 限制段数
    while (this.segments.length > this.maxSegments) {
      const old = this.segments.shift();
      this.group.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mesh.material.dispose();
    }
  }

  update(delta) {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i];
      seg.age += delta;
      seg.opacity = Math.max(0, 0.7 - seg.age * this.fadeSpeed);
      seg.mesh.material.opacity = seg.opacity;

      if (seg.opacity <= 0) {
        this.group.remove(seg.mesh);
        seg.mesh.geometry.dispose();
        seg.mesh.material.dispose();
        this.segments.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const seg of this.segments) {
      this.group.remove(seg.mesh);
      seg.mesh.geometry.dispose();
      seg.mesh.material.dispose();
    }
    this.segments = [];
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
