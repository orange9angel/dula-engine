import { AnimationBase } from '../AnimationBase.js';

export class CrossArms extends AnimationBase {
  constructor() {
    super('CrossArms', 1.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    let p = 0;
    if (t < 0.3) {
      p = t / 0.3;
    } else if (t < 0.7) {
      p = 1;
    } else {
      p = 1 - (t - 0.7) / 0.3;
    }
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Cross: right over left
    rArm.rotation.z = rBaseZ + ease * 0.7;
    rArm.rotation.x = -ease * 0.5;
    lArm.rotation.z = lBaseZ - ease * 0.7;
    lArm.rotation.x = -ease * 0.5;

    // Slight chest confidence
    character.mesh.rotation.x = -ease * 0.05;
  }
}
