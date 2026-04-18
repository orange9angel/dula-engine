import { AnimationBase } from '../AnimationBase.js';

export class Curtsy extends AnimationBase {
  constructor() {
    super('Curtsy', 1.2);
  }

  update(t, character) {
    const baseY = character.baseY || 0;
    const rLeg = character.rightLeg;
    const lLeg = character.leftLeg;

    // Dip with one leg back
    let p = 0;
    if (t < 0.3) {
      p = t / 0.3;
    } else if (t < 0.7) {
      p = 1;
    } else {
      p = 1 - (t - 0.7) / 0.3;
    }
    const ease = p * (2 - p);

    // Body lowers
    character.mesh.position.y = baseY - ease * 0.25;

    // One leg bends back (right leg)
    if (rLeg) rLeg.rotation.x = -ease * 0.5;

    // Arms lift dress sides slightly
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ + ease * 0.2;
      lArm.rotation.z = lBaseZ - ease * 0.2;
      rArm.rotation.x = -ease * 0.2;
      lArm.rotation.x = -ease * 0.2;
    }

    // Head bows slightly
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.15;
    }
  }
}
