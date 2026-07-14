import * as THREE from 'three';

/**
 * FacialAnimationSystem — 统一面部动画系统
 *
 * 解决 TTS 嘴型与表情动画的冲突问题。
 *
 * 驱动层（输入）：
 * - VisemeDriver:    TTS/语音嘴型 (aaa, eee, ooo, mmm...)
 * - EmotionDriver:   表情动画 (FacePain, FaceSmile, FaceSurprise...)
 * - BlinkDriver:     自动眨眼
 * - EyeTrackingDriver: 眼神追踪
 *
 * 混合策略：
 * 嘴型  = Viseme 基础 × Emotion 张力调制 + Emotion 形状偏移
 * 眉毛 = Emotion 主导（说话时也生效）
 * 眼皮 = Blink 最高优先级 > Emotion
 * 瞳孔 = EyeTracking 主导 > Emotion 微调
 *
 * 与 ActionMatrix 衔接：
 * 表情动画只输出面部关节，不直接写 mesh，而是写入对应的 driver 状态。
 * ActionMatrixController._applyPose 将面部数据写入 emotionDriver 而非直接应用。
 */

export class FacialAnimationSystem {
  constructor(character) {
    this.character = character;

    // ── 驱动状态 ──
    this.viseme = {         // 嘴型驱动
      active: false,
      shape: 'rest',        // 'rest' | 'aaa' | 'eee' | 'ooo' | 'mmm' | 'fff' | 'sss'
      weight: 0,            // 0~1
      lipHeight: 0,
      lipWidth: 1,
      jawOpen: 0,
      jawForward: 0,
      lipRound: 0,
      tongueUp: 0,
    };

    this.emotion = {         // 表情驱动
      active: false,
      name: 'neutral',
      weight: 0,
      // 嘴部张力/偏移
      tension: 0,           // 0=松弛, 1=紧咬牙/痛苦
      lipOffset: 0,         // 嘴部垂直偏移
      lipWidth: 0,          // 嘴部宽度变化
      // 眉毛
      browLeft: 0,          // 左眉毛高度偏移 (-1 下压 ~ +1 上提)
      browRight: 0,
      browInner: 0,         // 眉心挤压
      // 眼睛
      eyelidClosed: 0,      // 0=全开, 1=全闭
      eyeSquint: 0,         // 眯眼
      // 瞳孔/眼球
      pupilDilate: 0,
      // 整体
      faceTilt: 0,          // 面部倾斜
      headNod: 0,           // 点头/仰头
    };

    this.blink = {           // 眨眼驱动
      active: false,
      leftClosed: 0,        // 0=开, 1=闭
      rightClosed: 0,
      targetLeft: 0,
      targetRight: 0,
      speed: 8,             // 闭眼/睁眼速度
      nextBlinkTime: 0,
      blinkDuration: 0.15,  // 单次眨眼持续时间
      accumulatedTime: 0,    // 眨眼计时器
    };

    this.eyeTracking = {     // 眼神追踪
      active: true,
      target: null,         // THREE.Vector3 或 null
      targetWeight: 0,     // 0~1, 追踪强度
      saccadeTimer: 0,     // 微扫视计时器
      lookOffset: new THREE.Vector2(), // 细微偏移（让眼神更自然）
    };

    // ── 缓存 ──
    this._lastTime = 0;
    this._baseBrowL = 0;
    this._baseBrowR = 0;
    this._baseBrowInner = 0;
    this._baseJawOpen = 0;
    this._baseLipWidth = 1;
  }

  // ═══════════════════════════════════════
  //  公共 API：供外部写入驱动状态
  // ═══════════════════════════════════════

