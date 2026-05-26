/**
 * PostProcess Registry — 后处理效果注册表
 *
 * 与 AnimationRegistry / SceneRegistry / CameraMoveRegistry 等保持一致的设计：
 * - 空对象作为注册表
 * - registerPostProcess() 函数用于注入
 */

export const PostProcessRegistry = {};

export function registerPostProcess(name, Class) {
  PostProcessRegistry[name] = Class;
}

export { PostProcessBase } from './PostProcessBase.js';
