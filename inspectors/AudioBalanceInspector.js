import { InspectorBase } from './InspectorBase.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * AudioBalanceInspector — D8 音量平衡检测
 *
 * 检测范围:
 * - TTS 对白音量是否过低/过高
 * - BGM 音量是否盖过对白
 * - TTS 与 BGM 的音量差是否合理
 * - 同角色多条 TTS 音量一致性
 * - 最终混音 mixed.wav 整体音量
 */
export class AudioBalanceInspector extends InspectorBase {
  constructor() {
    super('AudioBalanceInspector', 'D8');
  }

  inspect(context) {
    this.reset();
    const { entries, audioDir, manifest, totalDuration } = context;

    // Collect speaking entries
    const speakingEntries = entries.filter((e) => e.text && e.character);

    // Build file mapping from manifest or filenames
    const ttsVolumes = []; // { entry, file, meanVol, maxVol }
    const fileMapping = this._buildFileMapping(speakingEntries, manifest, audioDir);

    // Measure TTS volumes
    for (const { entry, audioFile, audioPath } of fileMapping) {
      if (!audioPath || !fs.existsSync(audioPath)) continue;
      const vol = this._detectVolume(audioPath);
      if (vol) {
        ttsVolumes.push({ entry, file: audioFile, meanVol: vol.meanVol, maxVol: vol.maxVol });
      }
    }

    // ── D8-1: TTS 音量过低检测 ──
    for (const v of ttsVolumes) {
      if (v.meanVol < -26) {
        this.addIssue('warning',
          `配音音量过低: ${v.file} 平均音量 ${v.meanVol.toFixed(1)} dB，观众可能听不清台词`,
          v.entry.startTime,
          `在 voice_config.json 中提高该角色的 rate/pitch 或调整 TTS 生成参数，或使用 ffmpeg 提升音量`,
          'BUG-AUDIOBALANCE-TTS-LOW'
        );
      } else if (v.meanVol < -22) {
        this.addIssue('info',
          `配音音量偏低: ${v.file} 平均音量 ${v.meanVol.toFixed(1)} dB`,
          v.entry.startTime,
          `适当提升 TTS 音量`,
          'BUG-AUDIOBALANCE-TTS-LOW'
        );
      }

      if (v.maxVol < -8) {
        this.addIssue('warning',
          `配音峰值过低: ${v.file} 最大音量仅 ${v.maxVol.toFixed(1)} dB，缺乏力度感`,
          v.entry.startTime,
          `检查 TTS 声线参数或重新生成音频`,
          'BUG-AUDIOBALANCE-TTS-PEAK-LOW'
        );
      }
    }

    // ── D8-2: 同角色音量一致性 ──
    const charVolumes = new Map(); // char -> [{meanVol, maxVol, file}]
    for (const v of ttsVolumes) {
      const char = v.entry.character;
      if (!charVolumes.has(char)) charVolumes.set(char, []);
      charVolumes.get(char).push(v);
    }
    for (const [char, vols] of charVolumes) {
      if (vols.length < 2) continue;
      const means = vols.map((v) => v.meanVol);
      const minMean = Math.min(...means);
      const maxMean = Math.max(...means);
      const diff = maxMean - minMean;
      if (diff > 6) {
        this.addIssue('warning',
          `角色 ${char} 的配音音量不一致: 最低 ${minMean.toFixed(1)} dB vs 最高 ${maxMean.toFixed(1)} dB（差 ${diff.toFixed(1)} dB），观众会感到音量忽大忽小`,
          null,
          `统一 ${char} 的 voice_config.json 参数，或在混音阶段对各条 TTS 做音量归一化`,
          'BUG-AUDIOBALANCE-CHAR-INCONSISTENT'
        );
      }
    }

    // ── D8-3: BGM 音量检测 ──
    const musicDir = path.join(audioDir, 'music');
    const bgmVolumes = [];
    if (fs.existsSync(musicDir)) {
      const musicFiles = fs.readdirSync(musicDir).filter((f) => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.ogg'));
      for (const mf of musicFiles) {
        const mPath = path.join(musicDir, mf);
        const vol = this._detectVolume(mPath);
        if (vol) {
          bgmVolumes.push({ file: mf, meanVol: vol.meanVol, maxVol: vol.maxVol });
        }
      }
    }

    for (const bv of bgmVolumes) {
      if (bv.meanVol > -14) {
        this.addIssue('warning',
          `BGM 音量过大: ${bv.file} 平均音量 ${bv.meanVol.toFixed(1)} dB，可能盖过对白`,
          null,
          `降低 BGM 的 baseVolume（建议 ≤ 0.4）或在混音时降低 BGM 轨道音量`,
          'BUG-AUDIOBALANCE-BGM-LOUD'
        );
      } else if (bv.meanVol > -18) {
        this.addIssue('info',
          `BGM 音量偏高: ${bv.file} 平均音量 ${bv.meanVol.toFixed(1)} dB，注意与对白平衡`,
          null,
          `适当降低 BGM baseVolume`,
          'BUG-AUDIOBALANCE-BGM-LOUD'
        );
      }
      if (bv.meanVol < -32) {
        this.addIssue('warning',
          `BGM 音量过小: ${bv.file} 平均音量 ${bv.meanVol.toFixed(1)} dB，几乎听不到`,
          null,
          `提高 BGM 的 baseVolume 或检查音频文件本身音量`,
          'BUG-AUDIOBALANCE-BGM-LOW'
        );
      }
    }

    // ── D8-4: TTS vs BGM 音量差 ──
    if (ttsVolumes.length > 0 && bgmVolumes.length > 0) {
      const avgTtsMean = ttsVolumes.reduce((s, v) => s + v.meanVol, 0) / ttsVolumes.length;
      const avgBgmMean = bgmVolumes.reduce((s, v) => s + v.meanVol, 0) / bgmVolumes.length;
      const diff = avgTtsMean - avgBgmMean; // 负数 = BGM 比 TTS 响

      if (diff > -4) {
        this.addIssue('warning',
          `BGM 与对白音量差过小: BGM 平均 ${avgBgmMean.toFixed(1)} dB vs 对白平均 ${avgTtsMean.toFixed(1)} dB（差仅 ${Math.abs(diff).toFixed(1)} dB），对白可能被 BGM 淹没`,
          null,
          `降低 BGM baseVolume 或提高 TTS 音量，建议差值 ≥ 8 dB`,
          'BUG-AUDIOBALANCE-BGM-TTS-CLOSE'
        );
      } else if (diff > -7) {
        this.addIssue('info',
          `BGM 与对白音量差偏小: 差值 ${Math.abs(diff).toFixed(1)} dB，建议 ≥ 8 dB 以确保对白清晰`,
          null,
          `微调 BGM 或 TTS 音量`,
          'BUG-AUDIOBALANCE-BGM-TTS-CLOSE'
        );
      }
    }

    // ── D8-5: 混音整体音量 ──
    const mixedPath = path.join(audioDir, 'mixed.wav');
    if (fs.existsSync(mixedPath)) {
      const mixedVol = this._detectVolume(mixedPath);
      if (mixedVol) {
        if (mixedVol.meanVol < -22) {
          this.addIssue('warning',
            `最终混音音量偏低: mixed.wav 平均音量 ${mixedVol.meanVol.toFixed(1)} dB，整体可能偏轻`,
            null,
            `检查混音参数，适当提升整体输出音量`,
            'BUG-AUDIOBALANCE-MIXED-LOW'
          );
        }
        if (mixedVol.maxVol < -6) {
          this.addIssue('info',
            `最终混音峰值偏低: mixed.wav 最大音量 ${mixedVol.maxVol.toFixed(1)} dB，缺乏动态范围`,
            null,
            `考虑提升整体音量或检查是否有音轨被过度压缩`,
            'BUG-AUDIOBALANCE-MIXED-PEAK-LOW'
          );
        }
      }
    }
  }

  _buildFileMapping(speakingEntries, manifest, audioDir) {
    const mapping = [];
    if (manifest && manifest.entries && manifest.entries.length > 0) {
      for (const mEntry of manifest.entries) {
        const audioFile = mEntry.file;
        const audioPath = path.join(audioDir, audioFile);
        let storyEntry = speakingEntries.find((e) => e.index === mEntry.index);
        if (!storyEntry) {
          storyEntry = speakingEntries.find(
            (e) => e.character === mEntry.character && Math.abs(e.startTime - mEntry.startTime) < 0.5
          );
        }
        mapping.push({
          entry: storyEntry || { character: mEntry.character, startTime: mEntry.startTime, endTime: mEntry.endTime },
          audioFile,
          audioPath,
        });
      }
    } else {
      for (let idx = 0; idx < speakingEntries.length; idx++) {
        const entry = speakingEntries[idx];
        const fileNum = String(idx + 1).padStart(3, '0');
        const audioFileMp3 = `${fileNum}_${entry.character}.mp3`;
        const audioFileWav = `${fileNum}_${entry.character}.wav`;
        const audioPathMp3 = path.join(audioDir, audioFileMp3);
        const audioPathWav = path.join(audioDir, audioFileWav);
        let audioPath = null;
        let audioFile = null;
        if (fs.existsSync(audioPathMp3)) {
          audioPath = audioPathMp3;
          audioFile = audioFileMp3;
        } else if (fs.existsSync(audioFileWav)) {
          audioPath = audioPathWav;
          audioFile = audioFileWav;
        }
        mapping.push({ entry, audioFile, audioPath });
      }
    }
    return mapping;
  }

  _detectVolume(audioPath) {
    try {
      let volOutput = '';
      try {
        volOutput = execSync(
          `ffmpeg -i "${audioPath}" -af "volumedetect" -f null - 2>&1`,
          { encoding: 'utf-8', timeout: 15000 }
        );
      } catch (e) {
        volOutput = e.stdout || e.stderr || '';
      }
      const meanMatch = volOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      const maxMatch = volOutput.match(/max_volume:\s*([-\d.]+)\s*dB/);
      if (meanMatch && maxMatch) {
        return {
          meanVol: parseFloat(meanMatch[1]),
          maxVol: parseFloat(maxMatch[1]),
        };
      }
    } catch (e) {
      // skip
    }
    return null;
  }
}
