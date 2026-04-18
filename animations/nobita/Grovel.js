import { AnimationBase } from '../AnimationBase.js';

export class Grovel extends AnimationBase {
  constructor() {
    super('Grovel', 1.5);
  }

  update(t, character) {
    const baseY = character.baseY || 0;

    // Drop to knees then bow forward
    let p = 0;
    if (t < 0.3) {
      p = t / 0.3;
    } else if (t < 0.8) {
      p = 1;
    } else {
      p = 1 - (t - 0.8) / 0.2;
    }
    const ease = p * (2 - p);

    // Body lowers and leans forward
    character.mesh.position.y = baseY - ease * 0.5;
    character.mesh.rotation.x = ease * 0.8;

    // Head touches ground
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.5;
    }

    // Arms forward begging
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ + ease * 0.3;
      rArm.rotation.x = -ease * 0.9;
      lArm.rotation.z = lBaseZ - ease * 0.3;
      lArm.rotation.x = -ease * 0.9;
    }

    // Pleading tremble
    if (t > 0.3 && t < 0.8) {
      character.mesh.position.x = Math.sin(t * Math.PI * 10) * 0.01;
    }
  }
}
