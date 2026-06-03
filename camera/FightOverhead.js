import * as THREE from 'three';
import { CameraMoveBase } from './CameraMoveBase.js';

/**
 * FightOverhead — 俯视战场镜头
 *
 * 从正上方或斜上方俯瞰整个战场，用于展示多人战斗布局、
 * 2v1 夹击、包围等特殊调度场景。
 *
 * 参数：
 *   characterA: 角色A（通常是主要攻击者）
 *   characterB: 角色B（目标/防御者）
 *   height: 俯视高度（默认 10）
 *   angle: 倾斜角度（默认 30度，0=正俯视）
 *   autoFrame: 是否自动框选所有战斗角色（默认 true）
 *   extraChars: 额外角色名数组，用于自动框选
 */
export class FightOverhead extends CameraMoveBase {
  constructor(options = {}) {
    super({ duration: options.duration ?? 0.8 });
    this.characterA = options.characterA ?? 'Yusuke';
    this.characterB = options.characterB ?? 'Kuwabara';
    this.height = options.height ?? 10;
    this.angle = (options.angle ?? 30) * (Math.PI / 180);
    this.autoFrame = options.autoFrame !== false;
    this.extraChars = options.extraChars || [];
  }

  start(camera, context) {
    super.start(camera, context);
    this.startPos = camera.position.clone();
    this._computeTarget(context);
    if (!this.endPos) this.endPos = new THREE.Vector3(0, this.height, 0);
    if (!this.lookAtPos) this.lookAtPos = new THREE.Vector3(0, 0.5, 0);
  }

  update(t, camera, context) {
    this._computeTarget(context);

    if (!this.endPos || !this.lookAtPos) return;
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const desiredPos = new THREE.Vector3().lerpVectors(this.startPos, this.endPos, eased);
    camera.position.copy(desiredPos);
    camera.lookAt(this.lookAtPos);
  }

  _computeTarget(context) {
    const chars = [this.characterA, this.characterB, ...this.extraChars]
      .map((name) => context.characters.get(name))
      .filter(Boolean);

    if (chars.length === 0) return;

    // 计算所有角色的包围盒中心
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const char of chars) {
      const pos = char.mesh.position;
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);
    }

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ);

    // 动态调整高度以框选所有角色
    const dynamicHeight = this.autoFrame
      ? Math.max(this.height, span * 1.2 + 4)
      : this.height;

    // 倾斜角度偏移
    const offsetZ = Math.tan(this.angle) * dynamicHeight * 0.3;

    this.endPos = new THREE.Vector3(centerX, dynamicHeight, centerZ + offsetZ);
    this.lookAtPos = new THREE.Vector3(centerX, 0.5, centerZ);
  }
}
