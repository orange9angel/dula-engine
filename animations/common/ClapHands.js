import { AnimationBase } from '../AnimationBase.js';

export class ClapHands extends AnimationBase {
  constructor() {
    super('ClapHands', 0.8);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Raise arms to chest height first 20%
    let raise = 0;
    if (t < 0.2) {
      raise = t / 0.2;
    } else if (t < 0.8) {
      raise = 1;
    } else {
      raise = 1 - (t - 0.8) / 0.2;
    }
    const ease = raise < 0.5 ? 2 * raise * raise : -1 + (4 - 2 * raise) * raise;

    // Arms raised in front
    rArm.rotation.z = rBaseZ + ease * 0.4;
    rArm.rotation.x = -ease * 0.6;
    lArm.rotation.z = lBaseZ - ease * 0.4;
    lArm.rotation.x = -ease * 0.6;

    // Clapping motion during 20%~80%
    if (t >= 0.2 && t < 0.8) {
      const p = (t - 0.2) / 0.6;
      const clap = Math.abs(Math.sin(p * Math.PI * 6)) * 0.15;
      rArm.rotation.z = rBaseZ + 0.4 + clap;
      lArm.rotation.z = lBaseZ - 0.4 - clap;
    }
  }
}
