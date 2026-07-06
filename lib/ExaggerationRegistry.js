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
    if (character.pupilLeft) {
      originalScales.set('pupilLeft', character.pupilLeft.scale.clone());
    }
    if (character.pupilRight) {
      originalScales.set('pupilRight', character.pupilRight.scale.clone());
    }

    return {
      group,
      originalScales,
      intensity,
      phase: 'pop', // pop -> hold -> recover
      timer: 0,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.4);

        let scale = 1;
        if (this.phase === 'pop') {
          scale = 1 + Math.sin(t * Math.PI * 0.5) * 2.5 * this.intensity;
          if (t >= 0.3) this.phase = 'hold';
        } else if (this.phase === 'hold') {
          scale = 1 + 2.5 * this.intensity * (1 - (t - 0.3) / 0.3);
          if (t >= 0.6) this.phase = 'recover';
        } else {
          scale = 1 + 2.5 * this.intensity * (1 - t) * 0.5;
        }

        const eyeScale = Math.max(1, scale);
        if (character.eyeLeft) character.eyeLeft.scale.setScalar(eyeScale);
        if (character.eyeRight) character.eyeRight.scale.setScalar(eyeScale);
        // 瞳孔缩小形成对比
        const pupilScale = Math.max(0.3, 1 - (scale - 1) * 0.3);
        if (character.pupilLeft) character.pupilLeft.scale.setScalar(pupilScale);
        if (character.pupilRight) character.pupilRight.scale.setScalar(pupilScale);

        return t >= 1;
      },
      dispose() {
        // 恢复原始缩放
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
    const originalJawY = character.jaw?.position?.y || 0;
    const originalMouthY = character.mouth?.position?.y || 0;

    return {
      intensity,
      timer: 0,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.5);
        const drop = Math.sin(t * Math.PI) * 0.06 * this.intensity;

        if (character.jaw) {
          character.jaw.position.y = originalJawY - drop;
          character.jaw.rotation.x = drop * 5;
        }
        if (character.mouth) {
          character.mouth.position.y = originalMouthY - drop * 0.5;
          character.mouth.scale.y = 1 + drop * 3;
        }

        return t >= 1;
      },
      dispose() {
        if (character.jaw) {
          character.jaw.position.y = originalJawY;
          character.jaw.rotation.x = 0;
        }
        if (character.mouth) {
          character.mouth.position.y = originalMouthY;
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
    const leftBaseY = character.leftEyebrow?.position?.y || 0;
    const rightBaseY = character.rightEyebrow?.position?.y || 0;

    return {
      intensity,
      timer: 0,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.4);
        const offset = Math.sin(t * Math.PI) * 0.08 * this.intensity;

        if (character.leftEyebrow) {
          character.leftEyebrow.position.y = leftBaseY + offset;
          character.leftEyebrow.rotation.z = offset * 2;
        }
        if (character.rightEyebrow) {
          character.rightEyebrow.position.y = rightBaseY + offset;
          character.rightEyebrow.rotation.z = -offset * 2;
        }

        return t >= 1;
      },
      dispose() {
        if (character.leftEyebrow) {
          character.leftEyebrow.position.y = leftBaseY;
          character.leftEyebrow.rotation.z = 0;
        }
        if (character.rightEyebrow) {
          character.rightEyebrow.position.y = rightBaseY;
          character.rightEyebrow.rotation.z = 0;
        }
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
  defaultDuration: 0.8,
  build: (character, options = {}) => {
    const intensity = options.intensity || 1.0;
    const headGroup = character.headGroup;
    const bodyMesh = character.mesh;
    const originalHeadScale = headGroup?.scale?.clone() || new THREE.Vector3(1, 1, 1);
    const originalBodyScale = bodyMesh?.scale?.clone() || new THREE.Vector3(1, 1, 1);

    return {
      intensity,
      timer: 0,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.8);
        const factor = Math.sin(t * Math.PI) * 0.3 * this.intensity;

        if (headGroup) {
          headGroup.scale.set(
            originalHeadScale.x * (1 + factor),
            originalHeadScale.y * (1 + factor),
            originalHeadScale.z * (1 + factor)
          );
        }
        if (bodyMesh) {
          bodyMesh.scale.set(
            originalBodyScale.x * (1 - factor * 0.5),
            originalBodyScale.y * (1 - factor * 0.3),
            originalBodyScale.z * (1 - factor * 0.5)
          );
        }

        return t >= 1;
      },
      dispose() {
        if (headGroup) headGroup.scale.copy(originalHeadScale);
        if (bodyMesh) bodyMesh.scale.copy(originalBodyScale);
      },
    };
  },
});

