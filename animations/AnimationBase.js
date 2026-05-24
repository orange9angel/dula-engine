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
  }

  /**
   * Check if this animation is compatible with a given character.
   * @param {CharacterBase} character
   * @returns {{compatible: boolean, reason?: string}}
   */
  checkCompatibility(character) {
    const tags = this.tags;

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
   * @param {number} t - progress from 0 to 1
   * @param {CharacterBase} character
   */
  update(t, character) {
    // override in subclass
  }
}
