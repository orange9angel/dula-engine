import { AnimationBase } from '../AnimationBase.js';

export class SwayBody extends AnimationBase {
  constructor() {
    super('SwayBody', 1.0);
  }

  update(t, character) {
    character.mesh.rotation.z = Math.sin(t * Math.PI * 4) * 0.12;
  }
}
