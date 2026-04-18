import { AnimationBase } from '../AnimationBase.js';

export class Scold extends AnimationBase {
  constructor() {
    super('Scold', 1.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Confident stance: left hand on hip, right hand pointing
    let p = 0;
    if (t < 0.2) {
      p = t / 0.2;
    } else if (t < 0.8) {
      p = 1;
    } else {
      p = 1 - (t - 0.8) / 0.2;
    }
    const ease = p * (2 - p);

    // Left hand on hip
    lArm.rotation.z = lBaseZ + ease * 0.5;
    lArm.rotation.x = -ease * 0.3;

    // Right hand points and wags
    const wag = Math.sin(t * Math.PI * 8) * 0.1;
    rArm.rotation.z = rBaseZ - ease * 0.3;
    rArm.rotation.x = -ease * 0.6 + wag;

    // Head shake while scolding
    if (character.headGroup) {
      character.headGroup.rotation.y = Math.sin(t * Math.PI * 6) * ease * 0.15;
    }

    // Body leans forward assertively
    character.mesh.rotation.x = ease * 0.05;
  }
}
