/**
 * VelocitySmoother — 关节角速度平滑器
 *
 * 限制关节旋转的角速度，防止：
 * 1. 动画切换时的瞬间跳变
 * 2. 关键帧插值产生的过快速度
 * 3. 物理上不可能的瞬间旋转
 *
 * 工作原理：
 * - 记录每帧每个关节的旋转值
 * - 计算与上一帧的差值（角速度）
 * - 如果角速度超过阈值，将旋转限制在允许的最大变化范围内
 */

/**
 * 默认角速度限制（弧度/秒）
 * 基于人体关节的自然运动速度
 */
export const DEFAULT_VELOCITY_LIMITS = {
  // 头部 — 可以快速转动
  headGroup: { rx: 8, ry: 10, rz: 6 },

  // 锁骨 — 较慢
  rightClavicle: { rx: 4, ry: 4, rz: 3 },
  leftClavicle: { rx: 4, ry: 4, rz: 3 },

  // 肩关节 — 中等速度
  rightShoulder: { rx: 8, ry: 8, rz: 6 },
  leftShoulder: { rx: 8, ry: 8, rz: 6 },

  // 肘关节 — 较快（出拳等动作）
  rightElbow: { rx: 12, ry: 4, rz: 6 },
  leftElbow: { rx: 12, ry: 4, rz: 6 },

  // 肘扭转 — 较慢
  rightElbowTwist: { rx: 3, ry: 6, rz: 3 },
  leftElbowTwist: { rx: 3, ry: 6, rz: 3 },

  // 腕关节 — 较快
  rightWrist: { rx: 10, ry: 8, rz: 10 },
  leftWrist: { rx: 10, ry: 8, rz: 10 },

  // 髋关节 — 中等
  rightHip: { rx: 6, ry: 5, rz: 4 },
  leftHip: { rx: 6, ry: 5, rz: 4 },

  // 膝关节 — 较快（踢腿）
  rightKnee: { rx: 12, ry: 3, rz: 3 },
  leftKnee: { rx: 12, ry: 3, rz: 3 },

  // 踝关节 — 中等
  rightAnkle: { rx: 8, ry: 6, rz: 4 },
  leftAnkle: { rx: 8, ry: 6, rz: 4 },

  // 躯干
  mesh: { rx: 4, ry: 5, rz: 4 },
};

/**
 * 运动型角色的更高速度限制
 */
export const ATHLETIC_VELOCITY_LIMITS = {
  headGroup: { rx: 12, ry: 14, rz: 8 },
  rightClavicle: { rx: 6, ry: 6, rz: 4 },
  leftClavicle: { rx: 6, ry: 6, rz: 4 },
  rightShoulder: { rx: 12, ry: 12, rz: 8 },
  leftShoulder: { rx: 12, ry: 12, rz: 8 },
  rightElbow: { rx: 18, ry: 6, rz: 8 },
  leftElbow: { rx: 18, ry: 6, rz: 8 },
  rightElbowTwist: { rx: 4, ry: 10, rz: 4 },
  leftElbowTwist: { rx: 4, ry: 10, rz: 4 },
  rightWrist: { rx: 14, ry: 12, rz: 14 },
  leftWrist: { rx: 14, ry: 12, rz: 14 },
  rightHip: { rx: 10, ry: 8, rz: 6 },
  leftHip: { rx: 10, ry: 8, rz: 6 },
  rightKnee: { rx: 18, ry: 4, rz: 4 },
  leftKnee: { rx: 18, ry: 4, rz: 4 },
  rightAnkle: { rx: 12, ry: 8, rz: 6 },
  leftAnkle: { rx: 12, ry: 8, rz: 6 },
  mesh: { rx: 6, ry: 8, rz: 6 },
};

/**
 * 速度限制预设映射
 */
export const VELOCITY_PRESETS = {
  standard: DEFAULT_VELOCITY_LIMITS,
  athletic: ATHLETIC_VELOCITY_LIMITS,
};

