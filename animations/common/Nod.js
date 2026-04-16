import { AnimationBase } from '../AnimationBase.js';

export class Nod extends AnimationBase {
  constructor() {
    super('Nod', 0.5);
  }

  update(t, character) {
    if (!character.headGroup) return;
    const angle = Math.sin(t * Math.PI) * 0.15;
    character.headGroup.rotation.x = angle;
  }
}
