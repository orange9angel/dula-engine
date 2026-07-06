import { ExaggerationRegistry, getExaggeration, EXAGGERATION_PRESETS } from './ExaggerationRegistry.js';

/**
 * ExaggerationSystem — 夸张效果管理系统
 *
 * 为角色添加卡通/漫画风格的夸张表现，与写实层的 FacialAnimationSystem 互补。
 *
 * 特性：
 * - 效果分层：deform / particle / screen / lighting / camera
 * - 场景风格感知：shonen / comedy / horror / moe
 * - 角色性格感知：热血型、搞笑型、冷酷型等
 * - 与 CombatDirector 联动：受击时自动触发
 * - 与 ToneDirector 联动：语气推断时自动触发
 */

export class ExaggerationSystem {
  constructor(character) {
    this.character = character;
    this.activeEffects = []; // 当前播放的效果实例
    this.sceneStyle = 'neutral'; // shonen | comedy | horror | moe | drama
    this.personality = 'neutral'; // hotblood | comedic | cool | timid | noble
  }

  /**
   * 设置场景风格（影响夸张自动选择）
   */
  setSceneStyle(style) {
    this.sceneStyle = style;
  }

  /**
   * 设置角色性格（影响夸张程度和选择）
   */
  setPersonality(personality) {
    this.personality = personality;
  }

  /**
   * 触发单个夸张效果
   * @param {string} name — 效果名
   * @param {Object} options — { intensity, duration, color, camera, ... }
   */
  trigger(name, options = {}) {
    const config = getExaggeration(name);
    if (!config) {
      console.warn(`[ExaggerationSystem] Unknown effect: ${name}`);
      return null;
    }

    const instance = config.build(this.character, {
      ...options,
      duration: options.duration || config.defaultDuration,
      intensity: options.intensity || config.defaultIntensity,
    });

    if (!instance) return null;

    this.activeEffects.push({
      name,
      type: config.type,
      category: config.category,
      instance,
      startTime: performance.now(),
    });

    return instance;
  }

  /**
   * 触发预设组合（导演一键调用）
   * @param {string} presetName — 如 'shonen_anger', 'comedy_shock'
   * @param {Object} options
   */
  triggerPreset(presetName, options = {}) {
    const preset = EXAGGERATION_PRESETS[presetName];
    if (!preset) {
      console.warn(`[ExaggerationSystem] Unknown preset: ${presetName}`);
      return;
    }

    const results = [];
    for (const name of preset) {
      const instance = this.trigger(name, options);
      if (instance) results.push(instance);
    }
    return results;
  }

  /**
   * 根据 ToneDirector 结果自动触发
   * @param {Object} toneResult — ToneDirector.analyze 的输出
   */
  autoTriggerFromTone(toneResult) {
    if (!toneResult) return;

    const { toneId, intensity, sceneStyle } = toneResult;
    const style = sceneStyle || this.sceneStyle;

    // 1. 触发 tone 自带的 exaggeration 效果
    if (toneResult.tone?.exaggeration) {
      for (const exName of toneResult.tone.exaggeration) {
        this.trigger(exName, { intensity: intensity * 0.8 });
      }
    }

    // 2. 风格 × 语气 → 预设选择
    const presetMap = {
      shonen: {
        angry: 'shonen_anger',
        furious: 'shonen_anger',
        shock: 'shonen_shock',
        battle_cry: 'shonen_powerup',
        pain_shout: 'shonen_shock',
      },
      comedy: {
        shock: 'comedy_shock',
        surprise: 'comedy_shock',
        angry: 'comedy_anger',
        mock: 'comedy_anger',
        fear: 'comedy_shock',
        panic: 'comedy_shock',
      },
      horror: {
        shock: 'horror_shock',
        fear: 'horror_shock',
        panic: 'horror_shock',
        despair: 'horror_despair',
      },
      moe: {
        sad: 'moe_cry',
        despair: 'moe_cry',
        shock: 'moe_shock',
        happy: 'moe_joy',
        joyful: 'moe_joy',
      },
    };

    const preset = presetMap[style]?.[toneId] || presetMap[style]?.[this._toneToCategory(toneId)];
    if (preset) {
      this.triggerPreset(preset, { intensity });
    }

    // 单独触发非组合效果
    if (toneId === 'pain_shout' && intensity > 0.8) {
      this.trigger('vein_forehead', { intensity: intensity * 0.8 });
    }
    if (toneId === 'despair' && intensity > 0.7) {
      this.trigger('tear_fountain', { intensity: intensity * 0.9 });
    }
  }

