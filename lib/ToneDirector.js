import { EMOTION_PRESETS } from './FacialAnimationSystem.js';

/**
 * ToneDirector — 语气导演
 *
 * 从台词文本 + 场景上下文自动推断语气参数，
 * 驱动 TTS（音高/速度/音量）、FacialAnimationSystem（表情）、
 * CombatDirector（hitstop 同步）
 *
 * 设计原则：
 * - 剧本优先：显式 {Tone:xxx} 标签覆盖所有推断
 * - 智能推断：无标签时通过文本分析 + 场景上下文推导
 * - 零侵入：Tone 只是 metadata，不修改原始台词文本
 */

// ── 语气定义（语义层）──
export const TONE = {
  // 战斗
  BATTLE_CRY:    { id: 'battle_cry',    pitch: +2, speed: 1.2,  volume: 1.1, breaks: [],       intensity: 0.9, exaggeration: ['anger_aura', 'hair_stand'] },
  PAIN_SHOUT:    { id: 'pain_shout',    pitch: +4, speed: 1.3,  volume: 1.2, breaks: [],       intensity: 1.0, exaggeration: ['eye_pop', 'impact_lines'] },
  PAIN_GRUNT:    { id: 'pain_grunt',    pitch: -1, speed: 0.8,  volume: 0.7, breaks: [],       intensity: 0.6, exaggeration: ['vein_forehead'] },
  VICTORY_LAUGH: { id: 'victory_laugh', pitch: +3, speed: 1.1,  volume: 1.0, breaks: [0.1],    intensity: 0.85, exaggeration: ['chibi_deform'] },
  TAUNT:         { id: 'taunt',         pitch: +1, speed: 0.95, volume: 0.9, breaks: [0.12],   intensity: 0.7, exaggeration: ['anger_symbol'] },
  BATTLE_WHISPER:{ id: 'battle_whisper',pitch: 0,  speed: 0.8,  volume: 0.5, breaks: [0.15],   intensity: 0.5, exaggeration: [] },

  // 情绪
  NEUTRAL:       { id: 'neutral',       pitch: 0,  speed: 1.0,  volume: 1.0, breaks: [],       intensity: 0.0, exaggeration: [] },
  HAPPY:         { id: 'happy',         pitch: +1, speed: 1.05, volume: 1.0, breaks: [0.05],   intensity: 0.5, exaggeration: ['chibi_deform'] },
  JOYFUL:        { id: 'joyful',        pitch: +2, speed: 1.15, volume: 1.05, breaks: [0.05],   intensity: 0.7, exaggeration: ['chibi_deform', 'eyebrow_fly'] },
  SAD:           { id: 'sad',           pitch: -2, speed: 0.85, volume: 0.85, breaks: [0.15],   intensity: 0.6, exaggeration: [] },
  DESPAIR:       { id: 'despair',       pitch: -3, speed: 0.7,  volume: 0.75, breaks: [0.2],    intensity: 0.9, exaggeration: ['bg_black', 'tear_fountain'] },
  ANGRY:         { id: 'angry',         pitch: +1, speed: 1.15, volume: 1.1, breaks: [0.08],   intensity: 0.8, exaggeration: ['anger_aura', 'vein_forehead'] },
  FURIOUS:       { id: 'furious',       pitch: +2, speed: 1.25, volume: 1.2, breaks: [0.05],   intensity: 1.0, exaggeration: ['shonen_anger'] },
  FEAR:          { id: 'fear',          pitch: +2, speed: 1.25, volume: 0.9, breaks: [0.05],   intensity: 0.7, exaggeration: ['sweat_drop'] },
  PANIC:         { id: 'panic',         pitch: +3, speed: 1.4,  volume: 1.0, breaks: [0.03],   intensity: 0.9, exaggeration: ['eye_pop', 'sweat_drop'] },
  SURPRISE:      { id: 'surprise',      pitch: +3, speed: 1.2,  volume: 1.0, breaks: [0.02],   intensity: 0.6, exaggeration: ['eye_pop'] },
  SHOCK:         { id: 'shock',         pitch: +4, speed: 1.3,  volume: 1.1, breaks: [0.02],   intensity: 0.85, exaggeration: ['eye_pop', 'jaw_drop'] },
  DISGUST:       { id: 'disgust',       pitch: -1, speed: 0.9,  volume: 0.85, breaks: [0.1],    intensity: 0.5, exaggeration: [] },
  CONTEMPT:      { id: 'contempt',      pitch: -1, speed: 0.85, volume: 0.8, breaks: [0.15],   intensity: 0.6, exaggeration: [] },

  // 关系/社交
  FLIRT:         { id: 'flirt',         pitch: +1, speed: 0.9,  volume: 0.85, breaks: [0.1],    intensity: 0.4, exaggeration: [] },
  TEASE:         { id: 'tease',         pitch: +1, speed: 1.0,  volume: 0.9, breaks: [0.12],   intensity: 0.5, exaggeration: ['eyebrow_fly'] },
  MOCK:          { id: 'mock',          pitch: +1, speed: 0.95, volume: 0.9, breaks: [0.12],   intensity: 0.6, exaggeration: ['chibi_deform'] },
  SARCASM:       { id: 'sarcasm',       pitch: 0,  speed: 0.9,  volume: 0.9, breaks: [0.15],   intensity: 0.5, exaggeration: [] },
  RESPECTFUL:    { id: 'respectful',    pitch: -1, speed: 0.95, volume: 0.9, breaks: [0.1],    intensity: 0.3, exaggeration: [] },
  COMMAND:       { id: 'command',       pitch: 0,  speed: 1.1,  volume: 1.05, breaks: [0.08],   intensity: 0.7, exaggeration: [] },
  PLEAD:         { id: 'plead',         pitch: +1, speed: 0.85, volume: 0.85, breaks: [0.18],   intensity: 0.7, exaggeration: [] },

  // 特殊
  MONOLOGUE:     { id: 'monologue',     pitch: -1, speed: 0.85, volume: 0.9, breaks: [0.3],    intensity: 0.4, exaggeration: [] },
  NARRATION:     { id: 'narration',     pitch: -1, speed: 0.9,  volume: 0.9, breaks: [0.2],    intensity: 0.2, exaggeration: [] },
  WHISPER:       { id: 'whisper',       pitch: 0,  speed: 0.8,  volume: 0.4, breaks: [0.2],    intensity: 0.3, exaggeration: [] },
  SHOUT:         { id: 'shout',         pitch: +3, speed: 1.3,  volume: 1.2, breaks: [],       intensity: 0.9, exaggeration: ['screen_shake'] },
  BREATH:        { id: 'breath',        pitch: 0,  speed: 0.6,  volume: 0.3, breaks: [0.5],    intensity: 0.1, exaggeration: [] },
  GASP:          { id: 'gasp',          pitch: +2, speed: 1.5,  volume: 0.9, breaks: [0.05],   intensity: 0.7, exaggeration: ['eye_pop'] },
  LAUGH:         { id: 'laugh',         pitch: +2, speed: 1.1,  volume: 1.0, breaks: [0.08],   intensity: 0.6, exaggeration: ['chibi_deform'] },
  SOB:           { id: 'sob',           pitch: -2, speed: 0.7,  volume: 0.7, breaks: [0.25],   intensity: 0.8, exaggeration: ['tear_fountain'] },
};

