import * as THREE from 'three';
import { CameraMoveBase } from './CameraMoveBase.js';

/**
 * FightDramaticReveal — 角色戏剧性揭示镜头
 *
 * 从低角度快速推近，配合轻微仰拍，用于角色登场、
 * 变身、觉醒等戏剧性时刻。
 *
 * 参数：
 *   character: 目标角色
 *   startDistance: 起始距离（默认 8）
 *   endDistance: 结束距离（默认 2.5）
 *   startHeight: 起始高度（默认 0.3）
 *   endHeight: 结束高度（默认 1.2）
 *   side: 相机侧（'auto', 'left', 'right'）
 *   holdDuration: 到达后停留比例（默认 0.3）
 */
export class FightDramaticReveal extends CameraMoveBase {
  constructor(options = {}) {
    super({ duration: options.duration ?? 1.5 });
    this.character = options.character ?? 'Yusuke';
    this.startDistance = options.startDistance ?? 8;
    this.endDistance = options.endDistance ?? 2.5;
    this.startHeight = options.startHeight ?? 0.3;
    this.endHeight = options.endHeight ?? 1.2;
    this.side = options.side ?? 'auto';
    this.holdDuration = options.holdDuration ?? 0.3;
  }

  start(camera, context) {
    super.start(camera, context);
    this._computeTarget(context);
    if (!this._charPos) this._charPos = new THREE.Vector3(0, 0, 0);
    if (!this._camSide) this._camSide = -1;
  }

  update(t, camera, context) {
    this._computeTarget(context);
    if (!this._charPos || !this._camSide) return;

    // 运动曲线：快速推进 -> 缓停 -> 微震
    let progress;
    const holdStart = 1 - this.holdDuration;
    if (t < holdStart) {
      // 推进阶段：easeOutCubic
      const p = t / holdStart;
      progress = 1 - Math.pow(1 - p, 3);
    } else {
      // 停留阶段
      progress = 1;
    }

    const currentDist = this.startDistance + (this.endDistance - this.startDistance) * progress;
    const currentHeight = this.startHeight + (this.endHeight - this.startHeight) * progress;

    const pos = this._charPos;
    const camSide = this._camSide;

    camera.position.set(
      pos.x + camSide * currentDist,
      currentHeight,
      pos.z + 2 + (1 - progress) * 3 // 推进时 Z 也靠近
    );

    // 轻微仰角看向角色
    const lookAtY = 1.5 + progress * 0.3;
    camera.lookAt(new THREE.Vector3(pos.x, lookAtY, pos.z));
  }

  _computeTarget(context) {
    const char = context.characters.get(this.character);
    if (!char) return;

    this._charPos = char.mesh.position.clone();
    const facingDir = char.userData?.facingDir || 1;

    let camSide = this.side;
    if (camSide === 'auto') {
      camSide = facingDir === 1 ? -1 : 1;
    } else if (camSide === 'left') {
      camSide = -1;
    } else if (camSide === 'right') {
      camSide = 1;
    }
    this._camSide = camSide;
  }
}
