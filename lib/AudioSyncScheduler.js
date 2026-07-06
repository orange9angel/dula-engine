/**
 * AudioSyncScheduler — 音画同步调度器
 *
 * 职责：
 * 1. 记录每个 SFX/音效事件的时间戳、类型、来源
 * 2. 生成 audio_manifest.json 供 Python 后处理管道精确合成
 * 3. 前端运行时可查询"当前时间应播放什么音效"
 *
 * 设计原则：
 * - 前端只管"什么时候该有什么声音"
 * - Python 后处理负责实际音频混合（避免浏览器音频延迟）
 * - 支持实时预览（可选用 Web Audio API）
 */

export class AudioSyncScheduler {
  constructor() {
    this.events = []; // { time, type, source, volume, duration, params }
    this.offset = 0;  // 全局时间偏移（用于分段渲染）
    this.isRecording = true;
  }

  /**
   * 记录一个音效事件
   * @param {Object} event
   * @param {number} event.time — 触发时间（秒）
   * @param {string} event.type — 音效类型/名称，如 'laser_blast', 'explosion'
   * @param {string} event.source — 来源，如 'CharacterA:plasmaRifle', 'hit:CharacterB'
   * @param {number} [event.volume=1.0] — 音量
   * @param {number} [event.duration] — 持续时间（可选）
   * @param {Object} [event.params] — 额外参数（音高、空间位置等）
   */
  schedule(event) {
    if (!this.isRecording) return;
    this.events.push({
      time: event.time + this.offset,
      type: event.type,
      source: event.source || 'unknown',
      volume: event.volume ?? 1.0,
      duration: event.duration ?? null,
      params: event.params || {},
    });
  }

  /**
   * 批量记录（从 CombatDirector 的 hitEvents / weaponEvents 转换）
   */
  scheduleBatch(events) {
    for (const ev of events) {
      this.schedule(ev);
    }
  }

  /**
   * 设置全局时间偏移（用于分段渲染）
   */
  setOffset(offset) {
    this.offset = offset;
  }

  /**
   * 获取指定时间窗口内的事件（用于实时预览）
   */
  queryWindow(startTime, endTime) {
    return this.events.filter(e => e.time >= startTime && e.time <= endTime);
  }

  /**
   * 获取下一个即将触发的事件（用于实时预览）
   */
  queryNext(currentTime, lookahead = 0.1) {
    return this.events
      .filter(e => e.time >= currentTime && e.time <= currentTime + lookahead)
      .sort((a, b) => a.time - b.time);
  }

  /**
   * 导出音频时间线（供 Python 后处理）
   */
  exportManifest() {
    // 按时间排序
    const sorted = [...this.events].sort((a, b) => a.time - b.time);

    // 去重：同一时间同类型同来源的事件只保留一个
    const seen = new Set();
    const deduped = [];
    for (const ev of sorted) {
      const key = `${ev.time.toFixed(3)}_${ev.type}_${ev.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      eventCount: deduped.length,
      events: deduped.map(e => ({
        time: parseFloat(e.time.toFixed(4)),
        type: e.type,
        source: e.source,
        volume: parseFloat(e.volume.toFixed(3)),
        duration: e.duration,
        params: e.params,
      })),
    };
  }

  /**
   * 导出为 JSON 字符串
   */
  exportJSON(pretty = true) {
    return JSON.stringify(this.exportManifest(), null, pretty ? 2 : 0);
  }

  /**
   * 清空所有事件
   */
  clear() {
    this.events = [];
    this.offset = 0;
  }

  /**
   * 暂停记录（用于调试）
   */
  pause() {
    this.isRecording = false;
  }

  /**
   * 恢复记录
   */
  resume() {
    this.isRecording = true;
  }

  /**
   * 从 CombatDirector 的 sfx 配置自动生成事件
   * @param {number} baseTime — 动作开始时间
   * @param {Array} sfxList — normalizeSFX 后的数组
   * @param {string} source — 来源标识
   */
  scheduleSFX(baseTime, sfxList, source) {
    for (const sfx of sfxList) {
      const triggerTime = baseTime + (sfx.offset || 0);
      this.schedule({
        time: triggerTime,
        type: sfx.name,
        source,
        volume: sfx.volume ?? 1.0,
        params: {
          trigger: sfx.trigger,
          pitch: sfx.pitch ?? 1.0,
        },
      });
    }
  }
}
