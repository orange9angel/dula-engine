import { PoseMatrix, getPoseType, getDefaultPhase, ActionPhase, PoseType } from './PoseMatrix.js';
import { JointConstraintSystem } from '../constraints/JointConstraintSystem.js';

/**
 * ActionMatrixController — 运行时动作矩阵控制器（13点关节版）
 *
 * 13个控制点：
 *   headGroup, rightShoulder, rightElbow, rightWrist,
 *   leftShoulder, leftElbow, leftWrist,
 *   rightHip, rightKnee, rightAnkle,
 *   leftHip, leftKnee, leftAnkle,
 *   mesh
 *
 * 与角色骨骼的映射：
 *   - rightShoulder → character.rightArm (手臂根Group)
 *   - rightElbow    → character.rightElbow (肘关节Group，子级)
 *   - rightWrist    → character.rightWrist (腕关节Group，子级)
 *   - rightHip      → character.rightLeg (腿部根Group)
 *   - rightKnee     → character.rightKnee (膝关节Group，子级)
 *   - rightAnkle    → character.rightAnkle (踝关节Group，子级)
 */
export class ActionMatrixController {
  constructor(character) {
    this.character = character;
    this.currentPose = PoseMatrix.zero();
    this.currentPhase = ActionPhase.NEUTRAL;
    this.currentPoseType = PoseType.IDLE;
    this.currentAction = null;

    this._transitionFrom = null;
    this._transitionTo = null;
    this._transitionStartTime = 0;
    this._transitionDuration = 0.12;
    this._inTransition = false;

    this._matrixAnims = [];
    this._baselinePose = null;
    this._lastAppliedPose = PoseMatrix.zero();
    this._faceBaseState = null;

    // ── Joint Constraint System ──
    // 三层约束保护：速度平滑 → 关节硬限制 → 防穿模
    this._constraintSystem = new JointConstraintSystem(character);
  }

  captureBaseline() {
    const c = this.character;
    this._baselinePose = new PoseMatrix();

    const captureRot = (obj) => obj ? { rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z } : null;

    this._baselinePose.headGroup = captureRot(c.headGroup);
    this._baselinePose.rightClavicle = captureRot(c.rightClavicle);
    this._baselinePose.leftClavicle = captureRot(c.leftClavicle);
    this._baselinePose.rightShoulder = captureRot(c.rightArm);
    this._baselinePose.rightElbow = captureRot(c.rightElbow);
    this._baselinePose.rightElbowTwist = captureRot(c.rightElbowTwist);
    this._baselinePose.rightWrist = captureRot(c.rightWrist);
    this._baselinePose.leftShoulder = captureRot(c.leftArm);
    this._baselinePose.leftElbow = captureRot(c.leftElbow);
    this._baselinePose.leftElbowTwist = captureRot(c.leftElbowTwist);
    this._baselinePose.leftWrist = captureRot(c.leftWrist);
    this._baselinePose.rightHip = captureRot(c.rightLeg);
    this._baselinePose.rightKnee = captureRot(c.rightKnee);
    this._baselinePose.rightAnkle = captureRot(c.rightAnkle);
    this._baselinePose.leftHip = captureRot(c.leftLeg);
    this._baselinePose.leftKnee = captureRot(c.leftKnee);
    this._baselinePose.leftAnkle = captureRot(c.leftAnkle);

    // Baseline captured silently

    if (c.mesh) {
      this._baselinePose.mesh = {
        x: c.mesh.position.x, y: c.mesh.position.y, z: c.mesh.position.z,
        rx: c.mesh.rotation.x, ry: c.mesh.rotation.y, rz: c.mesh.rotation.z,
      };
    }

    // Capture facial feature baselines
    this._faceBaseState = {};
    if (c.leftEyebrow) this._faceBaseState.leftEyebrow = { y: c.leftEyebrow.position.y, z: c.leftEyebrow.position.z, rz: c.leftEyebrow.rotation.z };
    if (c.rightEyebrow) this._faceBaseState.rightEyebrow = { y: c.rightEyebrow.position.y, z: c.rightEyebrow.position.z, rz: c.rightEyebrow.rotation.z };
    if (c.leftEyelid) this._faceBaseState.leftEyelid = { sy: c.leftEyelid.scale.y, visible: c.leftEyelid.visible };
    if (c.rightEyelid) this._faceBaseState.rightEyelid = { sy: c.rightEyelid.scale.y, visible: c.rightEyelid.visible };
    if (c.leftPupil) this._faceBaseState.leftPupil = { sx: c.leftPupil.scale.x, sy: c.leftPupil.scale.y, sz: c.leftPupil.scale.z, x: c.leftPupil.position.x, y: c.leftPupil.position.y };
    if (c.rightPupil) this._faceBaseState.rightPupil = { sx: c.rightPupil.scale.x, sy: c.rightPupil.scale.y, sz: c.rightPupil.scale.z, x: c.rightPupil.position.x, y: c.rightPupil.position.y };
    if (c.mouth) this._faceBaseState.mouth = { sx: c.mouth.scale.x, sy: c.mouth.scale.y, sz: c.mouth.scale.z, x: c.mouth.position.x, y: c.mouth.position.y, z: c.mouth.position.z, rx: c.mouth.rotation.x, ry: c.mouth.rotation.y, rz: c.mouth.rotation.z };
  }

