/**
 * ToneSSML — TTS 参数生成器
 *
 * 将 ToneDirector 的输出转换为具体 TTS 引擎可消费的参数。
 * 支持：
 * - Edge TTS / pyttsx3 风格（pitch, rate, volume 百分比）
 * - SSML 标准（<prosody>, <break>）
 * - ElevenLabs 风格（stability, similarity_boost, style）
 */

export class ToneSSML {
  /**
   * 生成 Edge TTS / pyttsx3 参数
   */
  static toEdgeTTS(toneResult) {
    const { ttsParams } = toneResult;
    const p = ttsParams;

    // Edge TTS: pitch 以 Hz 偏移表示，+2st ≈ +12% Hz
    const pitchHz = p.pitch === 0 ? '0Hz' : `${p.pitch > 0 ? '+' : ''}${Math.round(p.pitch * 6)}Hz`;
    const ratePercent = Math.round((p.speed - 1) * 100);
    const rate = ratePercent === 0 ? '0%' : `${ratePercent > 0 ? '+' : ''}${ratePercent}%`;
    const volume = Math.round((p.volume - 1) * 100);
    const vol = volume === 0 ? '0%' : `${volume > 0 ? '+' : ''}${volume}%`;

    return {
      pitch: pitchHz,
      rate,
      volume: vol,
      // Edge TTS 不支持 break，但可以在文本中插入停顿标记
      text: this._injectBreaks(toneResult.text, p.breaks),
    };
  }

  /**
   * 生成标准 SSML
   */
  static toSSML(toneResult, voiceName = 'zh-CN-XiaoxiaoNeural') {
    const { ttsParams, text } = toneResult;
    const p = ttsParams;

    // pitch: 以 semitone 表示
    const pitchStr = p.pitch === 0 ? 'default' : `${p.pitch > 0 ? '+' : ''}${p.pitch}st`;
    // rate: 以百分比
    const ratePercent = Math.round((p.speed - 1) * 100);
    const rateStr = ratePercent === 0 ? 'default' : `${ratePercent > 0 ? '+' : ''}${ratePercent}%`;
    // volume: 以百分比
    const volumePercent = Math.round((p.volume - 1) * 100);
    const volumeStr = volumePercent === 0 ? 'default' : `${volumePercent > 0 ? '+' : ''}${volumePercent}%`;

    let ssml = `<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">\n`;
    ssml += `  <voice name="${voiceName}">\n`;
    ssml += `    <prosody pitch="${pitchStr}" rate="${rateStr}" volume="${volumeStr}">\n`;
    ssml += `      ${this._injectSSMLBreaks(text, p.breaks)}\n`;
    ssml += `    </prosody>\n`;
    ssml += `  </voice>\n`;
    ssml += `</speak>`;

    return ssml;
  }

