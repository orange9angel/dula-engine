import { AnimationBase } from '../AnimationBase.js';

export class StudyDespair extends AnimationBase {
  constructor() {
    super('StudyDespair', 1.5);
  }

  update(t, character) {
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (!rArm || !lArm) return;

    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
    const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;

    // Hands on head in despair
    let p = 0;
    if (t < 0.25) {
      p = t / 0.25;
    } else if (t < 0.85) {
      p = 1;
    } else {
      p = 1 - (t - 0.85) / 0.15;
    }
    const ease = p * (2 - p);

    // Both hands to head
    rArm.rotation.z = rBaseZ + ease * 0.8;
    rArm.rotation.x = -ease * 1.1;
    lArm.rotation.z = lBaseZ - ease * 0.8;
    lArm.rotation.x = -ease * 1.1;

    // Head down
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.35;
    }

    // Body slump
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY - ease * 0.1;

    // Shake head in despair
    if (t > 0.25 && t < 0.85) {
      character.headGroup.rotation.y = Math.sin(t * Math.PI * 8) * 0.1;
    }
  }
}
