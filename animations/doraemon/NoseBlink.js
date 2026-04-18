import { AnimationBase } from '../AnimationBase.js';

export class NoseBlink extends AnimationBase {
  constructor() {
    super('NoseBlink', 0.8);
  }

  update(t, character) {
    // Find the nose (it's a child of headGroup, second child after head sphere)
    // We'll traverse to find a red sphere near the nose position
    let nose = null;
    if (character.headGroup) {
      character.headGroup.traverse((child) => {
        if (child.isMesh && child.geometry && child.geometry.type === 'SphereGeometry') {
          // Nose is at ~y=0.12 relative to head
          if (Math.abs(child.position.y - 0.12) < 0.1 && child.position.z > 0.5) {
            nose = child;
          }
        }
      });
    }

    // Shy body language
    character.mesh.rotation.z = Math.sin(t * Math.PI) * 0.08;

    // Nose blinks (scales up and down)
    if (nose) {
      const blink = Math.abs(Math.sin(t * Math.PI * 4));
      const baseScale = 1.0;
      nose.scale.setScalar(baseScale + blink * 0.3);
    }

    // Paw at face shyly
    const rArm = character.rightArm;
    if (rArm) {
      const rBaseZ = character.rightArmBaseZ || rArm.rotation.z;
      const paw = Math.sin(t * Math.PI * 2) * 0.3;
      rArm.rotation.z = rBaseZ + paw;
      rArm.rotation.x = -paw * 0.5;
    }
  }
}