// ── 语气 → 表情映射 ──
export const TONE_EMOTION_MAP = {
  battle_cry:    'anger',
  pain_shout:    'pain',
  pain_grunt:    'pain',
  victory_laugh: 'smile',
  taunt:         'disgust',
  battle_whisper:'fear',
  neutral:       'neutral',
  happy:         'smile',
  joyful:        'smile',
  sad:           'sad',
  despair:       'sad',
  angry:         'anger',
  furious:       'anger',
  fear:          'fear',
  panic:         'fear',
  surprise:      'surprise',
  shock:         'surprise',
  disgust:       'disgust',
  contempt:      'disgust',
  flirt:         'smile',
  tease:         'smile',
  mock:          'disgust',
  sarcasm:       'disgust',
  respectful:    'neutral',
  command:       'anger',
  plead:         'sad',
  monologue:     'neutral',
  narration:     'neutral',
  whisper:       'fear',
  shout:         'anger',
  breath:        'neutral',
  gasp:          'surprise',
  laugh:         'smile',
  sob:           'sad',
};

// ── 语气 → 肢体动作映射（说话时自动播放）──
export const TONE_BODY_GESTURE = {
  battle_cry:    { anim: 'FistPump',        intensity: 0.9, layer: 'upper' },
  pain_shout:    { anim: 'HitStagger',      intensity: 1.0, layer: 'full' },
  pain_grunt:    { anim: 'Crouch',          intensity: 0.6, layer: 'full' },
  victory_laugh: { anim: 'Celebrate',         intensity: 0.8, layer: 'full' },
  taunt:         { anim: 'PointForward',    intensity: 0.6, layer: 'upper' },
  happy:         { anim: 'WaveHand',          intensity: 0.4, layer: 'upper' },
  joyful:        { anim: 'Celebrate',         intensity: 0.7, layer: 'full' },
  laugh:         { anim: 'Shrug',             intensity: 0.5, layer: 'upper' },
  angry:         { anim: 'CrossArms',         intensity: 0.6, layer: 'upper' },
  furious:       { anim: 'FistPump',          intensity: 0.9, layer: 'upper' },
  fear:          { anim: 'Tremble',           intensity: 0.7, layer: 'full' },
  panic:         { anim: 'FlailArms',         intensity: 0.8, layer: 'full' },
  surprise:      { anim: 'LookAround',        intensity: 0.4, layer: 'upper' },
  shock:         { anim: 'HitStagger',        intensity: 0.6, layer: 'full' },
  despair:       { anim: 'Crouch',            intensity: 0.8, layer: 'full' },
  plead:         { anim: 'PointForward',      intensity: 0.5, layer: 'upper' },
  command:       { anim: 'PointForward',      intensity: 0.7, layer: 'upper' },
  flirt:         { anim: 'WaveHand',            intensity: 0.3, layer: 'upper' },
  mock:          { anim: 'Shrug',             intensity: 0.5, layer: 'upper' },
  disgust:       { anim: 'Shrug',             intensity: 0.4, layer: 'upper' },
  contempt:      { anim: 'CrossArms',         intensity: 0.5, layer: 'upper' },
  monologue:     { anim: 'CrossArms',         intensity: 0.3, layer: 'upper' },
  whisper:       { anim: null,              intensity: 0,   layer: 'none' },
  breath:        { anim: null,              intensity: 0,   layer: 'none' },
  neutral:       { anim: null,              intensity: 0,   layer: 'none' },
  narration:     { anim: null,              intensity: 0,   layer: 'none' },
  sad:           { anim: 'Crouch',            intensity: 0.4, layer: 'full' },
  sobbing:       { anim: 'Crouch',            intensity: 0.7, layer: 'full' },
  gasp:          { anim: 'HitStagger',        intensity: 0.3, layer: 'full' },
  respectful:    { anim: 'Nod',               intensity: 0.3, layer: 'upper' },
};
export const TONE_MOUTH_TENSION = {
  pain_shout:    0.7,
  pain_grunt:    0.5,
  battle_cry:    0.4,
  furious:       0.6,
  shout:         0.5,
  gasp:          0.3,
  sob:           0.4,
  despair:       0.3,
  whisper:       0.2,
  breath:        0.0,
};