registerExaggeration('hair_stand', {
  type: 'particle',
  category: 'body',
  defaultDuration: 1.0,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const particles = [];
    const hairCount = Math.floor(15 * intensity);

    // 在头顶生成向上飞散的几何体
    for (let i = 0; i < hairCount; i++) {
      const geo = new THREE.ConeGeometry(0.01, 0.08, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: options.color || 0x332211,
        transparent: true,
        opacity: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = (i / hairCount) * Math.PI * 2 + Math.random() * 0.5;
      mesh.position.set(
        character.mesh.position.x + Math.cos(angle) * 0.08,
        character.mesh.position.y + character.height * 0.9,
        character.mesh.position.z + Math.sin(angle) * 0.08
      );
      mesh.rotation.z = Math.random() * 0.3;
      mesh.userData = {
        velocity: new THREE.Vector3(
          Math.cos(angle) * 0.5,
          2 + Math.random() * 2,
          Math.sin(angle) * 0.5
        ),
      };
      scene.add(mesh);
      particles.push(mesh);
    }

    return {
      intensity,
      timer: 0,
      particles,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 1.0);

        for (const p of this.particles) {
          p.userData.velocity.y += 3 * delta; // 向上加速
          p.position.addScaledVector(p.userData.velocity, delta);
          p.rotation.z += delta * 3;
          p.material.opacity = 0.8 * (1 - t);
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

// ═══════════════════════════════════════
//  粒子效果
// ═══════════════════════════════════════

registerExaggeration('sweat_drop', {
  type: 'particle',
  category: 'face',
  defaultDuration: 1.2,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const dropCount = Math.floor(3 * intensity);
    const drops = [];

    for (let i = 0; i < dropCount; i++) {
      const geo = new THREE.SphereGeometry(0.015, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.7,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // 挂在太阳穴位置
      const side = i % 2 === 0 ? 1 : -1;
      mesh.position.set(
        character.mesh.position.x + side * 0.12,
        character.mesh.position.y + character.height * 0.75,
        character.mesh.position.z + 0.05
      );
      mesh.userData = { speed: 0.3 + Math.random() * 0.2 };
      scene.add(mesh);
      drops.push(mesh);
    }

    return {
      intensity,
      timer: 0,
      drops,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 1.2);

        for (const d of this.drops) {
          d.position.y -= d.userData.speed * delta;
          d.material.opacity = 0.7 * (1 - t);
        }

        return t >= 1;
      },
      dispose() {
        for (const d of this.drops) {
          if (d.parent) d.parent.remove(d);
          d.geometry.dispose();
          d.material.dispose();
        }
      },
    };
  },
});

registerExaggeration('anger_aura', {
  type: 'particle',
  category: 'body',
  defaultDuration: 1.0,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const color = options.color || 0xff3300;
    const auraCount = Math.floor(20 * intensity);
    const particles = [];

    for (let i = 0; i < auraCount; i++) {
      const geo = new THREE.PlaneGeometry(0.05, 0.15);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.2 + Math.random() * 0.3;
      mesh.position.set(
        character.mesh.position.x + Math.cos(angle) * radius,
        character.mesh.position.y + Math.random() * character.height,
        character.mesh.position.z + Math.sin(angle) * radius
      );
      mesh.userData = {
        angle,
        radius,
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
      color,
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
          p.material.opacity = 0.6 * (1 - t) * (0.7 + pulse * 0.3);
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

registerExaggeration('tear_fountain', {
  type: 'particle',
  category: 'face',
  defaultDuration: 1.5,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const tearCount = Math.floor(10 * intensity);
    const tears = [];

    for (let i = 0; i < tearCount; i++) {
      const geo = new THREE.SphereGeometry(0.012, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xaaddff,
        transparent: true,
        opacity: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const side = i % 2 === 0 ? 1 : -1;
      mesh.position.set(
        character.mesh.position.x + side * 0.06,
        character.mesh.position.y + character.height * 0.72,
        character.mesh.position.z + 0.06
      );
      mesh.userData = {
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          1.5 + Math.random() * 1.5,
          0.3 + Math.random() * 0.2
        ),
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
        const t = this.timer / (options.duration || 1.5);

        for (const tear of this.tears) {
          tear.userData.velocity.y -= 3 * delta; // 重力
          tear.position.addScaledVector(tear.userData.velocity, delta);
          tear.material.opacity = 0.8 * (1 - t);
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

registerExaggeration('vein_forehead', {
  type: 'particle',
  category: 'face',
  defaultDuration: 0.8,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const veins = [];
    const veinCount = Math.floor(3 * intensity);

    for (let i = 0; i < veinCount; i++) {
      const points = [];
      const startX = (Math.random() - 0.5) * 0.06;
      const startY = character.height * 0.78;
      for (let j = 0; j < 5; j++) {
        points.push(new THREE.Vector3(
          startX + (Math.random() - 0.5) * 0.02,
          startY - j * 0.01,
          0.05 + j * 0.005
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const geo = new THREE.TubeGeometry(curve, 8, 0.003, 4, false);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xcc3333,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(character.mesh.position);
      scene.add(mesh);
      veins.push(mesh);
    }

    return {
      intensity,
      timer: 0,
      veins,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.8);

        for (const v of this.veins) {
          v.material.opacity = 0.9 * (1 - t) * (0.5 + Math.sin(t * Math.PI * 4) * 0.5);
        }

        return t >= 1;
      },
      dispose() {
        for (const v of this.veins) {
          if (v.parent) v.parent.remove(v);
          v.geometry.dispose();
          v.material.dispose();
        }
      },
    };
  },
});

// ═══════════════════════════════════════
//  屏幕/环境效果
// ═══════════════════════════════════════

registerExaggeration('impact_lines', {
  type: 'screen',
  category: 'screen',
  defaultDuration: 0.3,
  build: (character, options = {}) => {
    // 需要相机引用，通过 options.camera 传入
    const camera = options.camera || (typeof window !== 'undefined' ? window.__dulaCamera : null);
    if (!camera) return null;

    const intensity = options.intensity || 1.0;
    const lineCount = Math.floor(12 * intensity);
    const lines = [];
    const group = new THREE.Group();
    group.name = 'exaggeration_impact_lines';

    // 在相机前创建放射线
    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2;
      const geo = new THREE.PlaneGeometry(0.005, 2 + Math.random());
      const mat = new THREE.MeshBasicMaterial({
        color: options.color || 0x000000,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        Math.cos(angle) * 0.5,
        Math.sin(angle) * 0.5,
        -1.5
      );
      mesh.rotation.z = angle + Math.PI / 2;
      group.add(mesh);
      lines.push(mesh);
    }

    camera.add(group);

    return {
      intensity,
      timer: 0,
      group,
      lines,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.3);

        for (const line of this.lines) {
          const scale = 1 + Math.sin(t * Math.PI) * 2 * this.intensity;
          line.scale.y = scale;
          line.material.opacity = 0.6 * (1 - t) * (0.5 + Math.sin(t * Math.PI * 3) * 0.5);
        }

        return t >= 1;
      },
      dispose() {
        if (this.group.parent) this.group.parent.remove(this.group);
        for (const line of this.lines) {
          line.geometry.dispose();
          line.material.dispose();
        }
      },
    };
  },
});

registerExaggeration('bg_black', {
  type: 'lighting',
  category: 'environment',
  defaultDuration: 0.6,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const originalAmbient = scene.children
      .filter(c => c.type === 'AmbientLight')
      .map(l => ({ light: l, intensity: l.intensity }));

    // 降低环境光
    for (const { light } of originalAmbient) {
      light.intensity = 0.1;
    }

    // 添加聚光灯聚焦角色
    const spotLight = new THREE.SpotLight(
      options.color || 0xffffff,
      2 * intensity,
      10,
      Math.PI / 6,
      0.5
    );
    spotLight.position.set(
      character.mesh.position.x,
      character.mesh.position.y + 5,
      character.mesh.position.z + 3
    );
    spotLight.target = character.mesh;
    scene.add(spotLight);

    return {
      intensity,
      timer: 0,
      originalAmbient,
      spotLight,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.6);

        // 聚光灯脉冲
        this.spotLight.intensity = 2 * this.intensity * (0.8 + Math.sin(t * Math.PI * 3) * 0.2);

        return t >= 1;
      },
      dispose() {
        // 恢复环境光
        for (const { light, intensity } of this.originalAmbient) {
          light.intensity = intensity;
        }
        if (this.spotLight.parent) this.spotLight.parent.remove(this.spotLight);
      },
    };
  },
});

registerExaggeration('screen_shake', {
  type: 'camera',
  category: 'screen',
  defaultDuration: 0.4,
  build: (character, options = {}) => {
    const camera = options.camera || (typeof window !== 'undefined' ? window.__dulaCamera : null);
    if (!camera) return null;

    const intensity = options.intensity || 1.0;
    const originalPos = camera.position.clone();

    return {
      intensity,
      timer: 0,
      originalPos,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.4);
        const shake = Math.sin(t * Math.PI) * 0.1 * this.intensity * (1 - t);

        camera.position.x = this.originalPos.x + (Math.random() - 0.5) * shake;
        camera.position.y = this.originalPos.y + (Math.random() - 0.5) * shake;

        return t >= 1;
      },
      dispose() {
        camera.position.copy(this.originalPos);
      },
    };
  },
});

registerExaggeration('anger_symbol', {
  type: 'particle',
  category: 'body',
  defaultDuration: 0.8,
  build: (character, options = {}) => {
    const scene = character.mesh?.parent;
    if (!scene) return null;

    const intensity = options.intensity || 1.0;
    const group = new THREE.Group();
    group.name = 'exaggeration_anger_symbol';

    // 四角星形状
    const starShape = new THREE.Shape();
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 - Math.PI / 4;
      const x = Math.cos(angle) * 0.08;
      const y = Math.sin(angle) * 0.08;
      if (i === 0) starShape.moveTo(x, y);
      else starShape.lineTo(x, y);
      // 内凹点
      const innerAngle = ((i + 0.5) / 4) * Math.PI * 2 - Math.PI / 4;
      starShape.lineTo(
        Math.cos(innerAngle) * 0.03,
        Math.sin(innerAngle) * 0.03
      );
    }
    starShape.closePath();

    const geo = new THREE.ShapeGeometry(starShape);
    const mat = new THREE.MeshBasicMaterial({
      color: options.color || 0xff0000,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, character.height * 0.3, 0);
    group.add(mesh);

    // 位置跟随角色头部
    group.position.copy(character.mesh.position);
    group.position.y += character.height;
    scene.add(group);

    return {
      intensity,
      timer: 0,
      group,
      mesh,
      update(delta) {
        this.timer += delta;
        const t = this.timer / (options.duration || 0.8);
        const pulse = Math.sin(t * Math.PI * 4);

        this.group.position.copy(character.mesh.position);
        this.group.position.y += character.height;
        this.mesh.scale.setScalar(1 + pulse * 0.2 * this.intensity);
        this.mesh.rotation.z += delta * 2;
        this.mesh.material.opacity = 0.9 * (1 - t);

        return t >= 1;
      },
      dispose() {
        if (this.group.parent) this.group.parent.remove(this.group);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
      },
    };
  },
});

// ═══════════════════════════════════════
//  预设组合（Director 一键调用）
// ═══════════════════════════════════════

export const EXAGGERATION_PRESETS = {
  // 热血战斗
  shonen_anger: ['anger_aura', 'hair_stand', 'vein_forehead', 'screen_shake'],
  shonen_shock: ['eye_pop', 'impact_lines', 'screen_shake'],
  shonen_powerup: ['anger_aura', 'hair_stand', 'bg_black'],

  // 搞笑
  comedy_shock: ['eye_pop', 'jaw_drop', 'sweat_drop'],
  comedy_embarrass: ['sweat_drop', 'chibi_deform', 'eyebrow_fly'],
  comedy_anger: ['vein_forehead', 'anger_symbol', 'chibi_deform'],

  // 恐怖
  horror_shock: ['eye_shrink', 'bg_black', 'screen_shake'],
  horror_despair: ['bg_black', 'tear_fountain', 'chibi_deform'],

  // 萌系
  moe_cry: ['tear_fountain', 'chibi_deform', 'eyebrow_fly'],
  moe_shock: ['eye_pop', 'chibi_deform'],
  moe_joy: ['chibi_deform', 'eyebrow_fly'],
};
