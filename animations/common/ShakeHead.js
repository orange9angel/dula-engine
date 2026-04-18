import { AnimationBase } from '../AnimationBase.js';

export class ShakeHead extends AnimationBase {
  constructor() {
    super('ShakeHead', 0.8);
  }

  update(t, character) {
    if (!character.headGroup) return;
    // Three shakes
    const shakes = Math.sin(t * Math.PI * 6);
    character.headGroup.rotation.y = shakes * 0.35;
  }
}
