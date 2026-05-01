import { InspectorBase } from './InspectorBase.js';

/**
 * StoryQualityInspector — D9 故事质量与叙事节奏检查
 *
 * 核心理念：故事不是"全程精彩"才算好，而是"该平淡时平淡，该精彩时精彩"。
 * 支持经典的叙事节奏结构：
 *   - 铺垫/日常 (Setup)     → 低张力，建立角色和世界
 *   - 上升/冲突 (Rising)    → 张力爬升，引入冲突
 *   - 高潮 (Climax)         → 最大张力，核心冲突爆发
 *   - 回落/解决 (Falling)   → 张力下降，冲突解决
 *   - 结尾 (Resolution)     → 低张力，收束情感
 *
 * 检查范围:
 * - 分段节奏分析（将故事分为5段，每段有独立的情绪期望）
 * - 情绪张力曲线合理性
 * - 冲突密度分布
 * - 悬念设置与解答
 * - 角色情绪多样性
 * - 高潮定位与强度
 */
export class StoryQualityInspector extends InspectorBase {
  constructor() {
    super('StoryQualityInspector', 'D9');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText } = context;

    if (!entries || entries.length === 0) {
      this.addIssue('warning', '剧本无有效条目，无法进行故事质量分析', null, '检查 script.story 格式');
      return;
    }

    const totalDuration = entries[entries.length - 1]?.endTime || 0;
    if (totalDuration < 10) {
      this.addIssue('info', '剧本时长过短（<10秒），故事质量分析意义有限', null, null, 'D9-SHORT');
      return;
    }

    // 构建情绪时间线
    const emotionTimeline = this._buildEmotionTimeline(entries);

