import { InspectorBase } from './InspectorBase.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * MusicFitInspector — D12 配乐适配度检测
 *
 * 检测范围:
 * - BGM 风格与场景情绪匹配度
 * - BGM 音量合理性
 * - BGM 覆盖时长完整性
 * - 无 BGM 的空白检测
 * - BGM baseVolume 参数合理性
 *
 * 核心原则：BGM 应该服务于场景情绪，不应盖过对白，且覆盖完整。
 */
export class MusicFitInspector extends InspectorBase {
  constructor() {
    super('MusicFitInspector', 'D12');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText, totalDuration, audioDir } = context;

    // 提取所有 Music 标签
    const musicEvents = this._extractMusicEvents(storyText);

    // ── D12-1: BGM 缺失检测 ──
    if (musicEvents.length === 0) {
      if (totalDuration > 30) {
        this.addIssue('warning',
          `剧本时长 ${totalDuration.toFixed(1)}s 但无任何 BGM，将出现长时间静音，观感单调`,
          null,
          `添加 {Music:Play|name=xxx|fadeIn=1.5|baseVolume=0.4|endTime=${Math.ceil(totalDuration)}}`,
          'BUG-MUSIC-MISSING'
        );
      }
      return;
    }

    // ── D12-2: BGM 覆盖时长 ──
    for (const me of musicEvents) {
      if (me.endTime && me.endTime < totalDuration - 5) {
        this.addIssue('warning',
          `BGM "${me.name}" 在 ${me.endTime.toFixed(1)}s 结束，但剧本总时长 ${totalDuration.toFixed(1)}s，末尾 ${(totalDuration - me.endTime).toFixed(1)}s 将出现静音`,
          me.endTime,
          `将 endTime 设为 ${Math.ceil(totalDuration + 2)} 或更长`,
          'BUG-MUSIC-TOO-SHORT'
        );
      }
    }

    // ── D12-3: BGM 风格-场景匹配 ──
    this._checkMusicSceneMatch(musicEvents, entries, storyText);

    // ── D12-4: BGM 风格-情绪匹配 ──
    this._checkMusicEmotionMatch(musicEvents, entries);

    // ── D12-5: BGM 音量检测 ──
    this._checkMusicVolume(musicEvents, audioDir);

    // ── D12-6: baseVolume 参数 ──
    for (const me of musicEvents) {
      if (me.baseVolume !== null && me.baseVolume > 0.55) {
        this.addIssue('info',
          `BGM "${me.name}" 的 baseVolume=${me.baseVolume} 较高，在有对白的场景中可能干扰台词清晰度`,
          me.startTime,
          `建议 baseVolume ≤ 0.45（夜间/安静场景可更低），或在对白密集段落降低音量`,
          'BUG-MUSIC-BASEVOLUME-HIGH'
        );
      }
    }

