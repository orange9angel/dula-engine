import * as THREE from 'three';
import { CameraMoveBase } from './CameraMoveBase.js';

/**
 * FightBulletTimeTrack — 慢动作环绕跟踪镜头
 *
 * 在慢动作期间，相机以弧线环绕战斗中心移动，
 * 同时保持对打击点的聚焦。用于大招释放、关键命中等时刻。
 *
 * 参数：
 *   characterA: 攻击者
 *   characterB: 防御者
 *   radius: 环绕半径（默认 4）
 *   height: 相机高度（默认 2.0）
 *   arcAngle: 弧线角度（默认 60度，即 PI/3）
 *   focusOnHit: 是否聚焦命中点（默认 true）
 *   side: 相机起始侧（1=右侧，-1=左侧，默认自动计算）
 */
export class FightBulletTimeTrack extends CameraMoveBase {
  constructor(options = {}) {
    super({ duration: options.duration ?? 1.2 });
    this.characterA = options.characterA ?? 'Yusuke';
    this.characterB = options.characterB ?? 'Kuwabara';
    this.radius = options.radius ?? 4;
    this.height = options.height ?? 2.0;
    this.arcAngle = (options.arcAngle ?? 60) * (Math.PI / 180);
    this.focusOnHit = options.focusOnHit !== false;
    this.side = options.side ?? 0; // 0 = auto
  }

  start(camera, context) {
    super.start(camera, context);
    this._snapshotBattleState(context);
  }

  /**
   * 在开始时快照战斗状态，避免运行时角色位置变化导致相机漂移
   */
  _snapshotBattleState(context) {
    const charA = context.characters.get(this.characterA);
    const charB = context.characters.get(this.characterB);
    if (!charA || !charB) {
      this.midPoint = new THREE.Vector3(0, 0, 0);
      this.startAngle = 0;
      return;
    }

    const posA = charA.mesh.position.clone();
    const posB = charB.mesh.position.clone();
    this.midPoint = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);

    // 计算战斗方向（从A指向B）
    const battleDir = new THREE.Vector3().subVectors(posB, posA).normalize();
    this.battleAngle = Math.atan2(battleDir.z, battleDir.x);

    // 确定相机起始侧
    if (this.side === 0) {
      // 自动选择：相机从当前位置判断应在哪一侧
      const camPos = context.camera ? context.camera.position : new THREE.Vector3(0, 5, 10);
      const toCam = new THREE.Vector3().subVectors(camPos, this.midPoint);
      const camAngle = Math.atan2(toCam.z, toCam.x);
      // 计算相机相对于战斗方向的偏移角度
      let relAngle = camAngle - this.battleAngle;
      while (relAngle > Math.PI) relAngle -= Math.PI * 2;
      while (relAngle < -Math.PI) relAngle += Math.PI * 2;
      this.side = relAngle > 0 ? 1 : -1;
    } else {
      this.side = this.side > 0 ? 1 : -1;
    }

    // 起始角度：从战斗方向垂直偏移 90度 + 弧线的一半（让终点也在合理位置）
    this.startAngle = this.battleAngle + this.side * (Math.PI / 2 - this.arcAngle / 2);
  }

  update(t, camera, context) {
    // 使用快照的中点，不随角色实时位置变化
    const mid = this.midPoint;
    if (!mid) return;

    // 弧线运动：从 startAngle 到 startAngle + arcAngle * side
    const angle = this.startAngle + this.arcAngle * t * this.side;
    const camX = mid.x + Math.cos(angle) * this.radius;
    const camZ = mid.z + Math.sin(angle) * this.radius;

    // 高度微变化：中间略高，营造抛物线感
    const heightOffset = Math.sin(t * Math.PI) * 0.5;
    const camY = this.height + heightOffset;

    camera.position.set(camX, camY, camZ);

    // 看向焦点
    if (this.focusOnHit) {
      // 聚焦两人中间偏上的打击点
      const hitPoint = mid.clone().add(new THREE.Vector3(0, 1.2, 0));
      camera.lookAt(hitPoint);
    } else {
      camera.lookAt(mid.clone().add(new THREE.Vector3(0, 1.3, 0)));
    }
  }
}
