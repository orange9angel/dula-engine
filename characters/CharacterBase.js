import * as THREE from 'three';

export class CharacterBase {
  constructor(name) {
    this.name = name;
    this.mesh = new THREE.Group();
    this.mesh.name = name;
    this.mouth = null;
    this.mouthBaseScaleX = 1;
    this.mouthBaseScaleY = 1;
    this.mouthBaseScaleZ = 1;
    this.headGroup = null;
    this.rightArm = null;
    this.leftArm = null;
    this.leftPupil = null;
    this.rightPupil = null;
    this.baseY = 0;
    this.isSpeaking = false;
    this.speakStartTime = 0;
    this.speakEndTime = 0;
    this.animations = []; // queued animations
    this.moves = [];      // queued position moves
    this.teleportEvents = []; // instantaneous position resets
    this.eyeTracking = {
      active: false,
      target: new THREE.Vector3(),
      startTime: 0,
      endTime: 0,
    };
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

    // Explicit animations
    for (const anim of this.animations) {
      if (time >= anim.startTime && time <= anim.endTime) {
        const progress = (time - anim.startTime) / (anim.endTime - anim.startTime);
        anim.instance.update(progress, this);
      }
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
      // Y scale: base → base * 1.5 (open) for visible animation
      const openness = this.mouthBaseScaleY * (1.0 + 0.5 * factor);
      this.mouth.scale.y = openness;
      // Slight X shrink to maintain ellipse shape
      this.mouth.scale.x = this.mouthBaseScaleX * (1.0 - 0.1 * factor);
      this.mouth.scale.z = this.mouthBaseScaleZ;
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
}
