export class HitstopManager {
  constructor() {
    this.active = false;
    this.triggerTime = 0;
    this.duration = 0;
    this.intensity = 0;
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.flashDuration = 0;
    this.timeScale = 1.0; // 当前时间缩放，由外部 Storyboard 设置
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
    // 在慢动作期间，hitstop 持续时间按 timeScale 缩放
    // 这样轻击在慢动作中也能有足够长的冻结感
    const scaledDuration = this.duration / Math.max(0.05, this.timeScale);
    if (this.active && time >= this.triggerTime + scaledDuration) {
      this.active = false;
    }
    return this.active;
  }

  isShaking(time) {
    const scaledShakeDuration = this.shakeDuration / Math.max(0.05, this.timeScale);
    return time < this.triggerTime + scaledShakeDuration;
  }

  isFlashing(time) {
    const scaledFlashDuration = this.flashDuration / Math.max(0.05, this.timeScale);
    return time < this.triggerTime + scaledFlashDuration;
  }

  getShakeOffset(time) {
    if (!this.isShaking(time)) return { x: 0, y: 0 };
    const elapsed = time - this.triggerTime;
    const scaledShakeDuration = this.shakeDuration / Math.max(0.05, this.timeScale);
    const decay = Math.max(0, 1 - elapsed / (scaledShakeDuration + 0.001));
    const amp = this.shakeIntensity * decay;
    return {
      x: (Math.random() - 0.5) * amp * 2,
      y: (Math.random() - 0.5) * amp * 2,
    };
  }
}
