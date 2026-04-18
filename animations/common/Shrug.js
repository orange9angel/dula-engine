import { AnimationBase } from '../AnimationBase.js';

export class Shrug extends AnimationBase {
  constructor() {
    super('Shrug', 0.8);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Shrug up -> hold -> down
    let p = 0;
    if (t < 0.3) {
      p = t / 0.3;
    } else if (t < 0.6) {
      p = 1;
    } else {
      p = 1 - (t - 0.6) / 0.4;
    }
    const ease = Math.sin(p * Math.PI * 0.5);

    // Shoulders come up (arms rotate inward and up)
    rArm.rotation.z = rBaseZ - ease * 0.3;
    rArm.rotation.x = -ease * 0.2;
    lArm.rotation.z = lBaseZ + ease * 0.3;
    lArm.rotation.x = -ease * 0.2;

    // Head tilts in confusion
    if (character.headGroup) {
      character.headGroup.rotation.z = ease * 0.1;
      character.headGroup.rotation.x = ease * 0.1;
    }
  }
}
