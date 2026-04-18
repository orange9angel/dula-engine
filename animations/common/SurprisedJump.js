import { AnimationBase } from '../AnimationBase.js';

export class SurprisedJump extends AnimationBase {
  constructor() {
    super('SurprisedJump', 0.6);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    const baseY = character.baseY || 0;

    // Jump arc: quick up then down
    const y = Math.sin(t * Math.PI) * 0.4;
    character.mesh.position.y = baseY + y;

    // Arms fling up
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      const fling = Math.sin(t * Math.PI);
      rArm.rotation.z = rBaseZ + fling * 1.0;
      lArm.rotation.z = lBaseZ - fling * 1.0;
    }

    // Head snaps back
    if (character.headGroup) {
      character.headGroup.rotation.x = -Math.sin(t * Math.PI) * 0.25;
    }
  }
}
