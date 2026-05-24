import * as THREE from 'three';

/**
 * Character archetype tags for animation compatibility.
 * Subclasses should set this to declare what kind of character they are.
 * @example
 *   this.archetypes = ['humanoid', 'fighter', 'athletic'];
 * @type {string[]}
 */

export class CharacterBase {
  constructor(name) {
    this.name = name;
    this.mesh = new THREE.Group();
    this.mesh.name = name;
    this.boundingRadius = 0.5; // Override in subclass for accurate sizing
    this.mouth = null;
    this.mouthBaseScaleX = 1;
    this.mouthBaseScaleY = 1;
    this.mouthBaseScaleZ = 1;
    this.headGroup = null;
    this.rightArm = null;
    this.leftArm = null;
    this.rightLeg = null;
    this.leftLeg = null;
    this.leftPupil = null;
    this.rightPupil = null;
    // ── Facial expression system ──
    // Eyebrows for expression animation (optional — not all characters have them)
    this.leftEyebrow = null;
    this.rightEyebrow = null;
    // Eyelids for blink / squint animation (optional)
    this.leftEyelid = null;
    this.rightEyelid = null;
    // Jaw for mouth opening animation (optional — some characters use mouth scale instead)
    this.jaw = null;
    // ── Visual effects system ──
    // Generic effect groups that animations can spawn/modify
    this.effectGroups = {};     // named effect groups: { hitSpark, aura, shockwave, ... }
    this.particleEmitters = {}; // particle systems for trail / burst effects
    this.baseY = 0;
    this.isSpeaking = false;
    this.speakStartTime = 0;
    this.speakEndTime = 0;
    this.animations = []; // queued animations
    this.moves = [];      // queued position moves
    this.teleportEvents = []; // instantaneous position resets
    // ── Animation blending system ──
    this._poseSnapshot = null;      // snapshot before animation starts
    this._lastAnimEndPose = null;   // pose at end of last animation
    this._blendDuration = 0.12;     // seconds to blend between animations
    this._lastBodyAnimId = null;    // track which body animation is running
    this._blendStartTime = 0;       // when current blend started
    this._idleAnim = null;          // current idle animation instance
    this._idleStartTime = 0;
    this.eyeTracking = {
      active: false,
      target: new THREE.Vector3(),
      startTime: 0,
      endTime: 0,
    };
    /**
     * Archetype tags describing this character's body type and capabilities.
     * Used by animations to check compatibility.
     * Override in subclass to declare specific archetypes.
     * Common values: 'humanoid', 'fighter', 'athletic', 'round', 'tiny',
     *                'monster', 'quadruped', 'floating', 'slow', 'agile'
     */
    this.archetypes = ['humanoid'];
    this.build();
  }

  speak(startTime, duration) {
    this.isSpeaking = true;
    this.speakStartTime = startTime;
    this.speakEndTime = startTime + duration;
  }

  stopSpeaking() {
    this.isSpeaking = false;
    if (this.mouth) {
      this.mouth.scale.set(this.mouthBaseScaleX, this.mouthBaseScaleY, this.mouthBaseScaleZ);
    }
    if (this.headGroup && !this.eyeTracking.active) {
      this.headGroup.rotation.set(0, 0, 0);
    }
  }

  lookAtTarget(targetPos, startTime, endTime) {
    this.eyeTracking.active = true;
    this.eyeTracking.target.copy(targetPos);
    this.eyeTracking.startTime = startTime;
    this.eyeTracking.endTime = endTime;
  }

  clearLookAtTarget() {
    this.eyeTracking.active = false;
    if (this.headGroup) {
      this.headGroup.rotation.set(0, 0, 0);
    }
  }

