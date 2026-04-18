import { AnimationBase } from '../AnimationBase.js';

export class Run extends AnimationBase {
  constructor() {
    super('Run', 0.6);
  }

  update(t, character) {
    const leftLeg = character.leftLeg;
    const rightLeg = character.rightLeg;
    if (!leftLeg || !rightLeg) return;

    const stride = 0.8;
    const freq = Math.PI * 6;

    leftLeg.rotation.x = Math.sin(t * freq) * stride;
    rightLeg.rotation.x = Math.sin(t * freq + Math.PI) * stride;

    // Body lean forward
    character.mesh.rotation.x = 0.15;

    // Larger bob
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.abs(Math.sin(t * freq)) * 0.08;

    // Arms swing opposite to legs
    if (character.rightArm) {
      const baseZ = character.rightArmBaseZ || character.rightArm.rotation.z;
      character.rightArm.rotation.z = baseZ + Math.sin(t * freq + Math.PI) * 0.4;
    }
    if (character.leftArm) {
      const baseZ = character.leftArmBaseZ || character.leftArm.rotation.z;
      character.leftArm.rotation.z = baseZ + Math.sin(t * freq) * 0.4;
    }
  }
}
