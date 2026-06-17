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
 *
 * v2 增强：
 * - 支持肢体段（shoulder→elbow→wrist）连续碰撞检测，不再只检测离散点
 * - 支持角色间碰撞检测（可选）
 * - 对圆形/矮胖角色（如 Doraemon）自动使用更合适的碰撞体
 * - 可配置检测强度与忽略列表
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
 * 对圆形/矮胖角色（如 Doraemon）使用更宽的椭球/胶囊体
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

  // 识别圆形/矮胖角色并放大躯干碰撞体
  const archetypes = character.archetypes || [];
  const isRound = archetypes.includes('round') || archetypes.includes('dinosaur') || archetypes.includes('quadruped');
  const isTiny = archetypes.includes('tiny');
  const scaleMultiplier = isRound ? 1.35 : (isTiny ? 0.75 : 1.0);

  if (character.headGroup) {
    const headPos = new THREE.Vector3();
    character.headGroup.getWorldPosition(headPos);
    headCenter.copy(headPos);
    // 根据 boundingRadius 调整
    if (character.boundingRadius) {
      headRadius = Math.min(0.28, character.boundingRadius * 0.4) * scaleMultiplier;
      torsoRadius = Math.min(0.38, character.boundingRadius * 0.55) * scaleMultiplier;
    }
  }

  // 躯干中心在头部和脚部之间
  if (character.mesh) {
    const meshY = character.mesh.position.y;
    torsoCenter.y = meshY + (headCenter.y - meshY) * 0.45;
    torsoHeight = (headCenter.y - meshY) * 0.75;
  }

  // 矮胖角色：降低躯干高度，增大半径
  if (isRound) {
    torsoHeight *= 0.85;
    torsoRadius *= 1.2;
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
 * 计算线段上距离胶囊体中心最近的点，并返回穿透信息
 * @param {THREE.Vector3} a - 线段起点
 * @param {THREE.Vector3} b - 线段终点
 * @param {Object} capsule - { center, radius, height }
 * @returns {{ hit: boolean, point: THREE.Vector3, depth: number, normal: THREE.Vector3 }}
 */
function segmentCapsuleIntersection(a, b, capsule) {
  const halfHeight = capsule.height / 2;
  const result = { hit: false, point: new THREE.Vector3(), depth: 0, normal: new THREE.Vector3(0, 0, 1) };

  // 胶囊体沿 Y 轴。将线段端点转换到胶囊体局部坐标系
  const localA = new THREE.Vector3().subVectors(a, capsule.center);
  const localB = new THREE.Vector3().subVectors(b, capsule.center);

  // 参数化线段 p = localA + t * (localB - localA), t ∈ [0,1]
  const segDir = new THREE.Vector3().subVectors(localB, localA);
  const segLenSq = segDir.lengthSq();

  // 最近点投影到 Y 轴
  let closestY, closestT;
  if (segLenSq < 1e-8) {
    closestY = localA.y;
    closestT = 0;
  } else {
    // 最小化 |localA + t*segDir - projY|^2 对 t 求导
    const t = -localA.dot(segDir) / segLenSq;
    closestT = Math.max(0, Math.min(1, t));
    closestY = localA.y + closestT * segDir.y;
  }

  // clamp Y 到胶囊体圆柱段范围
  const clampedY = Math.max(-halfHeight, Math.min(halfHeight, closestY));

  // 在 clampedY 高度取线段上的点
  const linePoint = new THREE.Vector3().copy(localA).addScaledVector(segDir, closestT);
  linePoint.y = clampedY;

  // 计算到 Y 轴的水平距离
  const rDist = Math.sqrt(linePoint.x * linePoint.x + linePoint.z * linePoint.z);

  if (rDist <= capsule.radius + 1e-6) {
    // 线段进入胶囊体（圆柱部分或半球部分）
    result.hit = true;
    result.point.copy(linePoint).add(capsule.center);
    if (rDist < 1e-6) {
      result.normal.set(1, 0, 0);
    } else {
      result.normal.set(linePoint.x, 0, linePoint.z).normalize();
    }
    result.depth = capsule.radius - rDist;
    return result;
  }

  // 检查半球部分：当 closestY 在圆柱段外时，检查端点到半球球心的距离
  const sphereCenterY = closestY > 0 ? halfHeight : -halfHeight;
  const sphereCenter = new THREE.Vector3(0, sphereCenterY, 0);

  // 线段到球心的最近点
  const toCenter = new THREE.Vector3().subVectors(sphereCenter, localA);
  let tSphere = toCenter.dot(segDir) / segLenSq;
  tSphere = Math.max(0, Math.min(1, tSphere));
  const nearestPoint = new THREE.Vector3().copy(localA).addScaledVector(segDir, tSphere);
  const distToCenter = nearestPoint.distanceTo(sphereCenter);

  if (distToCenter <= capsule.radius + 1e-6) {
    result.hit = true;
    result.point.copy(nearestPoint).add(capsule.center);
    result.normal.copy(nearestPoint).sub(sphereCenter).normalize();
    if (result.normal.lengthSq() < 1e-6) result.normal.set(1, 0, 0);
    result.depth = capsule.radius - distToCenter;
  }

  return result;
}

/**
 * 计算线段上距离球心最近的点，并返回穿透信息
 * @param {THREE.Vector3} a - 线段起点
 * @param {THREE.Vector3} b - 线段终点
 * @param {Object} sphere - { center, radius }
 * @returns {{ hit: boolean, point: THREE.Vector3, depth: number, normal: THREE.Vector3 }}
 */
function segmentSphereIntersection(a, b, sphere) {
  const result = { hit: false, point: new THREE.Vector3(), depth: 0, normal: new THREE.Vector3(1, 0, 0) };
  const localA = new THREE.Vector3().subVectors(a, sphere.center);
  const localB = new THREE.Vector3().subVectors(b, sphere.center);
  const segDir = new THREE.Vector3().subVectors(localB, localA);
  const segLenSq = segDir.lengthSq();

  let t;
  if (segLenSq < 1e-8) {
    t = 0;
  } else {
    t = -localA.dot(segDir) / segLenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const nearestPoint = new THREE.Vector3().copy(localA).addScaledVector(segDir, t);
  const dist = nearestPoint.length();

  if (dist <= sphere.radius + 1e-6) {
    result.hit = true;
    result.point.copy(nearestPoint).add(sphere.center);
    result.normal.copy(nearestPoint).normalize();
    if (result.normal.lengthSq() < 1e-6) result.normal.set(1, 0, 0);
    result.depth = sphere.radius - dist;
  }

  return result;
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
 * 检测肢体段（两点连线）是否与身体碰撞体相交
 * @param {THREE.Vector3} a - 线段起点（世界坐标）
 * @param {THREE.Vector3} b - 线段终点（世界坐标）
 * @param {Object} colliders
 * @returns {{ name: string, point: THREE.Vector3, depth: number, normal: THREE.Vector3 }|null}
 */
function checkSegmentCollision(a, b, colliders) {
  for (const [name, collider] of Object.entries(colliders)) {
    const result = collider.type === 'capsule'
      ? segmentCapsuleIntersection(a, b, collider)
      : segmentSphereIntersection(a, b, collider);
    if (result.hit) {
      return { name, point: result.point, depth: result.depth, normal: result.normal };
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
  constructor(character, options = {}) {
    this.character = character;
    this.colliders = computeBodyColliders(character);
    this._debugEnabled = options.debug || false;

    // 配置
    this._config = {
      enableSelfCollision: options.enableSelfCollision !== false,
      enableInterCharacter: options.enableInterCharacter !== false,
      armStrength: options.armStrength ?? 1.0,
      legStrength: options.legStrength ?? 1.0,
      sampleCount: options.sampleCount ?? 3, // 肢体段采样点数
      pushScale: options.pushScale ?? 0.45,
      ...options,
    };

    // 缓存关节世界坐标（用于速度平滑）
    this._lastPositions = new Map();
  }

  /**
   * 配置防穿模系统
   */
  configure(config) {
    Object.assign(this._config, config);
  }

  /**
   * 更新碰撞体（角色移动后需要重新计算）
   */
  updateColliders() {
    this.colliders = computeBodyColliders(this.character);
  }

  /**
   * 获取肢体段的世界坐标点列表（用于连续碰撞检测）
   */
  _getSegmentWorldPoints(joints) {
    const points = [];
    for (const joint of joints) {
      if (joint) {
        const p = new THREE.Vector3();
        joint.getWorldPosition(p);
        points.push(p);
      }
    }
    return points;
  }

  /**
   * 对肢体链进行连续碰撞检测（线段 vs 碰撞体）
   * @param {THREE.Object3D[]} joints - 从近端到远端的关节链
   * @param {string} side - 'right' | 'left'
   * @param {string} limb - 'arm' | 'leg'
   * @returns {Object} 修正信息
   */
  _checkLimbChain(joints, side, limb) {
    const corrections = {};
    const c = this.character;
    if (joints.length < 2) return corrections;

    const shoulderName = side === 'right' ? 'rightShoulder' : 'leftShoulder';
    const hipName = side === 'right' ? 'rightHip' : 'leftHip';
    const elbowName = side === 'right' ? 'rightElbow' : 'leftElbow';
    const kneeName = side === 'right' ? 'rightKnee' : 'leftKnee';

    for (let i = 0; i < joints.length - 1; i++) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      joints[i].getWorldPosition(a);
      joints[i + 1].getWorldPosition(b);

      const hit = checkSegmentCollision(a, b, this.colliders);
      if (!hit) continue;

      // 根据命中点和法线计算修正
      const isArm = limb === 'arm';
      const rootName = isArm ? shoulderName : hipName;
      const midName = isArm ? elbowName : kneeName;

      corrections[rootName] = corrections[rootName] || { rx: 0, ry: 0, rz: 0 };
      if (midName === 'rightElbow' || midName === 'leftElbow' || midName === 'rightKnee' || midName === 'leftKnee') {
        corrections[midName] = corrections[midName] || { rx: 0, ry: 0, rz: 0 };
      }

      // 水平方向：将肢体向外推
      const pushX = hit.normal.x;
      const pushY = hit.normal.y;
      const strength = isArm ? this._config.armStrength : this._config.legStrength;
      const scale = this._config.pushScale * (1 + hit.depth * 2) * strength;

      if (isArm) {
        // 右臂 pushX>0 应增大 ry（外展）；左臂镜像
        const mirror = side === 'right' ? 1 : -1;
        corrections[rootName].ry += pushX * scale * 0.7 * mirror;
        corrections[rootName].rx -= pushY * scale * 0.4;
        // 命中点越靠近远端，越需要伸直肘部/膝部
        const t = i / (joints.length - 1);
        corrections[midName].rx -= scale * 0.25 * (1 + t);
      } else {
        // 腿部：水平外推
        const mirror = side === 'right' ? 1 : -1;
        corrections[hipName].ry += pushX * scale * 0.6 * mirror;
      }

      if (this._debugEnabled) {
        console.log(`[BodyCollisionGuard] ${side} ${limb} segment ${i} inside ${hit.name}, depth=${hit.depth.toFixed(3)}, push=(${pushX.toFixed(2)}, ${pushY.toFixed(2)})`);
      }

      // 只处理最深的一处穿透，避免过度修正
      break;
    }

    return corrections;
  }

  /**
   * 检测并修正手臂穿模
   * @returns {Object} 修正信息
   */
  checkAndFixArms() {
    const c = this.character;
    const corrections = {};

    const rightJoints = [c.rightArm, c.rightElbow, c.rightWrist].filter(Boolean);
    const leftJoints = [c.leftArm, c.leftElbow, c.leftWrist].filter(Boolean);

    const rightCorr = this._checkLimbChain(rightJoints, 'right', 'arm');
    const leftCorr = this._checkLimbChain(leftJoints, 'left', 'arm');

    for (const [joint, delta] of Object.entries(rightCorr)) {
      corrections[joint] = corrections[joint] || { rx: 0, ry: 0, rz: 0 };
      corrections[joint].rx += delta.rx || 0;
      corrections[joint].ry += delta.ry || 0;
      corrections[joint].rz += delta.rz || 0;
    }
    for (const [joint, delta] of Object.entries(leftCorr)) {
      corrections[joint] = corrections[joint] || { rx: 0, ry: 0, rz: 0 };
      corrections[joint].rx += delta.rx || 0;
      corrections[joint].ry += delta.ry || 0;
      corrections[joint].rz += delta.rz || 0;
    }

    return corrections;
  }

  /**
   * 检测并修正腿部穿模（腿穿过另一条腿或躯干）
   * @returns {Object} 修正信息
   */
  checkAndFixLegs() {
    const c = this.character;
    const corrections = {};

    const rightJoints = [c.rightLeg, c.rightKnee, c.rightAnkle].filter(Boolean);
    const leftJoints = [c.leftLeg, c.leftKnee, c.leftAnkle].filter(Boolean);

    const rightCorr = this._checkLimbChain(rightJoints, 'right', 'leg');
    const leftCorr = this._checkLimbChain(leftJoints, 'left', 'leg');

    for (const [joint, delta] of Object.entries(rightCorr)) {
      corrections[joint] = corrections[joint] || { rx: 0, ry: 0, rz: 0 };
      corrections[joint].rx += delta.rx || 0;
      corrections[joint].ry += delta.ry || 0;
      corrections[joint].rz += delta.rz || 0;
    }
    for (const [joint, delta] of Object.entries(leftCorr)) {
      corrections[joint] = corrections[joint] || { rx: 0, ry: 0, rz: 0 };
      corrections[joint].rx += delta.rx || 0;
      corrections[joint].ry += delta.ry || 0;
      corrections[joint].rz += delta.rz || 0;
    }

    return corrections;
  }

  /**
   * 检测并修正角色之间的穿模
   * @param {CharacterBase[]} otherCharacters - 其他角色实例列表
   * @returns {Object} 修正信息（推动本角色远离其他角色）
   */
  checkInterCharacterCollision(otherCharacters) {
    const corrections = {};
    if (!this._config.enableInterCharacter || !otherCharacters?.length) return corrections;

    const c = this.character;
    if (!c.mesh) return corrections;

    const myCenter = new THREE.Vector3();
    c.mesh.getWorldPosition(myCenter);
    myCenter.y += 1.0; // 身体中心

    const myRadius = c.boundingRadius || 0.5;

    for (const other of otherCharacters) {
      if (other === c || !other.mesh) continue;

      const otherCenter = new THREE.Vector3();
      other.mesh.getWorldPosition(otherCenter);
      otherCenter.y += 1.0;
      const otherRadius = other.boundingRadius || 0.5;

      const diff = new THREE.Vector3().subVectors(myCenter, otherCenter);
      const dist = diff.length();
      const minDist = myRadius + otherRadius;

      if (dist < minDist && dist > 0.001) {
        const overlap = minDist - dist;
        const pushDir = diff.normalize();
        // 将推力转换为躯干/臀部调整
        corrections.mesh = corrections.mesh || { rx: 0, ry: 0, rz: 0, x: 0, y: 0, z: 0 };
        corrections.mesh.x = (corrections.mesh.x || 0) + pushDir.x * overlap * 0.5;
        corrections.mesh.z = (corrections.mesh.z || 0) + pushDir.z * overlap * 0.5;

        if (this._debugEnabled) {
          console.log(`[BodyCollisionGuard] Inter-character collision with ${other.name}, overlap=${overlap.toFixed(3)}`);
        }
      }
    }

    return corrections;
  }

  /**
   * 执行完整的穿模检测和修正
   * @param {CharacterBase[]} otherCharacters - 其他角色实例（用于角色间碰撞）
   * @returns {Object} 所有修正的合并结果
   */
  enforce(otherCharacters = null) {
    // 更新碰撞体（角色可能移动了）
    this.updateColliders();

    let allCorrections = {};

    if (this._config.enableSelfCollision) {
      const armCorrections = this.checkAndFixArms();
      const legCorrections = this.checkAndFixLegs();

      allCorrections = { ...armCorrections };
      for (const [joint, delta] of Object.entries(legCorrections)) {
        if (allCorrections[joint]) {
          allCorrections[joint].rx = (allCorrections[joint].rx || 0) + (delta.rx || 0);
          allCorrections[joint].ry = (allCorrections[joint].ry || 0) + (delta.ry || 0);
          allCorrections[joint].rz = (allCorrections[joint].rz || 0) + (delta.rz || 0);
        } else {
          allCorrections[joint] = { ...delta };
        }
      }
    }

    // 角色间碰撞
    if (this._config.enableInterCharacter && otherCharacters) {
      const interCorr = this.checkInterCharacterCollision(otherCharacters);
      for (const [joint, delta] of Object.entries(interCorr)) {
        allCorrections[joint] = allCorrections[joint] || { rx: 0, ry: 0, rz: 0, x: 0, y: 0, z: 0 };
        allCorrections[joint].x = (allCorrections[joint].x || 0) + (delta.x || 0);
        allCorrections[joint].y = (allCorrections[joint].y || 0) + (delta.y || 0);
        allCorrections[joint].z = (allCorrections[joint].z || 0) + (delta.z || 0);
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
