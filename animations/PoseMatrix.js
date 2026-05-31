/**
 * PoseMatrix — 角色姿势矩阵系统（13点关节控制版）
 *
 * 控制点（13个）：
 *   1. headGroup      — 头（颈部旋转）
 *   2. rightShoulder  — 右肩（上臂根部）
 *   3. rightElbow     — 右肘（前臂旋转）
 *   4. rightWrist     — 右手腕（手掌旋转）
 *   5. leftShoulder   — 左肩
 *   6. leftElbow      — 左肘
 *   7. leftWrist      — 左手腕
 *   8. rightHip       — 右髋（大腿根部）
 *   9. rightKnee      — 右膝（小腿旋转）
 *  10. rightAnkle     — 右脚踝（脚掌旋转）
 *  11. leftHip        — 左髋
 *  12. leftKnee       — 左膝
 *  13. leftAnkle      — 左脚踝
 *  14. mesh           — 躯干根节点（整体位移/旋转）
 *
 * 所有数值是「相对基线的偏移量」（additive），不是绝对值。
 * 每个关节支持：rx, ry, rz（旋转），可选 sx, sy, sz（缩放）
 */

export class PoseMatrix {
  constructor() {
    // 13个控制点 + 躯干
    this.headGroup = null;
    this.rightShoulder = null;
    this.rightElbow = null;
    this.rightElbowTwist = null;
    this.rightWrist = null;
    this.leftShoulder = null;
    this.leftElbow = null;
    this.leftElbowTwist = null;
    this.leftWrist = null;
    this.rightHip = null;
    this.rightKnee = null;
    this.rightAnkle = null;
    this.leftHip = null;
    this.leftKnee = null;
    this.leftAnkle = null;
    this.mesh = null;
    // 面部表情（可选）
    this.mouth = null;      // { sx, sy, sz, px, py, pz, rx, ry, rz }
    this.eyebrows = null;   // { left: { py, pz, rz }, right: { py, pz, rz } }
    this.eyelids = null;    // { left: { sy, visible }, right: { sy, visible } }
    this.pupils = null;     // { left: { sx, sy, sz, px, py }, right: { sx, sy, sz, px, py } }
  }

  static zero() {
    return new PoseMatrix();
  }

  static fromJoint(jointName, values) {
    const p = new PoseMatrix();
    p[jointName] = { ...values };
    return p;
  }

  static lerp(a, b, t) {
    const result = new PoseMatrix();
    const joints = [
      'headGroup', 'rightShoulder', 'rightElbow', 'rightElbowTwist', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftElbowTwist', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle',
      'mesh', 'mouth', 'eyebrows', 'eyelids', 'pupils',
    ];
    for (const joint of joints) {
      if (!a[joint] && !b[joint]) continue;
      result[joint] = {};
      const keys = new Set([
        ...(a[joint] ? Object.keys(a[joint]) : []),
        ...(b[joint] ? Object.keys(b[joint]) : []),
      ]);
      for (const key of keys) {
        const av = a[joint]?.[key];
        const bv = b[joint]?.[key];
        const avType = typeof av;
        const bvType = typeof bv;
        // Handle nested objects (e.g. eyebrows.left, eyelids.left)
        if ((avType === 'object' && av !== null) || (bvType === 'object' && bv !== null)) {
          result[joint][key] = {};
          const avObj = av && typeof av === 'object' && av !== null ? av : {};
          const bvObj = bv && typeof bv === 'object' && bv !== null ? bv : {};
          const nestedKeys = new Set([
            ...Object.keys(avObj),
            ...Object.keys(bvObj),
          ]);
          for (const nKey of nestedKeys) {
            const nav = avObj[nKey] ?? 0;
            const nbv = bvObj[nKey] ?? 0;
            if (typeof nav === 'boolean' || typeof nbv === 'boolean') {
              result[joint][key][nKey] = t >= 0.5 ? nbv : nav;
            } else {
              result[joint][key][nKey] = nav + (nbv - nav) * t;
            }
          }
        } else if (avType === 'boolean' || bvType === 'boolean') {
          // For booleans (like visible), use b's value when t >= 0.5
          result[joint][key] = t >= 0.5 ? (bv ?? false) : (av ?? false);
        } else {
          result[joint][key] = (av ?? 0) + ((bv ?? 0) - (av ?? 0)) * t;
        }
      }
    }
    return result;
  }

  static add(a, b) {
    const result = new PoseMatrix();
    const joints = [
      'headGroup', 'rightShoulder', 'rightElbow', 'rightElbowTwist', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftElbowTwist', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle',
      'mesh', 'mouth', 'eyebrows', 'eyelids', 'pupils',
    ];
    for (const joint of joints) {
      if (!a[joint] && !b[joint]) continue;
      result[joint] = {};
      const keys = new Set([
        ...(a[joint] ? Object.keys(a[joint]) : []),
        ...(b[joint] ? Object.keys(b[joint]) : []),
      ]);
      for (const key of keys) {
        const av = a[joint]?.[key];
        const bv = b[joint]?.[key];
        const avType = typeof av;
        const bvType = typeof bv;
        // Handle nested objects
        if ((avType === 'object' && av !== null) || (bvType === 'object' && bv !== null)) {
          result[joint][key] = {};
          const avObj = av && typeof av === 'object' && av !== null ? av : {};
          const bvObj = bv && typeof bv === 'object' && bv !== null ? bv : {};
          const nestedKeys = new Set([...Object.keys(avObj), ...Object.keys(bvObj)]);
          for (const nKey of nestedKeys) {
            const nav = avObj[nKey] ?? 0;
            const nbv = bvObj[nKey] ?? 0;
            result[joint][key][nKey] = nav + nbv;
          }
        } else {
          result[joint][key] = (av ?? 0) + (bv ?? 0);
        }
      }
    }
    return result;
  }

