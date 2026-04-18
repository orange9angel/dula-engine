import { AnimationBase } from '../AnimationBase.js';

export class PanicSpin extends AnimationBase {
  constructor() {
    super('PanicSpin', 1.2);
  }

  update(t, character) {
    // Fast panic rotation
    character.mesh.rotation.y = t * Math.PI * 8;

    // Body tremble
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.sin(t * Math.PI * 12) * 0.03;

    // Arms flail wildly
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ + Math.sin(t * Math.PI * 10) * 0.6;
      rArm.rotation.x = Math.sin(t * Math.PI * 8) * 0.4;
      lArm.rotation.z = lBaseZ + Math.sin(t * Math.PI * 9) * 0.6;
      lArm.rotation.x = Math.sin(t * Math.PI * 7) * 0.4;
    }

    // Head shake
    if (character.headGroup) {
      character.headGroup.rotation.y = Math.sin(t * Math.PI * 6) * 0.3;
    }
  }
}
