import * as THREE from 'three';

/**
 * BodyCollisionGuard — 身体防穿模守卫
 *
 * 使用简化碰撞体近似角色身体，检测手臂/腿部关节的世界坐标
 * 是否进入身体内部。如果检测到穿模，通过调整父关节旋转
 * 将肢体推出碰撞体。
 *
 * 碰撞体定义（基于角色 mesh 结构动态计算）：
 * - torso: 胶囊体，覆盖躯干区域
 * - head: 球体，覆盖头部区域
 */

/**
 * 碰撞体定义
 * @typedef {Object} CollisionBody
 * @property {string} type - 'capsule' | 'sphere'
 * @property {THREE.Vector3} center - 局部坐标系中心
 * @property {number} radius - 半径
 * @property {number} [height] - 胶囊体高度（仅 capsule）
 */

/**
 * 默认身体碰撞体配置（基于标准人形角色尺寸）
 * 单位：米
 */
export const DEFAULT_BODY_COLLIDERS = {
  torso: {
    type: 'capsule',
    center: new THREE.Vector3(0, 0.9, 0),   // 躯干中心（肚脐高度）
    radius: 0.2,                              // 躯干半径
    height: 0.7,                              // 躯干高度（胸到髋）
  },
  head: {
    type: 'sphere',
    center: new THREE.Vector3(0, 1.65, 0),   // 头部中心
    radius: 0.18,                             // 头部半径
  },
};

/**
 * 根据角色实际尺寸计算碰撞体
 * 如果角色有 boundingRadius 等属性，会据此调整
 * @param {CharacterBase} character
 * @returns {Object} 碰撞体配置
 */
export function computeBodyColliders(character) {
  const colliders = {};

  // 尝试从角色的 mesh 结构推断尺寸
  let torsoCenter = new THREE.Vector3(0, 0.9, 0);
  let torsoRadius = 0.2;
  let torsoHeight = 0.7;
  let headCenter = new THREE.Vector3(0, 1.65, 0);
  let headRadius = 0.18;

  if (character.headGroup) {
    const headPos = new THREE.Vector3();
    character.headGroup.getWorldPosition(headPos);
    headCenter.copy(headPos);
    // 根据 boundingRadius 调整
    if (character.boundingRadius) {
      headRadius = Math.min(0.25, character.boundingRadius * 0.35);
      torsoRadius = Math.min(0.3, character.boundingRadius * 0.4);
    }
  }

  // 躯干中心在头部和脚部之间
  if (character.mesh) {
    const meshY = character.mesh.position.y;
    torsoCenter.y = meshY + (headCenter.y - meshY) * 0.45;
    torsoHeight = (headCenter.y - meshY) * 0.7;
  }

  colliders.torso = {
    type: 'capsule',
    center: torsoCenter,
    radius: torsoRadius,
    height: torsoHeight,
  };

  colliders.head = {
    type: 'sphere',
    center: headCenter,
    radius: headRadius,
  };

  return colliders;
}

/**
 * 检测点是否在胶囊体内
 * @param {THREE.Vector3} point - 世界坐标点
 * @param {Object} capsule - { center, radius, height }
 * @returns {boolean}
 */
function pointInCapsule(point, capsule) {
  const halfHeight = capsule.height / 2;
  const toPoint = new THREE.Vector3().subVectors(point, capsule.center);

  // 胶囊体沿 Y 轴
  const yDist = Math.abs(toPoint.y);
  const rDist = Math.sqrt(toPoint.x * toPoint.x + toPoint.z * toPoint.z);

  if (yDist <= halfHeight) {
    // 在圆柱部分
    return rDist <= capsule.radius;
  } else if (yDist <= halfHeight + capsule.radius) {
    // 在半球部分
    const sphereCenterY = capsule.center.y + (toPoint.y > 0 ? halfHeight : -halfHeight);
    const sphereCenter = new THREE.Vector3(capsule.center.x, sphereCenterY, capsule.center.z);
    const distToSphere = point.distanceTo(sphereCenter);
    return distToSphere <= capsule.radius;
  }
  return false;
}

/**
 * 检测点是否在球体内
 * @param {THREE.Vector3} point - 世界坐标点
 * @param {Object} sphere - { center, radius }
 * @returns {boolean}
 */
function pointInSphere(point, sphere) {
  const dist = point.distanceTo(sphere.center);
  return dist <= sphere.radius;
}

