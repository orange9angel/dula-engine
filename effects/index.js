/**
 * Effects — 可复用光效组件
 *
 * 这些不是后处理（PostProcess），而是角色/场景内嵌的 Mesh-based 光效组件。
 * 用于统一角色 build() 中发光效果的创建方式，减少重复代码。
 */

export { GlowEffect } from './GlowEffect.js';
export { AuraEffect } from './AuraEffect.js';
