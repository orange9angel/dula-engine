import { AnimationBase } from '../AnimationBase.js';

export class Spin extends AnimationBase {
  constructor() {
    super('Spin', 1.0);
  }

  update(t, character) {
    // Doraemon's classic happy spin
    character.mesh.rotation.y = t * Math.PI * 4;

    // Slight happy bob
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.abs(Math.sin(t * Math.PI * 4)) * 0.05;

    // Arms out for balance
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      const spread = Math.sin(t * Math.PI) * 0.3;
      rArm.rotation.z = rBaseZ + 0.4 + spread;
      lArm.rotation.z = lBaseZ - 0.4 - spread;
    }
  }
}
