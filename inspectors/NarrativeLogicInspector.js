import { InspectorBase } from './InspectorBase.js';

/**
 * NarrativeLogicInspector — D15 剧本逻辑合理性检测
 *
 * 检测范围:
 * - 抢拍检测：两个条目时间重叠（同一角色同时说两句话，或场景切换时时间冲突）
 * - 场景切换逻辑：场景切换是否有合理过渡，角色在新场景是否有 Position 定义
 * - 台词连贯性：同一角色连续台词之间是否有合理间隔，对话是否自然流转
 * - 角色出场逻辑：角色首次出场是否有 Position 或入场动画
 * - 场景内角色一致性：同一场景中不应出现不可能同时存在的角色
 *
 * 核心原则：时间轴是剧本的唯一真理，任何时间冲突都是严重错误。
 */
export class NarrativeLogicInspector extends InspectorBase {
  constructor() {
    super('NarrativeLogicInspector', 'D15');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText } = context;

    if (!entries || entries.length === 0) {
      this.addIssue('warning', '剧本无有效条目，无法进行叙事逻辑检测', null, '检查 script.story 格式');
      return;
    }

    // D15-1: 抢拍检测（时间重叠）
    this._checkTimeOverlap(entries);

    // D15-2: 场景切换逻辑
    this._checkSceneTransitions(entries, storyText);

    // D15-3: 台词连贯性
    this._checkDialogueContinuity(entries);

    // D15-4: 角色出场逻辑
    this._checkCharacterEntrance(entries, storyText);

