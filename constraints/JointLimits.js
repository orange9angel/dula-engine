/**
 * JointLimits — 关节旋转硬约束定义
 *
 * 按角色体型(archetype)分类定义各关节的旋转范围。
 * 每个关节定义 rx/ry/rz 的 [min, max] 范围（弧度）。
 *
 * 注意：约束的是「基线 + 偏移」后的最终旋转值，不是偏移量本身。
 * 这意味着约束是绝对的，与角色的初始姿势无关。
 */

/**
 * 关节限制配置模板
 * @typedef {Object} JointLimitConfig
 * @property {[number, number]} rx - [min, max] 绕X轴旋转范围
 * @property {[number, number]} ry - [min, max] 绕Y轴旋转范围
 * @property {[number, number]} rz - [min, max] 绕Z轴旋转范围
 */

/**
 * 标准人形角色关节限制
 * 基于人体解剖学，适用于大多数类人角色
 */
export const HUMANOID_STANDARD = {
  // === 头部 ===
  headGroup: {
    rx: [-Math.PI / 3, Math.PI / 4],   // 抬头60° ~ 低头45°
    ry: [-Math.PI / 2, Math.PI / 2],   // 左右转头90°
    rz: [-Math.PI / 6, Math.PI / 6],   // 侧倾30°
  },

  // === 锁骨（控制手臂整体前后/上下摆动）===
  rightClavicle: {
    rx: [-Math.PI / 6, Math.PI / 6],   // 前后摆动30°
    ry: [-Math.PI / 6, Math.PI / 3],   // 内收~外展
    rz: [-Math.PI / 6, Math.PI / 6],   // 轻微扭转
  },
  leftClavicle: {
    rx: [-Math.PI / 6, Math.PI / 6],
    ry: [-Math.PI / 3, Math.PI / 6],   // 镜像
    rz: [-Math.PI / 6, Math.PI / 6],
  },

  // === 肩关节（上臂根）===
  // 注意：在 armPivot 修正后，坐标系已改变：
  // - rx 控制上臂上下抬放（0=水平前举，负=向上，正=向下）
  // - ry 控制水平面内摆动（内收/外展）
  // - rz 控制手臂自旋/倾斜
  rightShoulder: {
    rx: [-Math.PI * 0.85, Math.PI / 6], // 向上170° ~ 向下30°（避免向后穿模）
    ry: [-Math.PI / 3, Math.PI / 2],    // 内收60° ~ 外展90°
    rz: [-Math.PI / 2, Math.PI / 2],    // 自旋±90°
  },
  leftShoulder: {
    rx: [-Math.PI * 0.85, Math.PI / 6],
    ry: [-Math.PI / 2, Math.PI / 3],    // 镜像
    rz: [-Math.PI / 2, Math.PI / 2],
  },

  // === 肘关节 ===
  // rx: 前臂弯曲（0=伸直，正=向前弯曲）
  // 关键：禁止反关节（rx < 0）
  rightElbow: {
    rx: [0, Math.PI * 0.95],            // 0° ~ 171°（接近完全弯曲）
    ry: [-Math.PI / 6, Math.PI / 6],    // 轻微水平摆动
    rz: [-Math.PI / 3, Math.PI / 3],    // 前臂扭转
  },
  leftElbow: {
    rx: [0, Math.PI * 0.95],
    ry: [-Math.PI / 6, Math.PI / 6],
    rz: [-Math.PI / 3, Math.PI / 3],
  },

  // === 肘扭转（专门控制前臂 ry）===
  rightElbowTwist: {
    rx: [-Math.PI / 12, Math.PI / 12],
    ry: [-Math.PI * 0.8, Math.PI * 0.8], // 前臂自旋（旋前/旋后）
    rz: [-Math.PI / 12, Math.PI / 12],
  },
  leftElbowTwist: {
    rx: [-Math.PI / 12, Math.PI / 12],
    ry: [-Math.PI * 0.8, Math.PI * 0.8],
    rz: [-Math.PI / 12, Math.PI / 12],
  },

  // === 腕关节 ===
  rightWrist: {
    rx: [-Math.PI / 3, Math.PI / 3],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 3, Math.PI / 3],
  },
  leftWrist: {
    rx: [-Math.PI / 3, Math.PI / 3],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 3, Math.PI / 3],
  },

  // === 髋关节（大腿根）===
  rightHip: {
    rx: [-Math.PI / 2, Math.PI / 6],    // 前抬90° ~ 后抬30°
    ry: [-Math.PI / 4, Math.PI / 4],    // 外展/内收
    rz: [-Math.PI / 6, Math.PI / 6],    // 轻微扭转
  },
  leftHip: {
    rx: [-Math.PI / 2, Math.PI / 6],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 6, Math.PI / 6],
  },

  // === 膝关节 ===
  // 关键：禁止反关节（rx < 0）
  rightKnee: {
    rx: [0, Math.PI * 0.95],            // 只能向前弯曲
    ry: [-Math.PI / 12, Math.PI / 12],  // 几乎无水平摆动
    rz: [-Math.PI / 12, Math.PI / 12],  // 几乎无扭转
  },
  leftKnee: {
    rx: [0, Math.PI * 0.95],
    ry: [-Math.PI / 12, Math.PI / 12],
    rz: [-Math.PI / 12, Math.PI / 12],
  },

  // === 踝关节 ===
  rightAnkle: {
    rx: [-Math.PI / 3, Math.PI / 6],    // 跖屈/背屈
    ry: [-Math.PI / 6, Math.PI / 6],    // 内外翻
    rz: [-Math.PI / 12, Math.PI / 12],  // 几乎无扭转
  },
  leftAnkle: {
    rx: [-Math.PI / 3, Math.PI / 6],
    ry: [-Math.PI / 6, Math.PI / 6],
    rz: [-Math.PI / 12, Math.PI / 12],
  },

  // === 躯干根节点 ===
  // mesh.ry 是角色在世界中的水平朝向（转身），应允许完整 360° 旋转，
  // 而不是用躯干扭转限制来约束面朝方向。
  mesh: {
    rx: [-Math.PI / 6, Math.PI / 6],
    ry: [-Math.PI, Math.PI],
    rz: [-Math.PI / 6, Math.PI / 6],
  },
};

