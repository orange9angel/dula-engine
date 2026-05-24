export class HitstopManager {
  constructor() {
    this.active = false;
    this.endTime = 0;
    this.intensity = 0; // 0-1, affects freeze duration and shake
    this.shakeIntensity = 0;
    this.shakeEndTime = 0;
    this.flashEndTime = 0;
  }

  trigger(duration, shakeIntensity = 0.3, flash = true) {
    // duration in seconds, e.g. 0.08 for light hit, 0.15 for heavy
    this.active = true;
    this.endTime = performance.now() / 1000 + duration;
    this.intensity = duration;
    this.shakeIntensity = shakeIntensity;
    this.shakeEndTime = this.endTime + 0.2; // shake continues slightly after freeze
    this.flashEndTime = flash ? (performance.now() / 1000 + 0.033) : 0; // 1 frame flash
  }

  update(time) {
    if (this.active && time >= this.endTime) {
      this.active = false;
    }
    return this.active;
  }

  isShaking(time) {
    return time < this.shakeEndTime;
  }

  isFlashing(time) {
    return time < this.flashEndTime;
  }

  getShakeOffset(time) {
    if (!this.isShaking(time)) return { x: 0, y: 0 };
    const decay = Math.max(0, (this.shakeEndTime - time) / (this.shakeEndTime - this.endTime + 0.001));
    const amp = this.shakeIntensity * decay;
    return {
      x: (Math.random() - 0.5) * amp * 2,
      y: (Math.random() - 0.5) * amp * 2,
    };
  }
}
