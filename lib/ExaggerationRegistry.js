import * as THREE from 'three';

/**
 * ExaggerationRegistry — 夸张效果注册表
 *
 * 可复用的卡通/漫画风格夸张效果库。
 * 每个效果包含：
 * - type: 效果类型（deform, particle, screen, lighting, camera）
 * - build(): 创建效果实例
 * - update(): 动画更新
 * - dispose(): 清理
 */

export const ExaggerationRegistry = {};

export function registerExaggeration(name, config) {
  ExaggerationRegistry[name] = {
    name,
    type: config.type, // 'deform' | 'particle' | 'screen' | 'lighting' | 'camera'
    category: config.category, // 'face' | 'body' | 'environment' | 'screen'
    build: config.build,
    defaultDuration: config.defaultDuration || 0.5,
    defaultIntensity: config.defaultIntensity || 1.0,
  };
}

export function getExaggeration(name) {
  return ExaggerationRegistry[name] || null;
}

// ═══════════════════════════════════════
//  面部变形效果
// ═══════════════════════════════════════

registerExaggeration('eye_pop', {
  type: 'deform',
  category: 'face',
  defaultDuration: 0.4,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const group = new THREE.Group();
    group.name = 'exaggeration_eye_pop';

    // 保存原始缩放
    const originalScales = new Map();
    if (character.eyeLeft) {
      originalScales.set('eyeLeft', character.eyeLeft.scale.clone());
    }
    if (character.eyeRight) {
      originalScales.set('eyeRight', character.eyeRight.scale.clone());
    }

    return {
      intensity,
      timer: 0,
      originalScales,
      group,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.4);
        const scale = 1 + Math.sin(t * Math.PI) * 0.5 * this.intensity;

        if (character.eyeLeft) {
          character.eyeLeft.scale.setScalar(scale);
        }
        if (character.eyeRight) {
          character.eyeRight.scale.setScalar(scale);
        }

        return t >= 1;
      },
      dispose() {
        for (const [key, scale] of this.originalScales) {
          if (character[key]) {
            character[key].scale.copy(scale);
          }
        }
      },
    };
  },
});

registerExaggeration('eye_shrink', {
  type: 'deform',
  category: 'face',
  defaultDuration: 0.5,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const originalScales = new Map();
    if (character.eyeLeft) {
      originalScales.set('eyeLeft', character.eyeLeft.scale.clone());
    }
    if (character.eyeRight) {
      originalScales.set('eyeRight', character.eyeRight.scale.clone());
    }

    return {
      intensity,
      timer: 0,
      originalScales,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);
        const scale = Math.max(0.3, 1 - Math.sin(t * Math.PI) * 0.7 * this.intensity);

        if (character.eyeLeft) character.eyeLeft.scale.setScalar(scale);
        if (character.eyeRight) character.eyeRight.scale.setScalar(scale);

        return t >= 1;
      },
      dispose() {
        for (const [key, scale] of this.originalScales) {
          if (character[key]) character[key].scale.copy(scale);
        }
      },
    };
  },
});

registerExaggeration('jaw_drop', {
  type: 'deform',
  category: 'face',
  defaultDuration: 0.5,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const originalJawY = character.jaw?.position.y || 0;

    return {
      intensity,
      timer: 0,
      originalJawY,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);
        const drop = Math.sin(t * Math.PI) * 0.15 * this.intensity;

        if (character.jaw) {
          character.jaw.position.y = this.originalJawY - drop;
        }

        return t >= 1;
      },
      dispose() {
        if (character.jaw) {
          character.jaw.position.y = this.originalJawY;
        }
      },
    };
  },
});

registerExaggeration('eyebrow_fly', {
  type: 'deform',
  category: 'face',
  defaultDuration: 0.4,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const originalLeftY = character.eyebrowLeft?.position.y || 0;
    const originalRightY = character.eyebrowRight?.position.y || 0;

    return {
      intensity,
      timer: 0,
      originalLeftY,
      originalRightY,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.4);
        const lift = Math.sin(t * Math.PI) * 0.2 * this.intensity;

        if (character.eyebrowLeft) character.eyebrowLeft.position.y = this.originalLeftY + lift;
        if (character.eyebrowRight) character.eyebrowRight.position.y = this.originalRightY + lift;

        return t >= 1;
      },
      dispose() {
        if (character.eyebrowLeft) character.eyebrowLeft.position.y = this.originalLeftY;
        if (character.eyebrowRight) character.eyebrowRight.position.y = this.originalRightY;
      },
    };
  },
});

