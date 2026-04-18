import { AnimationBase } from '../AnimationBase.js';

export class ScratchHead extends AnimationBase {
  constructor() {
    super('ScratchHead', 1.2);
  }

  update(t, character) {
    const arm = character.rightArm;
    if (!arm) return;

    const baseZ = character.rightArmBaseZ || arm.rotation.z;

    // Reach up -> scratch (small oscillation) -> lower
    if (t < 0.25) {
      const p = t / 0.25;
      arm.rotation.z = baseZ + p * p * 0.9;
      arm.rotation.x = -p * p * 1.0;
    } else if (t < 0.75) {
      const p = (t - 0.25) / 0.5;
      arm.rotation.z = baseZ + 0.9 + Math.sin(p * Math.PI * 6) * 0.08;
      arm.rotation.x = -1.0 + Math.sin(p * Math.PI * 4) * 0.05;
      // Head tilts slightly toward scratching hand
      if (character.headGroup) {
        character.headGroup.rotation.z = Math.sin(p * Math.PI * 6) * 0.05;
      }
    } else {
      const p = (t - 0.75) / 0.25;
      arm.rotation.z = baseZ + 0.9 * (1 - p) * (1 - p);
      arm.rotation.x = -1.0 * (1 - p) * (1 - p);
      if (character.headGroup) {
        character.headGroup.rotation.z = 0;
      }
    }
  }
}
