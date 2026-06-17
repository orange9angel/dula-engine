import * as THREE from 'three';
import { ActionMatrixController } from '../animations/ActionMatrixController.js';
import { RigAdapter } from '../rigging/RigAdapter.js';
import { applyMouthCueToShape, sampleMouthCue } from '../lib/AudioMouthCue.js';

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
    this.userData = this.mesh.userData;
    this.boundingRadius = 0.5; // Override in subclass for accurate sizing
    this.mouth = null;
    this.mouthBaseScaleX = 1;
    this.mouthBaseScaleY = 1;
    this.mouthBaseScaleZ = 1;
    this.headGroup = null;
    this.rightClavicle = null; // 右锁骨/肩胛骨Group（控制手臂前后摆动）
    this.leftClavicle = null;  // 左锁骨/肩胛骨Group
    this.rightArm = null;      // 右肩/上臂根Group
    this.leftArm = null;       // 左肩/上臂根Group
    this.rightLeg = null;      // 右髋/大腿根Group
    this.leftLeg = null;       // 左髋/大腿根Group
    // ── 15点关节控制（v3 动作矩阵系统）──
    // 手臂：锁骨 → 肩 → 肘 → 腕 → 手
    this.rightElbow = null;    // 右肘关节Group（rightArm的子级）
    this.rightElbowTwist = null; // 右肘扭转Group（rightElbow的子级，控制ry）
    this.rightWrist = null;    // 右手腕关节Group（rightElbowTwist的子级）
    this.leftElbow = null;     // 左肘关节Group
    this.leftElbowTwist = null; // 左肘扭转Group（leftElbow的子级，控制ry）
    this.leftWrist = null;     // 左手腕关节Group（leftElbowTwist的子级）
    // 腿部：髋 → 膝 → 踝 → 脚
    this.rightKnee = null;     // 右膝关节Group（rightLeg的子级）
    this.rightAnkle = null;    // 右脚踝关节Group（rightKnee的子级）
    this.leftKnee = null;      // 左膝关节Group
    this.leftAnkle = null;     // 左脚踝关节Group
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
    // Reusable light effect components (GlowEffect, AuraEffect, etc.)
    this.lightEffects = {};     // { name: effectInstance }
    this.baseY = 0.12;
    this.isSpeaking = false;
    this.speakStartTime = 0;
    this.speakEndTime = 0;
    this.speakText = '';
    this.visemeSequence = [];
    // -- Auto blink system --
    this.blinkTimer = Math.random() * 3 + 2; // 2~5s first blink
    this.blinkState = 'open'; // open, closing, closed, opening
    this.blinkProgress = 0;
    this.blinkDuration = 0.2;
    this.animations = []; // queued animations
    this.moves = [];      // queued position moves
    this.teleportEvents = []; // instantaneous position resets
    this.allowedBodyAnimations = null; // optional per-character body action allowlist
    this._blockedAnimationWarnings = new Set();
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
    // ── Joint Marker System ──
    // 可视化关节点标记，用于调试和动作演示
    this.jointMarkers = {};     // { jointName: THREE.Mesh marker }
    this.jointMarkersVisible = false;

    // ── Action Matrix Controller ──
    // 运行时动作矩阵系统：动画通过矩阵描述姿势，由控制器统一应用
    // 延迟初始化：在首次播放矩阵动画时创建，避免无矩阵动画的角色浪费资源
    this._actionMatrix = null;
    /**
     * Archetype tags describing this character's body type and capabilities.
     * Used by animations to check compatibility.
     * Override in subclass to declare specific archetypes.
     * Common values: 'humanoid', 'fighter', 'athletic', 'round', 'tiny',
     *                'monster', 'quadruped', 'floating', 'slow', 'agile'
     */
    this.archetypes = ['humanoid'];
    this.build();
    // 自动适配关节层级（为旧角色创建 elbow/wrist/knee/ankle）
    RigAdapter.adapt(this);
  }

  speak(startTime, duration, text = '', mouthCue = null) {
    this.isSpeaking = true;
    this.speakStartTime = startTime;
    this.speakEndTime = startTime + duration;
    this.speakText = text;
    this.mouthCue = mouthCue;
    // Generate viseme sequence from text
    if (text && typeof window !== 'undefined' && window.VisemeMapper) {
      this.visemeSequence = window.VisemeMapper.generateVisemeSequence(text, startTime, duration);
    } else {
      this.visemeSequence = [];
    }
  }

  stopSpeaking() {
    this.isSpeaking = false;
    this.speakText = '';
    this.visemeSequence = [];
    this.mouthCue = null;
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

  canPlayAnimationName(name) {
    if (!name) return true;
    if (name.startsWith('Face') || name.startsWith('FX')) return true;

    const allowed = this.allowedBodyAnimations;
    if (!allowed) return true;
    if (allowed instanceof Set) return allowed.has(name);
    if (Array.isArray(allowed)) return allowed.includes(name);
    return true;
  }

  canPlayAnimation(animation) {
    const name = typeof animation === 'string' ? animation : animation?.name;
    return this.canPlayAnimationName(name);
  }

  _warnBlockedAnimation(name) {
    const key = `${this.name}:${name}`;
    if (this._blockedAnimationWarnings.has(key)) return;
    this._blockedAnimationWarnings.add(key);
    console.warn(`[CharacterBase] ${this.name} does not support body animation "${name}"; skipped.`);
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

  playAnimation(AnimClass, startTime, duration, options = {}) {
    const anim = new AnimClass(options);
    if (!this.canPlayAnimation(anim)) {
      this._warnBlockedAnimation(anim.name);
      return null;
    }
    const endTime = startTime + (duration !== undefined ? duration : anim.duration);

    // 检测是否为矩阵动画（usePoseMatrix = true）
    if (anim.usePoseMatrix) {
      // 懒加载矩阵控制器
      if (!this._actionMatrix) {
        this._actionMatrix = new ActionMatrixController(this);
      }
      this._actionMatrix.registerAnimation({
        name: anim.name,
        poseType: anim.poseType || 'idle',
        phase: anim.phase || 'neutral',
        getPoseMatrix: (t, elapsed, activeDuration, time) => anim.getPoseMatrix(t, elapsed, activeDuration, time),
        startTime,
        endTime,
      });
    }

    // 同时加入旧动画队列（保持兼容）
    this.animations.push({
      instance: anim,
      startTime,
      endTime,
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
    if (this._actionMatrix) {
      this._actionMatrix.clearAnimations();
    }
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

    // Auto blink (runs even when not speaking)
    this._updateBlink(delta);

    // Eye / head tracking
    this.updateEyeTracking(time);

    // ── Action Matrix System (v3) ──
    // 优先使用矩阵控制器处理矩阵动画
    const hasMatrixAnims = this._actionMatrix && this._actionMatrix._matrixAnims.length > 0;
    const hasActiveMatrixAnims = hasMatrixAnims && this._actionMatrix._matrixAnims.some(
      a => time >= a.startTime && time <= a.endTime
    );


    // ── Animation blending system (v2) ──
    // Categorize active animations by priority
    const bodyAnims = [];
    const faceAnims = [];
    const fxAnims = [];
    const matrixAnimNames = new Set();
    for (const anim of this.animations) {
      if (time >= anim.startTime && time <= anim.endTime) {
        const progress = (time - anim.startTime) / (anim.endTime - anim.startTime);
        const name = anim.instance.name;
        const item = { anim, progress, elapsed: time - anim.startTime, name };
        // 矩阵动画由 ActionMatrixController 处理，旧动画仍走旧路径
        if (anim.instance.usePoseMatrix) {
          matrixAnimNames.add(name);
          continue;
        }
        if (name.startsWith('FX')) {
          fxAnims.push(item);
        } else if (name.startsWith('Face')) {
          faceAnims.push(item);
        } else {
          bodyAnims.push(item);
        }
      }
    }

    // 更新矩阵控制器：有动画时应用动画，无动画时执行 idle 恢复
    if (this._actionMatrix) {
      this._actionMatrix.update(time, delta);
    }

    // Sort each group by start time (most recent first)
    bodyAnims.sort((a, b) => b.anim.startTime - a.anim.startTime);
    faceAnims.sort((a, b) => b.anim.startTime - a.anim.startTime);

    const hasBody = bodyAnims.length > 0;
    const hasFace = faceAnims.length > 0;
    const hasFX = fxAnims.length > 0;

    if (hasBody || hasFace || hasFX) {
      // ── BODY ANIMATION (旧系统，仅处理非矩阵动画) ──
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

        const rootPositionBeforeBody = this.mesh ? this.mesh.position.clone() : null;

        // Run the body animation (modifies pose directly)
        primary.anim.instance.update(primary.progress, this);

        // Body animations are pose layers. Root X/Z travel is owned by moves,
        // combat contact solvers, and scene choreography so timeline traces stay coherent.
        if (rootPositionBeforeBody && this.mesh) {
          this.mesh.position.x = rootPositionBeforeBody.x;
          this.mesh.position.z = rootPositionBeforeBody.z;
        }

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
    } else if (!hasActiveMatrixAnims) {
      // No active animation — blend from last pose to idle
      this._lastBodyAnimId = null;
      this._poseSnapshot = null;
      this._updateIdle(time);
    }

    const matrixControlledMesh = hasActiveMatrixAnims ? this._actionMatrix?.currentPose?.mesh : null;
    const matrixControllingBodyRot = !!matrixControlledMesh &&
      (matrixControlledMesh.rx !== undefined || matrixControlledMesh.ry !== undefined || matrixControlledMesh.rz !== undefined);

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
          const preservedRot = matrixControllingBodyRot
            ? { x: this.mesh.rotation.x, y: this.mesh.rotation.y, z: this.mesh.rotation.z }
            : null;
          this.mesh.lookAt(this.mesh.position.x + dx, this.mesh.position.y, this.mesh.position.z + dz);
          if (preservedRot) {
            if (matrixControlledMesh.rx !== undefined) this.mesh.rotation.x = preservedRot.x;
            if (matrixControlledMesh.ry !== undefined) this.mesh.rotation.y = preservedRot.y;
            if (matrixControlledMesh.rz !== undefined) this.mesh.rotation.z = preservedRot.z;
          }
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
        if (!matrixControlledMesh || matrixControlledMesh.rx === undefined) {
          this.mesh.rotation.x = 0;
        }
        if (!matrixControlledMesh || matrixControlledMesh.rz === undefined) {
          this.mesh.rotation.z = 0;
        }
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
    // BUT: skip if matrix animation is controlling body rotation (rx/rz)
    if (!matrixControllingBodyRot) {
      if (this.mesh && Math.abs(this.mesh.rotation.x) > 0.01) {
        this.mesh.rotation.x = 0;
      }
      if (this.mesh && Math.abs(this.mesh.rotation.z) > 0.01) {
        this.mesh.rotation.z = 0;
      }
    }
  }

  getCurrentMouthShape(time) {
    let shape;
    if (this.visemeSequence.length > 0 && typeof window !== 'undefined' && window.VisemeMapper) {
      if (window.VisemeMapper.getMouthShapeFromSequence) {
        shape = window.VisemeMapper.getMouthShapeFromSequence(this.visemeSequence, time);
      } else {
        shape = window.VisemeMapper.getMouthShape(
          this.speakText,
          this.speakStartTime,
          this.speakEndTime - this.speakStartTime,
          time
        );
      }
    } else {
      // Fallback to sine wave when no viseme data
      const factor = Math.abs(Math.sin(time * 12));
      shape = { lipHeight: 0.4 + 0.2 * factor, lipWidth: 1.0, jawOpen: 0.2 * factor };
    }

    const cueSample = this.mouthCue ? sampleMouthCue(this.mouthCue, time - this.speakStartTime) : null;
    this._currentMouthShape = applyMouthCueToShape(shape, cueSample);
    return this._currentMouthShape;
  }

  animateMouth(time, delta) {
    if (!this.mouth) return;
    this.mouth.visible = true;

    const shape = this.getCurrentMouthShape(time);

    // Apply expression tension from active face animation
    const tension = this._faceTension || 0;
    const tensionScale = 1.0 - tension * 0.25;

    // Detect mouth geometry type — handle Mesh wrapper (Group children)
    let geoType = this.mouth.geometry?.type || 'Unknown';
    // If mouth is a Mesh wrapping another geometry (e.g. TubeGeometry inside a Group),
    // fall through to the default TubeGeometry path which is safest for smile curves
    if (geoType === 'Mesh') {
      geoType = 'TubeGeometry';
    }

    if (geoType === 'ConeGeometry') {
      const baseRot = this.mouthBaseRotationX !== undefined ? this.mouthBaseRotationX : Math.PI;
      const jawOpen = shape.jawOpen * tensionScale;
      // Cone mouths (Doraemon) point down when closed; opening swings the tip further down.
      this.mouth.rotation.x = baseRot + jawOpen;
    } else if (geoType === 'SphereGeometry') {
      // Legacy sphere mouth: map new lip params to old scale params
      const scaleY = 1.0 + shape.lipHeight * 0.8;
      const scaleX = shape.lipWidth;
      this.mouth.scale.y = this.mouthBaseScaleY * scaleY * tensionScale;
      this.mouth.scale.x = this.mouthBaseScaleX * scaleX;
      this.mouth.scale.z = this.mouthBaseScaleZ;
      if (this.mouthBaseY !== undefined) {
        const openFactor = (scaleY - 1.0) / 0.8;
        this.mouth.position.y = this.mouthBaseY - 0.05 * Math.max(0, openFactor);
      }
    } else if (geoType === 'Unknown' && this.mouth.type === 'Group') {
      // Jaw-pivot style mouth (Group with lower lip that rotates open)
      // + upper lip that scales for width variation
      const jawOpen = shape.jawOpen * tensionScale;
      // Use multiplicative scaling relative to base shape for more dramatic variation
      const lipWidth = shape.lipWidth;
      const lipHeight = shape.lipHeight * tensionScale;

      // Lower lip (jaw) rotation for opening
      const baseRot = this.mouthBaseRotationX !== undefined ? this.mouthBaseRotationX : 0;
      this.mouth.rotation.x = baseRot + jawOpen;

      // Scale lower lip width and height (multiplicative for dramatic effect)
      const lowerLip = this.mouth.children[0];
      if (lowerLip) {
        lowerLip.scale.x = lipWidth;
        lowerLip.scale.y = lipHeight;
      }

      // Scale upper lip width and height
      if (this.upperLip) {
        this.upperLip.scale.x = lipWidth;
        this.upperLip.scale.y = lipHeight * 0.85; // upper lip slightly thinner
      }

      // Scale mouth cavity width and height
      if (this.mouthCavity) {
        this.mouthCavity.scale.x = lipWidth * 0.9;
        const openFactor = 1.0 + jawOpen * 2.5;
        this.mouthCavity.scale.y = 0.6 * openFactor;
      }
    } else {
      // Default fallback
      const scaleY = 1.0 + shape.lipHeight * 0.8;
      const scaleX = shape.lipWidth;
      this.mouth.scale.y = this.mouthBaseScaleY * scaleY * tensionScale;
      this.mouth.scale.x = this.mouthBaseScaleX * scaleX;
      this.mouth.scale.z = this.mouthBaseScaleZ;
    }
  }

  animateBody(time, delta) {
    if (!this.headGroup) return;
    // Disabled — no head movement during speaking for clean motion demo
    // this.headGroup.rotation.x = Math.sin(time * 6) * 0.025;
  }

  /**
   * Auto blink system — runs independently of speaking state
   */
  _updateBlink(delta) {
    // Skip if manual FaceBlink animation is active
    const hasManualBlink = this.animations.some(a =>
      a.instance.name === 'FaceBlink' &&
      performance.now() / 1000 >= a.startTime &&
      performance.now() / 1000 <= a.endTime
    );
    if (hasManualBlink) {
      this.blinkTimer = Math.random() * 3 + 2;
      return;
    }

    this.blinkTimer -= delta;

    switch (this.blinkState) {
      case 'open':
        if (this.blinkTimer <= 0) {
          this.blinkState = 'closing';
          this.blinkProgress = 0;
        }
        break;
      case 'closing':
        this.blinkProgress += delta / (this.blinkDuration * 0.4);
        if (this.blinkProgress >= 1) {
          this.blinkState = 'opening';
          this.blinkProgress = 1;
        }
        this._applyBlink(this.blinkProgress);
        break;
      case 'opening':
        this.blinkProgress -= delta / (this.blinkDuration * 0.6);
        if (this.blinkProgress <= 0) {
          this.blinkState = 'open';
          this.blinkProgress = 0;
          this.blinkTimer = Math.random() * 4 + 2; // 2~6s next blink
        }
        this._applyBlink(this.blinkProgress);
        break;
    }
  }

  _applyBlink(factor) {
    // factor: 0=open, 1=closed
    if (this.leftEyelid) {
      this.leftEyelid.visible = true;
      this.leftEyelid.scale.y = 1 - factor * 0.95;
    }
    if (this.rightEyelid) {
      this.rightEyelid.visible = true;
      this.rightEyelid.scale.y = 1 - factor * 0.95;
    }
    // Subtle pupil shrink during blink
    if (this.leftPupil) {
      const pupilScale = 1 - factor * 0.3;
      this.leftPupil.scale.set(pupilScale, pupilScale, pupilScale);
    }
    if (this.rightPupil) {
      const pupilScale = 1 - factor * 0.3;
      this.rightPupil.scale.set(pupilScale, pupilScale, pupilScale);
    }
  }

  setPosition(x, y, z) {
    // Auto-apply foot offset so shoes sit on ground, not below it
    const groundOffset = 0.12;
    this.mesh.position.set(x, y + groundOffset, z);
    this.baseY = y + groundOffset;
  }

  lookAt(target) {
    this.mesh.lookAt(target);
  }

  /**
   * Add a reusable light effect component (GlowEffect, AuraEffect, etc.)
   * to this character. The effect will be automatically updated each frame.
   *
   * @param {string} name — unique identifier for this effect
   * @param {GlowEffect|AuraEffect} effect — effect instance
   * @param {THREE.Object3D} parent — parent object to attach the effect mesh/group to
   */
  addLightEffect(name, effect, parent = null) {
    this.lightEffects[name] = effect;
    if (parent && effect.mesh) {
      parent.add(effect.mesh);
    } else if (parent && effect.group) {
      parent.add(effect.group);
    }
  }

  /**
   * Get a light effect by name.
   */
  getLightEffect(name) {
    return this.lightEffects[name];
  }

  /**
   * Remove and dispose a light effect.
   */
  removeLightEffect(name) {
    const effect = this.lightEffects[name];
    if (effect) {
      if (effect.dispose) effect.dispose();
      delete this.lightEffects[name];
    }
  }

  /**
   * Update all light effects. Call this in subclass update() or let Storyboard call it.
   */
  updateLightEffects(time, delta) {
    for (const effect of Object.values(this.lightEffects)) {
      if (effect.update) effect.update(time, delta);
    }
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
    const blendObj = (objFrom, objTo, objTarget, f, axes = ['x', 'y', 'z']) => {
      if (!objFrom || !objTo || !objTarget) return;
      for (const key of axes) {
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
      blendObj(from.mesh.position, to.mesh.position, this.mesh.position, t, ['y']);
      blendObj(from.mesh.rotation, to.mesh.rotation, this.mesh.rotation, t, ['x', 'z']);
    }
  }

  _updateIdle(time) {
    // Static idle — no breathing sway, no head movement
    // Keeps character perfectly still when no animation is active
    if (this.mesh) {
      this.mesh.position.y = this.baseY;
    }
    if (this.headGroup) {
      this.headGroup.rotation.set(0, 0, 0);
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
        sx: this.mouth.scale.x,
        sy: this.mouth.scale.y,
        sz: this.mouth.scale.z,
        x: this.mouth.position.x,
        y: this.mouth.position.y,
        z: this.mouth.position.z,
        rx: this.mouth.rotation.x,
        ry: this.mouth.rotation.y,
        rz: this.mouth.rotation.z,
      };
    }
    if (this.headGroup) {
      state.headGroup = {
        rotation: this.headGroup.rotation.clone(),
      };
    }

    this._faceBaseState = state;
  }

  /**
   * Create visual joint markers for debugging and motion demonstration.
   * Supported joints: head, rightShoulder, rightElbow, rightWrist,
   *   leftShoulder, leftElbow, leftWrist, rightHip, rightKnee, rightAnkle,
   *   leftHip, leftKnee, leftAnkle, root
   * @param {Object} options
   * @param {number} [options.size=0.025] — marker sphere radius
   * @param {number} [options.opacity=0.85] — marker opacity
   */
  createJointMarkers(options = {}) {
    const size = options.size ?? 0.025;
    const opacity = options.opacity ?? 0.85;

    // Remove existing markers
    this.removeJointMarkers();

    const markerMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity,
      depthTest: false,
    });

    const jointDefs = [
      { name: 'head', target: this.headGroup, color: 0xff5555 },
      { name: 'rightShoulder', target: this.rightArm, color: 0x5588ff },
      { name: 'rightElbow', target: this.rightElbow, color: 0x66aaff },
      { name: 'rightWrist', target: this.rightWrist, color: 0x88ccff },
      { name: 'leftShoulder', target: this.leftArm, color: 0xff5555 },
      { name: 'leftElbow', target: this.leftElbow, color: 0xff6666 },
      { name: 'leftWrist', target: this.leftWrist, color: 0xff8888 },
      { name: 'rightHip', target: this.rightLeg, color: 0x55ff55 },
      { name: 'rightKnee', target: this.rightKnee, color: 0x66ff66 },
      { name: 'rightAnkle', target: this.rightAnkle, color: 0x88ff88 },
      { name: 'leftHip', target: this.leftLeg, color: 0xaa55ff },
      { name: 'leftKnee', target: this.leftKnee, color: 0xbb66ff },
      { name: 'leftAnkle', target: this.leftAnkle, color: 0xcc88ff },
      { name: 'root', target: this.mesh, color: 0xffff00, offsetY: 1.6 },
    ];

    for (const def of jointDefs) {
      if (!def.target) continue;
      const mat = markerMat.clone();
      mat.color.setHex(def.color);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), mat);
      marker.renderOrder = 999;
      if (def.offsetY) marker.position.y = def.offsetY;
      def.target.add(marker);
      this.jointMarkers[def.name] = marker;
    }

    this.jointMarkersVisible = true;
  }

  removeJointMarkers() {
    for (const [name, marker] of Object.entries(this.jointMarkers)) {
      if (marker.parent) marker.parent.remove(marker);
      if (marker.geometry) marker.geometry.dispose();
      if (marker.material) marker.material.dispose();
    }
    this.jointMarkers = {};
    this.jointMarkersVisible = false;
  }

  setJointMarkersVisible(visible) {
    this.jointMarkersVisible = visible;
    for (const marker of Object.values(this.jointMarkers)) {
      marker.visible = visible;
    }
  }

  dispose() {
    // Dispose light effects
    for (const effect of Object.values(this.lightEffects)) {
      if (effect.dispose) effect.dispose();
    }
    this.lightEffects = {};
    this.removeJointMarkers();
  }
}