/**
 * 运动型人形角色 — 更宽松的范围（运动员、格斗家）
 */
export const HUMANOID_ATHLETIC = {
  headGroup: {
    rx: [-Math.PI / 2, Math.PI / 3],
    ry: [-Math.PI * 0.6, Math.PI * 0.6],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  rightClavicle: {
    rx: [-Math.PI / 4, Math.PI / 4],
    ry: [-Math.PI / 4, Math.PI / 2],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  leftClavicle: {
    rx: [-Math.PI / 4, Math.PI / 4],
    ry: [-Math.PI / 2, Math.PI / 4],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  rightShoulder: {
    rx: [-Math.PI * 0.9, Math.PI / 4],
    ry: [-Math.PI / 2, Math.PI * 0.6],
    rz: [-Math.PI * 0.6, Math.PI * 0.6],
  },
  leftShoulder: {
    rx: [-Math.PI * 0.9, Math.PI / 4],
    ry: [-Math.PI * 0.6, Math.PI / 2],
    rz: [-Math.PI * 0.6, Math.PI * 0.6],
  },
  rightElbow: {
    rx: [0, Math.PI * 0.98],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 2, Math.PI / 2],
  },
  leftElbow: {
    rx: [0, Math.PI * 0.98],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 2, Math.PI / 2],
  },
  rightElbowTwist: {
    rx: [-Math.PI / 8, Math.PI / 8],
    ry: [-Math.PI * 0.9, Math.PI * 0.9],
    rz: [-Math.PI / 8, Math.PI / 8],
  },
  leftElbowTwist: {
    rx: [-Math.PI / 8, Math.PI / 8],
    ry: [-Math.PI * 0.9, Math.PI * 0.9],
    rz: [-Math.PI / 8, Math.PI / 8],
  },
  rightWrist: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 2, Math.PI / 2],
  },
  leftWrist: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 2, Math.PI / 2],
  },
  rightHip: {
    rx: [-Math.PI * 0.6, Math.PI / 3],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  leftHip: {
    rx: [-Math.PI * 0.6, Math.PI / 3],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  rightKnee: {
    rx: [0, Math.PI * 0.98],
    ry: [-Math.PI / 8, Math.PI / 8],
    rz: [-Math.PI / 8, Math.PI / 8],
  },
  leftKnee: {
    rx: [0, Math.PI * 0.98],
    ry: [-Math.PI / 8, Math.PI / 8],
    rz: [-Math.PI / 8, Math.PI / 8],
  },
  rightAnkle: {
    rx: [-Math.PI / 2, Math.PI / 3],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 8, Math.PI / 8],
  },
  leftAnkle: {
    rx: [-Math.PI / 2, Math.PI / 3],
    ry: [-Math.PI / 4, Math.PI / 4],
    rz: [-Math.PI / 8, Math.PI / 8],
  },
  mesh: {
    rx: [-Math.PI / 4, Math.PI / 4],
    ry: [-Math.PI, Math.PI],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
};

/**
 * 外星人/非标准体型 — 基于 Zorak 的关节结构
 * 更灵活的手臂，但仍有基本限制防止极端穿模
 */
export const ALIEN_FLEXIBLE = {
  headGroup: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI * 0.7, Math.PI * 0.7],
    rz: [-Math.PI / 3, Math.PI / 3],
  },
  rightClavicle: {
    rx: [-Math.PI / 3, Math.PI / 3],
    ry: [-Math.PI / 3, Math.PI / 2],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  leftClavicle: {
    rx: [-Math.PI / 3, Math.PI / 3],
    ry: [-Math.PI / 2, Math.PI / 3],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  rightShoulder: {
    rx: [-Math.PI * 0.95, Math.PI / 3],  // 允许更大的向上范围
    ry: [-Math.PI / 2, Math.PI * 0.7],
    rz: [-Math.PI * 0.7, Math.PI * 0.7],
  },
  leftShoulder: {
    rx: [-Math.PI * 0.95, Math.PI / 3],
    ry: [-Math.PI * 0.7, Math.PI / 2],
    rz: [-Math.PI * 0.7, Math.PI * 0.7],
  },
  rightElbow: {
    rx: [0, Math.PI * 0.98], // 肘关节只能向前/上弯曲，禁止向后（反关节）
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI * 0.6, Math.PI * 0.6],
  },
  leftElbow: {
    rx: [0, Math.PI * 0.98], // 肘关节只能向前/上弯曲，禁止向后（反关节）
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI * 0.6, Math.PI * 0.6],
  },
  rightElbowTwist: {
    rx: [-Math.PI / 6, Math.PI / 6],
    ry: [-Math.PI, Math.PI],              // 完全自旋
    rz: [-Math.PI / 6, Math.PI / 6],
  },
  leftElbowTwist: {
    rx: [-Math.PI / 6, Math.PI / 6],
    ry: [-Math.PI, Math.PI],
    rz: [-Math.PI / 6, Math.PI / 6],
  },
  rightWrist: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI / 2, Math.PI / 2],
    rz: [-Math.PI / 2, Math.PI / 2],
  },
  leftWrist: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI / 2, Math.PI / 2],
    rz: [-Math.PI / 2, Math.PI / 2],
  },
  rightHip: {
    rx: [-Math.PI * 0.7, Math.PI / 2],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  leftHip: {
    rx: [-Math.PI * 0.7, Math.PI / 2],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 4, Math.PI / 4],
  },
  rightKnee: {
    rx: [-Math.PI * 0.05, Math.PI * 0.98], // 允许轻微向后
    ry: [-Math.PI / 6, Math.PI / 6],
    rz: [-Math.PI / 6, Math.PI / 6],
  },
  leftKnee: {
    rx: [-Math.PI * 0.05, Math.PI * 0.98],
    ry: [-Math.PI / 6, Math.PI / 6],
    rz: [-Math.PI / 6, Math.PI / 6],
  },
  rightAnkle: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 6, Math.PI / 6],
  },
  leftAnkle: {
    rx: [-Math.PI / 2, Math.PI / 2],
    ry: [-Math.PI / 3, Math.PI / 3],
    rz: [-Math.PI / 6, Math.PI / 6],
  },
  mesh: {
    rx: [-Math.PI / 3, Math.PI / 3],
    ry: [-Math.PI, Math.PI],
    rz: [-Math.PI / 3, Math.PI / 3],
  },
};