  static scale(pose, s) {
    const result = new PoseMatrix();
    const joints = [
      'headGroup', 'rightShoulder', 'rightElbow', 'rightElbowTwist', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftElbowTwist', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle',
      'mesh', 'mouth', 'eyebrows', 'eyelids', 'pupils',
    ];
    for (const joint of joints) {
      if (!pose[joint]) continue;
      result[joint] = {};
      for (const key of Object.keys(pose[joint])) {
        const val = pose[joint][key];
        if (typeof val === 'object' && val !== null) {
          result[joint][key] = {};
          for (const nKey of Object.keys(val)) {
            result[joint][key][nKey] = val[nKey] * s;
          }
        } else {
          result[joint][key] = val * s;
        }
      }
    }
    return result;
  }

  isEmpty() {
    const joints = [
      'headGroup', 'rightShoulder', 'rightElbow', 'rightElbowTwist', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftElbowTwist', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle',
      'mesh', 'mouth', 'eyebrows', 'eyelids', 'pupils',
    ];
    return joints.every(j => !this[j]);
  }

  clone() {
    const result = new PoseMatrix();
    const joints = [
      'headGroup', 'rightShoulder', 'rightElbow', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle',
      'mesh', 'mouth', 'eyebrows', 'eyelids', 'pupils',
    ];
    for (const joint of joints) {
      if (this[joint]) {
        result[joint] = { ...this[joint] };
      }
    }
    return result;
  }
}

/**
 * ActionPhase — 动作阶段枚举
 */
export const ActionPhase = {
  NEUTRAL: 'neutral',
  WINDUP: 'windup',
  EXECUTION: 'execution',
  IMPACT: 'impact',
  RECOVERY: 'recovery',
};

/**
 * PoseType — 姿势类型枚举
 */
export const PoseType = {
  IDLE: 'idle',
  PREP: 'prep',
  ACTION: 'action',
  REACTION: 'reaction',
  RECOVERY: 'recovery',
  EXPRESSION: 'expression',
  GESTURE: 'gesture',
};

/**
 * 动画名称 → 姿势类型映射
 */
export const ANIM_TO_POSE_TYPE = {
  // idle
  Idle: PoseType.IDLE,
  Breathing: PoseType.IDLE,
  FightingStance: PoseType.IDLE,
  CrossArms: PoseType.IDLE,
  HandsOnHips: PoseType.IDLE,
  // prep
  SpiritGunCharge: PoseType.PREP,
  SpiritSwordDraw: PoseType.PREP,
  Ready: PoseType.PREP,
  Aim: PoseType.PREP,
  Crouch: PoseType.PREP,
  // action
  Punch: PoseType.ACTION,
  RightPunch: PoseType.ACTION,
  LeftPunch: PoseType.ACTION,
  LeftRightPunchCombo: PoseType.ACTION,
  Kick: PoseType.ACTION,
  Uppercut: PoseType.ACTION,
  ComboPunch: PoseType.ACTION,
  SpinKick: PoseType.ACTION,
  RyuHurricaneKick: PoseType.ACTION,
  ArcadeSpinKick: PoseType.ACTION,
  JumpAttack: PoseType.ACTION,
  JumpFlyingKick: PoseType.ACTION,
  HurricaneKick: PoseType.ACTION,
  AirTatsumaki: PoseType.ACTION,
  DragonPunch: PoseType.ACTION,
  BackFist: PoseType.ACTION,
  SweepKick: PoseType.ACTION,
  KneeStrike: PoseType.ACTION,
  SpiritSwordSwing: PoseType.ACTION,
  SpiritGunFire: PoseType.ACTION,
  DashForward: PoseType.ACTION,
  HeroLanding: PoseType.ACTION,
  // reaction
  HitStagger: PoseType.REACTION,
  Knockdown: PoseType.REACTION,
  Block: PoseType.REACTION,
  Dodge: PoseType.REACTION,
  BoxerGuardHop: PoseType.REACTION,
  Tremble: PoseType.REACTION,
  FacePain: PoseType.REACTION,
  // recovery
  GetUp: PoseType.RECOVERY,
  FaceReset: PoseType.RECOVERY,
  ShakeHead: PoseType.RECOVERY,
  Sigh: PoseType.RECOVERY,
  // expression
  FaceAngry: PoseType.EXPRESSION,
  FaceHappy: PoseType.EXPRESSION,
  FaceSad: PoseType.EXPRESSION,
  FaceSurprised: PoseType.EXPRESSION,
  FaceDetermined: PoseType.EXPRESSION,
  FaceSmirk: PoseType.EXPRESSION,
  FacePain: PoseType.EXPRESSION,
  FaceConfused: PoseType.EXPRESSION,
  FaceBlink: PoseType.EXPRESSION,
  // gesture
  WaveHand: PoseType.GESTURE,
  PointForward: PoseType.GESTURE,
  Shrug: PoseType.GESTURE,
  Nod: PoseType.GESTURE,
  ScratchHead: PoseType.GESTURE,
  LookAround: PoseType.GESTURE,
  Think: PoseType.GESTURE,
  ThumbsUp: PoseType.GESTURE,
  TurnToCamera: PoseType.GESTURE,
};

export function getPoseType(animName) {
  return ANIM_TO_POSE_TYPE[animName] || PoseType.IDLE;
}

export function getDefaultPhase(poseType) {
  switch (poseType) {
    case PoseType.PREP: return ActionPhase.WINDUP;
    case PoseType.ACTION: return ActionPhase.EXECUTION;
    case PoseType.REACTION: return ActionPhase.IMPACT;
    case PoseType.RECOVERY: return ActionPhase.RECOVERY;
    default: return ActionPhase.NEUTRAL;
  }
}