  /**
   * 设置当前 viseme（由 TTS/AudioMouthCue 调用）
   */
  setViseme(shape, weight = 1) {
    this.viseme.active = weight > 0.01;
    this.viseme.shape = shape;
    this.viseme.weight = weight;

    // 预计算嘴型参数
    const table = VISeme_TABLE[shape] || VISeme_TABLE.rest;
    this.viseme.lipHeight = table.lipHeight;
    this.viseme.lipWidth = table.lipWidth;
    this.viseme.jawOpen = table.jawOpen;
    this.viseme.jawForward = table.jawForward;
    this.viseme.lipRound = table.lipRound;
  }

  /**
   * 设置表情（由 ActionMatrix 的表情动画调用）
   */
  setEmotion(name, params = {}) {
    this.emotion.active = true;
    this.emotion.name = name;
    this.emotion.weight = params.weight ?? 1;

    this.emotion.tension = params.tension ?? 0;
    this.emotion.lipOffset = params.lipOffset ?? 0;
    this.emotion.lipWidth = params.lipWidth ?? 0;
    this.emotion.browLeft = params.browLeft ?? 0;
    this.emotion.browRight = params.browRight ?? 0;
    this.emotion.browInner = params.browInner ?? 0;
    this.emotion.eyelidClosed = params.eyelidClosed ?? 0;
    this.emotion.eyeSquint = params.eyeSquint ?? 0;
    this.emotion.pupilDilate = params.pupilDilate ?? 0;
    this.emotion.faceTilt = params.faceTilt ?? 0;
    this.emotion.headNod = params.headNod ?? 0;
  }

  /**
   * 清除表情（恢复 neutral）
   */
  clearEmotion() {
    this.emotion.active = false;
    this.emotion.name = 'neutral';
    this.emotion.weight = 0;
  }

  /**
   * 设置眼神目标（由 Storyboard 或对话系统调用）
   */
  setEyeTarget(target, weight = 1) {
    this.eyeTracking.target = target;
    this.eyeTracking.targetWeight = weight;
  }

  /**
   * 触发一次眨眼
   */
  triggerBlink() {
    this.blink.active = true;
    this.blink.targetLeft = 1;
    this.blink.targetRight = 1;
  }

  /**
   * 设置自动眨眼参数
   */
  setAutoBlink(intervalMin = 2, intervalMax = 5) {
    this._blinkIntervalMin = intervalMin;
    this._blinkIntervalMax = intervalMax;
    this._scheduleNextBlink();
  }

  // ═══════════════════════════════════════
  //  更新：每帧调用
  // ═══════════════════════════════════════

  update(time, delta) {
    this._updateBlink(delta);
    this._updateEyeTracking(time, delta);

    // ── 混合并应用到面部 mesh ──
    this._applyMixedFacial();
  }

  // ── 眨眼更新 ──
  _updateBlink(delta) {
    if (this._blinkIntervalMin === undefined) {
      this.setAutoBlink(2, 5); // 默认参数
    }

    this.blink.accumulatedTime += delta;

    // 自动触发
    if (!this.blink.active && this.blink.accumulatedTime >= this.blink.nextBlinkTime) {
      this.triggerBlink();
    }

    if (!this.blink.active) return;

    // 向目标闭合度插值
    const leftDiff = this.blink.targetLeft - this.blink.leftClosed;
    const rightDiff = this.blink.targetRight - this.blink.rightClosed;
    this.blink.leftClosed += leftDiff * Math.min(1, this.blink.speed * delta);
    this.blink.rightClosed += rightDiff * Math.min(1, this.blink.speed * delta);

    // 判断阶段：完全闭上后自动开始睁开
    if (this.blink.targetLeft > 0.9 && this.blink.leftClosed > 0.95) {
      this.blink.targetLeft = 0;
      this.blink.targetRight = 0;
    }

    // 完全睁开后结束
    if (this.blink.targetLeft < 0.1 && this.blink.leftClosed < 0.05) {
      this.blink.leftClosed = 0;
      this.blink.rightClosed = 0;
      this.blink.active = false;
      this.blink.accumulatedTime = 0;
      this._scheduleNextBlink();
    }
  }

