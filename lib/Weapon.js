import * as THREE from 'three';

/**
 * Weapon — 武器定义
 *
 * 描述一把武器的属性：模型、枪口位置、后坐力、特效等。
 * 武器模型（mesh）是可复用的，由 WeaponComponent 实例化并附加到角色。
 */
export class Weapon {
  constructor(config) {
    this.type = config.type || 'generic';
    this.name = config.name || this.type;

    // 武器模型（THREE.Group 或 THREE.Mesh），会被 clone 后使用
    this.mesh = config.mesh || null;

    // 枪口位置（相对于武器局部坐标系）
    this.muzzleOffset = config.muzzleOffset || new THREE.Vector3(0, 0, 0.3);

    // 弹壳抛出口位置（可选）
    this.ejectOffset = config.ejectOffset || new THREE.Vector3(0.05, 0.05, 0.1);

    // 后坐力参数
    this.recoil = {
      kickBack: config.recoil?.kickBack ?? 0.08,     // Z 轴后退
      muzzleClimb: config.recoil?.muzzleClimb ?? 0.04, // Y 轴上跳
      spread: config.recoil?.spread ?? 0.02,          // X 轴随机扩散
      recoverySpeed: config.recoil?.recoverySpeed ?? 12, // 恢复速度
      decay: config.recoil?.decay ?? 0.85,            // 每帧衰减系数
      ...config.recoil,
    };

    // 动画时间
    this.drawTime = config.drawTime ?? 0.35;      // 拔枪时间
    this.holsterTime = config.holsterTime ?? 0.25;  // 收枪时间
    this.fireDuration = config.fireDuration ?? 0.08; // 射击状态持续时间

    // 射击特效配置
    this.fireEffects = {
      fx: config.fireEffects?.fx || [],       // 枪口焰、激光束等
      sfx: config.fireEffects?.sfx || [],     // 音效
      light: config.fireEffects?.light || null, // 枪口闪光（如 PointLight）
      shellEject: config.fireEffects?.shellEject ?? false,
      ...config.fireEffects,
    };

    // 持握姿势建议（可选，用于提示 ActionMatrix）
    this.idlePose = config.idlePose || null;

    // 武器在角色上的默认挂载点
    this.defaultAttach = config.defaultAttach || 'rightHand';
  }

  /**
   * 获取枪口世界坐标（需要武器实例的当前世界矩阵）
   */
  getMuzzleWorldPosition(weaponMesh) {
    if (!weaponMesh) return new THREE.Vector3();
    const pos = this.muzzleOffset.clone();
    pos.applyMatrix4(weaponMesh.matrixWorld);
    return pos;
  }

  /**
   * 获取弹壳抛出口世界坐标
   */
  getEjectWorldPosition(weaponMesh) {
    if (!weaponMesh) return new THREE.Vector3();
    const pos = this.ejectOffset.clone();
    pos.applyMatrix4(weaponMesh.matrixWorld);
    return pos;
  }

  cloneMesh() {
    if (!this.mesh) return null;
    return this.mesh.clone();
  }
}