// ── 文本特征规则（关键词 → 候选语气）──
const TEXT_RULES = [
  // 战斗
  { pattern: /^(?:来[吧啊！]|上[啊！]|受死|接招|看招|纳命)/, tones: ['battle_cry'], context: 'combat' },
  { pattern: /^(?:啊[！—]|嗷[！—]|唔[！—]|呃[！—]|呜[！—])/, tones: ['pain_shout', 'pain_grunt'], context: 'combat' },
  { pattern: /哈[哈哈]{2,}/, tones: ['laugh', 'victory_laugh'], context: 'any' },
  { pattern: /嘻嘻|嘿嘿|呵呵/, tones: ['tease', 'mock'], context: 'any' },
  { pattern: /(?:去死|完蛋|没门|做梦|休想)/, tones: ['taunt', 'angry'], context: 'combat' },

  // 情绪
  { pattern: /(?:为什么|怎么会|不要[啊！]|不要走|不要杀)/, tones: ['despair', 'plead', 'panic'], context: 'any' },
  { pattern: /(?:好痛|痛[啊！]|好疼|疼[啊！])/, tones: ['pain_shout'], context: 'any' },
  { pattern: /(?:救命|救我|帮帮我|谁来)/, tones: ['panic', 'plead'], context: 'any' },
  { pattern: /(?:可恶|该死|混蛋|卑鄙|无耻)/, tones: ['angry', 'furious'], context: 'any' },
  { pattern: /(?:太好了|太棒了|万岁|胜利)/, tones: ['joyful', 'victory_laugh'], context: 'any' },
  { pattern: /(?:糟了|不好|完了|完了完了)/, tones: ['panic', 'fear'], context: 'any' },
  { pattern: /(?:你[…。]?|原来如此|难道|竟然)/, tones: ['shock', 'surprise'], context: 'any' },
  { pattern: /(?:谢谢|感谢|感激|多亏)/, tones: ['happy', 'respectful'], context: 'any' },
  { pattern: /(?:对不起|抱歉|都是我的错|我[不该])/, tones: ['sad', 'despair'], context: 'any' },
  { pattern: /(?:我[爱喜欢]你|你[真很]美|你[好真]帅)/, tones: ['flirt', 'happy'], context: 'romance' },
  { pattern: /(?:请|拜托|求求|求你了)/, tones: ['plead', 'respectful'], context: 'any' },
  { pattern: /(?:是[吗么吧]|对吧|不是吗)/, tones: ['sarcasm', 'tease'], context: 'any' },

  // 呼吸/特殊声音
  { pattern: /^[…。]{2,}$/, tones: ['breath'], context: 'any' },
  { pattern: /^(?:呼[…。]|呼——|吸气)/, tones: ['breath'], context: 'any' },
  { pattern: /^(?:咳|咳咳|呕|呸)/, tones: ['pain_grunt'], context: 'any' },
];

