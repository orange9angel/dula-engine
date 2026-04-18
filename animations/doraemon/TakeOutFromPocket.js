import { AnimationBase } from '../AnimationBase.js';

export class TakeOutFromPocket extends AnimationBase {
  constructor() {
    super('TakeOutFromPocket', 1.2);
  }

  update(t, character) {
    const arm = character.rightArm;
    if (!arm) return;
    const baseZ = character.rightArmBaseZ || arm.rotation.z;

    // Generic pocket rummage (reuse base pose from PullOutRacket)
    character.mesh.rotation.z = Math.sin(t * Math.PI * 3) * 0.05;

    if (t < 0.25) {
      // Reach into pocket
      const p = t / 0.25;
      arm.rotation.z = baseZ + 0.5 * p * p;
      arm.rotation.x = -0.6 * p * p;
    } else if (t < 0.45) {
      // Dig around
      const p = (t - 0.25) / 0.2;
      arm.rotation.z = baseZ + 0.5 + Math.sin(p * Math.PI * 4) * 0.06;
      arm.rotation.x = -0.6 + Math.sin(p * Math.PI * 3) * 0.08;
    } else if (t < 0.6) {
      // Pull out (generic reveal)
      const p = (t - 0.45) / 0.15;
      arm.rotation.z = baseZ + 0.5 * (1 - p);
      arm.rotation.x = -0.6 * (1 - p);
    } else {
      // Hold up proudly
      const p = (t - 0.6) / 0.4;
      arm.rotation.z = baseZ + Math.sin(p * Math.PI) * 0.15;
      arm.rotation.x = Math.sin(p * Math.PI) * 0.2;
    }
  }
}
