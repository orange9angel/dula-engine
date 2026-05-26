/**
 * PostProcessBase — 后处理效果基类
 *
 * 所有全屏后处理效果（Bloom、Vignette、RetroTV、ColorGrading 等）继承此类。
 * 通过 PostProcessRegistry 注册，由 Storyboard 在 render() 时调用。
 */

export class PostProcessBase {
  constructor(name, renderer, width = 1920, height = 1080) {
    this.name = name;
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.time = 0;
    this.enabled = true;
  }

  /**
   * 执行后处理渲染
   * @param {THREE.Scene} scene — 当前场景
   * @param {THREE.Camera} camera — 当前相机
   * @param {THREE.WebGLRenderTarget} inputTarget — 输入纹理（上一个后处理的结果）
   * @returns {THREE.WebGLRenderTarget} — 输出纹理（供下一个后处理使用）
   *
   * 简单实现可以直接渲染到屏幕（最后一个后处理），
   * 复杂实现可以渲染到 offscreen target 供链式叠加。
   */
  render(scene, camera, inputTarget = null) {
    // Subclass must override
    throw new Error(`PostProcessBase.render() must be overridden by ${this.name}`);
  }

  /**
   * 每帧更新（用于动画参数如 time、noise seed 等）
   * @param {number} deltaTime — 距上一帧的时间（秒）
   */
  update(deltaTime) {
    this.time += deltaTime;
  }

  /**
   * 设置后处理是否启用
   */
  setEnabled(v) {
    this.enabled = v;
  }

  /**
   * 释放 GPU 资源
   */
  dispose() {
    // Subclass should override and call super.dispose()
  }
}
