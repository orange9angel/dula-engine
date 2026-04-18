import { AnimationBase } from '../AnimationBase.js';

export class RunAway extends AnimationBase {
  constructor() {
    super('RunAway', 0.8);
  }

  update(t, character) {
    const leftLeg = character.leftLeg;
    const rightLeg = character.rightLeg;
    if (!leftLeg || !rightLeg) return;

    // Frantic run with arms protecting head
    const freq = Math.PI * 8;
    leftLeg.rotation.x = Math.sin(t * freq) * 0.7;
    rightLeg.rotation.x = Math.sin(t * freq + Math.PI) * 0.7;

    // Body leans way forward
    character.mesh.rotation.x = 0.25;

    // Bob
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.abs(Math.sin(t * freq)) * 0.06;

    // Arms over head
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ + 0.9;
      lArm.rotation.z = lBaseZ - 0.9;
      rArm.rotation.x = -0.4;
      lArm.rotation.x = -0.4;
    }

    // Head down
    if (character.headGroup) {
      character.headGroup.rotation.x = 0.2;
    }
  }
}