  _scheduleNextBlink() {
    const range = this._blinkIntervalMax - this._blinkIntervalMin;
    this.blink.nextBlinkTime = this._blinkIntervalMin + Math.random() * range;
  }

  // ── 眼神追踪更新 ──
  _updateEyeTracking(time, delta) {
    if (!this.eyeTracking.active || !this.eyeTracking.target) return;

    // 微扫视（saccade）
    this.eyeTracking.saccadeTimer -= delta;
    if (this.eyeTracking.saccadeTimer <= 0) {
      this.eyeTracking.saccadeTimer = 0.3 + Math.random() * 0.8;
      // 随机偏移 ±0.02
      this.eyeTracking.lookOffset.x = (Math.random() - 0.5) * 0.04;
      this.eyeTracking.lookOffset.y = (Math.random() - 0.5) * 0.04;
    }
  }

  // ── 核心：混合并应用 ──
  _applyMixedFacial() {
    const char = this.character;
    const V = this.viseme;
    const E = this.emotion;
    const B = this.blink;
    const ET = this.eyeTracking;

    const w = E.weight; // 表情权重

    // ── 嘴型混合 ──
    // 基础 = Viseme，由表情张力调制开合度，加表情偏移
    const tensionFactor = 1 - E.tension * 0.4; // 痛苦时嘴更紧
    // 不说话时表情不应让嘴张开（避免闭嘴静止画面出现大口）
    const emotionLipOffset = V.active ? E.lipOffset * w * 0.3 : 0;
    const mixedJawOpen = V.active
      ? (V.jawOpen * V.weight * tensionFactor + emotionLipOffset) * (1 - E.eyelidClosed * 0.1)
      : 0;
    const mixedLipWidth = (V.active ? V.lipWidth : 1) + E.lipWidth * w * 0.2;
    const mixedLipRound = V.lipRound * (V.weight || 0) + E.tension * w * 0.3;

    // 应用嘴型
    if (char.mouth) {
      char.mouth.scale.set(mixedLipWidth, 1 + mixedJawOpen * 0.6, 1);
      if (char.mouth.position) {
        char.mouth.position.y = (char.mouthBaseY || 0) + E.lipOffset * w * 0.02;
      }
    }
    if (char.jaw) {
      char.jaw.rotation.x = mixedJawOpen * 0.4;
    }

    // ── 眉毛混合（表情始终生效）──
    const browL = E.browLeft * w;
    const browR = E.browRight * w;
    const browInner = E.browInner * w;

    if (char.leftBrow) {
      char.leftBrow.position.y = (char.leftBrowBaseY || 0) + browL * 0.03 + browInner * 0.015;
      char.leftBrow.rotation.z = browInner * 0.2;
    }
    if (char.rightBrow) {
      char.rightBrow.position.y = (char.rightBrowBaseY || 0) + browR * 0.03 + browInner * 0.015;
      char.rightBrow.rotation.z = -browInner * 0.2;
    }

    // ── 眼皮（Blink 最高优先级）──
    let leftLid = 0, rightLid = 0;
    if (B.active) {
      leftLid = B.leftClosed;
      rightLid = B.rightClosed;
    } else {
      // 表情半闭 + 眯眼
      leftLid = Math.min(1, E.eyelidClosed * w + E.eyeSquint * w * 0.5);
      rightLid = leftLid;
    }

    if (char.leftEyelid) {
      char.leftEyelid.position.y = (char.leftEyelidBaseY || 0) - leftLid * 0.04;
    }
    if (char.rightEyelid) {
      char.rightEyelid.position.y = (char.rightEyelidBaseY || 0) - rightLid * 0.04;
    }

    // ── 瞳孔/眼球追踪 ──
    if (char.eyeLeft && char.eyeRight && ET.target) {
      const lookAt = ET.target.clone();
      // 加微扫视偏移
      lookAt.x += ET.lookOffset.x;
      lookAt.y += ET.lookOffset.y;

      // 表情影响瞳孔大小
      const pupilScale = 1 + E.pupilDilate * w * 0.3;
      if (char.eyeLeft.scale) char.eyeLeft.scale.setScalar(pupilScale);
      if (char.eyeRight.scale) char.eyeRight.scale.setScalar(pupilScale);
    }

    // ── 头部微倾斜（表情）──
    if (char.headGroup && E.weight > 0.01) {
      char.headGroup.rotation.z = E.faceTilt * w * 0.15;
      char.headGroup.rotation.x = (char.headGroupBaseX || 0) + E.headNod * w * 0.2;
    }

    this._lastTime = performance.now() / 1000;
  }
}