/**
 * 根据角色 archetypes 选择速度限制预设
 * @param {string[]} archetypes
 * @returns {Object}
 */
export function selectVelocityPreset(archetypes = []) {
  if (archetypes.includes('athletic') || archetypes.includes('fighter') || archetypes.includes('agile')) {
    return ATHLETIC_VELOCITY_LIMITS;
  }
  return DEFAULT_VELOCITY_LIMITS;
}

/**
 * VelocitySmoother 类
 */
export class VelocitySmoother {
  constructor(character, preset = 'standard') {
    this.character = character;
    this.limits = typeof preset === 'string'
      ? (VELOCITY_PRESETS[preset] || DEFAULT_VELOCITY_LIMITS)
      : preset;

    // 存储上一帧的旋转值
    this._lastRotations = new Map();
    // 存储上一帧的时间
    this._lastTime = 0;
    // 是否启用
    this.enabled = true;
  }

  /**
   * 设置速度限制预设
   * @param {string|Object} preset
   */
  setPreset(preset) {
    if (typeof preset === 'string') {
      this.limits = VELOCITY_PRESETS[preset] || DEFAULT_VELOCITY_LIMITS;
    } else {
      this.limits = preset;
    }
  }

  /**
   * 对目标旋转值应用速度平滑
   * @param {string} jointName - 关节名称（如 'rightShoulder'）
   * @param {Object} targetRotation - { rx, ry, rz } 目标旋转值
   * @param {number} deltaTime - 时间步长（秒）
   * @returns {Object} 平滑后的 { rx, ry, rz }
   */
  smooth(jointName, targetRotation, deltaTime) {
    if (!this.enabled || deltaTime <= 0) {
      return { ...targetRotation };
    }

    const limits = this.limits[jointName];
    if (!limits) {
      return { ...targetRotation };
    }

    const lastKey = jointName;
    const lastRot = this._lastRotations.get(lastKey);

    if (!lastRot) {
      // 第一帧，直接记录
      this._lastRotations.set(lastKey, {
        rx: targetRotation.rx ?? 0,
        ry: targetRotation.ry ?? 0,
        rz: targetRotation.rz ?? 0,
      });
      return { ...targetRotation };
    }

    const result = { ...targetRotation };

    // 对每个轴应用速度限制
    for (const axis of ['rx', 'ry', 'rz']) {
      if (targetRotation[axis] === undefined) continue;

      const limit = limits[axis];
      if (!limit) continue;

      const current = targetRotation[axis];
      const last = lastRot[axis] ?? 0;
      const delta = current - last;

      // 处理角度环绕（如从 -3.1 到 3.1 的跳变）
      let normalizedDelta = delta;
      if (axis === 'ry' || axis === 'rz') {
        while (normalizedDelta > Math.PI) normalizedDelta -= Math.PI * 2;
        while (normalizedDelta < -Math.PI) normalizedDelta += Math.PI * 2;
      }

      // 计算最大允许变化
      const maxDelta = limit * deltaTime;

      // 如果变化超过限制，进行平滑
      if (Math.abs(normalizedDelta) > maxDelta) {
        const sign = Math.sign(normalizedDelta);
        result[axis] = last + sign * maxDelta;

        // 对于 rx 轴（不环绕），确保结果在合理范围内
        if (axis !== 'ry') {
          // 保持结果连续性
        }
      }
    }

    // 更新记录
    this._lastRotations.set(lastKey, {
      rx: result.rx ?? lastRot.rx,
      ry: result.ry ?? lastRot.ry,
      rz: result.rz ?? lastRot.rz,
    });

    return result;
  }

  /**
   * 重置平滑器状态（用于动画切换时）
   */
  reset() {
    this._lastRotations.clear();
    this._lastTime = 0;
  }

  /**
   * 更新上一帧时间
   * @param {number} time
   */
  updateTime(time) {
    this._lastTime = time;
  }
}
