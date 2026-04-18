import { AnimationBase } from '../AnimationBase.js';

export class WaddleWalk extends AnimationBase {
  constructor() {
    super('WaddleWalk', 1.0);
  }

  update(t, character) {
    const leftLeg = character.leftLeg;
    const rightLeg = character.rightLeg;
    if (!leftLeg || !rightLeg) return;

    // Side-to-side waddle (Doraemon's round body sway)
    const waddle = Math.sin(t * Math.PI * 4) * 0.15;
    character.mesh.rotation.z = waddle;

    // Short steps
    leftLeg.rotation.x = Math.sin(t * Math.PI * 4) * 0.3;
    rightLeg.rotation.x = Math.sin(t * Math.PI * 4 + Math.PI) * 0.3;

    // Bouncy bob
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.abs(Math.sin(t * Math.PI * 4)) * 0.04;

    // Arms swing opposite to body tilt
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ + Math.sin(t * Math.PI * 4 + Math.PI) * 0.1;
      lArm.rotation.z = lBaseZ + Math.sin(t * Math.PI * 4) * 0.1;
    }
  }
}