/**
 * 检测点是否在任意碰撞体内
 * @param {THREE.Vector3} point
 * @param {Object} colliders
 * @returns {string|null} 碰撞体名称或 null
 */
function checkPointCollision(point, colliders) {
  for (const [name, collider] of Object.entries(colliders)) {
    if (collider.type === 'capsule') {
      if (pointInCapsule(point, collider)) return name;
    } else if (collider.type === 'sphere') {
      if (pointInSphere(point, collider)) return name;
    }
  }
  return null;
}

/**
 * 计算将点推出碰撞体所需的位移方向
 * @param {THREE.Vector3} point - 穿模点
 * @param {Object} collider - 碰撞体
 * @returns {THREE.Vector3} 推出方向（归一化）
 */
function computePushDirection(point, collider) {
  const dir = new THREE.Vector3();

  if (collider.type === 'sphere') {
    dir.subVectors(point, collider.center).normalize();
    // 如果点在中心，默认向侧面推
    if (dir.lengthSq() < 0.001) {
      dir.set(1, 0, 0);
    }
  } else if (collider.type === 'capsule') {
    const halfHeight = collider.height / 2;
    const toPoint = new THREE.Vector3().subVectors(point, collider.center);
    const yDist = toPoint.y;

    if (Math.abs(yDist) <= halfHeight) {
      // 在圆柱部分：水平推出
      dir.set(toPoint.x, 0, toPoint.z).normalize();
      if (dir.lengthSq() < 0.001) {
        dir.set(1, 0, 0);
      }
    } else {
      // 在半球部分：从球心推出
      const sphereCenterY = collider.center.y + (yDist > 0 ? halfHeight : -halfHeight);
      const sphereCenter = new THREE.Vector3(collider.center.x, sphereCenterY, collider.center.z);
      dir.subVectors(point, sphereCenter).normalize();
      if (dir.lengthSq() < 0.001) {
        dir.set(1, 0, 0);
      }
    }
  }

  return dir;
}

/**
 * BodyCollisionGuard 类
 */
export class BodyCollisionGuard {
  constructor(character) {
    this.character = character;
    this.colliders = computeBodyColliders(character);
    this._debugEnabled = false;

    // 缓存关节世界坐标（用于速度平滑）
    this._lastPositions = new Map();
  }

  /**
   * 更新碰撞体（角色移动后需要重新计算）
   */
  updateColliders() {
    this.colliders = computeBodyColliders(this.character);
  }