/**
 * 体型 → 关节限制配置映射
 */
export const LIMIT_PRESETS = {
  humanoid_standard: HUMANOID_STANDARD,
  humanoid_athletic: HUMANOID_ATHLETIC,
  alien_flexible: ALIEN_FLEXIBLE,
};

/**
 * 根据角色 archetypes 自动选择最合适的约束配置
 * @param {string[]} archetypes - 角色体型标签
 * @returns {Object} 关节限制配置
 */
export function selectLimitPreset(archetypes = []) {
  // 按优先级匹配
  if (archetypes.includes('alien') || archetypes.includes('monster')) {
    return ALIEN_FLEXIBLE;
  }
  if (archetypes.includes('athletic') || archetypes.includes('fighter') || archetypes.includes('agile')) {
    return HUMANOID_ATHLETIC;
  }
  // 默认标准人形
  return HUMANOID_STANDARD;
}

/**
 * 将角度值限制在 [min, max] 范围内
 * 支持角度环绕处理（对于 ry 等可能环绕 ±PI 的轴）
 * @param {number} value - 当前角度值
 * @param {[number, number]} range - [min, max]
 * @param {boolean} wrap - 是否处理角度环绕（默认 false）
 * @returns {number} 限制后的角度值
 */
export function clampAngle(value, range, wrap = false) {
  if (wrap) {
    // 处理角度环绕（如 ry 轴可能从 -3.1 跳到 3.1）
    // 先归一化到 [-PI, PI]
    let normalized = value;
    while (normalized > Math.PI) normalized -= Math.PI * 2;
    while (normalized < -Math.PI) normalized += Math.PI * 2;
    return Math.max(range[0], Math.min(range[1], normalized));
  }
  return Math.max(range[0], Math.min(range[1], value));
}

/**
 * 对单个关节的旋转值应用限制
 * @param {Object} rotation - { rx, ry, rz }
 * @param {Object} limits - 该关节的限制配置
 * @returns {Object} 限制后的 { rx, ry, rz }
 */
export function clampJointRotation(rotation, limits) {
  const result = { ...rotation };
  if (limits.rx && result.rx !== undefined) {
    result.rx = clampAngle(result.rx, limits.rx);
  }
  if (limits.ry && result.ry !== undefined) {
    result.ry = clampAngle(result.ry, limits.ry, true);
  }
  if (limits.rz && result.rz !== undefined) {
    result.rz = clampAngle(result.rz, limits.rz);
  }
  return result;
}
