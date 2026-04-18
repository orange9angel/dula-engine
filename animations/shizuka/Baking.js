import { AnimationBase } from '../AnimationBase.js';

export class Baking extends AnimationBase {
  constructor() {
    super('Baking', 2.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Mixing / stirring motion
    let p = 0;
    if (t < 0.2) {
      p = t / 0.2;
    } else if (t < 0.9) {
      p = 1;
    } else {
      p = 1 - (t - 0.9) / 0.1;
    }
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

    // Right arm stirs in circular motion
    const stirAngle = t * Math.PI * 3;
    rArm.rotation.z = rBaseZ + ease * 0.2 + Math.sin(stirAngle) * 0.1;
    rArm.rotation.x = -ease * 0.5 + Math.cos(stirAngle) * 0.1;

    // Left arm holds bowl
    lArm.rotation.z = lBaseZ - ease * 0.2;
    lArm.rotation.x = -ease * 0.4;

    // Body sways with stirring rhythm
    character.mesh.rotation.z = Math.sin(t * Math.PI * 3) * ease * 0.03;

    // Head looks down at work
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.15;
    }
  }
}