  registerAnimation(config) {
    this._matrixAnims.push({
      name: config.name,
      poseType: config.poseType || getPoseType(config.name),
      phase: config.phase || getDefaultPhase(config.poseType),
      getPoseMatrix: config.getPoseMatrix,
      startTime: config.startTime,
      endTime: config.endTime,
    });
  }

  clearAnimations() {
    this._matrixAnims = [];
    this.currentPose = PoseMatrix.zero();
    this._inTransition = false;
    // 重置约束系统，避免速度平滑器跨动画累积
    if (this._constraintSystem) {
      this._constraintSystem.reset();
    }
  }

  /**
   * 角色被瞬间移动（如 {Position:...} 或 setPosition）后调用。
   * 更新矩阵基线到当前位置，并清除残留的 mesh 偏移，
   * 避免旧矩阵动画把角色拉回之前的高度/位置。
   */
  teleportBaselineToCurrent() {
    if (!this._baselinePose) return;
    const c = this.character;
    if (c.mesh) {
      this._baselinePose.mesh = {
        x: c.mesh.position.x,
        y: c.mesh.position.y,
        z: c.mesh.position.z,
        rx: c.mesh.rotation.x,
        ry: c.mesh.rotation.y,
        rz: c.mesh.rotation.z,
      };
    }
    // 清除残留的 mesh 偏移，防止旧动画与新位置冲突
    if (this.currentPose) this.currentPose.mesh = null;
    if (this._lastAppliedPose) this._lastAppliedPose.mesh = null;
    if (this._transitionFrom) this._transitionFrom.mesh = null;
    if (this._transitionTo) this._transitionTo.mesh = null;
  }

