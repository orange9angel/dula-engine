export { SceneBase } from './SceneBase.js';

export const SceneRegistry = {};

export function registerScene(name, Class) {
  SceneRegistry[name] = Class;
}
