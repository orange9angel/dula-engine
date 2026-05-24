export { CameraMoveBase } from './CameraMoveBase.js';
export { CameraSmoothMove } from './CameraSmoothMove.js';

export const CameraMoveRegistry = {};

export function registerCameraMove(name, Class) {
  CameraMoveRegistry[name] = Class;
}
