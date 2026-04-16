import { AnimationBase } from '../AnimationBase.js';

export class StompFoot extends AnimationBase {
  constructor() {
    super('StompFoot', 0.5);
  }

  update(t, character) {
    const leg = character.leftLeg;
    if (!leg) return;
    // lift then stomp
    const phase = Math.sin(t * Math.PI);
    leg.rotation.x = -phase * 0.6;
    // body bounces slightly
    character.mesh.position.y = (character.baseY || 0) + phase * 0.03;
  }
}
