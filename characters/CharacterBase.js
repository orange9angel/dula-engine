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
    this.baseY = 0;
    this.isSpeaking = false;
    this.speakStartTime = 0;
    this.speakEndTime = 0;
    this.animations = []; // queued animations
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
    if (this.headGroup) {
      this.headGroup.rotation.set(0, 0, 0);
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

  clearAnimations() {
    this.animations = [];
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

    // Explicit animations
    for (const anim of this.animations) {
      if (time >= anim.startTime && time <= anim.endTime) {
        const progress = (time - anim.startTime) / (anim.endTime - anim.startTime);
        anim.instance.update(progress, this);
      }
    }
  }

  animateMouth(time, delta) {
    if (!this.mouth) return;
    // Pronounced mouth opening for clear visibility
    const speed = 10;
    const factor = Math.abs(Math.sin(time * speed));
    const openness = this.mouthBaseScaleY * (0.2 + 2.5 * factor);
    this.mouth.scale.y = openness;
    // Slight expansion in x/z to look like a real opening mouth
    this.mouth.scale.x = this.mouthBaseScaleX * (1.0 + 0.3 * factor);
    this.mouth.scale.z = this.mouthBaseScaleZ * (1.0 + 0.3 * factor);
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
