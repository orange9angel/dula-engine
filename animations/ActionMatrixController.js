import { PoseMatrix, getPoseType, getDefaultPhase, ActionPhase, PoseType } from './PoseMatrix.js';

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
  }

  captureBaseline() {
    const c = this.character;
    this._baselinePose = new PoseMatrix();

    const captureRot = (obj) => obj ? { rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z } : null;

    this._baselinePose.headGroup = captureRot(c.headGroup);
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
      this._applyIdlePose(time);
      this.currentPhase = ActionPhase.NEUTRAL;
      this.currentPoseType = PoseType.IDLE;
      this.currentAction = null;
      return;
    }

    activeAnims.sort((a, b) => b.startTime - a.startTime);
    const primary = activeAnims[0];

    if (this.currentAction !== primary.name) {
      this._startTransition(this.currentPose, PoseMatrix.zero(), primary.startTime);
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
      targetPose = this._mergePoses(targetPose, secondaryPose);
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
    this._lastAppliedPose = finalPose.clone();
  }

  _startTransition(fromPose, toPose, startTime) {
    this._transitionFrom = fromPose.clone();
    this._transitionTo = toPose.clone();
    this._transitionStartTime = startTime;
    this._inTransition = true;
  }

  _mergePoses(primary, secondary) {
    const result = primary.clone();
    const joints = ['mouth', 'eyebrows', 'eyelids'];
    for (const joint of joints) {
      if (secondary[joint] && !primary[joint]) {
        result[joint] = { ...secondary[joint] };
      }
    }
    return result;
  }

  _applyPose(pose) {
    const c = this.character;
    const base = this._baselinePose;
    if (!base) return;

    const apply = (targetObj, baseline, offset) => {
      if (!targetObj || !baseline) return;
      if (offset.rx !== undefined) targetObj.rotation.x = baseline.rx + offset.rx;
      if (offset.ry !== undefined) targetObj.rotation.y = baseline.ry + offset.ry;
      if (offset.rz !== undefined) targetObj.rotation.z = baseline.rz + offset.rz;
    };

    apply(c.headGroup, base.headGroup, pose.headGroup || {});
    apply(c.rightArm, base.rightShoulder, pose.rightShoulder || {});
    apply(c.rightElbow, base.rightElbow, pose.rightElbow || {});
    apply(c.rightElbowTwist, base.rightElbowTwist, pose.rightElbowTwist || {});
    apply(c.rightWrist, base.rightWrist, pose.rightWrist || {});
    apply(c.leftArm, base.leftShoulder, pose.leftShoulder || {});
    apply(c.leftElbow, base.leftElbow, pose.leftElbow || {});
    apply(c.leftElbowTwist, base.leftElbowTwist, pose.leftElbowTwist || {});
    apply(c.leftWrist, base.leftWrist, pose.leftWrist || {});
    apply(c.rightLeg, base.rightHip, pose.rightHip || {});
    apply(c.rightKnee, base.rightKnee, pose.rightKnee || {});
    apply(c.rightAnkle, base.rightAnkle, pose.rightAnkle || {});
    apply(c.leftLeg, base.leftHip, pose.leftHip || {});
    apply(c.leftKnee, base.leftKnee, pose.leftKnee || {});
    apply(c.leftAnkle, base.leftAnkle, pose.leftAnkle || {});

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

    if (pose.mouth && c.mouth) {
      const m = pose.mouth;
      const baseM = faceBase.mouth || {};
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

  _applyIdlePose(time) {
    const c = this.character;
    const base = this._baselinePose;
    if (!base) return;

    const returnSpeed = 2 * 0.016;  // 更慢的过渡，保持动画结束姿势更久
    const idlePose = PoseMatrix.lerp(this._lastAppliedPose, PoseMatrix.zero(), returnSpeed);

    // Idle pose transition (silent)

    // Static idle — no breathing, no head sway
    // Character holds last pose perfectly still
    // Preserve mesh Y offset (don't force to 0, let it return to base naturally)
    if (idlePose.mesh) {
      idlePose.mesh = { ...idlePose.mesh };
    } else {
      idlePose.mesh = {};
    }
    idlePose.headGroup = { rx: 0, ry: 0, rz: 0 };
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
