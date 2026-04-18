import { AnimationBase } from '../AnimationBase.js';

export class Giggle extends AnimationBase {
  constructor() {
    super('Giggle', 1.0);
  }

  update(t, character) {
    const lArm = character.leftArm;
    if (!lArm) return;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Hand to mouth
    let raise = 1;
    if (t < 0.2) raise = t / 0.2;
    else if (t > 0.8) raise = 1 - (t - 0.8) / 0.2;
    const ease = raise < 0.5 ? 2 * raise * raise : -1 + (4 - 2 * raise) * ease;

    lArm.rotation.z = lBaseZ - ease * 0.4;
    lArm.rotation.x = -ease * 0.8;

    // Body bounces with laughter
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.abs(Math.sin(t * Math.PI * 6)) * ease * 0.03;

    // Head tilts back slightly
    if (character.headGroup) {
      character.headGroup.rotation.x = -ease * 0.1;
      character.headGroup.rotation.z = Math.sin(t * Math.PI * 3) * ease * 0.05;
    }
  }
}
