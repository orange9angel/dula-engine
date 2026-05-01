import { InspectorBase } from './InspectorBase.js';

/**
 * EffectInspector — D5 特效合理性检查
 *
 * 检查范围:
 * - Camera:Shake 滥用检测（频率、强度、与情绪匹配度）
 * - 特效与角色情绪一致性
 * - 连续特效叠加检测
 * - 特效强度范围合理性
 * - 静态/对话场景不必要的特效
 */
export class EffectInspector extends InspectorBase {
  constructor() {
    super('EffectInspector', 'D5');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText } = context;

    // Extract all effect tags
    const shakeEvents = this._extractShakeEvents(entries, storyText);
    const sfxEvents = this._extractSFXEvents(entries, storyText);

    // Run checks
    this._checkShakeFrequency(shakeEvents, entries);
    this._checkShakeIntensity(shakeEvents);
    this._checkShakeEmotionMatch(shakeEvents, entries);
    this._checkConsecutiveEffects(shakeEvents, sfxEvents, entries);
    this._checkUnnecessaryShake(shakeEvents, entries);
  }

  _extractShakeEvents(entries, storyText) {
    const events = [];
    const lines = storyText.split('\n');
    const regex = /\{Camera:Shake\|([^}]+)\}/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m;
      while ((m = regex.exec(line)) !== null) {
        const params = this._parseParams(m[1]);
        // Find corresponding entry
        const entry = this._findEntryForLine(entries, lineIdx);
        events.push({
          params,
          line: lineIdx + 1,
          entry,
          intensity: params.intensity !== undefined ? parseFloat(params.intensity) : 0.5,
          duration: params.duration !== undefined ? parseFloat(params.duration) : 0.5,
        });
      }
    }
    return events;
  }

  _extractSFXEvents(entries, storyText) {
    const events = [];
    const lines = storyText.split('\n');
    const regex = /\{SFX:Play\|([^}]+)\}/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m;
      while ((m = regex.exec(line)) !== null) {
        const entry = this._findEntryForLine(entries, lineIdx);
        events.push({ line: lineIdx + 1, entry });
      }
    }
    return events;
  }

  _parseParams(paramStr) {
    const params = {};
    const pairs = paramStr.split('|');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) {
        params[pair.trim()] = true;
        continue;
      }
      const key = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      const n = parseFloat(val);
      params[key] = isNaN(n) ? val : n;
    }
    return params;
  }

  _findEntryForLine(entries, lineIdx) {
    // Approximate: find entry whose content appears near this line
    // This is simplified; in practice we'd need better line mapping
    for (const entry of entries) {
      if (entry.index === lineIdx - 1) return entry; // rough approximation
    }
    return null;
  }

  /**
   * D5-1: Shake frequency check
   * Warn if more than 2 Shake in any 10-second window
   */
  _checkShakeFrequency(shakeEvents, entries) {
    if (shakeEvents.length === 0) return;

    // Sort by entry startTime
    const timedEvents = shakeEvents
      .filter((e) => e.entry && e.entry.startTime !== undefined)
      .sort((a, b) => a.entry.startTime - b.entry.startTime);

    const WINDOW = 10; // seconds
    const MAX_SHAKES_IN_WINDOW = 2;

    for (let i = 0; i < timedEvents.length; i++) {
      const startTime = timedEvents[i].entry.startTime;
      let count = 0;
      const windowEvents = [];

      for (let j = i; j < timedEvents.length; j++) {
        if (timedEvents[j].entry.startTime - startTime <= WINDOW) {
          count++;
          windowEvents.push(timedEvents[j]);
        } else {
          break;
        }
      }

      if (count > MAX_SHAKES_IN_WINDOW) {
        this.addIssue('warning',
          `Camera:Shake 过于密集：在 ${startTime.toFixed(1)}s 后的 ${WINDOW} 秒内使用了 ${count} 次抖动。频繁抖动会让观众视觉疲劳，削弱冲击力`,
          startTime,
          `建议将 ${count} 次 Shake 减少到 ≤${MAX_SHAKES_IN_WINDOW} 次，或改用其他运镜（如 CloseUp、ZoomIn）表达情绪`,
          'BUG-EFF-SHAKE-FREQUENCY'
        );
        // Skip ahead to avoid duplicate warnings
        i += count - 1;
      }
    }

    // Also check total Shake count vs total entries ratio
    const totalCharEntries = entries.filter((e) => e.character).length;
    if (totalCharEntries > 0) {
      const ratio = shakeEvents.length / totalCharEntries;
      if (ratio > 0.3) {
        this.addIssue('warning',
          `Camera:Shake 使用频率过高（${shakeEvents.length}/${totalCharEntries} 个角色条目，占比 ${(ratio * 100).toFixed(0)}%）。Shake 是强特效，应保留给真正需要冲击力的时刻`,
          null,
          `将 Shake 使用率控制在 30% 以下，仅在 panic/scared/angry 等强情绪时使用`,
          'BUG-EFF-SHAKE-OVERUSE'
        );
      }
    }
  }

  /**
   * D5-2: Shake intensity range check
   */
  _checkShakeIntensity(shakeEvents) {
    for (const ev of shakeEvents) {
      if (ev.intensity > 0.8) {
        this.addIssue('warning',
          `Camera:Shake 强度过高 (${ev.intensity})，可能导致画面严重失真、角色面部不可辨认`,
          ev.entry?.startTime,
          `建议 intensity ≤ 0.5（轻微抖动）或 ≤ 0.8（强烈抖动）。如需更强冲击力，可配合 ZoomIn + SFX`,
          'BUG-EFF-SHAKE-TOO-STRONG'
        );
      } else if (ev.intensity < 0.05) {
        this.addIssue('info',
          `Camera:Shake 强度过低 (${ev.intensity})，观众可能察觉不到抖动效果`,
          ev.entry?.startTime,
          `建议 intensity ≥ 0.1，或移除 Shake 改用静态运镜`,
          'BUG-EFF-SHAKE-TOO-WEAK'
        );
      }

      if (ev.duration > 2.0) {
        this.addIssue('warning',
          `Camera:Shake 持续时间过长 (${ev.duration}s)，长时间抖动会造成视觉不适`,
          ev.entry?.startTime,
          `建议 duration ≤ 1.0s。如需持续紧张感，可间歇性使用多个短 Shake`,
          'BUG-EFF-SHAKE-TOO-LONG'
        );
      }
    }
  }

  /**
   * D5-3: Shake should match character emotion
   * Shake is appropriate for: panic, scared, angry, excited (sparingly)
   * Shake is NOT appropriate for: calm, happy, gentle, daydreaming, proud
   */
  _checkShakeEmotionMatch(shakeEvents, entries) {
    const highEnergyEmotions = ['panic', 'scared', 'angry', 'excited', 'exasperated', 'worried'];
    const lowEnergyEmotions = ['calm', 'happy', 'gentle', 'daydreaming', 'proud', 'teasing', 'defiant'];

    for (const ev of shakeEvents) {
      if (!ev.entry) continue;

      const emotion = ev.entry.voiceEmotion || this._inferEmotionFromText(ev.entry.dialogue || '');
      if (!emotion) continue;

      if (lowEnergyEmotions.includes(emotion)) {
        this.addIssue('warning',
          `Camera:Shake 与角色情绪不匹配：条目使用 {Voice:${emotion}}（低张力），但 Shake 是高冲击特效，会产生违和感`,
          ev.entry.startTime,
          `情绪为 ${emotion} 时建议用 Static、CloseUp 或 Pan；Shake 应保留给 panic/scared/angry`,
          'BUG-EFF-SHAKE-EMOTION-MISMATCH'
        );
      }
    }
  }

  /**
   * D5-4: Consecutive effects stacking
   * Warn if Shake + SFX are used in the same entry without clear narrative reason
   */
  _checkConsecutiveEffects(shakeEvents, sfxEvents, entries) {
    const shakeEntryIndices = new Set();
    for (const ev of shakeEvents) {
      if (ev.entry) shakeEntryIndices.add(ev.entry.index);
    }

    const sfxEntryIndices = new Set();
    for (const ev of sfxEvents) {
      if (ev.entry) sfxEntryIndices.add(ev.entry.index);
    }

    // Find entries that have both Shake and SFX
    for (const idx of shakeEntryIndices) {
      if (sfxEntryIndices.has(idx)) {
        const entry = entries.find((e) => e.index === idx);
        if (entry) {
          this.addIssue('info',
            `条目 ${idx}: 同时使用了 Camera:Shake + SFX，确保两者服务于同一叙事目的（如爆炸、撞击），避免特效堆砌`,
            entry.startTime,
            `如果只是想强调台词，保留 SFX 移除 Shake；如果是动作场面，保留两者`,
            'BUG-EFF-STACKING'
          );
        }
      }
    }
  }

  /**
   * D5-5: Unnecessary Shake in static/dialogue scenes
   * Shake in long dialogue (>5s) without action animation is usually unnecessary
   */
  _checkUnnecessaryShake(shakeEvents, entries) {
    for (const ev of shakeEvents) {
      if (!ev.entry) continue;

      const duration = ev.entry.endTime - ev.entry.startTime;
      const hasActionAnim = ev.entry.animations && ev.entry.animations.some((a) =>
        !['Nod', 'Think', 'WaveHand', 'ScratchHead'].includes(a)
      );

      if (duration > 5 && !hasActionAnim) {
        this.addIssue('info',
          `条目 ${ev.entry.index}: 长台词 (${duration.toFixed(1)}s) 使用 Shake 但无动作动画，抖动可能分散观众对台词的注意力`,
          ev.entry.startTime,
          `长对话建议用 Static 或 CloseUp；Shake 适合配合 Jump/Run/SurprisedJump 等动作`,
          'BUG-EFF-SHAKE-STATIC-DIALOGUE'
        );
      }
    }
  }

  _inferEmotionFromText(text) {
    if (!text) return null;
    if (/救命|救我|完蛋|死了|怎么办|不要.*啊|停.*下来/.test(text)) return 'panic';
    if (/好痛|好怕|好可怕|好危险/.test(text)) return 'scared';
    if (/笨蛋|可恶|讨厌|气死|混蛋/.test(text)) return 'angry';
    if (/太棒了|真的吗|超厉害|好厉害|太好了/.test(text)) return 'excited';
    if (/才.*不会|才.*没有|才.*不是/.test(text)) return 'defiant';
    if (/真是的|每次.*都|又.*乱来/.test(text)) return 'exasperated';
    if (/没事吧|小心|要不要|还好吗/.test(text)) return 'worried';
    if (/哈哈|嘻嘻|嘿嘿|开心|高兴/.test(text)) return 'happy';
    if (/呜呜|好难过|伤心|失望|算了/.test(text)) return 'sad';
    return 'calm';
  }
}
