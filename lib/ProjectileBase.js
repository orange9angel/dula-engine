import * as THREE from 'three';

/**
 * ProjectileBase — 世界坐标系弹道基类
 * 管理从发射点到目标点的飞行轨迹
 * 
 * 设计原则：所有动画基于故事时间(time)，不使用 requestAnimationFrame
 * 适用于离线逐帧渲染环境
 */
export class ProjectileBase {
  constructor(options = {}) {
    this.id = Math.random().toString(36).slice(2);
    this.startTime = options.startTime || 0;
    this.speed = options.speed || 10; // units per second
    this.fromPos = options.fromPos ? options.fromPos.clone() : new THREE.Vector3();
    this.toPos = options.toPos ? options.toPos.clone() : new THREE.Vector3();
    this.attacker = options.attacker || null;
    this.defender = options.defender || null;
    
    // 计算方向
    this.direction = new THREE.Vector3().subVectors(this.toPos, this.fromPos).normalize();
    this.distance = this.fromPos.distanceTo(this.toPos);
    this.duration = this.distance / this.speed;
    this.endTime = this.startTime + this.duration;
    
    // 状态
    this.hit = false;
    this.active = true;
    this.hitTime = null;
    this.visualCreated = false;
    
    // Three.js 对象
    this.mesh = null;
    this.trail = []; // 轨迹点数组 {pos, time}
    this.trailMesh = null;
    
    // 击中特效对象（用于基于时间的更新）
    this.hitEffects = []; // { mesh, startTime, duration, type }
    
    // 回调
    this.onHit = options.onHit || null;
    this.onComplete = options.onComplete || null;
  }
  
  /**
   * 创建视觉表现，子类重写
   */
  createVisual(scene) {
    if (this.visualCreated) return this.mesh;
    this.visualCreated = true;
    
    const geometry = new THREE.SphereGeometry(0.15, 16, 16);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x88ccff, 
      transparent: true, 
      opacity: 0.9 
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.fromPos);
    scene.add(this.mesh);
    return this.mesh;
  }
  
  /**
   * 更新弹道位置和特效
   * @param {number} time — 当前故事时间
   * @param {number} delta — 帧间隔（已考虑timeScale）
   * @param {THREE.Scene} scene — 场景
   * @param {Map} characters — 角色映射
   */
  update(time, delta, scene, characters) {
    if (!this.active) {
      // 即使弹道已结束，继续更新击中特效
      this._updateHitEffects(time, scene);
      return;
    }
    
    if (time < this.startTime) return;
    
    // 确保视觉对象已创建
    if (!this.visualCreated && scene) {
      this.createVisual(scene);
    }
    
    if (time >= this.endTime) {
      if (!this.hit) {
        this._triggerHit(time, scene, characters);
      }
      this._destroy(scene);
      return;
    }
    
    // 计算当前位置
    const progress = (time - this.startTime) / this.duration;
    const currentPos = new THREE.Vector3().lerpVectors(this.fromPos, this.toPos, progress);
    
    // 更新mesh位置
    if (this.mesh) {
      this.mesh.position.copy(currentPos);
    }
    
    // 记录轨迹点
    this.trail.push({ pos: currentPos.clone(), time });
    if (this.trail.length > 30) this.trail.shift();
    
    // 更新轨迹mesh
    this._updateTrail(scene);
    
    // 碰撞检测
    if (this.defender && characters) {
      const defenderChar = characters.get(this.defender);
      if (defenderChar && defenderChar.mesh) {
        const dist = currentPos.distanceTo(defenderChar.mesh.position);
        if (dist < (defenderChar.boundingRadius || 0.5) + 0.2) {
          this._triggerHit(time, scene, characters);
          this._destroy(scene);
          return;
        }
      }
    }
    
    // 更新已有的击中特效
    this._updateHitEffects(time, scene);
  }
  
  /**
   * 触发命中效果
   */
  _triggerHit(time, scene, characters) {
    if (this.hit) return;
    this.hit = true;
    this.hitTime = time;
    
    // 创建击中特效
    this._createHitEffect(time, scene);
    
    // 触发防御者的受击反应
    if (this.defender && characters) {
      const defender = characters.get(this.defender);
      if (defender && defender.playAnimation) {
        this._triggerReaction(defender, time);
      }
    }
    
    if (this.onHit) {
      this.onHit(this, time, scene, characters);
    }
  }
  
  /**
   * 触发防御者受击反应，子类可重写
   */
  _triggerReaction(defender, time) {
    // 默认不做任何事，由子类或外部系统处理
  }
  
  /**
   * 创建击中特效，子类重写
   * 所有特效必须加入 this.hitEffects 数组，由 _updateHitEffects 驱动
   */
  _createHitEffect(time, scene) {
    const hitPos = this.toPos.clone();
    
    // 简单的爆炸球
    const geometry = new THREE.SphereGeometry(0.4, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.8,
    });
    const burst = new THREE.Mesh(geometry, material);
    burst.position.copy(hitPos);
    scene.add(burst);
    
    this.hitEffects.push({
      mesh: burst,
      startTime: time,
      duration: 0.3,
      type: 'burst',
      baseScale: 1,
    });
  }
  
  /**
   * 更新所有击中特效（基于故事时间）
   */
  _updateHitEffects(time, scene) {
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const effect = this.hitEffects[i];
      const elapsed = time - effect.startTime;
      
      if (elapsed >= effect.duration) {
        // 特效结束，清理
        scene.remove(effect.mesh);
        effect.mesh.geometry?.dispose();
        effect.mesh.material?.dispose();
        this.hitEffects.splice(i, 1);
        continue;
      }
      
      const progress = elapsed / effect.duration;
      
      if (effect.type === 'burst') {
        const s = effect.baseScale * (1 + elapsed * 5);
        effect.mesh.scale.setScalar(s);
        effect.mesh.material.opacity = 0.8 * (1 - progress);
      } else if (effect.type === 'ring') {
        const s = 1 + elapsed * 10;
        effect.mesh.scale.setScalar(s);
        effect.mesh.material.opacity = 0.8 * (1 - progress);
      }
    }
  }
  
  /**
   * 更新轨迹渲染
   */
  _updateTrail(scene) {
    if (this.trail.length < 2) return;
    
    if (this.trailMesh) {
      scene.remove(this.trailMesh);
      this.trailMesh.geometry?.dispose();
    }
    
    const points = this.trail.map(t => t.pos);
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, points.length * 2, 0.05, 4, false);
    const material = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.4,
    });
    this.trailMesh = new THREE.Mesh(geometry, material);
    scene.add(this.trailMesh);
  }
  
  /**
   * 销毁弹道
   */
  _destroy(scene) {
    this.active = false;
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.mesh = null;
    }
    if (this.trailMesh) {
      scene.remove(this.trailMesh);
      this.trailMesh.geometry?.dispose();
      this.trailMesh.material?.dispose();
      this.trailMesh = null;
    }
    if (this.onComplete) {
      this.onComplete(this);
    }
  }
  
  /**
   * 完全清理（包括所有特效）
   */
  cleanup(scene) {
    this._destroy(scene);
    for (const effect of this.hitEffects) {
      scene.remove(effect.mesh);
      effect.mesh.geometry?.dispose();
      effect.mesh.material?.dispose();
    }
    this.hitEffects = [];
  }
}
