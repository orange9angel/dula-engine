import { AnimationBase } from '../AnimationBase.js';

export class PlayViolin extends AnimationBase {
  constructor() {
    super('PlayViolin', 2.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Pose: left arm holds violin under chin, right arm bows
    let p = 0;
    if (t < 0.2) {
      p = t / 0.2;
    } else if (t < 0.9) {
      p = 1;
    } else {
      p = 1 - (t - 0.9) / 0.1;
    }
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

    // Left arm: hold violin position (under chin)
    lArm.rotation.z = lBaseZ + ease * 0.3;
    lArm.rotation.x = -ease * 0.5;

    // Right arm: bowing motion
    const bow = Math.sin(t * Math.PI * 4) * 0.25;
    rArm.rotation.z = rBaseZ - ease * 0.2;
    rArm.rotation.x = -ease * 0.4 + bow;

    // Head tilts to hold violin
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.1;
      character.headGroup.rotation.y = ease * 0.1;
    }

    // Body sways with music
    character.mesh.rotation.z = Math.sin(t * Math.PI * 2) * ease * 0.04;
  }
}
