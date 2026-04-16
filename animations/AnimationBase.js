export class AnimationBase {
  constructor(name, duration = 1.0) {
    this.name = name;
    this.duration = duration;
  }

  /**
   * @param {number} t - progress from 0 to 1
   * @param {CharacterBase} character
   */
  update(t, character) {
    // override in subclass
  }
}