registerExaggeration('vein_forehead', {
  type: 'deform',
  category: 'face',
  defaultDuration: 0.8,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const group = new THREE.Group();
    group.name = 'exaggeration_vein_forehead';

    // 在额头位置创建青筋
    const veinGeo = new THREE.TorusGeometry(0.08, 0.015, 8, 16, Math.PI);
    const veinMat = new THREE.MeshBasicMaterial({ color: 0x880000 });
    const vein = new THREE.Mesh(veinGeo, veinMat);
    vein.position.set(0, 0.25, 0.15);
    vein.rotation.x = -Math.PI / 2;
    group.add(vein);

    // 添加脉冲效果
    const pulseGeo = new THREE.SphereGeometry(0.02, 6, 6);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.6 });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.position.set(0.08, 0.25, 0.15);
    group.add(pulse);

    if (character.head) {
      character.head.add(group);
    } else if (character.mesh) {
      character.mesh.add(group);
    }

    return {
      intensity,
      timer: 0,
      group,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.8);

        // 脉冲跳动
        const pulseScale = 1 + Math.sin(this.timer * 10) * 0.3 * this.intensity;
        pulse.scale.setScalar(pulseScale);
        pulse.material.opacity = 0.6 * (1 - t) * this.intensity;

        // 青筋颜色加深
        vein.material.color.setHSL(0.0, 0.8, 0.3 + Math.sin(this.timer * 8) * 0.1);

        return t >= 1;
      },
      dispose() {
        if (this.group.parent) {
          this.group.parent.remove(this.group);
        }
        this.group.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      },
    };
  },
});

// ═══════════════════════════════════════
//  身体变形效果
// ═══════════════════════════════════════

registerExaggeration('chibi_deform', {
  type: 'deform',
  category: 'body',
  defaultDuration: 0.5,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const originalScale = character.mesh?.scale?.clone() || new THREE.Vector3(1, 1, 1);
    const charHeight = character.height || 1.7;

    return {
      intensity,
      timer: 0,
      originalScale,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);
        const chibiFactor = Math.sin(t * Math.PI) * 0.3 * this.intensity;

        if (character.mesh) {
          character.mesh.scale.y = this.originalScale.y * (1 - chibiFactor * 0.5);
          character.mesh.scale.x = this.originalScale.x * (1 + chibiFactor * 0.3);
          character.mesh.scale.z = this.originalScale.z * (1 + chibiFactor * 0.3);
        }

        return t >= 1;
      },
      dispose() {
        if (character.mesh) {
          character.mesh.scale.copy(this.originalScale);
        }
      },
    };
  },
});

registerExaggeration('hair_stand', {
  type: 'deform',
  category: 'body',
  defaultDuration: 0.5,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const hairMeshes = [];
    const originalPositions = new Map();

    // 收集头发mesh
    character.mesh?.traverse((child) => {
      if (child.name && (child.name.includes('hair') || child.name.includes('Hair'))) {
        hairMeshes.push(child);
        originalPositions.set(child.uuid, child.position.clone());
      }
    });

    return {
      intensity,
      timer: 0,
      hairMeshes,
      originalPositions,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);
        const lift = Math.sin(t * Math.PI) * 0.3 * this.intensity;

        for (const hair of this.hairMeshes) {
          const original = this.originalPositions.get(hair.uuid);
          if (original) {
            hair.position.y = original.y + lift;
          }
        }

        return t >= 1;
      },
      dispose() {
        for (const hair of this.hairMeshes) {
          const original = this.originalPositions.get(hair.uuid);
          if (original) {
            hair.position.copy(original);
          }
        }
      },
    };
  },
});

// ═══════════════════════════════════════
//  粒子特效
// ═══════════════════════════════════════

