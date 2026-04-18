import { AnimationBase } from '../AnimationBase.js';

export class Tremble extends AnimationBase {
  constructor() {
    super('Tremble', 1.0);
  }

  update(t, character) {
    const baseY = character.baseY || 0;
    const intensity = 0.03;
    const freq = 25;

    // Random-ish trembling using multiple sine waves
    character.mesh.position.x = Math.sin(t * freq) * intensity + Math.sin(t * freq * 1.7) * intensity * 0.5;
    character.mesh.position.y = baseY + Math.sin(t * freq * 1.3) * intensity * 0.7;
    character.mesh.position.z = Math.sin(t * freq * 0.9) * intensity;

    // Slight rotation tremble
    character.mesh.rotation.z = Math.sin(t * freq * 1.1) * 0.02;

    // Arms hug self slightly
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      rArm.rotation.z = rBaseZ - 0.15 + Math.sin(t * freq) * 0.03;
      lArm.rotation.z = lBaseZ + 0.15 + Math.sin(t * freq * 1.2) * 0.03;
    }
  }
}
