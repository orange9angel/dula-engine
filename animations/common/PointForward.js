import { AnimationBase } from '../AnimationBase.js';

export class PointForward extends AnimationBase {
  constructor() {
    super('PointForward', 1.0);
  }

  update(t, character) {
    const arm = character.rightArm;
    if (!arm) return;

    // Raise -> point -> hold -> lower
    let raise = 0;
    if (t < 0.2) {
      raise = t / 0.2;
    } else if (t < 0.7) {
      raise = 1;
    } else {
      raise = 1 - (t - 0.7) / 0.3;
    }
    const ease = raise * (2 - raise); // ease out

    const baseZ = character.rightArmBaseZ || arm.rotation.z;
    arm.rotation.z = baseZ + ease * 0.6;     // raise to side
    arm.rotation.x = -ease * 0.8;            // point forward

    // Head follows the pointing direction slightly
    if (character.headGroup && t > 0.2 && t < 0.7) {
      character.headGroup.rotation.y = 0.15 * Math.sin((t - 0.2) * Math.PI * 2);
    }
  }
}
