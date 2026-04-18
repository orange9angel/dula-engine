import { AnimationBase } from '../AnimationBase.js';

export class SitDown extends AnimationBase {
  constructor() {
    super('SitDown', 1.0);
  }

  update(t, character) {
    const baseY = character.baseY || 0;
    const leftLeg = character.leftLeg;
    const rightLeg = character.rightLeg;

    // Lower body, bend knees
    let p = 0;
    if (t < 0.4) {
      p = t / 0.4;
    } else {
      p = 1;
    }
    const ease = p * (2 - p);

    // Body drops about 0.4 units
    character.mesh.position.y = baseY - ease * 0.4;

    // Knees bend forward
    if (leftLeg) leftLeg.rotation.x = -ease * 0.9;
    if (rightLeg) rightLeg.rotation.x = -ease * 0.9;

    // Arms rest on knees or lap
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ + ease * 0.2;
      rArm.rotation.x = -ease * 0.4;
      lArm.rotation.z = lBaseZ - ease * 0.2;
      lArm.rotation.x = -ease * 0.4;
    }

    // Body leans slightly forward
    character.mesh.rotation.x = ease * 0.15;
  }
}