    // ── D12-7: BGM 静音间隙 ──
    this._checkMusicGaps(musicEvents, totalDuration);
  }

  _extractMusicEvents(storyText) {
    const events = [];
    const regex = /\{Music:Play\|([^}]+)\}/g;
    let m;
    while ((m = regex.exec(storyText)) !== null) {
      const params = m[1];
      const nameMatch = params.match(/name=([^|]+)/);
      const endTimeMatch = params.match(/endTime=([\d.]+)/);
      const baseVolumeMatch = params.match(/baseVolume=([\d.]+)/);
      const fadeInMatch = params.match(/fadeIn=([\d.]+)/);

      // 估算 startTime：找到该标签所在行附近的 SRT 时间
      const textBefore = storyText.substring(0, m.index);
      const linesBefore = textBefore.split('\n');
      let startTime = 0;
      // 向上查找最近的时间轴行
      for (let i = linesBefore.length - 1; i >= 0; i--) {
        const timeMatch = linesBefore[i].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
        if (timeMatch) {
          startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
          break;
        }
      }

      events.push({
        name: nameMatch ? nameMatch[1].trim() : 'unknown',
        endTime: endTimeMatch ? parseFloat(endTimeMatch[1]) : null,
        baseVolume: baseVolumeMatch ? parseFloat(baseVolumeMatch[1]) : null,
        fadeIn: fadeInMatch ? parseFloat(fadeInMatch[1]) : null,
        startTime,
        raw: m[0],
      });
    }
    return events;
  }

  _checkMusicSceneMatch(musicEvents, entries, storyText) {
    // 场景到期望 BGM 风格的映射
    const sceneMusicExpectations = {
      'NightStreetScene': { expected: ['night', 'ambient', 'calm', 'quiet', 'soft'], forbidden: ['chaos', 'tension', 'rock', 'upbeat', 'party'] },
      'NightRoomScene': { expected: ['night', 'ambient', 'calm', 'quiet', 'soft', 'room'], forbidden: ['chaos', 'tension', 'rock', 'upbeat', 'party', 'epic'] },
      'RoomScene': { expected: ['room', 'calm', 'soft', 'gentle', 'daily'], forbidden: ['chaos', 'tension', 'epic', 'battle'] },
      'ParkScene': { expected: ['park', 'gentle', 'calm', 'nature', 'soft'], forbidden: ['chaos', 'tension', 'dark'] },
      'BeachScene': { expected: ['beach', 'ocean', 'summer', 'relax'], forbidden: ['chaos', 'tension', 'winter'] },
      'BasketballArenaScene': { expected: ['sport', 'upbeat', 'energy', 'active'], forbidden: ['calm', 'ambient', 'sleep', 'sad'] },
      'DrawerScene': { expected: ['mystery', 'wonder', 'curious', 'magic'], forbidden: ['chaos', 'party', 'upbeat'] },
      'TimeTunnelScene': { expected: ['space', 'scifi', 'warp', 'travel', 'wonder'], forbidden: ['calm', 'daily', 'room'] },
      'FutureCityScene': { expected: ['scifi', 'future', 'city', 'tech'], forbidden: ['calm', 'daily', 'room', 'nature'] },
    };

    // 获取每个音乐事件对应的场景
    for (const me of musicEvents) {
      const scene = this._findSceneForMusic(storyText, me.raw);
      if (!scene) continue;

      const expectation = sceneMusicExpectations[scene];
      if (!expectation) continue;

      const musicName = me.name.toLowerCase();
      const isExpected = expectation.expected.some((k) => musicName.includes(k));
      const isForbidden = expectation.forbidden.some((k) => musicName.includes(k));

      if (isForbidden) {
        this.addIssue('warning',
          `BGM 风格不匹配: 场景 ${scene} 使用了 "${me.name}"，该风格（${expectation.forbidden.filter((k) => musicName.includes(k)).join('/')}）与场景氛围冲突`,
          me.startTime,
          `为 ${scene} 选择 ${expectation.expected.join('/')} 风格的 BGM`,
          'BUG-MUSIC-SCENE-MISMATCH'
        );
      } else if (!isExpected) {
        // 不是期望风格，也不是禁止风格 — 提示
        this.addIssue('info',
          `BGM 风格建议: 场景 ${scene} 使用了 "${me.name}"，建议考虑 ${expectation.expected.join('/')} 风格的配乐`,
          me.startTime,
          `如需更换，可从 Pixabay 搜索 "${expectation.expected[0]}" 或 "${expectation.expected[1]}" 风格音乐`,
          'BUG-MUSIC-SCENE-HINT'
        );
      }
    }
  }

  _checkMusicEmotionMatch(musicEvents, entries) {
    // 获取 BGM 播放期间的所有台词情绪
    for (const me of musicEvents) {
      const bgmStart = me.startTime;
      const bgmEnd = me.endTime || bgmStart + 60;

      const entriesInWindow = entries.filter((e) =>
        e.character && e.text &&
        e.startTime >= bgmStart && e.startTime < bgmEnd
      );

      if (entriesInWindow.length === 0) continue;

      // 统计情绪
      const emotions = [];
      for (const e of entriesInWindow) {
        const emo = e.voiceEmotion || this._inferEmotionFromText(e.text);
        if (emo) emotions.push(emo);
      }

      if (emotions.length === 0) continue;

      const highTension = ['panic', 'scared', 'angry', 'excited'];
      const lowTension = ['calm', 'happy', 'gentle', 'daydreaming', 'proud'];

      const hasHigh = emotions.some((e) => highTension.includes(e));
      const hasLow = emotions.some((e) => lowTension.includes(e));
      const allLow = emotions.every((e) => lowTension.includes(e));
      const allHigh = emotions.every((e) => highTension.includes(e));

      const musicName = me.name.toLowerCase();
      const isCalmMusic = /calm|ambient|soft|quiet|gentle|night|sleep/.test(musicName);
      const isTenseMusic = /chaos|tension|rock|battle|epic|action/.test(musicName);

      if (allHigh && isCalmMusic) {
        this.addIssue('warning',
          `BGM 情绪不匹配: BGM "${me.name}" 风格平静，但该时段台词情绪均为高张力（${emotions.join('/')}），音乐无法烘托紧张感`,
          me.startTime,
          `更换为 tension/chaos/action 风格的 BGM，或降低 baseVolume 让对白情绪主导`,
          'BUG-MUSIC-EMOTION-MISMATCH'
        );
      } else if (allLow && isTenseMusic) {
        this.addIssue('warning',
          `BGM 情绪不匹配: BGM "${me.name}" 风格紧张，但该时段台词情绪均为低张力（${emotions.join('/')}），音乐与氛围冲突`,
          me.startTime,
          `更换为 calm/ambient/soft 风格的 BGM`,
          'BUG-MUSIC-EMOTION-MISMATCH'
        );
      }
    }
  }

  _checkMusicVolume(musicEvents, audioDir) {
    const musicDir = path.join(audioDir, 'music');
    if (!fs.existsSync(musicDir)) return;

    for (const me of musicEvents) {
      // 查找对应的音乐文件
      const musicFiles = fs.readdirSync(musicDir).filter((f) => {
        const base = f.replace(/\.[^.]+$/, '').toLowerCase();
        return base.includes(me.name.toLowerCase()) || me.name.toLowerCase().includes(base);
      });

      for (const mf of musicFiles) {
        const mPath = path.join(musicDir, mf);
        try {
          let volOutput = '';
          try {
            volOutput = execSync(
              `ffmpeg -i "${mPath}" -af "volumedetect" -f null - 2>&1`,
              { encoding: 'utf-8', timeout: 15000 }
            );
          } catch (e) {
            volOutput = e.stdout || e.stderr || '';
          }
          const meanMatch = volOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
          if (meanMatch) {
            const meanVol = parseFloat(meanMatch[1]);
            if (meanVol > -14) {
              this.addIssue('warning',
                `BGM "${mf}" 原始音量过大（${meanVol.toFixed(1)} dB），即使降低 baseVolume 也可能在对白间隙突兀`,
                me.startTime,
                `使用 ffmpeg 预压缩 BGM 音量，或选择原始音量更低的素材`,
                'BUG-MUSIC-VOLUME-LOUD'
              );
            } else if (meanVol < -35) {
              this.addIssue('warning',
                `BGM "${mf}" 原始音量过小（${meanVol.toFixed(1)} dB），即使提高 baseVolume 也可能听不清`,
                me.startTime,
                `使用 ffmpeg 提升 BGM 音量，或选择原始音量更高的素材`,
                'BUG-MUSIC-VOLUME-LOW'
              );
            }
          }
        } catch (e) {
          // skip
        }
      }
    }
  }

  _checkMusicGaps(musicEvents, totalDuration) {
    if (musicEvents.length === 0) return;

    // 按 startTime 排序
    const sorted = [...musicEvents].sort((a, b) => a.startTime - b.startTime);

    // 检查开头间隙
    if (sorted[0].startTime > 3) {
      this.addIssue('info',
        `剧本开头 ${sorted[0].startTime.toFixed(1)}s 无 BGM，可考虑添加淡入音乐`,
        0,
        `将 BGM 开始时间提前到 0s 并设置 fadeIn`,
        'BUG-MUSIC-GAP-START'
      );
    }

    // 检查中间间隙
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].endTime || sorted[i - 1].startTime + 30;
      const gap = sorted[i].startTime - prevEnd;
      if (gap > 5) {
        this.addIssue('warning',
          `BGM 出现 ${gap.toFixed(1)}s 的静音间隙（${prevEnd.toFixed(1)}s - ${sorted[i].startTime.toFixed(1)}s），观众会感到突兀`,
          prevEnd,
          `延长前一段 BGM 的 endTime 或提前下一段 BGM 的开始时间`,
          'BUG-MUSIC-GAP'
        );
      }
    }
  }

  _findSceneForMusic(storyText, musicTag) {
    const idx = storyText.indexOf(musicTag);
    if (idx === -1) return null;
    const textBefore = storyText.substring(0, idx);
    const lines = textBefore.split('\n');
    // 向上查找最近的 @SceneName
    for (let i = lines.length - 1; i >= 0; i--) {
      const sceneMatch = lines[i].match(/@(\w+Scene)/);
      if (sceneMatch) return sceneMatch[1];
    }
    return null;
  }

  _inferEmotionFromText(text) {
    if (!text) return 'calm';
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