  updateEyeTracking(time) {
    if (!this.eyeTracking.active || !this.headGroup) return;
    if (time < this.eyeTracking.startTime || time > this.eyeTracking.endTime) {
      if (!this.isSpeaking) {
        this.headGroup.rotation.x = 0;
        this.headGroup.rotation.y = 0;
      }
      return;
    }

    const headWorldPos = new THREE.Vector3();
    this.headGroup.getWorldPosition(headWorldPos);
    const target = this.eyeTracking.target;

    const dx = target.x - headWorldPos.x;
    const dy = target.y - headWorldPos.y;
    const dz = target.z - headWorldPos.z;

    const distXZ = Math.sqrt(dx * dx + dz * dz);
    let yaw = Math.atan2(dx, dz) - this.mesh.rotation.y;
    let pitch = -Math.atan2(dy, distXZ);

    // Normalize yaw to [-PI, PI]
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;

    // Clamp for natural neck limits
    const maxYaw = 0.8;
    const maxPitch = 0.5;
    this.headGroup.rotation.y = Math.max(-maxYaw, Math.min(maxYaw, yaw));
    this.headGroup.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, pitch));

    // Optional: subtle pupil shift for extra liveliness
    if (this.leftPupil && this.rightPupil) {
      const pupilShift = Math.max(-0.02, Math.min(0.02, yaw * 0.03));
      this.leftPupil.position.x = (this.leftPupil.userData.baseX || this.leftPupil.position.x) + pupilShift;
      this.rightPupil.position.x = (this.rightPupil.userData.baseX || this.rightPupil.position.x) + pupilShift;
    }
  }

  playAnimation(AnimClass, startTime, duration) {
    const anim = new AnimClass();
    this.animations.push({
      instance: anim,
      startTime,
      endTime: startTime + (duration !== undefined ? duration : anim.duration),
    });
  }

  moveTo(targetPos, startTime, duration) {
    this.moves.push({
      targetPos,
      startPos: undefined,
      startTime,
      endTime: startTime + duration,
    });
  }

  teleport(pos, time) {
    this.teleportEvents.push({ pos, time });
  }

  clearAnimations() {
    this.animations = [];
    this.moves = [];
    this.teleportEvents = [];
  }

  update(time, delta) {
    // Speaking
    if (this.isSpeaking) {
      if (time >= this.speakEndTime) {
        this.stopSpeaking();
      } else {
        this.animateMouth(time, delta);
        this.animateBody(time, delta);
      }
    }

    // Eye / head tracking
    this.updateEyeTracking(time);

    // ── Animation blending system (v2) ──
    // Categorize active animations by priority
    const bodyAnims = [];
    const faceAnims = [];
    const fxAnims = [];
    for (const anim of this.animations) {
      if (time >= anim.startTime && time <= anim.endTime) {
        const progress = (time - anim.startTime) / (anim.endTime - anim.startTime);
        const name = anim.instance.name;
        const item = { anim, progress, elapsed: time - anim.startTime, name };
        if (name.startsWith('FX')) {
          fxAnims.push(item);
        } else if (name.startsWith('Face')) {
          faceAnims.push(item);
        } else {
          bodyAnims.push(item);
        }
      }
    }

    // Sort each group by start time (most recent first)
    bodyAnims.sort((a, b) => b.anim.startTime - a.anim.startTime);
    faceAnims.sort((a, b) => b.anim.startTime - a.anim.startTime);

    const hasBody = bodyAnims.length > 0;
    const hasFace = faceAnims.length > 0;
    const hasFX = fxAnims.length > 0;

    if (hasBody || hasFace || hasFX) {
      // ── BODY ANIMATION ──
      if (hasBody) {
        const primary = bodyAnims[0];

        // Detect animation change: if most recent anim is different from last frame
        const currentAnimId = primary.anim.startTime;
        if (this._lastBodyAnimId !== currentAnimId) {
          // Animation changed! Snapshot current pose as blend source
          this._poseSnapshot = this._snapshotPose();
          this._blendStartTime = primary.anim.startTime;
          this._lastBodyAnimId = currentAnimId;
        }

        // Compute blend factor
        const blendElapsed = time - (this._blendStartTime || primary.anim.startTime);
        const blendFactor = Math.min(1, blendElapsed / this._blendDuration);

        // Save current mesh state
        const preAnimPose = this._snapshotPose();

        // Run the body animation (modifies mesh directly)
        primary.anim.instance.update(primary.progress, this);

        // Capture what the animation wants
        const animPose = this._snapshotPose();

        // Blend from snapshot to animation output
        if (blendFactor < 1 && this._poseSnapshot) {
          this._blendPoses(this._poseSnapshot, animPose, blendFactor);
        }

        // Store final pose for next frame's idle blend
        this._lastAnimEndPose = this._snapshotPose();
      }

      // ── FACIAL EXPRESSION ──
      if (hasFace) {
        const face = faceAnims[0];
        face.anim.instance.update(face.progress, this);
      }

      // ── FX EFFECTS (all run in parallel) ──
      for (const fx of fxAnims) {
        fx.anim.instance.update(fx.progress, this);
      }
    } else {
      // No active animation — blend from last pose to idle
      this._lastBodyAnimId = null;
      this._poseSnapshot = null;
      this._updateIdle(time);
    }

    // Position moves
    for (const move of this.moves) {
      if (time >= move.startTime && time < move.endTime) {
        if (move.startPos === undefined) {
          move.startPos = {
            x: this.mesh.position.x,
            y: this.mesh.position.y,
            z: this.mesh.position.z,
          };
        }
        const progress = (time - move.startTime) / (move.endTime - move.startTime);
        const t = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress; // easeInOutQuad
        const startX = move.startPos.x;
        const startZ = move.startPos.z;
        this.mesh.position.x = startX + (move.targetPos.x - startX) * t;
        this.mesh.position.z = startZ + (move.targetPos.z - startZ) * t;
        if (move.targetPos.y !== undefined) {
          const startY = move.startPos.y;
          this.mesh.position.y = startY + (move.targetPos.y - startY) * t;
          this.baseY = this.mesh.position.y;
        }
        // face movement direction (only if horizontal movement is significant)
        const dx = move.targetPos.x - this.mesh.position.x;
        const dz = move.targetPos.z - this.mesh.position.z;
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          this.mesh.lookAt(this.mesh.position.x + dx, this.mesh.position.y, this.mesh.position.z + dz);
        }
      } else if (time >= move.endTime && !move.completed) {
        // Ensure character reaches target position even if update jumps past endTime
        this.mesh.position.x = move.targetPos.x;
        this.mesh.position.z = move.targetPos.z;
        if (move.targetPos.y !== undefined) {
          this.mesh.position.y = move.targetPos.y;
          this.baseY = move.targetPos.y;
        }
        // Reset pitch rotation after movement (keep only yaw from facing direction)
        this.mesh.rotation.x = 0;
        this.mesh.rotation.z = 0;
        move.completed = true;
      }
    }

    // Teleport events (applied after moves so they take precedence)
    for (const tp of this.teleportEvents) {
      if (time >= tp.time && time < tp.time + 0.05) {
        this.mesh.position.x = tp.pos.x;
        this.mesh.position.z = tp.pos.z;
      }
    }

    // Ensure character mesh stays upright (prevent lookAt from flipping)
    if (this.mesh && Math.abs(this.mesh.rotation.x) > 0.01) {
      this.mesh.rotation.x = 0;
    }
    if (this.mesh && Math.abs(this.mesh.rotation.z) > 0.01) {
      this.mesh.rotation.z = 0;
    }
  }

  animateMouth(time, delta) {
    if (!this.mouth) return;
    this.mouth.visible = true;
    const speed = 12;
    const factor = Math.abs(Math.sin(time * speed));

    // Detect mouth geometry type by checking constructor name
    const geoType = this.mouth.geometry?.type || 'Unknown';

    if (geoType === 'ConeGeometry') {
      // ConeGeometry (jaw): use rotation to simulate opening/closing
      // Closed: rotation.x = Math.PI (inverted, pointing up)
      // Open: rotate slightly to drop the jaw down
      const baseRot = this.mouthBaseRotationX !== undefined ? this.mouthBaseRotationX : Math.PI;
      const jawOpen = 0.3 * factor; // max 0.3 rad (~17°) opening
      this.mouth.rotation.x = baseRot - jawOpen;
    } else if (geoType === 'SphereGeometry') {
      // SphereGeometry (ellipse mouth like Doraemon): scale Y more aggressively
      // since the base scale is small (e.g., 0.3), we need larger relative change
      // Y scale: base → base * 1.8 (open) for visible but not extreme animation
      const openness = this.mouthBaseScaleY * (1.0 + 0.8 * factor);
      this.mouth.scale.y = openness;
      // Slight X shrink to maintain ellipse shape
      this.mouth.scale.x = this.mouthBaseScaleX * (1.0 - 0.2 * factor);
      this.mouth.scale.z = this.mouthBaseScaleZ;
      // Also move mouth down slightly when opening to simulate jaw drop
      if (this.mouthBaseY !== undefined) {
        this.mouth.position.y = this.mouthBaseY - 0.05 * factor;
      }
    } else {
      // TubeGeometry (smile curve) and others: use gentle Y scale
      // Y scale: 1.0 (closed) → 1.15 (open)
      const openness = this.mouthBaseScaleY * (1.0 + 0.15 * factor);
      this.mouth.scale.y = openness;
      // No x/z expansion — prevents lip from sliding off face
      this.mouth.scale.x = this.mouthBaseScaleX;
      this.mouth.scale.z = this.mouthBaseScaleZ;
    }
  }

  animateBody(time, delta) {
    if (!this.headGroup) return;
    // Gentle nodding and slight sway while speaking
    this.headGroup.rotation.x = Math.sin(time * 10) * 0.05;
    this.headGroup.rotation.y = Math.sin(time * 5) * 0.03;
  }

  setPosition(x, y, z) {
    this.mesh.position.set(x, y, z);
    this.baseY = y;
  }

  lookAt(target) {
    this.mesh.lookAt(target);
  }

  /**
   * Capture base positions/rotations/scales for all facial features
   * so that expression animations can modify them deterministically
   * and FaceReset can truly restore them.
   * Call this at the very end of build() after all facial features are created.
   */
  /**
   * Snapshot current pose of animatable body parts.
   */
  _snapshotPose() {
    const pose = {};
    if (this.headGroup) {
      pose.headGroup = { rotation: this.headGroup.rotation.clone() };
    }
    if (this.rightArm) {
      pose.rightArm = { rotation: this.rightArm.rotation.clone() };
    }
    if (this.leftArm) {
      pose.leftArm = { rotation: this.leftArm.rotation.clone() };
    }
    if (this.rightLeg) {
      pose.rightLeg = { rotation: this.rightLeg.rotation.clone() };
    }
    if (this.leftLeg) {
      pose.leftLeg = { rotation: this.leftLeg.rotation.clone() };
    }
    if (this.mesh) {
      pose.mesh = {
        position: this.mesh.position.clone(),
        rotation: this.mesh.rotation.clone(),
      };
    }
    return pose;
  }

  _clonePose(pose) {
    const cloned = {};
    for (const key of Object.keys(pose)) {
      cloned[key] = {};
      for (const prop of Object.keys(pose[key])) {
        if (pose[key][prop].clone) {
          cloned[key][prop] = pose[key][prop].clone();
        } else {
          cloned[key][prop] = pose[key][prop];
        }
      }
    }
    return cloned;
  }

  _applyPose(pose) {
    if (pose.headGroup && this.headGroup) {
      this.headGroup.rotation.copy(pose.headGroup.rotation);
    }
    if (pose.rightArm && this.rightArm) {
      this.rightArm.rotation.copy(pose.rightArm.rotation);
    }
    if (pose.leftArm && this.leftArm) {
      this.leftArm.rotation.copy(pose.leftArm.rotation);
    }
    if (pose.rightLeg && this.rightLeg) {
      this.rightLeg.rotation.copy(pose.rightLeg.rotation);
    }
    if (pose.leftLeg && this.leftLeg) {
      this.leftLeg.rotation.copy(pose.leftLeg.rotation);
    }
    if (pose.mesh && this.mesh) {
      this.mesh.position.copy(pose.mesh.position);
      this.mesh.rotation.copy(pose.mesh.rotation);
    }
  }

  _blendPoses(from, to, t) {
    // t=0 -> from, t=1 -> to
    const lerp = (a, b, f) => a + (b - a) * f;
    const blendObj = (objFrom, objTo, objTarget, f) => {
      if (!objFrom || !objTo || !objTarget) return;
      for (const key of ['x', 'y', 'z']) {
        if (objFrom[key] !== undefined && objTo[key] !== undefined) {
          objTarget[key] = lerp(objFrom[key], objTo[key], f);
        }
      }
    };

    if (from.headGroup && to.headGroup && this.headGroup) {
      blendObj(from.headGroup.rotation, to.headGroup.rotation, this.headGroup.rotation, t);
    }
    if (from.rightArm && to.rightArm && this.rightArm) {
      blendObj(from.rightArm.rotation, to.rightArm.rotation, this.rightArm.rotation, t);
    }
    if (from.leftArm && to.leftArm && this.leftArm) {
      blendObj(from.leftArm.rotation, to.leftArm.rotation, this.leftArm.rotation, t);
    }
    if (from.rightLeg && to.rightLeg && this.rightLeg) {
      blendObj(from.rightLeg.rotation, to.rightLeg.rotation, this.rightLeg.rotation, t);
    }
    if (from.leftLeg && to.leftLeg && this.leftLeg) {
      blendObj(from.leftLeg.rotation, to.leftLeg.rotation, this.leftLeg.rotation, t);
    }
    if (from.mesh && to.mesh && this.mesh) {
      blendObj(from.mesh.position, to.mesh.position, this.mesh.position, t);
      blendObj(from.mesh.rotation, to.mesh.rotation, this.mesh.rotation, t);
    }
  }

  _updateIdle(time) {
    // Subtle breathing sway when no animation is active
    if (!this._idleStartTime) this._idleStartTime = time;
    const idleT = time - this._idleStartTime;
    const breath = Math.sin(idleT * 2.5) * 0.015;
    if (this.mesh) {
      this.mesh.position.y = this.baseY + breath;
    }
    if (this.headGroup) {
      this.headGroup.rotation.x = Math.sin(idleT * 1.8) * 0.01;
      this.headGroup.rotation.y = Math.sin(idleT * 1.2) * 0.008;
    }
    if (this.rightArm) {
      this.rightArm.rotation.z = (this.rightArmBaseZ || 0) + Math.sin(idleT * 2.0) * 0.02;
    }
    if (this.leftArm) {
      this.leftArm.rotation.z = (this.leftArmBaseZ || 0) - Math.sin(idleT * 2.0) * 0.02;
    }
  }

  _captureFaceBaseState() {
    const state = {};

    if (this.leftEyebrow) {
      state.leftEyebrow = {
        position: this.leftEyebrow.position.clone(),
        rotation: this.leftEyebrow.rotation.clone(),
      };
    }
    if (this.rightEyebrow) {
      state.rightEyebrow = {
        position: this.rightEyebrow.position.clone(),
        rotation: this.rightEyebrow.rotation.clone(),
      };
    }
    if (this.leftEyelid) {
      state.leftEyelid = {
        scale: this.leftEyelid.scale.clone(),
        position: this.leftEyelid.position.clone(),
      };
    }
    if (this.rightEyelid) {
      state.rightEyelid = {
        scale: this.rightEyelid.scale.clone(),
        position: this.rightEyelid.position.clone(),
      };
    }
    if (this.mouth) {
      state.mouth = {
        scale: this.mouth.scale.clone(),
        position: this.mouth.position.clone(),
        rotation: this.mouth.rotation.clone(),
      };
    }
    if (this.headGroup) {
      state.headGroup = {
        rotation: this.headGroup.rotation.clone(),
      };
    }

    this._faceBaseState = state;
  }
}
