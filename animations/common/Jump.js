import { AnimationBase } from '../AnimationBase.js';

export class Jump extends AnimationBase {
  constructor() {
    super('Jump', 0.6);
  }

  update(t, character) {
    const y = Math.sin(t * Math.PI) * 0.5;
    const baseY = character.baseY || 0;
    character.mesh.position.y = baseY + y;
  }
}
