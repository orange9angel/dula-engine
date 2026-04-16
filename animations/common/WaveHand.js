import { AnimationBase } from '../AnimationBase.js';

export class WaveHand extends AnimationBase {
  constructor() {
    super('WaveHand', 1.0);
  }

  update(t, character) {
    const arm = character.rightArm;
    if (!arm) return;
    const baseZ = character.rightArmBaseZ || arm.rotation.z;
    const angle = Math.sin(t * Math.PI * 4) * 0.5;
    arm.rotation.z = baseZ + angle;
  }
}
