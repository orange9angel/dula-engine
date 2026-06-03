import * as THREE from 'three';
import { CameraMoveBase } from './CameraMoveBase.js';

/**
 * FightEmotionCloseUp — 格斗情绪特写镜头
 *
 * 极近距离拍摄角色面部/上半身，强调情绪张力。
 * 用于决胜时刻、角色觉醒、重要台词等剧情节点。
 *
 * 参数：
 *   character: 目标角色名
 *   distance: 相机距离（默认 1.5）
 *   height: 相机高度偏移（默认 1.6，角色眼高）
 *   side: 相机在哪一侧（'auto', 'left', 'right'）
 *   drift: 微漂移幅度（默认 0.05，营造呼吸感）
 */
export class FightEmotionCloseUp extends CameraMoveBase {
  constructor(options = {}) {
    super({ duration: options.duration ?? 1.5 });
    this.character = options.character ?? 'Yusuke';
    this.distance = options.distance ?? 1.5;
    this.height = options.height ?? 1.6;
    this.side = options.side ?? 'auto';
    this.drift = options.drift ?? 0.05;
    this._phase = 0;
  }

  start(camera, context) {
    super.start(camera, context);
    this.startPos = camera.position.clone();
    this._computeTarget(context);
    if (!this.endPos) this.endPos = new THREE.Vector3(0, this.height, 0.8);
    if (!this.lookAtPos) this.lookAtPos = new THREE.Vector3(0, 1.5, 0);
  }

  update(t, camera, context) {
    this._computeTarget(context);

    // 缓慢推进 + 微漂移
    const eased = t < 0.3 ? t / 0.3 : 1; // 快速就位，然后稳定
    const driftX = Math.sin(this._phase) * this.drift * (1 - t * 0.5);
    const driftY = Math.cos(this._phase * 0.7) * this.drift * 0.5 * (1 - t * 0.5);
    this._phase += 0.02;

    if (!this.endPos || !this.lookAtPos) return;
    const desiredPos = new THREE.Vector3().lerpVectors(this.startPos, this.endPos, eased);
    desiredPos.x += driftX;
    desiredPos.y += driftY;

    camera.position.copy(desiredPos);
    camera.lookAt(this.lookAtPos);
  }

  _computeTarget(context) {
    const char = context.characters.get(this.character);
    if (!char) return;

    const pos = char.mesh.position.clone();
    const facingDir = char.userData?.facingDir || 1;

    let camSide = this.side;
    if (camSide === 'auto') {
      camSide = facingDir === 1 ? -1 : 1; // 在角色面向的相反侧
    } else if (camSide === 'left') {
      camSide = -1;
    } else if (camSide === 'right') {
      camSide = 1;
    }

    // 极近距离，略偏上
    this.endPos = new THREE.Vector3(
      pos.x + camSide * this.distance,
      pos.y + this.height,
      pos.z + 0.8
    );

    // 看向角色面部
    this.lookAtPos = pos.clone().add(new THREE.Vector3(0, 1.5, 0));
  }
}
