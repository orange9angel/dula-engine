export { CameraMoveBase } from './CameraMoveBase.js';
export { CameraCollisionGuard } from './CameraCollisionGuard.js';
export { CameraSmoothMove } from './CameraSmoothMove.js';
export { FightEmotionCloseUp } from './FightEmotionCloseUp.js';
export { FightBulletTimeTrack } from './FightBulletTimeTrack.js';
export { FightDramaticReveal } from './FightDramaticReveal.js';
export { FightOverhead } from './FightOverhead.js';

export const CameraMoveRegistry = {};

export function registerCameraMove(name, Class) {
  CameraMoveRegistry[name] = Class;
}