  update(time, delta) {
    if (!this._baselinePose) {
      this.captureBaseline();
    }

    const activeAnims = [];
    for (const anim of this._matrixAnims) {
      if (time >= anim.startTime && time <= anim.endTime) {
        const progress = (time - anim.startTime) / (anim.endTime - anim.startTime);
        activeAnims.push({ ...anim, progress });
      }
    }

    if (activeAnims.length === 0) {
      this._applyIdlePose(time, delta);
      this.currentPhase = ActionPhase.NEUTRAL;
      this.currentPoseType = PoseType.IDLE;
      this.currentAction = null;
      return;
    }

    activeAnims.sort((a, b) => b.startTime - a.startTime);
    const primary = activeAnims[0];

    if (this.currentAction !== primary.name) {
      // 从当前姿态过渡到动画的初始姿态（t=0时的姿态），而不是zero pose
      const initialPose = primary.getPoseMatrix(0, 0, primary.endTime - primary.startTime, primary.startTime);
      this._startTransition(this.currentPose, initialPose, primary.startTime);
      this.currentAction = primary.name;
      this.currentPoseType = primary.poseType;
      this.currentPhase = primary.phase;
    }

    let targetPose = primary.getPoseMatrix(
      primary.progress,
      time - primary.startTime,
      primary.endTime - primary.startTime,
      time
    );
    for (let i = 1; i < activeAnims.length; i++) {
      const secondary = activeAnims[i];
      const secondaryPose = secondary.getPoseMatrix(
        secondary.progress,
        time - secondary.startTime,
        secondary.endTime - secondary.startTime,
        time
      );
      targetPose = this._mergePoses(targetPose, secondaryPose, primary.name, secondary.name);
    }

    let finalPose = targetPose;


    if (this._inTransition) {
      const elapsed = time - this._transitionStartTime;
      const t = Math.min(1, elapsed / this._transitionDuration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      finalPose = PoseMatrix.lerp(this._transitionFrom, targetPose, ease);
      if (t >= 1) this._inTransition = false;
    }

    this.currentPose = finalPose;
    this._applyPose(finalPose);
    // 应用关节约束（速度平滑 + 硬限制 + 防穿模）
    // otherCharacters 会在 SceneBase.update 中统一传入，这里不传以避免重复
    if (this._constraintSystem) {
      this._constraintSystem.enforce(delta);
    }
    this._lastAppliedPose = finalPose.clone();
  }

  _startTransition(fromPose, toPose, startTime) {
    this._transitionFrom = fromPose.clone();
    this._transitionTo = toPose.clone();
    this._transitionStartTime = startTime;
    this._inTransition = true;
  }

  _mergePoses(primary, secondary, primaryName = '', secondaryName = '') {
    const result = primary.clone();

    // ── 面部表情：始终合并（secondary 作为叠加层） ──
    const faceJoints = ['mouth', 'eyebrows', 'eyelids', 'pupils'];
    for (const joint of faceJoints) {
      if (secondary[joint] && primary[joint]) {
        result[joint] = this._blendFaceFeatures(primary[joint], secondary[joint], 0.7);
      } else if (secondary[joint]) {
        result[joint] = { ...secondary[joint] };
      }
    }

    // ── 身体关节：智能层级合并 ──
    // 策略：根据动画类型决定哪些关节由哪个动画主导
    const isPrimaryRun = primaryName === 'Run';
    const isSecondaryRun = secondaryName === 'Run';
    const isPrimaryJump = primaryName === 'CrouchJump';
    const isSecondaryJump = secondaryName === 'CrouchJump';

    // 当 Run + CrouchJump 组合时：
    // - Run 主导四肢（shoulder, elbow, wrist, hip, knee, ankle）
    // - CrouchJump 主导 mesh.y（整体高度）和 mesh.rx（前倾）
    if ((isPrimaryRun && isSecondaryJump) || (isPrimaryJump && isSecondaryRun)) {
      const runPose = isPrimaryRun ? primary : secondary;
      const jumpPose = isPrimaryJump ? primary : secondary;

      // 四肢：Run 主导
      const limbJoints = [
        'rightShoulder', 'rightElbow', 'rightElbowTwist', 'rightWrist',
        'leftShoulder', 'leftElbow', 'leftElbowTwist', 'leftWrist',
        'rightHip', 'rightKnee', 'rightAnkle',
        'leftHip', 'leftKnee', 'leftAnkle',
      ];
      for (const joint of limbJoints) {
        if (runPose[joint]) {
          result[joint] = { ...runPose[joint] };
        }
      }

      // mesh：合并 — Run 的 rx/rz/ry，Jump 的 y（优先）
      if (!result.mesh) result.mesh = {};
      const runMesh = runPose.mesh || {};
      const jumpMesh = jumpPose.mesh || {};
      // Jump 的 y 优先（起跳高度）
      if (jumpMesh.y !== undefined) result.mesh.y = jumpMesh.y;
      // Run 的 rx（前倾）和 rz（侧倾）作为基础，Jump 的叠加
      if (runMesh.rx !== undefined && jumpMesh.rx !== undefined) {
        result.mesh.rx = runMesh.rx + jumpMesh.rx;
      } else if (jumpMesh.rx !== undefined) {
        result.mesh.rx = jumpMesh.rx;
      } else if (runMesh.rx !== undefined) {
        result.mesh.rx = runMesh.rx;
      }
      if (runMesh.rz !== undefined) result.mesh.rz = runMesh.rz;
      if (runMesh.ry !== undefined) result.mesh.ry = runMesh.ry;
      // x/z 位移：Run 优先（但通常 Run 动画不设 x/z）
      if (runMesh.x !== undefined) result.mesh.x = runMesh.x;
      if (runMesh.z !== undefined) result.mesh.z = runMesh.z;

      // 头部：Jump 主导（起跳时头部稳定）
      if (jumpPose.headGroup) {
        result.headGroup = { ...jumpPose.headGroup };
      }

      return result;
    }

    // 默认：primary 主导，secondary 只补充缺失的关节
    const bodyJoints = [
      'headGroup', 'rightClavicle', 'leftClavicle',
      'rightShoulder', 'rightElbow', 'rightElbowTwist', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftElbowTwist', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle',
      'mesh',
    ];
    for (const joint of bodyJoints) {
      if (!result[joint] && secondary[joint]) {
        result[joint] = { ...secondary[joint] };
      }
    }

    return result;
  }

  _blendFaceFeatures(a, b, t) {
    // Deep blend nested face feature objects
    const result = {};
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const av = a?.[key];
      const bv = b?.[key];
      if (av !== null && typeof av === 'object' && bv !== null && typeof bv === 'object') {
        result[key] = {};
        const nestedKeys = new Set([...Object.keys(av), ...Object.keys(bv)]);
        for (const nKey of nestedKeys) {
          const nav = av?.[nKey] ?? 0;
          const nbv = bv?.[nKey] ?? 0;
          if (typeof nav === 'boolean' || typeof nbv === 'boolean') {
            result[key][nKey] = t >= 0.5 ? (nbv ?? false) : (nav ?? false);
          } else {
            result[key][nKey] = nav + (nbv - nav) * t;
          }
        }
      } else if (typeof av === 'number' || typeof bv === 'number') {
        result[key] = (av ?? 0) + ((bv ?? 0) - (av ?? 0)) * t;
      } else {
        result[key] = t >= 0.5 ? bv : av;
      }
    }
    return result;
  }

