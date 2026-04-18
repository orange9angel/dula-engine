import { AnimationBase } from '../AnimationBase.js';

export class TriumphPose extends AnimationBase {
  constructor() {
    super('TriumphPose', 1.0);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // V-sign pose with bounce
    let p = 0;
    if (t < 0.2) {
      p = t / 0.2;
    } else {
      p = 1;
    }
    const ease = p * (2 - p);

    // Arms up in V
    rArm.rotation.z = rBaseZ + ease * 1.1;
    lArm.rotation.z = lBaseZ - ease * 1.1;
    rArm.rotation.x = -ease * 0.2;
    lArm.rotation.x = -ease * 0.2;

    // Proud chest
    character.mesh.rotation.x = -ease * 0.08;

    // Bounce
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.sin(t * Math.PI * 3) * ease * 0.05;

    // Head high
    if (character.headGroup) {
      character.headGroup.rotation.x = -ease * 0.1;
    }
  }
}
