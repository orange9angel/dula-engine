export { AnimationBase } from './AnimationBase.js';

export const AnimationRegistry = {};

export function registerAnimation(name, Class) {
  AnimationRegistry[name] = Class;
}
