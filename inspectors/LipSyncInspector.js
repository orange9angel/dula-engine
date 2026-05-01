import { InspectorBase } from './InspectorBase.js';

/**
 * LipSyncInspector — D9 唇形同步检测
 *
 * 检测范围:
 * - 台词长度与时间窗口匹配度（防止嘴型动画被压缩或过度拉伸）
 * - 连续快嘴检测（同一角色连续多条短台词）
 * - 短台词长窗口检测（嘴型长时间保持张开）
 * - 台词密度与动画时长比例
 *
 * 原理：引擎根据台词音频时长驱动嘴型（viseme）动画。
 * 如果时间窗口 << 台词实际所需时间，嘴型动画会被压缩到不自然的高速开合。
 * 如果时间窗口 >> 台词所需时间，嘴型会在台词结束后长时间保持最后状态。
 */
export class LipSyncInspector extends InspectorBase {
  constructor() {
    super('LipSyncInspector', 'D9');
  }

  inspect(context) {
    this.reset();
    const { entries } = context;

    const speakingEntries = entries.filter((e) => e.text && e.character);

    // ── D9-1: 台词长度与时间窗口匹配 ──
    for (const entry of speakingEntries) {
      const text = entry.text;
      const timeWindow = (entry.endTime || entry.startTime + 3) - entry.startTime;
      const charCount = text.length;
      // 中文字符：正常语速约 3-5 字/秒，嘴型动画需要至少 0.15s/字
      const minReasonableTime = charCount * 0.18; // 0.18s/字 是较舒适的下限
      const idealTime = charCount * 0.25; // 0.25s/字 是理想语速

      if (charCount > 15 && timeWindow < 3.0) {
        this.addIssue('warning',
          `唇形同步警告: ${entry.character} 的台词"${text.substring(0, 20)}..."(${charCount}字) 仅在 ${timeWindow.toFixed(1)}s 内，嘴型动画将被严重压缩`,
          entry.startTime,
          `将时间窗口扩大到至少 ${Math.ceil(minReasonableTime)}s，或精简台词`,
          'BUG-LIPSYNC-COMPRESSED'
        );
      } else if (charCount > 25 && timeWindow < 5.0) {
        this.addIssue('error',
          `唇形同步错误: ${entry.character} 的长台词"${text.substring(0, 20)}..."(${charCount}字) 时间窗口仅 ${timeWindow.toFixed(1)}s，嘴型将变形到不自然`,
          entry.startTime,
          `必须扩大时间窗口到至少 ${Math.ceil(minReasonableTime)}s（建议 ${Math.ceil(idealTime)}s）`,
          'BUG-LIPSYNC-SEVERE'
        );
      }

      // 短台词但时间窗口过长
      if (charCount <= 3 && timeWindow > 4.0) {
        this.addIssue('warning',
          `唇形同步警告: ${entry.character} 的短台词"${text}"(${charCount}字) 时间窗口长达 ${timeWindow.toFixed(1)}s，嘴型将在台词结束后长时间保持张开`,
          entry.startTime,
          `缩短时间窗口到 1-2s，或在台词后添加动作/表情填充时间`,
          'BUG-LIPSYNC-STRETCHED'
        );
      }

      // 极端压缩：单字时间 < 0.12s
      if (charCount > 0 && timeWindow / charCount < 0.12) {
        this.addIssue('error',
          `唇形同步严重错误: ${entry.character} 的台词平均每个字仅 ${(timeWindow / charCount).toFixed(2)}s，远超正常语速极限，嘴型将抽搐`,
          entry.startTime,
          `立即扩大时间窗口或大幅精简台词`,
          'BUG-LIPSYNC-EXTREME'
        );
      }
    }

    // ── D9-2: 连续快嘴检测 ──
    this._checkRapidFireDialogue(speakingEntries);

    // ── D9-3: 单角色台词密度异常 ──
    this._checkCharacterDialogueDensity(speakingEntries);
  }

  _checkRapidFireDialogue(speakingEntries) {
    // 按角色分组，检查连续多条短台词
    const charEntries = new Map();
    for (const entry of speakingEntries) {
      if (!charEntries.has(entry.character)) {
        charEntries.set(entry.character, []);
      }
      charEntries.get(entry.character).push(entry);
    }

    for (const [char, ents] of charEntries) {
      if (ents.length < 3) continue;

      // 找连续 3+ 条时间窗口 < 2.5s 的
      let streak = 0;
      let streakStart = null;
      for (let i = 0; i < ents.length; i++) {
        const timeWindow = (ents[i].endTime || ents[i].startTime + 3) - ents[i].startTime;
        if (timeWindow < 2.5) {
          if (streak === 0) streakStart = ents[i].startTime;
          streak++;
        } else {
          if (streak >= 3) {
            this.addIssue('warning',
              `角色 ${char} 连续 ${streak} 条台词时间窗口均 < 2.5s，嘴型动画将连续高速切换，可能产生抽搐感`,
              streakStart,
              `合并部分短台词或增加停顿时间，让嘴型有"休息"的间隙`,
              'BUG-LIPSYNC-RAPID-FIRE'
            );
          }
          streak = 0;
          streakStart = null;
        }
      }
      if (streak >= 3) {
        this.addIssue('warning',
          `角色 ${char} 连续 ${streak} 条台词时间窗口均 < 2.5s，嘴型动画将连续高速切换`,
          streakStart,
          `合并部分短台词或增加停顿时间`,
          'BUG-LIPSYNC-RAPID-FIRE'
        );
      }
    }
  }

  _checkCharacterDialogueDensity(speakingEntries) {
    // 检查是否有角色的台词平均字数/时间比异常高
    const charStats = new Map(); // char -> {totalChars, totalTime, count}
    for (const entry of speakingEntries) {
      const char = entry.character;
      const timeWindow = (entry.endTime || entry.startTime + 3) - entry.startTime;
      if (!charStats.has(char)) {
        charStats.set(char, { totalChars: 0, totalTime: 0, count: 0 });
      }
      const s = charStats.get(char);
      s.totalChars += entry.text.length;
      s.totalTime += timeWindow;
      s.count++;
    }

    for (const [char, stats] of charStats) {
      if (stats.count < 2) continue;
      const avgCharsPerSec = stats.totalChars / stats.totalTime;
      if (avgCharsPerSec > 5.5) {
        this.addIssue('warning',
          `角色 ${char} 平均语速过快: ${avgCharsPerSec.toFixed(1)} 字/秒，嘴型动画将持续高速开合`,
          null,
          `适当放慢 ${char} 的台词节奏，或增加时间窗口`,
          'BUG-LIPSYNC-FAST-TALKER'
        );
      }
    }
  }
}
