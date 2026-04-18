import { AnimationBase } from '../AnimationBase.js';

export class Bow extends AnimationBase {
  constructor() {
    super('Bow', 1.2);
  }

  update(t, character) {
    const body = character.mesh;
    const head = character.headGroup;

    // Bend forward 0~45% , hold 45~70%, return 70~100%
    let angle = 0;
    if (t < 0.45) {
      const p = t / 0.45;
      angle = p * p * 0.6; // ease in
    } else if (t < 0.7) {
      angle = 0.6;
    } else {
      const p = (t - 0.7) / 0.3;
      angle = 0.6 * (1 - p) * (1 - p); // ease out
    }

    body.rotation.x = angle;
    if (head) {
      head.rotation.x = angle * 0.3;
    }

    // Slight forward offset to keep feet planted
    body.position.z = (Math.sin(angle) * 0.35);
  }
}