// ── 场景语境增强规则 ──
const CONTEXT_BOOST = {
  combat: {
    'battle_cry': 2.0, 'pain_shout': 2.0, 'pain_grunt': 1.5,
    'shout': 1.5, 'angry': 1.3, 'fear': 1.2, 'panic': 1.3,
    'neutral': 0.3, 'happy': 0.3, 'flirt': 0.1,
  },
  romance: {
    'flirt': 2.0, 'happy': 1.5, 'tease': 1.5, 'sad': 1.2,
    'despair': 1.3, 'breath': 1.3, 'whisper': 1.5,
    'battle_cry': 0.1, 'pain_shout': 0.1, 'angry': 0.5,
  },
  horror: {
    'fear': 2.0, 'panic': 2.0, 'shock': 1.8, 'gasp': 1.5,
    'whisper': 1.5, 'breath': 1.5, 'despair': 1.3,
    'happy': 0.1, 'joyful': 0.1, 'laugh': 0.3,
  },
  comedy: {
    'laugh': 2.0, 'tease': 1.8, 'mock': 1.5, 'sarcasm': 1.5,
    'happy': 1.3, 'joyful': 1.2, 'surprise': 1.2,
    'despair': 0.2, 'pain_shout': 0.3,
  },
  dramatic: {
    'monologue': 2.0, 'despair': 1.8, 'sad': 1.5, 'shock': 1.5,
    'command': 1.3, 'plead': 1.5, 'fear': 1.2,
    'neutral': 0.5,
  },
};

// ── 角色状态影响 ──
const STATE_MODIFIERS = {
  isHit: { 'pain_shout': 3.0, 'pain_grunt': 2.0, 'neutral': 0.1 },
  isLowHP: { 'despair': 1.5, 'fear': 1.5, 'panic': 1.3, 'battle_cry': 0.5 },
  isExhausted: { 'breath': 2.0, 'sad': 1.5, 'despair': 1.3, 'speed': 0.8 },
  isVictory: { 'victory_laugh': 3.0, 'joyful': 2.0, 'happy': 1.5 },
  isBetrayed: { 'despair': 2.5, 'shock': 2.0, 'angry': 1.5, 'sad': 1.5 },
};

