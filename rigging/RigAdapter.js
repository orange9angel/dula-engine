import * as THREE from 'three';

/**
 * RigAdapter — 自动为扁平角色创建层级关节结构
 *
 * 问题：旧角色只有 rightArm/leftArm/rightLeg/leftLeg（单层Group），
 *       没有 elbow/wrist/knee/ankle 子关节，无法使用矩阵动画。
 *
 * 解决：在现有 Group 下自动插入 elbow/wrist/knee/ankle 层级，
 *       无需修改角色的 build() 方法。
 *
 * 适配模式：
 *   - 已层级化角色（Yusuke/Kuwabara）：rightElbow 已存在，跳过
 *   - 扁平角色（Doraemon/Nobita/Ultraman...）：自动插入关节
 *   - 特殊角色（Xingzai 昆虫腿）：部分适配
 */
export class RigAdapter {
  /**
   * 适配一个角色，自动创建缺失的关节层级
   * @param {CharacterBase} character
   * @returns {boolean} 是否进行了修改
   */
  static adapt(character) {
    let modified = false;
    if (this._adaptArm(character, 'right')) modified = true;
    if (this._adaptArm(character, 'left')) modified = true;
    if (this._adaptLeg(character, 'right')) modified = true;
    if (this._adaptLeg(character, 'left')) modified = true;
    return modified;
  }

  /**
   * 检查角色是否已经适配
   */
  static isAdapted(character) {
    return character.rightElbow !== null && character.leftElbow !== null;
  }

  // ========== ARM ADAPTATION ==========

  static _adaptArm(character, side) {
    const armKey = side === 'right' ? 'rightArm' : 'leftArm';
    const elbowKey = side === 'right' ? 'rightElbow' : 'leftElbow';
    const wristKey = side === 'right' ? 'rightWrist' : 'leftWrist';
    const arm = character[armKey];

    // 已经适配过或没有手臂
    if (!arm || character[elbowKey]) return false;

    const armLen = character.rightArmLength || character.leftArmLength || this._estimateArmLength(arm);
    if (!armLen || armLen <= 0) return false;

    // 在 arm Group 下找到所有 mesh，按 y 坐标排序
    const meshes = this._collectMeshes(arm);
    meshes.sort((a, b) => a.position.y - b.position.y);

    // 估计 upper/lower 分界点（约 45% 处为 elbow）
    const upperRatio = 0.45;
    const elbowY = -armLen * upperRatio;
    const wristY = -armLen * 0.85;

    // 创建 Elbow Group（pivot 在 upper arm 末端）
    const elbow = new THREE.Group();
    elbow.position.y = elbowY;
    arm.add(elbow);
    character[elbowKey] = elbow;

    // 创建 Wrist Group（pivot 在 forearm 末端）
    const wrist = new THREE.Group();
    wrist.position.y = wristY - elbowY; // 相对 elbow
    elbow.add(wrist);
    character[wristKey] = wrist;

    // 重新 parent meshes：
    // - upper arm mesh → 留在 arm（shoulder）下
    // - lower arm mesh → 移到 elbow 下，调整相对位置
    // - hand mesh → 移到 wrist 下，调整相对位置
    for (const mesh of meshes) {
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);
      const localY = mesh.position.y;

      if (localY < wristY - 0.01) {
        // Hand mesh：移到 wrist 下
        wrist.add(mesh);
        mesh.position.y = localY - wristY;
      } else if (localY < elbowY - 0.01) {
        // Lower arm mesh：移到 elbow 下
        elbow.add(mesh);
        mesh.position.y = localY - elbowY;
      }
      // Upper arm mesh 留在 arm 下，无需移动
    }

    return true;
  }

  // ========== LEG ADAPTATION ==========

  static _adaptLeg(character, side) {
    const legKey = side === 'right' ? 'rightLeg' : 'leftLeg';
    const kneeKey = side === 'right' ? 'rightKnee' : 'leftKnee';
    const ankleKey = side === 'right' ? 'rightAnkle' : 'leftAnkle';
    const leg = character[legKey];

    // 已经适配过或没有腿
    if (!leg || character[kneeKey]) return false;

    // 估计腿部长度
    const legLen = this._estimateLegLength(leg);
    if (!legLen || legLen <= 0) return false;

    // 收集 leg Group 下的所有 mesh
    const meshes = this._collectMeshes(leg);
    meshes.sort((a, b) => a.position.y - b.position.y);

    // 估计 thigh/shin 分界点
    const kneeY = -legLen * 0.48;
    const ankleY = -legLen * 0.88;

    // 创建 Knee Group
    const knee = new THREE.Group();
    knee.position.y = kneeY;
    leg.add(knee);
    character[kneeKey] = knee;

    // 创建 Ankle Group
    const ankle = new THREE.Group();
    ankle.position.y = ankleY - kneeY;
    knee.add(ankle);
    character[ankleKey] = ankle;

    // 重新 parent meshes
    for (const mesh of meshes) {
      const localY = mesh.position.y;

      if (localY < ankleY - 0.01) {
        // Foot/shoe mesh：移到 ankle 下
        ankle.add(mesh);
        mesh.position.y = localY - ankleY;
      } else if (localY < kneeY - 0.01) {
        // Shin mesh：移到 knee 下
        knee.add(mesh);
        mesh.position.y = localY - kneeY;
      }
      // Thigh mesh 留在 leg（hip）下
    }

    return true;
  }

  // ========== UTILITIES ==========

  /**
   * 收集一个 Group 下的所有 Mesh（递归）
   */
  static _collectMeshes(group) {
    const meshes = [];
    group.traverse((child) => {
      if (child.isMesh && child !== group) {
        meshes.push(child);
      }
    });
    return meshes;
  }

  /**
   * 估计手臂长度：从 shoulder 到最远 mesh 的 y 距离
   */
  static _estimateArmLength(armGroup) {
    let minY = 0;
    armGroup.traverse((child) => {
      if (child.isMesh && child.position.y < minY) {
        minY = child.position.y;
      }
    });
    return Math.abs(minY);
  }

  /**
   * 估计腿部长度：从 hip 到最远 mesh 的 y 距离
   */
  static _estimateLegLength(legGroup) {
    let minY = 0;
    legGroup.traverse((child) => {
      if (child.isMesh && child.position.y < minY) {
        minY = child.position.y;
      }
    });
    return Math.abs(minY);
  }
}
