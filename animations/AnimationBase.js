/**
 * Animation compatibility tags.
 * Used by the engine and inspectors to determine which characters can use an animation.
 *
 * @typedef {Object} AnimationTags
 * @property {string[]} [requires] - Required body parts, e.g. ['rightArm', 'leftArm']
 * @property {string[]} [suits] - Character archetypes this animation suits, e.g. ['humanoid', 'fighter']
 * @property {string[]} [notSuits] - Character archetypes this animation does NOT suit, e.g. ['round', 'tiny']
 * @property {number} [minHeight=0] - Minimum character height for this animation to look right
 * @property {number} [maxHeight=Infinity] - Maximum character height
 */

import { getPoseType, getDefaultPhase } from './PoseMatrix.js';

export class AnimationBase {
  constructor(name, duration = 1.0) {
    this.name = name;
    this.duration = duration;
    /**
     * Compatibility metadata for this animation.
     * Subclasses should override this to declare their requirements.
     * @type {AnimationTags}
     */
    this.tags = {
      requires: [],
      suits: [],
      notSuits: [],
      minHeight: 0,
      maxHeight: Infinity,
    };

    /**
     * 是否使用姿势矩阵模式。
     * - false（默认）：子类覆盖 update(t, character) 直接操作角色
     * - true：子类覆盖 getPoseMatrix(t) 返回 PoseMatrix，由 ActionMatrixController 应用
     *
     * 迁移路径：
     * 1. 旧动画保持 usePoseMatrix = false，继续用 update()
     * 2. 新动画或迁移中的动画设置 usePoseMatrix = true，实现 getPoseMatrix()
     * 3. 最终所有动画统一为矩阵模式，删除 update() 路径
     */
    this.usePoseMatrix = false;

    // 矩阵模式下的姿势类型和阶段（自动推导）
    this._poseType = getPoseType(name);
    this._phase = getDefaultPhase(this._poseType);
  }

  get poseType() {
    return this._poseType;
  }

  get phase() {
    return this._phase;
  }

  /**
   * Check if this animation is compatible with a given character.
   * @param {CharacterBase} character
   * @returns {{compatible: boolean, reason?: string}}
   */
  checkCompatibility(character) {
    const tags = this.tags;

    if (typeof character.canPlayAnimation === 'function' && !character.canPlayAnimation(this)) {
      return { compatible: false, reason: `Animation "${this.name}" is not enabled for ${character.name}` };
    }

    // Check required body parts
    for (const part of tags.requires || []) {
      if (!character[part]) {
        return { compatible: false, reason: `Missing body part: ${part}` };
      }
    }

    // Check height constraints (approximate from mesh bounding box or baseY)
    const height = character.mesh?.position?.y !== undefined
      ? character.baseY + 1.5 // rough estimate
      : Infinity;
    if (height < tags.minHeight) {
      return { compatible: false, reason: `Character too short (${height.toFixed(2)} < ${tags.minHeight})` };
    }
    if (height > tags.maxHeight) {
      return { compatible: false, reason: `Character too tall (${height.toFixed(2)} > ${tags.maxHeight})` };
    }

    return { compatible: true };
  }

  /**
   * 旧接口：直接操作角色（usePoseMatrix = false 时使用）
   * @param {number} t - progress from 0 to 1
   * @param {CharacterBase} character
   */
  update(t, character) {
    // override in subclass when usePoseMatrix = false
  }

  /**
   * 新接口：返回姿势矩阵（usePoseMatrix = true 时必须覆盖）
   * @param {number} t - progress from 0 to 1
   * @param {number} [elapsed] - elapsed seconds since animation start
   * @param {number} [duration] - active animation duration in seconds
   * @param {number} [time] - absolute storyboard time in seconds
   * @returns {PoseMatrix|null} 姿势矩阵（相对基线的偏移量）
   */
  getPoseMatrix(t, elapsed, duration, time) {
    // override in subclass when usePoseMatrix = true
    return null;
  }
}