  /**
   * 生成 ElevenLabs 风格参数
   */
  static toElevenLabs(toneResult) {
    const { tone, intensity } = toneResult;

    // ElevenLabs 使用 stability / similarity_boost / style 控制情感
    const styleMap = {
      'battle_cry':    { stability: 0.3, similarity_boost: 0.85, style: 0.8 },
      'pain_shout':    { stability: 0.2, similarity_boost: 0.9,  style: 0.9 },
      'pain_grunt':    { stability: 0.4, similarity_boost: 0.8,  style: 0.6 },
      'angry':         { stability: 0.3, similarity_boost: 0.85, style: 0.7 },
      'furious':       { stability: 0.2, similarity_boost: 0.9,  style: 0.9 },
      'fear':          { stability: 0.4, similarity_boost: 0.8,  style: 0.6 },
      'panic':         { stability: 0.2, similarity_boost: 0.9,  style: 0.8 },
      'sad':           { stability: 0.5, similarity_boost: 0.75, style: 0.5 },
      'despair':       { stability: 0.4, similarity_boost: 0.8,  style: 0.7 },
      'happy':         { stability: 0.6, similarity_boost: 0.7,  style: 0.4 },
      'joyful':        { stability: 0.5, similarity_boost: 0.75, style: 0.6 },
      'laugh':         { stability: 0.5, similarity_boost: 0.7,  style: 0.5 },
      'surprise':      { stability: 0.4, similarity_boost: 0.8,  style: 0.6 },
      'shock':         { stability: 0.3, similarity_boost: 0.85, style: 0.7 },
      'whisper':       { stability: 0.7, similarity_boost: 0.6,  style: 0.3 },
      'monologue':     { stability: 0.6, similarity_boost: 0.7,  style: 0.3 },
      'narration':     { stability: 0.7, similarity_boost: 0.6,  style: 0.2 },
      'neutral':       { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
    };

    const base = styleMap[tone.id] || styleMap.neutral;

    return {
      ...base,
      // 根据 intensity 微调
      stability: Math.max(0.1, Math.min(0.9, base.stability - (intensity - 0.5) * 0.2)),
      similarity_boost: Math.max(0.5, Math.min(1.0, base.similarity_boost + (intensity - 0.5) * 0.1)),
      style: Math.max(0, Math.min(1.0, base.style + (intensity - 0.5) * 0.3)),
      // pitch/speed 作为 speaker boost 参数
      pitch: tone.pitch,
      speed: tone.speed,
      volume: tone.volume,
    };
  }

  /**
   * 生成 OpenAI TTS 参数（不支持 SSML，用纯文本+前置提示词）
   */
  static toOpenAI(toneResult) {
    const { tone, text } = toneResult;
    // OpenAI 只有 speed 参数，需要把语气信息注入到文本前缀
    const toneHint = this._getToneHint(tone.id);
    const hintedText = toneHint ? `[${toneHint}] ${text}` : text;

    return {
      text: hintedText,
      speed: tone.speed,
      // OpenAI 只支持 0.25 ~ 4.0
      speed_clamped: Math.max(0.25, Math.min(4.0, tone.speed)),
    };
  }

  /**
   * 通用：生成最佳可用格式的参数
   */
  static toParams(toneResult, engine = 'edge') {
    switch (engine) {
      case 'edge':
      case 'pyttsx3':
      case 'sapi':
        return { type: 'edge', params: this.toEdgeTTS(toneResult) };
      case 'ssml':
      case 'azure':
      case 'google':
        return { type: 'ssml', params: this.toSSML(toneResult) };
      case 'elevenlabs':
        return { type: 'elevenlabs', params: this.toElevenLabs(toneResult) };
      case 'openai':
        return { type: 'openai', params: this.toOpenAI(toneResult) };
      default:
        return { type: 'edge', params: this.toEdgeTTS(toneResult) };
    }
  }

  // ── 内部工具 ──

  static _injectBreaks(text, breaks) {
    if (!breaks || breaks.length === 0) return text;
    // 在文本中插入停顿标记（如 <...>）
    let result = text;
    for (const b of breaks) {
      result += ' <...' + b + 's>';
    }
    return result;
  }

  static _injectSSMLBreaks(text, breaks) {
    if (!breaks || breaks.length === 0) return text;
    // 在文本末尾插入 SSML break
    let result = text;
    for (const b of breaks) {
      result += ` <break time="${Math.round(b * 1000)}ms"/>`;
    }
    return result;
  }

  static _getToneHint(toneId) {
    const hints = {
      'battle_cry': '大声呐喊',
      'pain_shout': '痛苦大喊',
      'pain_grunt': '痛苦低吟',
      'angry': '愤怒地说',
      'furious': '狂怒地咆哮',
      'fear': '恐惧地',
      'panic': '惊慌地',
      'sad': '悲伤地',
      'despair': '绝望地',
      'happy': '开心地说',
      'joyful': '兴奋地',
      'laugh': '笑着说',
      'surprise': '惊讶地',
      'shock': '震惊地',
      'whisper': '低声说',
      'monologue': '独白',
      'narration': '旁白',
      'flirt': '暧昧地',
      'tease': '调侃地',
      'mock': '嘲讽地',
      'sarcasm': '讽刺地',
      'command': '命令地',
      'plead': '恳求地',
      'respectful': '恭敬地',
    };
    return hints[toneId] || '';
  }
}

/**
 * 批量生成音频脚本（供 Python 后处理调用）
 * 输出: [{ speaker, text, startTime, toneId, ttsParams, emotion, ... }]
 */
export function exportAudioScript(toneResults, engine = 'edge') {
  return toneResults.map(result => {
    const params = ToneSSML.toParams(result, engine);
    return {
      speaker: result.speaker,
      text: result.text,
      startTime: result.startTime,
      duration: result.duration,
      toneId: result.toneId,
      toneSource: result.source,
      confidence: result.confidence,
      ...params,
      emotion: result.emotion,
      mouthTension: result.mouthTension,
      intensity: result.intensity,
    };
  });
}
