export { AnimationBase } from './AnimationBase.js';
export {
  PoseMatrix,
  ActionPhase,
  PoseType,
  ANIM_TO_POSE_TYPE,
  getPoseType,
  getDefaultPhase,
} from './PoseMatrix.js';
export { ActionMatrixController } from './ActionMatrixController.js';

export const AnimationRegistry = {};

export function registerAnimation(name, Class) {
  AnimationRegistry[name] = Class;
}
