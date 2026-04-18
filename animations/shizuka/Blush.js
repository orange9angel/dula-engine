import { AnimationBase } from '../AnimationBase.js';

export class Blush extends AnimationBase {
  constructor() {
    super('Blush', 1.2);
  }

  update(t, character) {
    // Shy body language
    const baseY = character.baseY || 0;

    // Slight sway
    character.mesh.rotation.z = Math.sin(t * Math.PI * 2) * 0.05;

    // Head down, looking away
    if (character.headGroup) {
      let p = 0;
      if (t < 0.3) {
        p = t / 0.3;
      } else if (t < 0.8) {
        p = 1;
      } else {
        p = 1 - (t - 0.8) / 0.2;
      }
      const ease = p * (2 - p);
      character.headGroup.rotation.x = ease * 0.25;
      character.headGroup.rotation.y = ease * 0.3;
    }

    // Hands clasped in front
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      let p = 0;
      if (t < 0.3) p = t / 0.3;
      else if (t < 0.8) p = 1;
      else p = 1 - (t - 0.8) / 0.2;
      const ease = p * (2 - p);

      rArm.rotation.z = rBaseZ + ease * 0.3;
      rArm.rotation.x = -ease * 0.4;
      lArm.rotation.z = lBaseZ - ease * 0.3;
      lArm.rotation.x = -ease * 0.4;
    }

    // Small bounce on toes
    character.mesh.position.y = baseY + Math.abs(Math.sin(t * Math.PI * 3)) * 0.02;
  }
}