registerExaggeration('anger_aura', {
  type: 'particle',
  category: 'body',
  defaultDuration: 1.0,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const particles = [];
    const charHeight = character.height || 1.7;
    const auraColor = options.color || 0xff4400;
    const count = Math.floor(40 * intensity); // 增加粒子数量
    const scene = character.mesh?.parent;
    if (!scene) return null;

    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 8, 8); // 更大的粒子
      const mat = new THREE.MeshBasicMaterial({
        color: auraColor,
        transparent: true,
        opacity: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        character.mesh.position.x + (Math.random() - 0.5) * 0.5,
        character.mesh.position.y + Math.random() * charHeight,
        character.mesh.position.z + (Math.random() - 0.5) * 0.5
      );
      mesh.userData = {
        angle: Math.random() * Math.PI * 2,
        radius: 0.2 + Math.random() * 0.3,
        speed: 2 + Math.random() * 3,
        pulseOffset: Math.random() * Math.PI * 2,
      };
      scene.add(mesh);
      particles.push(mesh);
    }

    return {
      intensity,
      timer: 0,
      particles,
      auraColor,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 1.0);
        const pulse = Math.sin(t * Math.PI * 2 * (options.pulse || 8));

        for (const p of this.particles) {
          p.userData.angle += p.userData.speed * delta;
          p.position.x = character.mesh.position.x + Math.cos(p.userData.angle) * p.userData.radius;
          p.position.z = character.mesh.position.z + Math.sin(p.userData.angle) * p.userData.radius;
          p.position.y += Math.sin(this.timer * 3 + p.userData.pulseOffset) * 0.01;
          p.scale.y = 1 + pulse * 0.3;
          p.material.opacity = 0.8 * (1 - t) * (0.7 + pulse * 0.3);
        }

        return t >= 1;
      },
      dispose() {
        for (const p of this.particles) {
          if (p.parent) p.parent.remove(p);
          p.geometry.dispose();
          p.material.dispose();
        }
      },
    };
  },
});

registerExaggeration('anger_symbol', {
  type: 'particle',
  category: 'face',
  defaultDuration: 0.8,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const symbols = [];
    const symbolCount = Math.floor(2 * intensity);
    const charHeight = character.height || 1.7;

    for (let i = 0; i < symbolCount; i++) {
      // 创建怒气符号（十字形）
      const group = new THREE.Group();
      const bar1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.02, 0.01),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      const bar2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.06, 0.01),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      group.add(bar1, bar2);

      group.position.set(
        character.mesh.position.x + (i === 0 ? -0.2 : 0.2),
        character.mesh.position.y + charHeight + 0.1,
        character.mesh.position.z + 0.2
      );
      scene.add(group);
      symbols.push(group);
    }

    return {
      intensity,
      timer: 0,
      symbols,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.8);

        for (const s of this.symbols) {
          s.rotation.z += delta * 2;
          s.position.y += Math.sin(this.timer * 5) * 0.001;
          const scale = 1 + Math.sin(this.timer * 8) * 0.2;
          s.scale.setScalar(scale);
          s.traverse((child) => {
            if (child.material) child.material.opacity = 1 - t;
          });
        }

        return t >= 1;
      },
      dispose() {
        for (const s of this.symbols) {
          if (s.parent) s.parent.remove(s);
          s.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
          });
        }
      },
    };
  },
});

registerExaggeration('sweat_drop', {
  type: 'particle',
  category: 'face',
  defaultDuration: 0.8,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const drops = [];
    const dropCount = Math.floor(2 * intensity);
    const charHeight = character.height || 1.7;

    for (let i = 0; i < dropCount; i++) {
      const geo = new THREE.SphereGeometry(0.03, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.7,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        character.mesh.position.x + (i === 0 ? -0.15 : 0.15),
        character.mesh.position.y + charHeight * 0.85,
        character.mesh.position.z + 0.1
      );
      scene.add(mesh);
      drops.push({ mesh, startY: mesh.position.y });
    }

    return {
      intensity,
      timer: 0,
      drops,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.8);

        for (const d of this.drops) {
          d.mesh.position.y = d.startY - t * 0.15;
          d.mesh.material.opacity = 0.7 * (1 - t);
        }

        return t >= 1;
      },
      dispose() {
        for (const d of this.drops) {
          if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
          d.mesh.geometry.dispose();
          d.mesh.material.dispose();
        }
      },
    };
  },
});

registerExaggeration('tear_fountain', {
  type: 'particle',
  category: 'face',
  defaultDuration: 1.0,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const tears = [];
    const tearCount = Math.floor(10 * intensity);
    const charHeight = character.height || 1.7;

    for (let i = 0; i < tearCount; i++) {
      const geo = new THREE.SphereGeometry(0.02, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xaaddff,
        transparent: true,
        opacity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        character.mesh.position.x + (Math.random() - 0.5) * 0.1,
        character.mesh.position.y + charHeight * 0.88,
        character.mesh.position.z + 0.1
      );
      mesh.userData = {
        velocity: 0.5 + Math.random() * 0.5,
        side: Math.random() > 0.5 ? -1 : 1,
      };
      scene.add(mesh);
      tears.push(mesh);
    }

    return {
      intensity,
      timer: 0,
      tears,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 1.0);

        for (const tear of this.tears) {
          tear.position.y -= tear.userData.velocity * delta;
          tear.position.x += Math.sin(this.timer * 3) * 0.001 * tear.userData.side;
          tear.material.opacity = 0.6 * (1 - t);
        }

        return t >= 1;
      },
      dispose() {
        for (const tear of this.tears) {
          if (tear.parent) tear.parent.remove(tear);
          tear.geometry.dispose();
          tear.material.dispose();
        }
      },
    };
  },
});

