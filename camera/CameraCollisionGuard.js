import * as THREE from 'three';

/**
 * Centralized camera collision resolver.
 *
 * Push a camera position out of:
 *  - character bounding spheres (torso/head approximation)
 *  - scene obstacles registered by the current scene (trees, furniture, walls, etc.)
 *
 * Usage from any CameraMoveBase subclass:
 *   import { CameraCollisionGuard } from 'dula-engine';
 *   const safePos = CameraCollisionGuard.resolve(desiredPos, context, { margin: 0.35 });
 *
 * The guard is conservative: it only moves the camera when it is actually inside
 * an obstacle, and it never pulls the camera below ground.
 */
export class CameraCollisionGuard {
  static defaultOptions = {
    margin: 0.35,            // extra clearance beyond obstacle radius
    groundHeight: 0.5,       // minimum camera y
    maxPush: 10.0,           // safety cap on push distance
  };

  /**
   * Resolve a single camera position against characters and scene obstacles.
   *
   * @param {THREE.Vector3} position - desired camera position (mutated in place and returned)
   * @param {Object} context - { characters, currentScene }
   * @param {Object} options - overrides for defaultOptions
   * @returns {THREE.Vector3} the safe position
   */
  static resolve(position, context, options = {}) {
    const opts = { ...CameraCollisionGuard.defaultOptions, ...options };

    // 1. Characters
    if (context && context.characters) {
      const chars = Array.from(context.characters.values()).filter(
        (c) => c && c.mesh && c.mesh.visible !== false
      );
      for (const c of chars) {
        CameraCollisionGuard._pushFromSphere(
          position,
          CameraCollisionGuard._characterCenter(c),
          (c.boundingRadius || 0.5) + opts.margin,
          opts.maxPush
        );
      }
    }

    // 2. Scene obstacles
    if (context && context.currentScene && context.currentScene.cameraObstacles) {
      for (const obs of context.currentScene.cameraObstacles) {
        if (!obs) continue;
        if (obs.type === 'sphere') {
          CameraCollisionGuard._pushFromSphere(
            position,
            obs.center,
            (obs.radius || 0.5) + opts.margin,
            opts.maxPush
          );
        } else if (obs.type === 'capsule') {
          CameraCollisionGuard._pushFromCapsule(
            position,
            obs.start,
            obs.end,
            (obs.radius || 0.5) + opts.margin,
            opts.maxPush
          );
        } else if (obs.type === 'box') {
          CameraCollisionGuard._pushFromBox(
            position,
            obs.center,
            obs.size,
            obs.rotation,
            opts.margin,
            opts.maxPush
          );
        }
      }
    }

    // 3. Floor clamp
    position.y = Math.max(opts.groundHeight, position.y);

    return position;
  }

  /**
   * Resolve an interpolated camera path. Pushes both endpoints and also samples
   * the path to catch cases where the straight line between two safe endpoints
   * passes through an obstacle.
   *
   * @param {THREE.Vector3} start - path start (mutated)
   * @param {THREE.Vector3} end - path end (mutated)
   * @param {Object} context
   * @param {Object} options
   * @param {number} samples - number of path samples to check
   */
  static resolvePath(start, end, context, options = {}, samples = 5) {
    CameraCollisionGuard.resolve(start, context, options);
    CameraCollisionGuard.resolve(end, context, options);

    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const sample = new THREE.Vector3().lerpVectors(start, end, t);
      CameraCollisionGuard.resolve(sample, context, options);
    }

    return { start, end };
  }

  static _characterCenter(character) {
    const center = new THREE.Vector3();
    character.mesh.getWorldPosition(center);
    center.y += character.boundingRadius || 0.5;
    return center;
  }

  static _pushFromSphere(position, center, radius, maxPush) {
    const toPos = new THREE.Vector3().subVectors(position, center);
    const dist = toPos.length();
    if (dist < radius && dist > 0.001) {
      const push = Math.min(radius - dist, maxPush);
      toPos.normalize().multiplyScalar(push);
      position.add(toPos);
    } else if (dist < 0.001) {
      // Exactly at center: push toward +X as a deterministic fallback
      position.x += radius;
    }
  }

  static _pushFromCapsule(position, start, end, radius, maxPush) {
    const closest = new THREE.Vector3();
    const t = CameraCollisionGuard._closestPointOnSegment(position, start, end, closest);
    const toPos = new THREE.Vector3().subVectors(position, closest);
    const dist = toPos.length();
    if (dist < radius && dist > 0.001) {
      const push = Math.min(radius - dist, maxPush);
      toPos.normalize().multiplyScalar(push);
      position.add(toPos);
    } else if (dist < 0.001) {
      // On capsule axis: push perpendicular toward +X/+Z
      const dir = new THREE.Vector3().subVectors(end, start).normalize();
      const fallback = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      if (fallback.lengthSq() < 0.001) fallback.set(1, 0, 0);
      position.add(fallback.multiplyScalar(radius));
    }
  }

  static _pushFromBox(position, center, size, rotation, margin, maxPush) {
    // Transform position into box-local space
    const invQuat = new THREE.Quaternion();
    if (rotation) invQuat.copy(rotation).invert();
    const localPos = position.clone().sub(center).applyQuaternion(invQuat);

    const halfSize = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    const closestLocal = new THREE.Vector3(
      Math.max(-halfSize.x, Math.min(halfSize.x, localPos.x)),
      Math.max(-halfSize.y, Math.min(halfSize.y, localPos.y)),
      Math.max(-halfSize.z, Math.min(halfSize.z, localPos.z))
    );

    const diff = new THREE.Vector3().subVectors(localPos, closestLocal);
    const dist = diff.length();

    if (dist < margin && dist > 0.001) {
      diff.normalize().multiplyScalar(Math.min(margin - dist, maxPush));
      localPos.add(diff);
      position.copy(center).add(localPos.applyQuaternion(rotation || new THREE.Quaternion()));
    } else if (dist < 0.001) {
      // Inside box center: push out along largest half-axis
      const axes = [
        { axis: new THREE.Vector3(1, 0, 0), extent: halfSize.x },
        { axis: new THREE.Vector3(0, 1, 0), extent: halfSize.y },
        { axis: new THREE.Vector3(0, 0, 1), extent: halfSize.z },
      ];
      axes.sort((a, b) => b.extent - a.extent);
      localPos.add(axes[0].axis.multiplyScalar(axes[0].extent + margin));
      position.copy(center).add(localPos.applyQuaternion(rotation || new THREE.Quaternion()));
    }
  }

  static _closestPointOnSegment(p, a, b, out) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const abLenSq = ab.lengthSq();
    if (abLenSq < 0.0001) {
      out.copy(a);
      return 0;
    }
    let t = ap.dot(ab) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    out.copy(a).add(ab.multiplyScalar(t));
    return t;
  }
}