  _applyPose(pose) {
    const c = this.character;
    const base = this._baselinePose;
    if (!base) return;

    const apply = (jointName, targetObj, baseline, offset) => {
      if (!targetObj || !baseline) return;
      if (offset.rx !== undefined) targetObj.rotation.x = baseline.rx + offset.rx;
      if (offset.ry !== undefined) targetObj.rotation.y = baseline.ry + offset.ry;
      if (offset.rz !== undefined) targetObj.rotation.z = baseline.rz + offset.rz;
    };

    apply('headGroup', c.headGroup, base.headGroup, pose.headGroup || {});
    apply('rightClavicle', c.rightClavicle, base.rightClavicle, pose.rightClavicle || {});
    apply('leftClavicle', c.leftClavicle, base.leftClavicle, pose.leftClavicle || {});
    apply('rightShoulder', c.rightArm, base.rightShoulder, pose.rightShoulder || {});
    apply('rightElbow', c.rightElbow, base.rightElbow, pose.rightElbow || {});
    apply('rightElbowTwist', c.rightElbowTwist, base.rightElbowTwist, pose.rightElbowTwist || {});
    apply('rightWrist', c.rightWrist, base.rightWrist, pose.rightWrist || {});
    apply('leftShoulder', c.leftArm, base.leftShoulder, pose.leftShoulder || {});
    apply('leftElbow', c.leftElbow, base.leftElbow, pose.leftElbow || {});
    apply('leftElbowTwist', c.leftElbowTwist, base.leftElbowTwist, pose.leftElbowTwist || {});
    apply('leftWrist', c.leftWrist, base.leftWrist, pose.leftWrist || {});
    apply('rightHip', c.rightLeg, base.rightHip, pose.rightHip || {});
    apply('rightKnee', c.rightKnee, base.rightKnee, pose.rightKnee || {});
    apply('rightAnkle', c.rightAnkle, base.rightAnkle, pose.rightAnkle || {});
    apply('leftHip', c.leftLeg, base.leftHip, pose.leftHip || {});
    apply('leftKnee', c.leftKnee, base.leftKnee, pose.leftKnee || {});
    apply('leftAnkle', c.leftAnkle, base.leftAnkle, pose.leftAnkle || {});

    if (pose.mesh && c.mesh && base.mesh) {
      const m = pose.mesh;
      if (m.x !== undefined) c.mesh.position.x = base.mesh.x + m.x;
      if (m.y !== undefined) {
        let targetY = base.mesh.y + m.y;
        // Floor clamp: allow crouching (m.y < 0) but never let feet go below ground
        // For jumping actions (m.y > 0), allow going up freely
        // For crouching, allow up to 0.5 units below baseY (deep crouch)
        const floorY = (c.baseY !== undefined ? c.baseY : 0.12) - 0.5;
        if (targetY < floorY) {
          targetY = floorY;
        }
        c.mesh.position.y = targetY;
      }
      if (m.z !== undefined) c.mesh.position.z = base.mesh.z + m.z;
      if (m.rx !== undefined) c.mesh.rotation.x = base.mesh.rx + m.rx;
      if (m.ry !== undefined) c.mesh.rotation.y = base.mesh.ry + m.ry;
      if (m.rz !== undefined) c.mesh.rotation.z = base.mesh.rz + m.rz;
    }

    const faceBase = this._faceBaseState || {};

    // Set face tension for viseme mouth animation blending
    if (pose.mouth && pose.mouth.tension !== undefined) {
      c._faceTension = pose.mouth.tension;
    } else {
      c._faceTension = 0;
    }

    // ── 面部：通过 facialSystem 统一应用，或旧路径直接应用 ──
    if (c.facialSystem) {
      this._applyPoseToFacialSystem(pose, faceBase);
    } else {
      this._applyPoseToMeshDirect(pose, faceBase);
    }
  }

