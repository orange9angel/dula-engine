import { AnimationBase } from '../AnimationBase.js';

export class Float extends AnimationBase {
  constructor() {
    super('Float', 2.0);
  }

  update(t, character) {
    const baseY = character.baseY || 0;

    // Gentle hover like a bamboo-copter flight
    character.mesh.position.y = baseY + 0.5 + Math.sin(t * Math.PI * 2) * 0.15;

    // Slow drift forward/back
    character.mesh.position.z = Math.sin(t * Math.PI) * 0.2;

    // Arms slightly out for flying pose
    const rArm = character.rightArm;
    const lArm = character.leftArm;
    if (rArm && lArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const lBaseZ = character.leftArmBaseZ || lArm.rotation.z;
      const flap = Math.sin(t * Math.PI * 3) * 0.15;
      rArm.rotation.z = rBaseZ + 0.3 + flap;
      lArm.rotation.z = lBaseZ - 0.3 - flap;
    }

    // Body tilts slightly with movement
    character.mesh.rotation.x = Math.sin(t * Math.PI * 2) * 0.05;
    character.mesh.rotation.z = Math.sin(t * Math.PI * 1.5) * 0.03;
  }
}
