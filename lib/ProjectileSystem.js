import * as THREE from 'three';

/**
 * ProjectileSystem — 弹道管理系统
 * 管理所有世界坐标系的飞行道具
 */
export class ProjectileSystem {
  constructor() {
    this.projectiles = []; // 活跃弹道数组
    this._pending = [];    // 待发射的弹道（按startTime排序）
  }
  
  /**
   * 注册一个待发射的弹道
   */
  schedule(projectile) {
    this._pending.push(projectile);
    this._pending.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * 立即发射一个弹道（用于测试或即时触发）
   */
  fire(projectile, scene) {
    this.projectiles.push(projectile);
    if (scene && projectile.createVisual) {
      projectile.createVisual(scene);
    }
  }
  
  /**
   * 更新所有弹道
   * @param {number} time — 当前故事时间
   * @param {number} delta — 帧间隔（秒）
   * @param {THREE.Scene} scene — 场景
   * @param {Map} characters — 角色映射
   */
  update(time, delta, scene, characters) {
    // 激活待发射的弹道
    while (this._pending.length > 0 && this._pending[0].startTime <= time) {
      const p = this._pending.shift();
      this.projectiles.push(p);
      if (scene && p.createVisual) {
        p.createVisual(scene);
      }
    }
    
    // 更新活跃弹道
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(time, delta, scene, characters);
      if (!p.active) {
        this.projectiles.splice(i, 1);
      }
    }
  }
  
  /**
   * 清理所有弹道
   */
  clear(scene) {
    for (const p of this.projectiles) {
      p._destroy(scene);
    }
    this.projectiles = [];
    this._pending = [];
  }
  
  /**
   * 获取弹道数量（调试用）
   */
  get count() {
    return this.projectiles.length + this._pending.length;
  }
}