  /**
   * 通过 FacialAnimationSystem 统一应用面部姿态
   * 将几何 pose 转换为语义 emotion 参数
   */
  _applyPoseToFacialSystem(pose, faceBase) {
    const c = this.character;
    const fs = c.facialSystem;
    if (!fs) return;

    const emotion = { weight: 1 };

    // ── 嘴型 ──
    if (pose.mouth && c.mouth) {
      const m = pose.mouth;
      const baseM = faceBase.mouth || {};
      const scaleY = (baseM.sy || c.mouthBaseScaleY || 1) * (1 + (m.sy || 0));
      const scaleX = (baseM.sx || c.mouthBaseScaleX || 1) * (1 + (m.sx || 0));
      emotion.tension = m.tension || 0;
      emotion.lipOffset = (m.py || 0) * 10;
      emotion.lipWidth = (scaleX / (baseM.sx || 1)) - 1;
    }

    // ── 眉毛 ──
    if (pose.eyebrows) {
      const eb = pose.eyebrows;
      if (eb.left) {
        emotion.browLeft = (eb.left.py || 0) * 20;
        emotion.browInner = (eb.left.rz || 0) * 5;
      }
      if (eb.right) {
        emotion.browRight = (eb.right.py || 0) * 20;
      }
    }

    // ── 眼皮 ──
    if (pose.eyelids) {
      if (pose.eyelids.left && pose.eyelids.left.sy !== undefined) {
        emotion.eyelidClosed = Math.max(0, Math.min(1, pose.eyelids.left.sy * 2));
      }
      emotion.eyeSquint = (pose.eyelids.left?.sy || 0) * 0.5;
    }

    // ── 瞳孔 ──
    if (pose.pupils) {
      if (pose.pupils.left && pose.pupils.left.sx !== undefined) {
        emotion.pupilDilate = (pose.pupils.left.sx - 1) * 2;
      }
    }

    fs.setEmotion('matrix_pose', emotion);
  }

