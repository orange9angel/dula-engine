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
  }

  captureBaseline() {
    const c = this.character;
    this._baselinePose = new PoseMatrix();

    const captureRot = (obj) => obj ? { rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z } : null;

    this._baselinePose.headGroup = captureRot(c.headGroup);
    this._baselinePose.rightShoulder = captureRot(c.rightArm);
    this._baselinePose.rightElbow = captureRot(c.rightElbow);
    this._baselinePose.rightWrist = captureRot(c.rightWrist);
    this._baselinePose.leftShoulder = captureRot(c.leftArm);
    this._baselinePose.leftElbow = captureRot(c.leftElbow);
    this._baselinePose.leftWrist = captureRot(c.leftWrist);
    this._baselinePose.rightHip = captureRot(c.rightLeg);
    this._baselinePose.rightKnee = captureRot(c.rightKnee);
    this._baselinePose.rightAnkle = captureRot(c.rightAnkle);
    this._baselinePose.leftHip = captureRot(c.leftLeg);
    this._baselinePose.leftKnee = captureRot(c.leftKnee);
    this._baselinePose.leftAnkle = captureRot(c.leftAnkle);

    if (c.mesh) {
      this._baselinePose.mesh = {
        x: c.mesh.position.x, y: c.mesh.position.y, z: c.mesh.position.z,
        rx: c.mesh.rotation.x, ry: c.mesh.rotation.y, rz: c.mesh.rotation.z,
      };
    }
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
    if (!this._baselinePose) this.captureBaseline();

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

    let targetPose = primary.getPoseMatrix(primary.progress);
    for (let i = 1; i < activeAnims.length; i++) {
      const secondary = activeAnims[i];
      const secondaryPose = secondary.getPoseMatrix(secondary.progress);
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
    apply(c.rightWrist, base.rightWrist, pose.rightWrist || {});
    apply(c.leftArm, base.leftShoulder, pose.leftShoulder || {});
    apply(c.leftElbow, base.leftElbow, pose.leftElbow || {});
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
      if (m.y !== undefined) c.mesh.position.y = base.mesh.y + m.y;
      if (m.z !== undefined) c.mesh.position.z = base.mesh.z + m.z;
      if (m.rx !== undefined) c.mesh.rotation.x = base.mesh.rx + m.rx;
      if (m.ry !== undefined) c.mesh.rotation.y = base.mesh.ry + m.ry;
      if (m.rz !== undefined) c.mesh.rotation.z = base.mesh.rz + m.rz;
    }

    if (pose.mouth && c.mouth) {
      const m = pose.mouth;
      if (m.sx !== undefined) c.mouth.scale.x = (c.mouthBaseScaleX || 1) * (1 + m.sx);
      if (m.sy !== undefined) c.mouth.scale.y = (c.mouthBaseScaleY || 1) * (1 + m.sy);
      if (m.sz !== undefined) c.mouth.scale.z = (c.mouthBaseScaleZ || 1) * (1 + m.sz);
    }
  }

  _applyIdlePose(time) {
    const c = this.character;
    const base = this._baselinePose;
    if (!base) return;

    const returnSpeed = 5 * 0.016;
    const idlePose = PoseMatrix.lerp(this._lastAppliedPose, PoseMatrix.zero(), returnSpeed);

    const breath = Math.sin(time * 2.5) * 0.015;
    const sway = Math.sin(time * 1.8) * 0.01;

    idlePose.mesh = { ...idlePose.mesh, y: breath };
    idlePose.headGroup = { ...idlePose.headGroup, rx: sway, ry: Math.sin(time * 1.2) * 0.008 };

    if (c.rightArm) {
      idlePose.rightShoulder = { ...idlePose.rightShoulder, rz: (c.rightArmBaseZ || 0) + Math.sin(time * 2.0) * 0.02 };
    }
    if (c.leftArm) {
      idlePose.leftShoulder = { ...idlePose.leftShoulder, rz: (c.leftArmBaseZ || 0) - Math.sin(time * 2.0) * 0.02 };
    }

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
