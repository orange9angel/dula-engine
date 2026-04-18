import { AnimationBase } from '../AnimationBase.js';

export class HandsOnHips extends AnimationBase {
  constructor() {
    super('HandsOnHips', 1.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    // Move to hips and hold
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

    // Arms bent akimbo
    rArm.rotation.z = rBaseZ - ease * 0.5;
    rArm.rotation.x = -ease * 0.3;
    lArm.rotation.z = lBaseZ + ease * 0.5;
    lArm.rotation.x = -ease * 0.3;

    // Slight confident chest puff
    character.mesh.rotation.x = -ease * 0.05;
  }
}
