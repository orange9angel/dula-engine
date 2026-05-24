export class HitstopManager {
  constructor() {
    this.active = false;
    this.triggerTime = 0;
    this.duration = 0;
    this.intensity = 0;
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.flashDuration = 0;
  }

  trigger(storyTime, duration, shakeIntensity = 0.3, flash = true) {
    // duration in seconds, e.g. 0.08 for light hit, 0.15 for heavy
    this.active = true;
    this.triggerTime = storyTime;
    this.duration = duration;
    this.intensity = duration;
    this.shakeIntensity = shakeIntensity;
    this.shakeDuration = duration + 0.2; // shake continues slightly after freeze
    this.flashDuration = flash ? 0.033 : 0; // 1 frame flash
  }

  update(time) {
    if (this.active && time >= this.triggerTime + this.duration) {
      this.active = false;
    }
    return this.active;
  }

  isShaking(time) {
    return time < this.triggerTime + this.shakeDuration;
  }

  isFlashing(time) {
    return time < this.triggerTime + this.flashDuration;
  }

  getShakeOffset(time) {
    if (!this.isShaking(time)) return { x: 0, y: 0 };
    const elapsed = time - this.triggerTime;
    const decay = Math.max(0, 1 - elapsed / (this.shakeDuration + 0.001));
    const amp = this.shakeIntensity * decay;
    return {
      x: (Math.random() - 0.5) * amp * 2,
      y: (Math.random() - 0.5) * amp * 2,
    };
  }
}
