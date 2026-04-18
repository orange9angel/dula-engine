import { AnimationBase } from '../AnimationBase.js';

export class Think extends AnimationBase {
  constructor() {
    super('Think', 2.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    if (!rArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;

    // Slow raise to chin
    let raise = 0;
    if (t < 0.2) {
      raise = t / 0.2;
    } else if (t < 0.9) {
      raise = 1;
    } else {
      raise = 1 - (t - 0.9) / 0.1;
    }
    const ease = raise < 0.5 ? 2 * raise * raise : -1 + (4 - 2 * raise) * raise;

    // Hand to chin
    rArm.rotation.z = rBaseZ + ease * 0.5;
    rArm.rotation.x = -ease * 0.9;

    // Head tilts down thoughtfully
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.2;
      character.headGroup.rotation.y = Math.sin(t * Math.PI * 0.5) * ease * 0.1;
    }
  }
}
