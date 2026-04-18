import { AnimationBase } from '../AnimationBase.js';

export class Cry extends AnimationBase {
  constructor() {
    super('Cry', 1.5);
  }

  update(t, character) {
    const rArm = character.rightArm;
    if (!rArm) return;
    const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;

    // Wipe tears motion
    const wipe = Math.sin(t * Math.PI * 4) * 0.15;

    // Arm raises to eye level
    let raise = 1;
    if (t < 0.15) raise = t / 0.15;
    else if (t > 0.85) raise = 1 - (t - 0.85) / 0.15;
    const ease = raise < 0.5 ? 2 * raise * raise : -1 + (4 - 2 * raise) * raise;

    rArm.rotation.z = rBaseZ + ease * 0.6;
    rArm.rotation.x = -ease * 0.8 + wipe;

    // Head down in sorrow
    if (character.headGroup) {
      character.headGroup.rotation.x = ease * 0.3;
      // Body shakes with sobs
      character.headGroup.rotation.z = Math.sin(t * Math.PI * 8) * ease * 0.05;
    }

    // Shoulders heave
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + Math.sin(t * Math.PI * 6) * ease * 0.02;
  }
}