    // 执行各项检查
    this._checkSegmentRhythm(entries, emotionTimeline, totalDuration);
    this._checkTensionCurve(emotionTimeline, totalDuration);
    this._checkClimaxPosition(emotionTimeline, totalDuration);
    this._checkConflictDistribution(entries, totalDuration);
    this._checkSuspenseResolution(entries, totalDuration);
    this._checkCharacterEmotionDiversity(entries);
    this._checkPacingVariety(emotionTimeline, totalDuration);
  }

  /**
   * 构建情绪时间线：每个时间点对应的情绪强度
   */
  _buildEmotionTimeline(entries) {
    const timeline = [];

    // 情绪强度映射（1-10）
    const intensityMap = {
      // 低张力（日常/平静）
      calm: 1, gentle: 2, daydreaming: 2, curious: 2,
      // 中低张力
      happy: 3, teasing: 3, proud: 4, concerned: 3,
      // 中张力
      excited: 5, defiant: 5, triumphant: 5, whiny: 4,
      // 高张力
      exasperated: 6, worried: 6, angry: 7,
      // 最高张力（危机/高潮）
      panic: 9, scared: 9,
      // 悲伤（特殊，通常用于结尾）
      sad: 4,
    };

    for (const entry of entries) {
      if (!entry.character) continue;

      // 获取情绪标签（优先使用显式标签，其次推断）
      let emotion = entry.voiceEmotion || entry.emotion;
      if (!emotion && entry.text) {
        emotion = this._inferEmotionFromText(entry.text);
      }

      const intensity = emotion ? (intensityMap[emotion] || 3) : 2;
      timeline.push({
        startTime: entry.startTime,
        endTime: entry.endTime,
        character: entry.character,
        emotion,
        intensity,
        text: entry.text || '',
      });
    }

    return timeline;
  }

  /**
   * 从文本推断情绪（简化版，用于无标签条目）
   */
  _inferEmotionFromText(text) {
    if (!text) return null;

    // 高张力
    if (/救命|救我|完蛋|死了|怎么办|不要.*啊|停.*下来/.test(text)) return 'panic';
    if (/好痛|好怕|好可怕|好危险/.test(text)) return 'scared';
    if (/笨蛋|可恶|讨厌|气死|混蛋/.test(text)) return 'angry';

    // 中张力
    if (/太棒了|真的吗|超厉害|好厉害|太好了/.test(text)) return 'excited';
    if (/才.*不会|才.*没有|才.*不是/.test(text)) return 'defiant';
    if (/真是的|每次.*都|又.*乱来/.test(text)) return 'exasperated';
    if (/没事吧|小心|要不要|还好吗/.test(text)) return 'worried';

    // 低张力
    if (/哈哈|嘻嘻|嘿嘿|开心|高兴/.test(text)) return 'happy';
    if (/小心.*哦|要注意|慢慢来|没关系/.test(text)) return 'gentle';
    if (/呜呜|好难过|伤心|失望|算了/.test(text)) return 'sad';

    return 'calm';
  }

  /**
   * D9-1: 分段节奏检查
   * 将故事分为5段，每段有独立的情绪期望
   */
  _checkSegmentRhythm(entries, timeline, totalDuration) {
    if (timeline.length === 0) return;

    // 五段式结构
    const segments = [
      { name: '铺垫/日常', start: 0, end: totalDuration * 0.15, expectedIntensity: 'low', maxIntensity: 4 },
      { name: '上升/冲突', start: totalDuration * 0.15, end: totalDuration * 0.40, expectedIntensity: 'rising', minIntensity: 2, maxIntensity: 7 },
      { name: '高潮', start: totalDuration * 0.40, end: totalDuration * 0.70, expectedIntensity: 'high', minIntensity: 5 },
      { name: '回落/解决', start: totalDuration * 0.70, end: totalDuration * 0.90, expectedIntensity: 'falling', maxIntensity: 6 },
      { name: '结尾', start: totalDuration * 0.90, end: totalDuration, expectedIntensity: 'low', maxIntensity: 5 },
    ];

    for (const seg of segments) {
      const segEntries = timeline.filter((e) => e.startTime >= seg.start && e.startTime < seg.end);
      if (segEntries.length === 0) continue;

      const avgIntensity = segEntries.reduce((sum, e) => sum + e.intensity, 0) / segEntries.length;
      const maxInSeg = Math.max(...segEntries.map((e) => e.intensity));
      const minInSeg = Math.min(...segEntries.map((e) => e.intensity));

      // 检查各段的情绪期望
      if (seg.expectedIntensity === 'low') {
        if (maxInSeg >= 8) {
          this.addIssue('warning',
            `${seg.name}段（${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s）出现过高情绪强度(${maxInSeg})，破坏了铺垫/收束的节奏。该段应保持低张力，让观众进入/退出故事`,
            seg.start,
            `将该段的高情绪台词移到上升段或高潮段，或用更平静的表达方式`,
            'D9-SEG-RHYTHM'
          );
        }
      } else if (seg.expectedIntensity === 'high') {
        if (maxInSeg < 6) {
          this.addIssue('warning',
            `${seg.name}段（${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s）最高情绪强度仅${maxInSeg}，缺乏足够的高潮张力。高潮段应有panic/scared/angry等强情绪`,
            seg.start,
            `在该段添加核心冲突爆发（如角色遇险、重大转折），使用{Voice:panic}或{Voice:scared}增强表现力`,
            'D9-SEG-CLIMAX-WEAK'
          );
        }
      } else if (seg.expectedIntensity === 'rising') {
        if (avgIntensity < 3) {
          this.addIssue('info',
            `${seg.name}段（${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s）平均情绪强度(${avgIntensity.toFixed(1)})偏低，上升曲线不够明显`,
            seg.start,
            `逐步增加冲突和紧张感，让观众感受到"事情正在变糟/变好"`,
            'D9-SEG-RISING-FLAT'
          );
        }
      } else if (seg.expectedIntensity === 'falling') {
        if (minInSeg >= 7) {
          this.addIssue('info',
            `${seg.name}段（${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s）情绪持续高涨，缺少回落缓冲。高潮后需要给观众"喘息"的空间`,
            seg.start,
            `添加1-2句平静的台词或过渡动作，让情绪自然下降`,
            'D9-SEG-NO-FALL'
          );
        }
      }
    }
  }

  /**
   * D9-2: 张力曲线检查
   * 检测情绪 plateau（长时间同一情绪）和突兀跳跃
   */
  _checkTensionCurve(timeline, totalDuration) {
    if (timeline.length < 3) return;

    // 检测情绪 plateau（连续60秒无变化）
    const windowSize = 60; // 秒
    let plateauStart = null;
    let plateauEmotion = null;

    for (let t = 0; t <= totalDuration - windowSize; t += 5) {
      const windowEntries = timeline.filter((e) => e.startTime >= t && e.startTime < t + windowSize);
      if (windowEntries.length < 2) continue;

      const uniqueEmotions = new Set(windowEntries.map((e) => e.emotion).filter(Boolean));
      const avgIntensity = windowEntries.reduce((sum, e) => sum + e.intensity, 0) / windowEntries.length;

      if (uniqueEmotions.size === 1 && avgIntensity < 5) {
        // 单一低情绪持续60秒
        if (!plateauStart) {
          plateauStart = t;
          plateauEmotion = Array.from(uniqueEmotions)[0];
        }
      } else {
        if (plateauStart !== null && t - plateauStart >= 30) {
          this.addIssue('info',
            `情绪 plateau 检测：从 ${plateauStart.toFixed(1)}s 到 ${t.toFixed(1)}s 持续使用 "${plateauEmotion}" 情绪，节奏可能过于单调`,
            plateauStart,
            `插入一个小冲突、转折或幽默片段打破单调，或缩短该段时长`,
            'D9-PLATEAU'
          );
        }
        plateauStart = null;
        plateauEmotion = null;
      }
    }

    // 检测突兀的情绪跳跃（3秒内从 calm 到 panic）
    // 但排除场景切换导致的跳跃（不同场景可以有不同情绪基调）
    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1];
      const curr = timeline[i];
      const timeGap = curr.startTime - prev.endTime;

      // 跳过场景切换后的第一条台词（场景切换允许情绪重置）
      if (timeGap <= 3 && prev.intensity <= 3 && curr.intensity >= 8) {
        // 检查是否是同角色连续台词（同角色跳跃更突兀）
        const isSameCharacter = prev.character === curr.character;
        // 检查是否有过渡条目（中间有其他角色或旁白）
        const hasTransition = !isSameCharacter;

        if (isSameCharacter) {
          this.addIssue('info',
            `情绪跳跃突兀：角色 ${curr.character} 从 "${prev.emotion}"(强度${prev.intensity}) 在 ${timeGap.toFixed(1)}秒内跳到 "${curr.emotion}"(强度${curr.intensity})，同角色缺少过渡铺垫`,
            curr.startTime,
            `在该角色台词之间添加1-2句过渡（如察觉异常、犹豫、准备），让情绪爬升更自然`,
            'D9-JUMP-SAME-CHAR'
          );
        } else if (timeGap <= 1.5) {
          // 不同角色但时间间隔极短，仍然突兀
          this.addIssue('info',
            `情绪跳跃突兀：从 "${prev.emotion}"(强度${prev.intensity}) 在 ${timeGap.toFixed(1)}秒内跳到 "${curr.emotion}"(强度${curr.intensity})，对话接得太紧缺少缓冲`,
            curr.startTime,
            `在两段台词之间增加1-2秒停顿，或插入一个动作/反应镜头`,
            'D9-JUMP-RAPID'
          );
        }
        // 不同角色且间隔 > 1.5秒，视为合理（场景切换或对话自然流转）
      }
    }
  }

  /**
   * D9-3: 高潮定位检查
   * 高潮应出现在 40%-70% 区间（黄金分割点附近）
   */
  _checkClimaxPosition(timeline, totalDuration) {
    if (timeline.length === 0) return;

    // 找到全局最高情绪点
    const maxIntensity = Math.max(...timeline.map((e) => e.intensity));
    const climaxEntries = timeline.filter((e) => e.intensity === maxIntensity);

    if (climaxEntries.length === 0) return;

    // 取第一个高潮点作为"主高潮"
    const mainClimax = climaxEntries[0];
    const climaxRatio = mainClimax.startTime / totalDuration;

    // 高潮位置评估
    if (climaxRatio < 0.25) {
      this.addIssue('warning',
        `高潮出现过早（${(climaxRatio * 100).toFixed(0)}% 处，约 ${mainClimax.startTime.toFixed(1)}s），观众尚未充分投入。经典结构建议高潮在 40%-70% 区间`,
        mainClimax.startTime,
        `在前面增加铺垫内容（角色动机、日常互动），让观众建立情感连接后再爆发冲突`,
        'D9-CLIMAX-EARLY'
      );
    } else if (climaxRatio > 0.80) {
      this.addIssue('info',
        `高潮出现较晚（${(climaxRatio * 100).toFixed(0)}% 处），可能导致前段节奏拖沓。确保前段有足够的"小高潮"维持观众兴趣`,
        mainClimax.startTime,
        `在前 40% 添加1-2个"伪高潮"或悬念钩子，让观众保持期待`,
        'D9-CLIMAX-LATE'
      );
    } else if (climaxRatio >= 0.40 && climaxRatio <= 0.70) {
      this.addIssue('info',
        `高潮位置理想（${(climaxRatio * 100).toFixed(0)}% 处，约 ${mainClimax.startTime.toFixed(1)}s），符合经典叙事结构的黄金位置`,
        mainClimax.startTime,
        null,
        'D9-CLIMAX-GOOD'
      );
    }

    // 高潮强度评估
    if (maxIntensity < 7) {
      this.addIssue('warning',
        `全局最高情绪强度仅 ${maxIntensity}，缺乏真正的高潮爆发。建议至少有一个 panic/scared/angry 级别的强情绪点`,
        mainClimax.startTime,
        `设计一个"生死攸关"或"重大转折"的时刻，让角色情绪达到顶点`,
        'D9-CLIMAX-WEAK'
      );
    }
  }

  /**
   * D9-4: 冲突密度分布检查
   * 检测冲突是否均匀分布，避免前段密集后段空洞或反之
   */
  _checkConflictDistribution(entries, totalDuration) {
    // 冲突关键词
    const conflictPatterns = [
      /不要|不行|不可以|反对|拒绝/,
      /笨蛋|可恶|讨厌|烦人|气死|混蛋/,
      /救命|救我|完蛋|死了|怎么办/,
      /才.*不会|才.*没有|才.*不是/,
      /小心|危险|快.*了|来不及/,
      /为什么.*不|凭什么|不公平/,
    ];

    // 将故事分为3段，统计每段冲突数
    const thirds = [
      { name: '前1/3', start: 0, end: totalDuration / 3 },
      { name: '中1/3', start: totalDuration / 3, end: (totalDuration * 2) / 3 },
      { name: '后1/3', start: (totalDuration * 2) / 3, end: totalDuration },
    ];

    const conflictCounts = thirds.map((seg) => {
      const segEntries = entries.filter((e) => e.startTime >= seg.start && e.startTime < seg.end && e.text);
      let count = 0;
      for (const entry of segEntries) {
        for (const pattern of conflictPatterns) {
          if (pattern.test(entry.text)) {
            count++;
            break;
          }
        }
      }
      return { ...seg, count, totalLines: segEntries.length };
    });

    const totalConflicts = conflictCounts.reduce((sum, c) => sum + c.count, 0);
    if (totalConflicts === 0) {
      this.addIssue('warning',
        '全剧未检测到冲突元素，故事可能过于平淡。冲突是驱动叙事的核心动力',
        0,
        `添加角色间的分歧、意外事件、时间压力等冲突元素`,
        'D9-NO-CONFLICT'
      );
      return;
    }

    // 检查冲突分布是否过于集中
    const maxConflicts = Math.max(...conflictCounts.map((c) => c.count));
    const minConflicts = Math.min(...conflictCounts.map((c) => c.count));

    if (maxConflicts > 0 && minConflicts === 0) {
      const emptySeg = conflictCounts.find((c) => c.count === 0);
      const denseSeg = conflictCounts.find((c) => c.count === maxConflicts);
      this.addIssue('info',
        `冲突分布不均：${denseSeg.name} 有 ${maxConflicts} 处冲突，但 ${emptySeg.name} 完全无冲突。建议均匀分布以维持观众兴趣`,
        emptySeg.start,
        `在 ${emptySeg.name} 添加铺垫冲突或悬念钩子，为后续高潮做准备`,
        'D9-CONFLICT-UNEVEN'
      );
    }
  }

  /**
   * D9-5: 悬念设置与解答检查
   * 检测悬念是否在合理时间内得到解答
   */
  _checkSuspenseResolution(entries, totalDuration) {
    // 悬念设置模式
    const suspensePatterns = [
      { regex: /怎么办|会怎样|结果呢|到底.*呢/, type: 'question' },
      { regex: /小心|危险|快.*了|来不及|要.*了/, type: 'urgency' },
      { regex: /难道|莫非|该不会|难道.*吗/, type: 'doubt' },
      { regex: /如果.*就|要是.*该多好|万一/, type: 'hypothetical' },
    ];

    // 解答/回应模式
    const resolutionPatterns = [
      /原来.*是|果然|没想到|竟然/,
      /没事.*了|安全.*了|得救.*了|成功.*了/,
      /终于|总算|好在/,
    ];

    const suspensePoints = [];
    const resolutionPoints = [];

    for (const entry of entries) {
      if (!entry.text) continue;

      for (const sp of suspensePatterns) {
        if (sp.regex.test(entry.text)) {
          suspensePoints.push({ time: entry.startTime, text: entry.text, type: sp.type });
          break;
        }
      }

      for (const rp of resolutionPatterns) {
        if (rp.test(entry.text)) {
          resolutionPoints.push({ time: entry.startTime, text: entry.text });
          break;
        }
      }
    }

    // 检查每个悬念是否在合理时间内解答（< 总时长50%）
    for (const suspense of suspensePoints) {
      const maxResolveTime = suspense.time + totalDuration * 0.5;
      const resolved = resolutionPoints.some((r) => r.time > suspense.time && r.time <= maxResolveTime);

      if (!resolved) {
        // 检查是否在结尾前解答
        const anyLater = resolutionPoints.some((r) => r.time > suspense.time);
        if (!anyLater) {
          this.addIssue('info',
            `悬念未解答："${suspense.text.substring(0, 20)}..."（${suspense.time.toFixed(1)}s）设置了悬念，但全剧未找到明确的解答/回应。观众可能感到困惑`,
            suspense.time,
            `添加一句揭示真相或解决问题的台词（如"原来如此"、"终于成功了"）`,
            'D9-SUSPENSE-UNRESOLVED'
          );
        }
      }
    }

    // 检查是否有"解答"但没有对应的"悬念"（突兀的揭示）
    for (const resolution of resolutionPoints) {
      const hasPriorSuspense = suspensePoints.some((s) => s.time < resolution.time && resolution.time - s.time < totalDuration * 0.6);
      if (!hasPriorSuspense) {
        this.addIssue('info',
          `突兀的揭示："${resolution.text.substring(0, 20)}..."（${resolution.time.toFixed(1)}s）像是解答/结果，但之前没有明显的悬念铺垫。观众可能感到意外而非惊喜`,
          resolution.time,
          `在前面添加悬念铺垫（如角色担忧、暗示危险、提出问题），让揭示更有冲击力`,
          'D9-RESOLUTION-NO-SUSPENSE'
        );
      }
    }
  }

  /**
   * D9-6: 角色情绪多样性检查
   * 每个主要角色应有情绪变化，避免"情绪扁平"
   */
  _checkCharacterEmotionDiversity(entries) {
    const charEmotions = new Map();

    for (const entry of entries) {
      if (!entry.character || !entry.text) continue;

      if (!charEmotions.has(entry.character)) {
        charEmotions.set(entry.character, new Set());
      }
      const emotions = charEmotions.get(entry.character);

      // 获取情绪
      let emotion = entry.voiceEmotion || entry.emotion;
      if (!emotion) {
        emotion = this._inferEmotionFromText(entry.text);
      }
      if (emotion) {
        emotions.add(emotion);
      }
    }

    for (const [char, emotions] of charEmotions) {
      const count = emotions.size;
      const totalLines = entries.filter((e) => e.character === char && e.text).length;

      // 只有台词量足够的角色才检查
      if (totalLines < 3) continue;

      if (count === 1) {
        this.addIssue('warning',
          `角色 ${char} 在全剧中只表现出 1 种情绪（"${Array.from(emotions)[0]}"），过于扁平。好的角色应有情绪起伏`,
          null,
          `为 ${char} 设计情绪变化：日常→困惑→兴奋→担忧→释然，让角色更立体`,
          'D9-CHAR-FLAT'
        );
      } else if (count === 2) {
        this.addIssue('info',
          `角色 ${char} 只有 2 种情绪变化，略显单薄。建议增加中间情绪层次`,
          null,
          `在两种极端情绪之间添加过渡（如 calm → worried → panic → relieved）`,
          'D9-CHAR-THIN'
        );
      }
    }
  }

  /**
   * D9-7: 节奏多样性检查
   * 检测是否长时间保持同一语速/节奏
   */
  _checkPacingVariety(emotionTimeline, totalDuration) {
    if (emotionTimeline.length < 5) return;

    // 计算相邻条目的情绪变化幅度
    let totalChange = 0;
    let changeCount = 0;

    for (let i = 1; i < emotionTimeline.length; i++) {
      const change = Math.abs(emotionTimeline[i].intensity - emotionTimeline[i - 1].intensity);
      totalChange += change;
      changeCount++;
    }

    const avgChange = changeCount > 0 ? totalChange / changeCount : 0;

    if (avgChange < 1.5) {
      this.addIssue('info',
        `全剧平均情绪变化幅度仅 ${avgChange.toFixed(1)}，节奏较为平缓。建议增加"情绪过山车"——让观众在紧张和放松之间切换`,
        null,
        `交替安排紧张片段和轻松片段（如冲突→幽默→危机→温情），形成波浪式节奏`,
        'D9-PACING-MONOTONE'
      );
    } else if (avgChange > 4.5) {
      this.addIssue('info',
        `全剧平均情绪变化幅度高达 ${avgChange.toFixed(1)}，节奏过于跳跃。观众可能需要更多"喘息"空间`,
        null,
        `在高情绪片段之间插入1-2句过渡台词，让情绪变化更平滑`,
        'D9-PACING-CHAOTIC'
      );
    }
  }
}
