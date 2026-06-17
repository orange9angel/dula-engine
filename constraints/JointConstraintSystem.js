import { selectLimitPreset, clampJointRotation } from './JointLimits.js';
import { BodyCollisionGuard } from './BodyCollisionGuard.js';
import { VelocitySmoother, selectVelocityPreset } from './VelocitySmoother.js';

/**
 * JointConstraintSystem — 关节约束系统主入口
 *
 * 整合三层约束保护：
 * 1. JointLimits: 硬约束，基于解剖学的旋转范围限制
 * 2. BodyCollisionGuard: 防穿模，检测肢体是否进入身体碰撞体
 * 3. VelocitySmoother: 软约束，限制角速度防止瞬间跳变
 *
 * 执行顺序：
 *   动画输出 → VelocitySmoother（平滑）→ JointLimits（硬限制）→ BodyCollisionGuard（防穿模）→ 渲染
 */

/**
 * 关节名称映射：PoseMatrix 属性名 → CharacterBase 属性名
 */
const JOINT_NAME_MAP = {
  headGroup: 'headGroup',
  rightClavicle: 'rightClavicle',
  leftClavicle: 'leftClavicle',
  rightShoulder: 'rightArm',
  leftShoulder: 'leftArm',
  rightElbow: 'rightElbow',
  leftElbow: 'leftElbow',
  rightElbowTwist: 'rightElbowTwist',
  leftElbowTwist: 'leftElbowTwist',
  rightWrist: 'rightWrist',
  leftWrist: 'leftWrist',
  rightHip: 'rightLeg',
  leftHip: 'leftLeg',
  rightKnee: 'rightKnee',
  leftKnee: 'leftKnee',
  rightAnkle: 'rightAnkle',
  leftAnkle: 'leftAnkle',
};

/**
 * 需要应用速度平滑的关节列表
 */
const SMOOTHED_JOINTS = [
  'headGroup',
  'rightClavicle', 'leftClavicle',
  'rightShoulder', 'leftShoulder',
  'rightElbow', 'leftElbow',
  'rightElbowTwist', 'leftElbowTwist',
  'rightWrist', 'leftWrist',
  'rightHip', 'leftHip',
  'rightKnee', 'leftKnee',
  'rightAnkle', 'leftAnkle',
];

/**
 * 需要应用硬约束的关节列表
 */
const LIMITED_JOINTS = [
  'headGroup',
  'rightClavicle', 'leftClavicle',
  'rightShoulder', 'leftShoulder',
  'rightElbow', 'leftElbow',
  'rightElbowTwist', 'leftElbowTwist',
  'rightWrist', 'leftWrist',
  'rightHip', 'leftHip',
  'rightKnee', 'leftKnee',
  'rightAnkle', 'leftAnkle',
  'mesh',
];

export class JointConstraintSystem {
  constructor(character) {
    this.character = character;
    this.archetypes = character.archetypes || ['humanoid'];

    // 1. 关节硬约束
    const limitPreset = selectLimitPreset(this.archetypes);
    this._jointLimits = limitPreset;

    // 2. 防穿模守卫
    this._collisionGuard = new BodyCollisionGuard(character);

    // 3. 速度平滑
    const velocityPreset = selectVelocityPreset(this.archetypes);
    this._velocitySmoother = new VelocitySmoother(character, velocityPreset);

    // 配置开关
    this._config = {
      enableJointLimits: true,
      enableCollisionGuard: true,
      enableVelocitySmooth: true,
    };

    // 调试
    this._debug = false;
  }

  /**
   * 配置约束系统
   * @param {Object} config
   * @param {boolean} config.enableJointLimits
   * @param {boolean} config.enableCollisionGuard
   * @param {boolean} config.enableVelocitySmooth
   */
  configure(config) {
    Object.assign(this._config, config);
  }

  /**
   * 启用/禁用调试输出
   */
  setDebug(enabled) {
    this._debug = enabled;
    this._collisionGuard.setDebug(enabled);
  }

