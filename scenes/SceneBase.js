import * as THREE from 'three';
import { JointConstraintSystem } from '../constraints/JointConstraintSystem.js';

export class SceneBase {
  constructor(name) {
    this.name = name;
    this.scene = new THREE.Scene();
    this.scene.name = name;
    this.lights = [];
    this.characters = [];
    // Per-character constraint systems (created lazily)
    this._constraintSystems = new Map();
    // Collision proxies for camera clipping prevention
    this.cameraObstacles = [];
  }

  /**
   * Register a collision proxy to keep cameras from clipping into scene geometry.
   *
   * Supported obstacle types:
   *   - { type: 'sphere',  center: THREE.Vector3, radius: number }
   *   - { type: 'capsule', start: THREE.Vector3, end: THREE.Vector3, radius: number }
   *   - { type: 'box',     center: THREE.Vector3, size: THREE.Vector3, rotation?: THREE.Quaternion }
   */
  registerCameraObstacle(obstacle) {
    if (obstacle && obstacle.type) {
      this.cameraObstacles.push(obstacle);
    }
  }

  clearCameraObstacles() {
    this.cameraObstacles = [];
  }

  build() {
    // Override in subclass
    this.addLights();
    return this.scene;
  }

  addLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambient);
    this.lights.push(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    this.scene.add(dir);
    this.lights.push(dir);
  }

  addCharacter(character) {
    if (!this.characters.includes(character)) {
      this.characters.push(character);
      this.scene.add(character.mesh);
    }
  }

  removeCharacter(character) {
    const idx = this.characters.indexOf(character);
    if (idx !== -1) {
      this.characters.splice(idx, 1);
      this.scene.remove(character.mesh);
    }
  }

  update(time, delta) {
    for (const c of this.characters) {
      c.update(time, delta);
    }

    // 统一应用身体约束（防穿模 + 关节限制 + 速度平滑）
    // 在角色 update 之后执行，确保对矩阵动画和非矩阵动画都生效
    for (const c of this.characters) {
      const am = c._actionMatrix;
      if (am && am._constraintSystem) {
        const others = this.characters.filter((other) => other !== c);
        am._constraintSystem.enforce(delta, others);
      } else {
        // Non-matrix characters also get collision guard + joint limits
        let cs = this._constraintSystems.get(c);
        if (!cs) {
          cs = new JointConstraintSystem(c);
          // Disable velocity smoothing for non-matrix path to avoid interfering
          // with the existing animation blending in CharacterBase
          cs.configure({ enableVelocitySmooth: false });
          this._constraintSystems.set(c, cs);
        }
        const others = this.characters.filter((other) => other !== c);
        cs.enforce(delta, others);
      }
    }
  }
}