  /**
   * 与 CombatDirector 联动：受击时触发
   */
  onHit(attacker, defender, profile, hitPoint) {
    const style = this.sceneStyle;

    if (style === 'shonen') {
      this.trigger('impact_lines', { intensity: 0.8, camera: this._getCamera() });
      this.trigger('screen_shake', { intensity: 0.6, camera: this._getCamera() });
      if (profile?.type === 'projectile') {
        this.trigger('eye_pop', { intensity: 0.7 });
      }
    } else if (style === 'comedy') {
      this.trigger('eye_pop', { intensity: 0.9 });
      this.trigger('sweat_drop', { intensity: 1.0 });
      this.trigger('jaw_drop', { intensity: 0.6 });
    } else if (style === 'horror') {
      this.trigger('screen_shake', { intensity: 0.4, camera: this._getCamera() });
      this.trigger('bg_black', { intensity: 0.7 });
    }
  }

  /**
   * 与 FacialAnimationSystem 联动：表情变化时触发
   */
  onEmotionChange(emotion, intensity) {
    const style = this.sceneStyle;

    if (emotion === 'surprise' && intensity > 0.6) {
      if (style === 'comedy' || style === 'moe') {
        this.trigger('eye_pop', { intensity });
      }
    }
    if (emotion === 'anger' && intensity > 0.7) {
      if (style === 'shonen') {
        this.trigger('anger_aura', { intensity });
      } else if (style === 'comedy') {
        this.trigger('anger_symbol', { intensity });
        this.trigger('vein_forehead', { intensity: intensity * 0.8 });
      }
    }
    if (emotion === 'fear' && intensity > 0.6) {
      if (style === 'comedy') {
        this.trigger('sweat_drop', { intensity });
      } else if (style === 'horror') {
        this.trigger('eye_shrink', { intensity });
      }
    }
  }

  /**
   * 每帧更新
   */
  update(delta) {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      const done = effect.instance.update(delta);
      if (done) {
        effect.instance.dispose();
        this.activeEffects.splice(i, 1);
      }
    }
  }

  /**
   * 清除所有效果
   */
  clear() {
    for (const effect of this.activeEffects) {
      effect.instance.dispose();
    }
    this.activeEffects = [];
  }

  _toneToCategory(toneId) {
    const map = {
      angry: 'angry', furious: 'angry',
      sad: 'sad', despair: 'sad',
      fear: 'fear', panic: 'fear',
      shock: 'shock', surprise: 'shock',
      happy: 'happy', joyful: 'happy', laugh: 'happy',
      battle_cry: 'angry', pain_shout: 'shock',
    };
    return map[toneId] || toneId;
  }

  _getCamera() {
    return typeof window !== 'undefined' ? window.__dulaCamera : null;
  }
}

/**
 * CharacterPersonality — 角色性格档案
 *
 * 定义角色的夸张风格倾向。
 */
export const CharacterPersonality = {
  // 热血少年漫
  hotblood: {
    exaggerationStyle: 'shonen',
    intensityMultiplier: 1.2,
    preferredEffects: ['anger_aura', 'hair_stand', 'vein_forehead'],
    rareEffects: ['tear_fountain', 'sweat_drop'],
  },

  // 搞笑角色
  comedic: {
    exaggerationStyle: 'comedy',
    intensityMultiplier: 1.3,
    preferredEffects: ['eye_pop', 'jaw_drop', 'sweat_drop', 'chibi_deform'],
    rareEffects: ['anger_aura', 'bg_black'],
  },

  // 冷酷型
  cool: {
    exaggerationStyle: 'shonen',
    intensityMultiplier: 0.6,
    preferredEffects: ['bg_black', 'screen_shake'],
    rareEffects: ['eye_pop', 'tear_fountain', 'chibi_deform'],
  },

  // 胆小/萌系
  timid: {
    exaggerationStyle: 'moe',
    intensityMultiplier: 1.0,
    preferredEffects: ['chibi_deform', 'tear_fountain', 'sweat_drop'],
    rareEffects: ['anger_aura', 'vein_forehead'],
  },

  // 高贵/优雅
  noble: {
    exaggerationStyle: 'drama',
    intensityMultiplier: 0.7,
    preferredEffects: ['bg_black', 'screen_shake'],
    rareEffects: ['eye_pop', 'chibi_deform', 'sweat_drop'],
  },

  // 反派
  villain: {
    exaggerationStyle: 'shonen',
    intensityMultiplier: 1.1,
    preferredEffects: ['anger_aura', 'bg_black', 'vein_forehead'],
    rareEffects: ['chibi_deform', 'tear_fountain'],
  },
};