    // D15-5: 场景内时间连续性
    this._checkSceneTimeContinuity(entries);
  }

  /**
   * D15-1: 抢拍检测
   * 检测任意两个条目的时间区间是否重叠
   * 排除合理的重叠：背景音乐/效果条目可以与说话条目重叠
   */
  _checkTimeOverlap(entries) {
    // 只检查有角色或场景切换的"主条目"
    const mainEntries = entries.map((e, idx) => ({ ...e, _index: idx })).filter((e) => {
      // 纯配置条目（无角色、无文字）通常是场景切换或音乐，不与其他主条目冲突
      // 但如果它有场景切换标签，它定义了新场景的开始
      const isPureConfig = !e.character && !(e.text || e.dialogue);
      const hasSceneSwitch = e.scene && e.rawText && e.rawText.includes('@');
      // 有角色说话的条目，或有场景切换的条目，都是"主条目"
      return e.character || hasSceneSwitch || isPureConfig;
    });

    for (let i = 0; i < mainEntries.length; i++) {
      for (let j = i + 1; j < mainEntries.length; j++) {
        const a = mainEntries[i];
        const b = mainEntries[j];

        // 检查时间重叠
        const overlap = a.startTime < b.endTime && b.startTime < a.endTime;
        if (!overlap) continue;

        // 同一角色同时说两句话 —— 严重错误
        if (a.character && b.character && a.character === b.character) {
          this.addIssue('error',
            `抢拍（严重）: 角色 ${a.character} 在 ${a.startTime.toFixed(1)}s~${a.endTime.toFixed(1)}s 和 ${b.startTime.toFixed(1)}s~${b.endTime.toFixed(1)}s 同时有两个条目，角色不可能同时说两句话`,
            a.startTime,
            `将第二个条目的开始时间调整到 ${a.endTime.toFixed(1)}s 之后`,
            'D15-OVERLAP-SAME-CHAR'
          );
          continue;
        }

        // 两个不同角色但时间完全重叠且不是场景切换条目 —— 可能是抢拍
        // 场景切换条目（entry N 有 @Scene）通常与下一条目有短暂重叠（过渡时间）
        const isSceneSwitchA = a.rawText && a.rawText.includes('@');
        const isSceneSwitchB = b.rawText && b.rawText.includes('@');

        // 如果一个是纯场景切换（无角色台词），另一个是角色台词，允许短暂重叠（过渡）
        if ((isSceneSwitchA && !a.character) || (isSceneSwitchB && !b.character)) {
          // 场景切换行允许与下一条目有最多 2 秒的重叠（淡入淡出过渡）
          const switchEntry = isSceneSwitchA && !a.character ? a : b;
          const otherEntry = switchEntry === a ? b : a;
          const overlapDuration = Math.min(switchEntry.endTime, otherEntry.endTime) - Math.max(switchEntry.startTime, otherEntry.startTime);
          if (overlapDuration <= 2.0) continue; // 合理过渡
        }

        // 两个都有角色台词的条目重叠 —— 可能是抢拍
        if (a.character && b.character) {
          // 检查是否是同一行内的不同角色对话（快速对切）
          const gap = Math.abs(a.startTime - b.startTime);
          if (gap < 0.5) {
            this.addIssue('error',
              `抢拍: 条目 #${a._index + 1} (${a.character}) 和 #${b._index + 1} (${b.character}) 几乎同时开始 (${a.startTime.toFixed(1)}s / ${b.startTime.toFixed(1)}s)，时间重叠 ${(Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime)).toFixed(1)}s。如非故意设计，请调整时间`,
              a.startTime,
              `将其中一个条目的开始时间延后，确保不重叠`,
              'D15-OVERLAP-DIALOGUE'
            );
          } else {
            // 部分重叠（如 A 还没说完 B 就开始了）
            this.addIssue('warning',
              `时间重叠: 条目 #${a._index + 1} (${a.character}, ${a.startTime.toFixed(1)}s~${a.endTime.toFixed(1)}s) 与 #${b._index + 1} (${b.character}, ${b.startTime.toFixed(1)}s~${b.endTime.toFixed(1)}s) 时间重叠。对切镜头可能导致音频混杂`,
              a.startTime,
              `调整时间使条目顺序排列，或在重叠处使用 {Transition:Cut} 明确对切意图`,
              'D15-OVERLAP-PARTIAL'
            );
          }
        }
      }
    }
  }

  /**
   * D15-2: 场景切换逻辑
   * - 场景切换时，旧场景角色是否有退场，新场景角色是否有 Position
   * - 同一场景内，角色位置是否一致
   */
  _checkSceneTransitions(entries, storyText) {
    const sceneEntries = []; // 每个场景的第一条条目
    let currentScene = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.scene && entry.scene !== currentScene) {
        currentScene = entry.scene;
        sceneEntries.push({ scene: currentScene, entryIndex: i, entry });
      }
    }

    // 检查每个场景切换点
    for (let i = 1; i < sceneEntries.length; i++) {
      const prev = sceneEntries[i - 1];
      const curr = sceneEntries[i];
      const prevSceneLastEntries = this._getSceneLastEntries(entries, prev.entryIndex, curr.entryIndex);

      // 检查新场景第一条目是否有 Position 标签（角色定位）
      const currEntry = curr.entry;
      const hasPositionInCurr = currEntry.positionOps && currEntry.positionOps.length > 0;
      const hasPositionInRaw = currEntry.rawText && /\{Position:\w+/.test(currEntry.rawText);

      if (!hasPositionInCurr && !hasPositionInRaw) {
        // 检查下几条目是否有 Position
        const nextFewEntries = entries.slice(curr.entryIndex, curr.entryIndex + 5);
        const hasPositionSoon = nextFewEntries.some((e) =>
          (e.positionOps && e.positionOps.length > 0) ||
          (e.rawText && /\{Position:\w+/.test(e.rawText))
        );

        if (!hasPositionSoon) {
          this.addIssue('warning',
            `场景 ${curr.scene} 开始后未找到任何 {Position:...} 标签，角色可能全部堆叠在原点`,
            curr.entry.startTime,
            `在 ${curr.scene} 的第一条条目添加 {Position:CharacterName|x=...|z=...|face=...} 定义角色位置`,
            'D15-SCENE-NO-POSITION'
          );
        }
      }

      // 检查旧场景角色是否有退场暗示
      const prevSceneChars = new Set();
      for (let j = prev.entryIndex; j < curr.entryIndex; j++) {
        if (entries[j].character) prevSceneChars.add(entries[j].character);
      }

      // 新场景中出现的角色
      const currSceneChars = new Set();
      for (let j = curr.entryIndex; j < entries.length; j++) {
        if (entries[j].scene && entries[j].scene !== curr.scene) break;
        if (entries[j].character) currSceneChars.add(entries[j].character);
      }

      // 检查是否有角色从旧场景"瞬移"到新场景（无退场+无重新入场）
      for (const char of prevSceneChars) {
        if (currSceneChars.has(char)) {
          // 角色在两个场景都出现，检查是否有退场/入场标记
          const hasExit = prevSceneLastEntries.some((e) =>
            e.character === char && (
              e.animations?.some((a) => /walk|run|leave|exit|fade|move/i.test(a)) ||
              e.storyEvents?.some((ev) => ev.name === 'Move' || ev.name === 'FadeOut' || ev.name === 'Exit')
            )
          );

          const hasReentry = entries.slice(curr.entryIndex, curr.entryIndex + 5).some((e) =>
            e.positionOps?.some((po) => po.character === char) ||
            (e.rawText && new RegExp(`Position:${char}`, 'i').test(e.rawText))
          );

          if (!hasExit && !hasReentry) {
            this.addIssue('info',
              `角色 ${char} 从 ${prev.scene} 直接出现在 ${curr.scene}，无退场动画也无重新入场 Position。如非同一地点的不同视角，建议添加过渡`,
              curr.entry.startTime,
              `在 ${prev.scene} 末尾添加退场动画，或在 ${curr.scene} 开头添加 {Position:${char}}`,
              'D15-SCENE-TELEPORT'
            );
          }
        }
      }
    }
  }

  /**
   * D15-3: 台词连贯性
   * - 同一角色连续台词间隔是否合理（< 0.5s 太紧，> 10s 可能断线）
   * - 对话是否自然流转（A 说完 B 接，B 说完 A 接）
   * - 过长独白（同一角色连续 3 句以上无其他角色插话）
   */
  _checkDialogueContinuity(entries) {
    // 按时间排序的说话条目
    const dialogueEntries = entries
      .map((e, idx) => ({ ...e, _index: idx }))
      .filter((e) => e.character && (e.text || e.dialogue))
      .sort((a, b) => a.startTime - b.startTime);

    if (dialogueEntries.length < 2) return;

    // 检测同一角色连续台词
    let sameCharStreak = 1;
    let streakStartIdx = 0;

    for (let i = 1; i < dialogueEntries.length; i++) {
      const prev = dialogueEntries[i - 1];
      const curr = dialogueEntries[i];
      const gap = curr.startTime - prev.endTime;

      // 间隔检查
      if (gap < 0) {
        // 时间重叠已在 _checkTimeOverlap 中处理
      } else if (gap < 0.3 && gap > 0) {
        // 只有真正相邻的台词（gap > 0 且很小）才报间隔过短
        // gap === 0 表示前一条结束、后一条立即开始，这是 SRT 的标准写法，不报错
        this.addIssue('info',
          `台词间隔过短: ${curr.character} 的台词（${curr.startTime.toFixed(1)}s）距上一条仅 ${gap.toFixed(2)}s，观众可能来不及消化`,
          curr.startTime,
          `将间隔增加到至少 0.5s，或合并为一句台词`,
          'D15-DIALOGUE-RAPID'
        );
      } else if (gap > 15) {
        this.addIssue('info',
          `台词间隔过长: ${curr.character} 的台词（${curr.startTime.toFixed(1)}s）距上一条有 ${gap.toFixed(1)}s 空白，节奏可能断裂`,
          curr.startTime,
          `添加过渡动作、环境描写或缩短空白时间`,
          'D15-DIALOGUE-GAP'
        );
      }

      // 同一角色连续台词计数
      if (curr.character === prev.character) {
        sameCharStreak++;
      } else {
        if (sameCharStreak >= 4) {
          const startEntry = dialogueEntries[streakStartIdx];
          this.addIssue('info',
            `独白过长: ${prev.character} 连续 ${sameCharStreak} 句台词无其他角色插话（从 ${startEntry.startTime.toFixed(1)}s 到 ${prev.endTime.toFixed(1)}s），节奏单调`,
            startEntry.startTime,
            `插入其他角色的反应（如"嗯？""真的吗？"）或动作镜头打破独白`,
            'D15-MONOLOGUE-LONG'
          );
        }
        sameCharStreak = 1;
        streakStartIdx = i;
      }
    }

    // 检查最后一段 streak
    if (sameCharStreak >= 4) {
      const lastIdx = dialogueEntries.length - 1;
      const startEntry = dialogueEntries[streakStartIdx];
      const lastEntry = dialogueEntries[lastIdx];
      this.addIssue('info',
        `独白过长: ${lastEntry.character} 连续 ${sameCharStreak} 句台词无其他角色插话（从 ${startEntry.startTime.toFixed(1)}s 到 ${lastEntry.endTime.toFixed(1)}s），节奏单调`,
        startEntry.startTime,
        `插入其他角色的反应或动作镜头打破独白`,
        'D15-MONOLOGUE-LONG'
      );
    }
  }

  /**
   * D15-4: 角色出场逻辑
   * - 角色首次出场是否有 Position 定义
   * - 角色出场前是否有场景定义（不能在空中出场）
   */
  _checkCharacterEntrance(entries, storyText) {
    const charFirstAppearance = new Map(); // char -> { entry, entryIndex, hasPosition }
    const charPositionHistory = new Map(); // char -> last known scene
    const narrationOnlyChars = new Set(['Narrator']);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.character) continue;

      const char = entry.character;
      if (narrationOnlyChars.has(char)) continue;

      if (!charFirstAppearance.has(char)) {
        // 首次出场
        const hasPosition = entry.positionOps?.some((po) => po.character === char) ||
          entry.storyEvents?.some((ev) => ev.name === 'Move' && ev.options?.character === char) ||
          (entry.rawText && (new RegExp(`Position:${char}`, 'i').test(entry.rawText) || new RegExp(`Event:Move\\|character=${char}`, 'i').test(entry.rawText)));

        // 检查前面几条目是否有该角色的 Position 或 Move
        const hasPositionBefore = entries.slice(0, i).some((e) =>
          e.positionOps?.some((po) => po.character === char) ||
          e.storyEvents?.some((ev) => ev.name === 'Move' && ev.options?.character === char) ||
          (e.rawText && (new RegExp(`Position:${char}`, 'i').test(e.rawText) || new RegExp(`Event:Move\\|character=${char}`, 'i').test(e.rawText)))
        );

        if (!hasPosition && !hasPositionBefore) {
          this.addIssue('warning',
            `角色 ${char} 首次出场（条目 #${i + 1}, ${entry.startTime.toFixed(1)}s）但无 {Position:${char}} 定义，可能出现在默认位置（原点）`,
            entry.startTime,
            `在 ${char} 首次出场前添加 {Position:${char}|x=...|z=...|face=...} 定义初始位置`,
            'D15-CHAR-NO-POSITION'
          );
        }

        charFirstAppearance.set(char, { entry, entryIndex: i, hasPosition: hasPosition || hasPositionBefore });
      }

      // 记录角色所在场景
      if (entry.scene) {
        charPositionHistory.set(char, entry.scene);
      }
    }
  }

  /**
   * D15-5: 场景内时间连续性
   * - 同一场景内，条目时间是否连续（不应有大段空白）
   * - 场景最后一条目到场景切换是否有合理间隔
   */
  _checkSceneTimeContinuity(entries) {
    const sceneRanges = [];
    let currentScene = null;
    let sceneStart = -1;
    let sceneEnd = -1;
    let sceneStartIdx = -1;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.scene && entry.scene !== currentScene) {
        // 保存上一个场景
        if (currentScene !== null) {
          sceneRanges.push({ scene: currentScene, start: sceneStart, end: sceneEnd, startIdx: sceneStartIdx, endIdx: i - 1 });
        }
        currentScene = entry.scene;
        sceneStart = entry.startTime;
        sceneStartIdx = i;
        sceneEnd = entry.endTime;
      } else if (currentScene !== null) {
        sceneEnd = Math.max(sceneEnd, entry.endTime);
      }
    }
    // 保存最后一个场景
    if (currentScene !== null) {
      sceneRanges.push({ scene: currentScene, start: sceneStart, end: sceneEnd, startIdx: sceneStartIdx, endIdx: entries.length - 1 });
    }

    for (let i = 0; i < sceneRanges.length; i++) {
      const range = sceneRanges[i];
      const sceneEntries = entries.slice(range.startIdx, range.endIdx + 1);

      // 检查场景内是否有大段空白（> 8秒无任何条目）
      const activeEntries = sceneEntries
        .map((e, idx) => ({ ...e, _localIdx: idx }))
        .filter((e) => e.character || (e.storyEvents && e.storyEvents.length > 0));

      for (let j = 1; j < activeEntries.length; j++) {
        const prev = activeEntries[j - 1];
        const curr = activeEntries[j];
        const gap = curr.startTime - prev.endTime;
        if (gap > 8) {
          this.addIssue('info',
            `场景 ${range.scene} 内 ${prev.endTime.toFixed(1)}s ~ ${curr.startTime.toFixed(1)}s 有 ${gap.toFixed(1)}s 空白，无角色活动或事件`,
            prev.endTime,
            `添加过渡动作、环境音效或缩短空白`,
            'D15-SCENE-DEAD-AIR'
          );
        }
      }

      // 检查场景切换间隔
      if (i < sceneRanges.length - 1) {
        const nextRange = sceneRanges[i + 1];
        const transitionGap = nextRange.start - range.end;
        if (transitionGap < 0) {
          // 重叠已在 _checkTimeOverlap 中处理
        } else if (transitionGap > 5) {
          this.addIssue('info',
            `场景切换间隔过长: ${range.scene} 结束于 ${range.end.toFixed(1)}s，${nextRange.scene} 开始于 ${nextRange.start.toFixed(1)}s，间隔 ${transitionGap.toFixed(1)}s。观众可能感到节奏断裂`,
            range.end,
            `缩短间隔或在中间添加过渡画面/音效`,
            'D15-TRANSITION-GAP'
          );
        }
      }
    }
  }

  _getSceneLastEntries(entries, sceneStartIdx, sceneEndIdx) {
    return entries.slice(sceneStartIdx, sceneEndIdx);
  }
}
