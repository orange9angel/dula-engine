import { TransitionBase } from './TransitionBase.js';

export const TransitionRegistry = {};

export function registerTransition(name, Class) {
  TransitionRegistry[name] = Class;
}

export { TransitionBase };
