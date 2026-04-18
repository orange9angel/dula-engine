import { AnimationBase } from '../AnimationBase.js';

export class LazyStretch extends AnimationBase {
  constructor() {
    super('LazyStretch', 2.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Slow lazy stretch: arms up and back
    let p = 0;
    if (t < 0.3) {
      p = t / 0.3;
    } else if (t < 0.7) {
      p = 1;
    } else {
      p = 1 - (t - 0.7) / 0.3;
    }
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

    // Arms stretch high
    rArm.rotation.z = rBaseZ + ease * 1.0;
    lArm.rotation.z = lBaseZ - ease * 1.0;
    rArm.rotation.x = -ease * 0.3;
    lArm.rotation.x = -ease * 0.3;

    // Body arches back
    character.mesh.rotation.x = -ease * 0.15;

    // Head back with yawn
    if (character.headGroup) {
      character.headGroup.rotation.x = -ease * 0.2;
    }

    // On the spot lazy sway
    character.mesh.rotation.z = Math.sin(t * Math.PI * 2) * ease * 0.05;
  }
}