  /**
   * 执行完整约束流程
   *
   * 注意：这个方法在 _applyPose 之后调用，直接修改 Three.js 对象的旋转值
   *
   * @param {number} deltaTime - 时间步长（秒）
   * @param {CharacterBase[]} otherCharacters - 其他角色实例，用于角色间碰撞检测
   */
  enforce(deltaTime = 0.016, otherCharacters = null) {
    const c = this.character;

    // === 第1层：速度平滑 ===
    // 对当前旋转值进行平滑（防止瞬间跳变）
    if (this._config.enableVelocitySmooth) {
      for (const poseName of SMOOTHED_JOINTS) {
        const charProp = JOINT_NAME_MAP[poseName];
        const jointObj = c[charProp];
        if (!jointObj) continue;

        const currentRot = {
          rx: jointObj.rotation.x,
          ry: jointObj.rotation.y,
          rz: jointObj.rotation.z,
        };

        const smoothed = this._velocitySmoother.smooth(poseName, currentRot, deltaTime);

        jointObj.rotation.x = smoothed.rx;
        jointObj.rotation.y = smoothed.ry;
        jointObj.rotation.z = smoothed.rz;
      }

      // 躯干
      if (c.mesh && this._velocitySmoother.limits.mesh) {
        const meshRot = {
          rx: c.mesh.rotation.x,
          ry: c.mesh.rotation.y,
          rz: c.mesh.rotation.z,
        };
        const smoothed = this._velocitySmoother.smooth('mesh', meshRot, deltaTime);
        c.mesh.rotation.x = smoothed.rx;
        c.mesh.rotation.y = smoothed.ry;
        c.mesh.rotation.z = smoothed.rz;
      }
    }

    // === 第2层：关节硬约束 ===
    // 将旋转值限制在解剖学范围内
    if (this._config.enableJointLimits) {
      for (const poseName of LIMITED_JOINTS) {
        const limits = this._jointLimits[poseName];
        if (!limits) continue;

        let jointObj;
        if (poseName === 'mesh') {
          jointObj = c.mesh;
        } else {
          const charProp = JOINT_NAME_MAP[poseName];
          jointObj = c[charProp];
        }
        if (!jointObj) continue;

        const currentRot = {
          rx: jointObj.rotation.x,
          ry: jointObj.rotation.y,
          rz: jointObj.rotation.z,
        };

        const clamped = clampJointRotation(currentRot, limits);

        // 只在值被修改时写入（减少不必要的赋值）
        if (clamped.rx !== currentRot.rx) jointObj.rotation.x = clamped.rx;
        if (clamped.ry !== currentRot.ry) jointObj.rotation.y = clamped.ry;
        if (clamped.rz !== currentRot.rz) jointObj.rotation.z = clamped.rz;

        if (this._debug && (
          clamped.rx !== currentRot.rx ||
          clamped.ry !== currentRot.ry ||
          clamped.rz !== currentRot.rz
        )) {
          console.log(`[JointLimits] ${poseName} clamped: rx=${currentRot.rx.toFixed(2)}→${clamped.rx.toFixed(2)}, ry=${currentRot.ry.toFixed(2)}→${clamped.ry.toFixed(2)}, rz=${currentRot.rz.toFixed(2)}→${clamped.rz.toFixed(2)}`);
        }
      }
    }

    // === 第3层：防穿模 ===
    // 检测肢体是否进入身体碰撞体，必要时调整旋转
    if (this._config.enableCollisionGuard) {
      const corrections = this._collisionGuard.enforce(otherCharacters);

      for (const [poseName, delta] of Object.entries(corrections)) {
        // mesh 位移（来自角色间碰撞）
        if (poseName === 'mesh') {
          if (c.mesh) {
            if (delta.x) c.mesh.position.x += delta.x;
            if (delta.y) c.mesh.position.y += delta.y;
            if (delta.z) c.mesh.position.z += delta.z;
          }
          continue;
        }

        const charProp = JOINT_NAME_MAP[poseName];
        const jointObj = c[charProp];
        if (!jointObj) continue;

        if (delta.rx) jointObj.rotation.x += delta.rx;
        if (delta.ry) jointObj.rotation.y += delta.ry;
        if (delta.rz) jointObj.rotation.z += delta.rz;

        if (this._debug) {
          console.log(`[CollisionGuard] ${poseName} corrected: rx+=${(delta.rx || 0).toFixed(3)}, ry+=${(delta.ry || 0).toFixed(3)}, rz+=${(delta.rz || 0).toFixed(3)}`);
        }
      }
    }
  }

  /**
   * 重置约束系统状态
   * 在动画切换时调用，避免速度平滑器将上一动画的末状态与当前动画初状态做差值
   */
  reset() {
    this._velocitySmoother.reset();
  }

  /**
   * 获取当前约束状态（用于调试面板）
   */
  getStatus() {
    return {
      config: { ...this._config },
      archetypes: [...this.archetypes],
      limitPreset: this._jointLimits === this._jointLimits ? 'active' : 'unknown',
    };
  }
}
