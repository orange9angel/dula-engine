import { AnimationBase } from '../AnimationBase.js';

export class Walk extends AnimationBase {
  constructor() {
    super('Walk', 1.0);
  }

  update(t, character) {
    const leftLeg = character.leftLeg;
    const rightLeg = character.rightLeg;
    if (!leftLeg || !rightLeg) return;

    // alternating leg swing
    leftLeg.rotation.x = Math.sin(t * Math.PI * 4) * 0.5;
    rightLeg.rotation.x = Math.sin(t * Math.PI * 4 + Math.PI) * 0.5;

    // slight body bob
    character.mesh.position.y = (character.baseY || 0) + Math.abs(Math.sin(t * Math.PI * 4)) * 0.05;

    // slight arm swing opposite to legs
    if (character.rightArm) {
      const baseZ = character.rightArmBaseZ || character.rightArm.rotation.z;
      character.rightArm.rotation.z = baseZ + Math.sin(t * Math.PI * 4 + Math.PI) * 0.15;
    }
    if (character.leftArm) {
      const baseZ = character.leftArmBaseZ || character.leftArm.rotation.z;
      character.leftArm.rotation.z = baseZ + Math.sin(t * Math.PI * 4) * 0.15;
    }
  }
}
