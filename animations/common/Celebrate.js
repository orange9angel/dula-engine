import { AnimationBase } from '../AnimationBase.js';

export class Celebrate extends AnimationBase {
  constructor() {
    super('Celebrate', 1.2);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Arms up with bounce
    const bounce = Math.abs(Math.sin(t * Math.PI * 4)) * 0.1;
    const baseY = character.baseY || 0;

    // Quick raise then celebratory pump
    let raise = 1;
    if (t < 0.15) {
      raise = t / 0.15;
    }
    const ease = raise * (2 - raise);

    rArm.rotation.z = rBaseZ + ease * 1.2 + bounce;
    lArm.rotation.z = lBaseZ - ease * 1.2 - bounce;
    rArm.rotation.x = -ease * 0.3;
    lArm.rotation.x = -ease * 0.3;

    character.mesh.position.y = baseY + bounce;

    // Head back in joy
    if (character.headGroup) {
      character.headGroup.rotation.x = -ease * 0.2;
    }
  }
}