  /**
   * 旧路径：直接应用到 mesh（兼容无 facialSystem 的角色）
   */
  _applyPoseToMeshDirect(pose, faceBase) {
    const c = this.character;

    if (pose.mouth && c.mouth) {
      const m = pose.mouth;
      const baseM = faceBase.mouth || {};
      if (!c.isSpeaking) {
        if (m.sx !== undefined) c.mouth.scale.x = (baseM.sx || c.mouthBaseScaleX || 1) * (1 + m.sx);
        if (m.sy !== undefined) c.mouth.scale.y = (baseM.sy || c.mouthBaseScaleY || 1) * (1 + m.sy);
        if (m.sz !== undefined) c.mouth.scale.z = (baseM.sz || c.mouthBaseScaleZ || 1) * (1 + m.sz);
        if (m.px !== undefined) c.mouth.position.x = (baseM.x || c.mouthBasePosX || c.mouth.position.x) + m.px;
        if (m.py !== undefined) c.mouth.position.y = (baseM.y || c.mouthBasePosY || c.mouth.position.y) + m.py;
        if (m.pz !== undefined) c.mouth.position.z = (baseM.z || c.mouthBasePosZ || c.mouth.position.z) + m.pz;
        if (m.rx !== undefined) c.mouth.rotation.x = (baseM.rx || c.mouthBaseRotX || c.mouth.rotation.x) + m.rx;
        if (m.ry !== undefined) c.mouth.rotation.y = (baseM.ry || c.mouthBaseRotY || c.mouth.rotation.y) + m.ry;
        if (m.rz !== undefined) c.mouth.rotation.z = (baseM.rz || c.mouthBaseRotZ || c.mouth.rotation.z) + m.rz;
      }
    }

    if (pose.eyebrows) {
      const eb = pose.eyebrows;
      if (c.leftEyebrow && eb.left) {
        const le = eb.left;
        const baseLE = faceBase.leftEyebrow || {};
        if (le.py !== undefined) c.leftEyebrow.position.y = (baseLE.y || c.leftEyebrowBaseY || c.leftEyebrow.position.y) + le.py;
        if (le.pz !== undefined) c.leftEyebrow.position.z = (baseLE.z || c.leftEyebrowBaseZ || c.leftEyebrow.position.z) + le.pz;
        if (le.rz !== undefined) c.leftEyebrow.rotation.z = (baseLE.rz || c.leftEyebrowBaseRZ || c.leftEyebrow.rotation.z) + le.rz;
      }
      if (c.rightEyebrow && eb.right) {
        const re = eb.right;
        const baseRE = faceBase.rightEyebrow || {};
        if (re.py !== undefined) c.rightEyebrow.position.y = (baseRE.y || c.rightEyebrowBaseY || c.rightEyebrow.position.y) + re.py;
        if (re.pz !== undefined) c.rightEyebrow.position.z = (baseRE.z || c.rightEyebrowBaseZ || c.rightEyebrow.position.z) + re.pz;
        if (re.rz !== undefined) c.rightEyebrow.rotation.z = (baseRE.rz || c.rightEyebrowBaseRZ || c.rightEyebrow.rotation.z) + re.rz;
      }
    }

    if (pose.eyelids) {
      if (c.leftEyelid && pose.eyelids.left) {
        const el = pose.eyelids.left;
        const baseEL = faceBase.leftEyelid || {};
        if (el.visible !== undefined) c.leftEyelid.visible = el.visible;
        if (el.sy !== undefined) c.leftEyelid.scale.y = (baseEL.sy || c.leftEyelidBaseSY || 1) * (1 + el.sy);
      }
      if (c.rightEyelid && pose.eyelids.right) {
        const er = pose.eyelids.right;
        const baseER = faceBase.rightEyelid || {};
        if (er.visible !== undefined) c.rightEyelid.visible = er.visible;
        if (er.sy !== undefined) c.rightEyelid.scale.y = (baseER.sy || c.rightEyelidBaseSY || 1) * (1 + er.sy);
      }
    }

    if (pose.pupils) {
      if (c.leftPupil && pose.pupils.left) {
        const pl = pose.pupils.left;
        const basePL = faceBase.leftPupil || {};
        if (pl.sx !== undefined) c.leftPupil.scale.x = (basePL.sx || c.leftPupilBaseSX || 1) * (1 + pl.sx);
        if (pl.sy !== undefined) c.leftPupil.scale.y = (basePL.sy || c.leftPupilBaseSY || 1) * (1 + pl.sy);
        if (pl.sz !== undefined) c.leftPupil.scale.z = (basePL.sz || c.leftPupilBaseSZ || 1) * (1 + pl.sz);
        if (pl.px !== undefined) c.leftPupil.position.x = (basePL.x || c.leftPupilBaseX || c.leftPupil.position.x) + pl.px;
        if (pl.py !== undefined) c.leftPupil.position.y = (basePL.y || c.leftPupilBaseY || c.leftPupil.position.y) + pl.py;
      }
      if (c.rightPupil && pose.pupils.right) {
        const pr = pose.pupils.right;
        const basePR = faceBase.rightPupil || {};
        if (pr.sx !== undefined) c.rightPupil.scale.x = (basePR.sx || c.rightPupilBaseSX || 1) * (1 + pr.sx);
        if (pr.sy !== undefined) c.rightPupil.scale.y = (basePR.sy || c.rightPupilBaseSY || 1) * (1 + pr.sy);
        if (pr.sz !== undefined) c.rightPupil.scale.z = (basePR.sz || c.rightPupilBaseSZ || 1) * (1 + pr.sz);
        if (pr.px !== undefined) c.rightPupil.position.x = (basePR.x || c.rightPupilBaseX || c.rightPupil.position.x) + pr.px;
        if (pr.py !== undefined) c.rightPupil.position.y = (basePR.y || c.rightPupilBaseY || c.rightPupil.position.y) + pr.py;
      }
    }
  }