// ═══════════════════════════════════════
//  屏幕/环境特效
// ═══════════════════════════════════════

registerExaggeration('impact_lines', {
  type: 'screen',
  category: 'environment',
  defaultDuration: 0.3,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const lines = [];
    const lineCount = Math.floor(8 * intensity);

    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2;
      const length = 0.5 + Math.random() * 0.5;
      const geo = new THREE.PlaneGeometry(0.02, length);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        character.mesh.position.x + Math.cos(angle) * 0.3,
        character.mesh.position.y + Math.random() * 0.5,
        character.mesh.position.z + Math.sin(angle) * 0.3
      );
      mesh.rotation.y = angle;
      scene.add(mesh);
      lines.push(mesh);
    }

    return {
      intensity,
      timer: 0,
      lines,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.3);

        for (const line of this.lines) {
          line.material.opacity = 0.8 * (1 - t);
          line.scale.x = 1 + t * 0.5;
        }

        return t >= 1;
      },
      dispose() {
        for (const line of this.lines) {
          if (line.parent) line.parent.remove(line);
          line.geometry.dispose();
          line.material.dispose();
        }
      },
    };
  },
});

registerExaggeration('screen_shake', {
  type: 'camera',
  category: 'screen',
  defaultDuration: 0.5,
  build: (character, options = {}) => {
    const camera = options.camera || (typeof window !== 'undefined' ? window.__dulaCamera : null);
    if (!camera) return null;

    const intensity = options.intensity || 1.0;
    const originalPosition = camera.position.clone();

    return {
      intensity,
      timer: 0,
      originalPosition,
      camera,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);

        if (t < 1) {
          const shake = (1 - t) * 0.1 * this.intensity;
          this.camera.position.x = this.originalPosition.x + (Math.random() - 0.5) * shake;
          this.camera.position.y = this.originalPosition.y + (Math.random() - 0.5) * shake;
          this.camera.position.z = this.originalPosition.z + (Math.random() - 0.5) * shake;
        } else {
          this.camera.position.copy(this.originalPosition);
        }

        return t >= 1;
      },
      dispose() {
        this.camera.position.copy(this.originalPosition);
      },
    };
  },
});

registerExaggeration('bg_black', {
  type: 'screen',
  category: 'environment',
  defaultDuration: 0.5,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;

    // 创建背景遮罩
    const geo = new THREE.PlaneGeometry(20, 20);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(character.mesh.position.x, character.mesh.position.y + 1, character.mesh.position.z - 2);
    mesh.renderOrder = -1; // 确保在最底层
    scene.add(mesh);

    return {
      intensity,
      timer: 0,
      mesh,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);

        // 先淡入再淡出
        if (t < 0.5) {
          this.mesh.material.opacity = (t / 0.5) * 0.8 * this.intensity;
        } else {
          this.mesh.material.opacity = ((1 - t) / 0.5) * 0.8 * this.intensity;
        }

        return t >= 1;
      },
      dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
      },
    };
  },
});

// ═══════════════════════════════════════
//  预设组合
// ═══════════════════════════════════════

export const EXAGGERATION_PRESETS = {
  // 热血少年漫：愤怒
  shonen_anger: ['anger_aura', 'vein_forehead', 'hair_stand'],
  // 热血少年漫：震惊
  shonen_shock: ['eye_pop', 'impact_lines', 'screen_shake'],
  // 热血少年漫：爆发
  shonen_powerup: ['anger_aura', 'hair_stand', 'screen_shake'],
  // 搞笑：震惊
  comedy_shock: ['eye_pop', 'jaw_drop', 'sweat_drop'],
  // 搞笑：愤怒
  comedy_anger: ['anger_symbol', 'vein_forehead', 'chibi_deform'],
  // 恐怖：震惊
  horror_shock: ['eye_shrink', 'screen_shake', 'bg_black'],
  // 恐怖：绝望
  horror_despair: ['eye_shrink', 'bg_black', 'tear_fountain'],
  // 萌系：哭泣
  moe_cry: ['tear_fountain', 'chibi_deform', 'eye_shrink'],
  // 萌系：震惊
  moe_shock: ['eye_pop', 'chibi_deform'],
  // 萌系：开心
  moe_joy: ['chibi_deform', 'eyebrow_fly'],
};

export default ExaggerationRegistry;