export class ToneDirector {
  constructor() {
    this.rules = TEXT_RULES;
    this.contextBoost = CONTEXT_BOOST;
    this.stateModifiers = STATE_MODIFIERS;
  }

  /**
   * 分析台词语气
   * @param {string} text — 台词文本
   * @param {Object} context — 上下文
   * @param {string} context.scene — 'combat' | 'romance' | 'horror' | 'comedy' | 'dramatic' | 'neutral'
   * @param {string} context.precedingAction — 前序动作标签
   * @param {Object} context.characterState — 角色状态
   * @param {string} context.explicitTone — 显式指定的 tone id（优先）
   * @returns {ToneResult}
   */
  analyze(text, context = {}) {
    // 1. 显式标签优先
    if (context.explicitTone) {
      const tone = Object.values(TONE).find(t => t.id === context.explicitTone);
      if (tone) return this._buildResult(tone, text, context, 'explicit');
    }

    // 2. 文本规则匹配
    const candidates = this._matchTextRules(text);

    // 3. 场景语境增强
    this._applyContextBoost(candidates, context.scene);

    // 4. 角色状态修正
    this._applyStateModifiers(candidates, context.characterState);

    // 5. 标点符号分析（补充信号）
    this._applyPunctuationBoost(candidates, text);

    // 6. 选择最高分的语气
    const best = this._selectBest(candidates);
    return this._buildResult(best, text, context, 'inferred');
  }

  _matchTextRules(text) {
    const scores = new Map();
    // 初始化所有 tone 为 0.1 基础分
    for (const tone of Object.values(TONE)) {
      scores.set(tone.id, 0.1);
    }

    for (const rule of this.rules) {
      if (rule.pattern.test(text)) {
        for (const toneId of rule.tones) {
          scores.set(toneId, (scores.get(toneId) || 0) + 1.0);
        }
      }
    }

    return scores;
  }

  _applyContextBoost(scores, scene) {
    const boost = this.contextBoost[scene || 'neutral'];
    if (!boost) return;
    for (const [toneId, factor] of Object.entries(boost)) {
      scores.set(toneId, (scores.get(toneId) || 0) * factor);
    }
  }

  _applyStateModifiers(scores, characterState) {
    if (!characterState) return;
    for (const [state, modifiers] of Object.entries(this.stateModifiers)) {
      if (characterState[state]) {
        for (const [toneId, factor] of Object.entries(modifiers)) {
          if (toneId === 'speed') continue; // speed 是特殊参数
          scores.set(toneId, (scores.get(toneId) || 0) * factor);
        }
      }
    }
  }

  _applyPunctuationBoost(scores, text) {
    // 多感叹号 → 强烈情绪
    const exclCount = (text.match(/！/g) || []).length;
    if (exclCount >= 2) {
      scores.set('shout', (scores.get('shout') || 0) + exclCount * 0.5);
      scores.set('battle_cry', (scores.get('battle_cry') || 0) + exclCount * 0.3);
    }
    if (text.endsWith('！')) {
      scores.set('angry', (scores.get('angry') || 0) + 0.3);
      scores.set('surprise', (scores.get('surprise') || 0) + 0.3);
    }
    if (text.endsWith('？')) {
      scores.set('surprise', (scores.get('surprise') || 0) + 0.5);
      scores.set('shock', (scores.get('shock') || 0) + 0.3);
    }
    if (text.endsWith('…') || text.endsWith('...')) {
      scores.set('despair', (scores.get('despair') || 0) + 0.5);
      scores.set('sad', (scores.get('sad') || 0) + 0.3);
      scores.set('monologue', (scores.get('monologue') || 0) + 0.3);
    }
    // 省略号 + 短句 = 喘息/低语
    if ((text.includes('…') || text.includes('...')) && text.length < 8) {
      scores.set('breath', (scores.get('breath') || 0) + 0.8);
      scores.set('whisper', (scores.get('whisper') || 0) + 0.5);
    }
  }