  /**
   * 是否允许应用" alive "呼吸/微动 idle。
   * 机器人、载具、机械类角色不需要呼吸微动，否则会和 CharacterBase 的
   * _updateIdle 冲突，造成 2:11 处那种可见抖动。
   */
  _shouldApplyIdleMotion() {
    const c = this.character;
    if (c.disableIdleMotion) return false;
    const archetypes = c.archetypes || [];
    if (archetypes.includes('robot') || archetypes.includes('vehicle') || archetypes.includes('machine')) {
      return false;
    }
    return true;
  }

  _applyIdlePose(time, delta = 0.016) {
    const c = this.character;
    const base = this._baselinePose;
    if (!base) return;

    // Slower return to idle so the end of a gesture doesn't snap to zero instantly.
    const returnSpeed = 0.5 * delta;
    const idlePose = PoseMatrix.lerp(this._lastAppliedPose, PoseMatrix.zero(), returnSpeed);

    if (idlePose.mesh) {
      idlePose.mesh = { ...idlePose.mesh };
    } else {
      idlePose.mesh = {};
    }

    const allowMotion = this._shouldApplyIdleMotion();

    if (allowMotion) {
      // Subtle "alive" idle motion: breathing, weight shift, micro gestures.
      // Keep amplitudes small so it reads as natural fidgeting, not dancing.
      const t = time * 1.6;
      idlePose.headGroup = {
        rx: Math.sin(t * 0.5) * 0.012,
        ry: Math.sin(t * 0.35) * 0.018,
        rz: Math.sin(t * 0.28) * 0.008,
      };
      idlePose.rightClavicle = { rz: Math.sin(t * 0.6 + 0.3) * 0.015 };
      idlePose.leftClavicle = { rz: -Math.sin(t * 0.6 + 0.3) * 0.015 };
      // Keep arms slightly away from the torso in idle so they don't sink into the body.
      const isMonkey = this.character.archetypes && this.character.archetypes.includes('monkey');
      if (isMonkey) {
        // Monkey arms hang forward; a small forward/outward rotation keeps them off the belly.
        idlePose.rightShoulder = { rx: -0.22 + Math.sin(t * 0.6 + 0.3) * 0.04, ry: 0.12 };
        idlePose.leftShoulder = { rx: -0.22 + Math.sin(t * 0.6 + 0.3) * 0.04, ry: -0.12 };
      } else {
        idlePose.rightShoulder = { rz: -0.12 + Math.sin(t * 0.6 + 0.3) * 0.02 };
        idlePose.leftShoulder = { rz: 0.12 - Math.sin(t * 0.6 + 0.3) * 0.02 };
      }
      // Keep a slight natural bend in the elbows instead of forcing them straight.
      idlePose.rightElbow = { rx: -0.08 + Math.sin(t * 0.7 + 1.0) * 0.04, ry: 0, rz: 0 };
      idlePose.leftElbow = { rx: -0.08 + Math.sin(t * 0.7 + 2.5) * 0.04, ry: 0, rz: 0 };
      idlePose.rightWrist = { ry: Math.sin(t * 0.9 + 0.5) * 0.04, rz: Math.sin(t * 0.65 + 0.2) * 0.03 };
      idlePose.leftWrist = { ry: -Math.sin(t * 0.9 + 0.5) * 0.04, rz: -Math.sin(t * 0.65 + 0.2) * 0.03 };
      idlePose.rightHip = { rx: Math.sin(t * 0.55 + 0.4) * 0.02 };
      idlePose.leftHip = { rx: Math.sin(t * 0.55 + 0.4 + Math.PI) * 0.02 };
      idlePose.rightKnee = { rx: Math.abs(Math.sin(t * 0.55 + 0.4)) * 0.025 };
      idlePose.leftKnee = { rx: Math.abs(Math.sin(t * 0.55 + 0.4 + Math.PI)) * 0.025 };
    }

    // Reset facial features to base state (prevent mouth/eyebrow drift)
    idlePose.mouth = { sx: 0, sy: 0, sz: 0, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
    idlePose.eyebrows = {
      left: { py: 0, pz: 0, rz: 0 },
      right: { py: 0, pz: 0, rz: 0 },
    };
    idlePose.eyelids = {
      left: { visible: false, sy: 0 },
      right: { visible: false, sy: 0 },
    };

    this._applyPose(idlePose);
    // 应用关节约束（SceneBase.update 中会统一传入其他角色做角色间碰撞，这里做无其他角色时的兜底）
    if (this._constraintSystem) {
      this._constraintSystem.enforce(delta);
    }
    this._lastAppliedPose = idlePose.clone();
    this.currentPose = idlePose.clone();
  }

  getMatrixState() {
    return {
      phase: this.currentPhase,
      poseType: this.currentPoseType,
      action: this.currentAction,
      inTransition: this._inTransition,
      pose: this.currentPose,
    };
  }
}
