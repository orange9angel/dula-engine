import * as THREE from 'three';
import { CameraMoveBase } from './CameraMoveBase.js';
import { parseVecOption } from './utils.js';

/**
 * CameraSmoothMove — smooth camera interpolation between positions.
 * Instead of hard cuts, smoothly moves the camera from its current
 * position/lookAt to the target over a specified duration.
 */
export class CameraSmoothMove extends CameraMoveBase {
  constructor(options = {}) {
    super(options);
    this.name = 'CameraSmoothMove';
    this.duration = options.duration ?? 0.5;
    this.targetPosition = parseVecOption(options.position, new THREE.Vector3(0, 3, 10));
    this.targetLookAt = parseVecOption(options.lookAt, new THREE.Vector3(0, 1.5, 0));
    this.easeType = options.ease ?? 'easeInOutQuad'; // easeInOutQuad, easeOutCubic, linear
  }

  start(camera, context) {
    super.start(camera, context);
    this.startPosition = camera.position.clone();
    // Compute current lookAt direction
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.startLookAt = camera.position.clone().add(dir.multiplyScalar(10));
  }

  update(t, camera, context) {
    const ease = this._ease(t);

    // Interpolate position
    camera.position.lerpVectors(this.startPosition, this.targetPosition, ease);

    // Interpolate lookAt
    const currentLookAt = new THREE.Vector3().lerpVectors(this.startLookAt, this.targetLookAt, ease);
    camera.lookAt(currentLookAt);
  }

  _ease(t) {
    switch (this.easeType) {
      case 'easeInOutQuad':
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      case 'easeOutCubic':
        return 1 - Math.pow(1 - t, 3);
      case 'easeOutQuad':
        return 1 - (1 - t) * (1 - t);
      case 'linear':
      default:
        return t;
    }
  }
}