  _selectBest(scores) {
    let bestId = 'neutral';
    let bestScore = -1;
    for (const [id, score] of scores) {
      // 同分时优先 neutral，避免平静/无特征文本被默认推断成 battle_cry
      if (score > bestScore || (score === bestScore && id === 'neutral')) {
        bestScore = score;
        bestId = id;
      }
    }
    return TONE[Object.keys(TONE).find(k => TONE[k].id === bestId)] || TONE.NEUTRAL;
  }

  _buildResult(tone, text, context, source) {
    // 角色状态可能修改 speed
    let speed = tone.speed;
    if (context.characterState?.isExhausted) speed *= 0.85;
    if (context.characterState?.isPanicked) speed *= 1.2;

    const gesture = TONE_BODY_GESTURE[tone.id] || { anim: null, intensity: 0, layer: 'none' };

    return {
      tone,
      toneId: tone.id,
      text,
      source, // 'explicit' | 'inferred'
      confidence: source === 'explicit' ? 1.0 : this._estimateConfidence(tone, text),
      ttsParams: {
        pitch: tone.pitch,
        speed,
        volume: tone.volume,
        breaks: tone.breaks,
      },
      emotion: TONE_EMOTION_MAP[tone.id] || 'neutral',
      mouthTension: TONE_MOUTH_TENSION[tone.id] || 0,
      intensity: tone.intensity,
      bodyGesture: gesture, // NEW: 肢体动作指令
    };
  }

  _estimateConfidence(tone, text) {
    // 文本越短，歧义越大，置信度越低
    const base = Math.min(0.9, 0.3 + text.length * 0.05);
    // 明确的关键词匹配提高置信度
    if (tone.id !== 'neutral') return Math.min(0.95, base + 0.2);
    return base;
  }

  /**
   * 批量分析剧本台词
   * @param {Array} lines — [{ speaker, text, time, duration, ... }]
   * @param {Object} storyContext — 全局场景上下文
   * @returns {Array} 带有 tone 的台词列表
   */
  analyzeScript(lines, storyContext = {}) {
    return lines.map(line => {
      const context = {
        scene: line.scene || storyContext.scene || 'neutral',
        precedingAction: line.precedingAction || storyContext.precedingAction,
        characterState: line.characterState || storyContext.characterState,
        explicitTone: line.explicitTone,
      };
      const result = this.analyze(line.text, context);
      return { ...line, tone: result };
    });
  }

  /**
   * 与 FacialAnimationSystem 联动
   */
  applyToFacialSystem(character, toneResult) {
    if (!character?.facialSystem) return;
    const emotion = toneResult.emotion;
    if (emotion && EMOTION_PRESETS[emotion]) {
      character.facialSystem.setEmotion(emotion, {
        ...EMOTION_PRESETS[emotion],
        tension: toneResult.mouthTension || EMOTION_PRESETS[emotion].tension || 0,
      });
    }
  }

  /**
   * 与 CombatDirector 联动：根据语气调整 hitstop
   */
  syncWithCombat(combatDirector, toneResult, hitTime) {
    if (!combatDirector) return;
    // 痛苦喊叫时延长 hitstop 让语音和画面同步
    if (toneResult.toneId === 'pain_shout' || toneResult.toneId === 'pain_grunt') {
      const extraStop = 0.1 + toneResult.intensity * 0.15;
      if (combatDirector.sb?.hitstopManager) {
        combatDirector.sb.hitstopManager.extend(hitTime, extraStop);
      }
    }
    // 战斗呐喊时提前触发（让语音在动作开始前就响起）
    if (toneResult.toneId === 'battle_cry') {
      return { audioOffset: -0.08 }; // 提前 80ms
    }
    return {};
  }
}

/**
 * ToneResult 类型说明（供 IDE 提示）
 * @typedef {Object} ToneResult
 * @property {Object} tone — TONE 定义
 * @property {string} toneId — 语气 ID
 * @property {string} text — 原始台词
 * @property {string} source — 'explicit' | 'inferred'
 * @property {number} confidence — 0~1
 * @property {Object} ttsParams — { pitch, speed, volume, breaks }
 * @property {string} emotion — 表情名
 * @property {number} mouthTension — 嘴型张力
 * @property {number} intensity — 整体强度
 */