  /**
   * 检测并修正手臂穿模
   * @returns {Object} 修正信息 { rightShoulder, leftShoulder, rightElbow, leftElbow, ... }
   */
  checkAndFixArms() {
    const corrections = {};
    const c = this.character;

    // 检查右臂
    if (c.rightElbow && c.rightArm) {
      const elbowWorld = new THREE.Vector3();
      c.rightElbow.getWorldPosition(elbowWorld);
      const collision = checkPointCollision(elbowWorld, this.colliders);
      if (collision) {
        const pushDir = computePushDirection(elbowWorld, this.colliders[collision]);
        // 将推出方向转换为 shoulder 的 ry/rz 调整量
        // pushDir.x > 0 表示需要向右推 → 增大 shoulder.ry（外展）
        // pushDir.y > 0 表示需要向上推 → 减小 shoulder.rx（向上抬）
        corrections.rightShoulder = corrections.rightShoulder || { rx: 0, ry: 0, rz: 0 };
        corrections.rightShoulder.ry += pushDir.x * 0.3; // 水平外推
        corrections.rightShoulder.rx -= pushDir.y * 0.2; // 垂直上推
        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Right elbow inside ${collision}, pushing ${pushDir.x.toFixed(2)}, ${pushDir.y.toFixed(2)}`);
        }
      }
    }

    // 检查左臂
    if (c.leftElbow && c.leftArm) {
      const elbowWorld = new THREE.Vector3();
      c.leftElbow.getWorldPosition(elbowWorld);
      const collision = checkPointCollision(elbowWorld, this.colliders);
      if (collision) {
        const pushDir = computePushDirection(elbowWorld, this.colliders[collision]);
        corrections.leftShoulder = corrections.leftShoulder || { rx: 0, ry: 0, rz: 0 };
        corrections.leftShoulder.ry -= pushDir.x * 0.3; // 左臂镜像
        corrections.leftShoulder.rx -= pushDir.y * 0.2;
        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Left elbow inside ${collision}, pushing ${pushDir.x.toFixed(2)}, ${pushDir.y.toFixed(2)}`);
        }
      }
    }

    // 检查右手腕（更深层的穿模）
    if (c.rightWrist && c.rightArm) {
      const wristWorld = new THREE.Vector3();
      c.rightWrist.getWorldPosition(wristWorld);
      const collision = checkPointCollision(wristWorld, this.colliders);
      if (collision) {
        const pushDir = computePushDirection(wristWorld, this.colliders[collision]);
        corrections.rightShoulder = corrections.rightShoulder || { rx: 0, ry: 0, rz: 0 };
        corrections.rightShoulder.ry += pushDir.x * 0.5;
        corrections.rightShoulder.rx -= pushDir.y * 0.3;
        // 同时调整 elbow 减少弯曲
        corrections.rightElbow = corrections.rightElbow || { rx: 0, ry: 0, rz: 0 };
        corrections.rightElbow.rx -= 0.2;
        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Right wrist inside ${collision}`);
        }
      }
    }

    // 检查左手腕
    if (c.leftWrist && c.leftArm) {
      const wristWorld = new THREE.Vector3();
      c.leftWrist.getWorldPosition(wristWorld);
      const collision = checkPointCollision(wristWorld, this.colliders);
      if (collision) {
        const pushDir = computePushDirection(wristWorld, this.colliders[collision]);
        corrections.leftShoulder = corrections.leftShoulder || { rx: 0, ry: 0, rz: 0 };
        corrections.leftShoulder.ry -= pushDir.x * 0.5;
        corrections.leftShoulder.rx -= pushDir.y * 0.3;
        corrections.leftElbow = corrections.leftElbow || { rx: 0, ry: 0, rz: 0 };
        corrections.leftElbow.rx -= 0.2;
        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Left wrist inside ${collision}`);
        }
      }
    }

    return corrections;
  }

  /**
   * 检测并修正腿部穿模（腿穿过另一条腿或躯干）
   * @returns {Object} 修正信息
   */
  checkAndFixLegs() {
    const corrections = {};
    const c = this.character;

    // 检查右膝
    if (c.rightKnee && c.rightLeg) {
      const kneeWorld = new THREE.Vector3();
      c.rightKnee.getWorldPosition(kneeWorld);
      const collision = checkPointCollision(kneeWorld, this.colliders);
      if (collision) {
        const pushDir = computePushDirection(kneeWorld, this.colliders[collision]);
        corrections.rightHip = corrections.rightHip || { rx: 0, ry: 0, rz: 0 };
        corrections.rightHip.ry += pushDir.x * 0.3;
        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Right knee inside ${collision}`);
        }
      }
    }

    // 检查左膝
    if (c.leftKnee && c.leftLeg) {
      const kneeWorld = new THREE.Vector3();
      c.leftKnee.getWorldPosition(kneeWorld);
      const collision = checkPointCollision(kneeWorld, this.colliders);
      if (collision) {
        const pushDir = computePushDirection(kneeWorld, this.colliders[collision]);
        corrections.leftHip = corrections.leftHip || { rx: 0, ry: 0, rz: 0 };
        corrections.leftHip.ry -= pushDir.x * 0.3;
        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Left knee inside ${collision}`);
        }
      }
    }

    return corrections;
  }

  /**
   * 执行完整的穿模检测和修正
   * @returns {Object} 所有修正的合并结果
   */
  enforce() {
    // 更新碰撞体（角色可能移动了）
    this.updateColliders();

    const armCorrections = this.checkAndFixArms();
    const legCorrections = this.checkAndFixLegs();

    // 合并修正
    const allCorrections = { ...armCorrections };
    for (const [joint, delta] of Object.entries(legCorrections)) {
      if (allCorrections[joint]) {
        allCorrections[joint].rx = (allCorrections[joint].rx || 0) + (delta.rx || 0);
        allCorrections[joint].ry = (allCorrections[joint].ry || 0) + (delta.ry || 0);
        allCorrections[joint].rz = (allCorrections[joint].rz || 0) + (delta.rz || 0);
      } else {
        allCorrections[joint] = { ...delta };
      }
    }

    return allCorrections;
  }

  /**
   * 启用/禁用调试输出
   */
  setDebug(enabled) {
    this._debugEnabled = enabled;
  }
}