/**
 * Viseme 查表 — 各嘴型的基础参数
 */
export const VISeme_TABLE = {
  rest:   { lipHeight: 0,   lipWidth: 1,   jawOpen: 0,   jawForward: 0,  lipRound: 0 },
  aaa:    { lipHeight: 0.2, lipWidth: 1,   jawOpen: 0.8, jawForward: 0,  lipRound: 0 },
  eee:    { lipHeight: 0.3, lipWidth: 0.7, jawOpen: 0.3, jawForward: 0,  lipRound: 0 },
  ooo:    { lipHeight: 0.1, lipWidth: 0.8, jawOpen: 0.3, jawForward: 0,  lipRound: 0.8 },
  mmm:    { lipHeight: 0.05, lipWidth: 0.9, jawOpen: 0,   jawForward: 0,  lipRound: 0.2 },
  fff:    { lipHeight: 0.15, lipWidth: 0.8, jawOpen: 0.1, jawForward: 0.1, lipRound: 0.1 },
  sss:    { lipHeight: 0.2, lipWidth: 0.8, jawOpen: 0,   jawForward: 0,  lipRound: 0.3 },
  lll:    { lipHeight: 0.3, lipWidth: 0.8, jawOpen: 0.2, jawForward: 0.1, lipRound: 0.2 },
  uuu:    { lipHeight: 0.05, lipWidth: 0.7, jawOpen: 0.2, jawForward: 0,  lipRound: 0.9 },
  ttt:    { lipHeight: 0.1, lipWidth: 0.85, jawOpen: 0,   jawForward: 0,  lipRound: 0.1 },
};

/**
 * 预设表情参数 — 快速调用
 */
export const EMOTION_PRESETS = {
  neutral:   { tension: 0,   lipOffset: 0,   browLeft: 0,   browRight: 0,   browInner: 0,   eyelidClosed: 0,   eyeSquint: 0 },
  pain:      { tension: 0.8, lipOffset: -0.2, browLeft: 0.6, browRight: 0.6, browInner: 0.9, eyelidClosed: 0.3, eyeSquint: 0.5 },
  smile:     { tension: 0,   lipOffset: 0.2, browLeft: 0.2, browRight: 0.2, browInner: 0,   eyelidClosed: 0,   eyeSquint: 0.2 },
  surprise:  { tension: 0,   lipOffset: 0.4, browLeft: 0.8, browRight: 0.8, browInner: 0,   eyelidClosed: 0,   eyeSquint: 0 },
  anger:     { tension: 0.6, lipOffset: -0.1, browLeft: 0.2, browRight: 0.2, browInner: 0.8, eyelidClosed: 0.2, eyeSquint: 0.6 },
  sad:       { tension: 0.2, lipOffset: -0.3, browLeft: 0.5, browRight: 0.3, browInner: 0.4, eyelidClosed: 0.2, eyeSquint: 0 },
  fear:      { tension: 0.5, lipOffset: 0.1, browLeft: 0.7, browRight: 0.7, browInner: 0.3, eyelidClosed: 0.1, eyeSquint: 0.3 },
  disgust:   { tension: 0.4, lipOffset: -0.2, browLeft: 0.3, browRight: 0.1, browInner: 0.6, eyelidClosed: 0.2, eyeSquint: 0.4 },
};
