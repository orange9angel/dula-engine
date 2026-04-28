import { InspectorBase } from './InspectorBase.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * AudioInspector — D7 音频检查
 *
 * 检查范围:
 * - 音频文件存在性（基于 manifest.json 或构造文件名）
 * - 音频时长与台词匹配
 * - 音频实际音量（防止静音/音量过低）—— 关键检查
 * - BGM endTime 与总时长对比
 * - SFX 素材存在性
 * - manifest.json 同步性
 * - 孤立音频文件
 * - 最终混音 mixed.wav 音量检查
 */
export class AudioInspector extends InspectorBase {
  constructor() {
    super('AudioInspector', 'D7');
  }

  inspect(context) {
    this.reset();
    const { entries, audioDir, totalDuration, manifest, storyText } = context;

    // Build a mapping from entry index (matching audio filenames) to entry
    // Strategy: prefer manifest.json file field, fallback to constructed filename
    const speakingEntries = [];
    for (const entry of entries) {
      if (entry.text && entry.character) {
        speakingEntries.push(entry);
      }
    }

    // Build file mapping: if manifest exists, use its file names; otherwise construct
    const fileMapping = []; // { entry, audioFile, audioPath }
    if (manifest && manifest.entries && manifest.entries.length > 0) {
      // Use manifest.json file names (ground truth from dula-audio)
      for (const mEntry of manifest.entries) {
        const audioFile = mEntry.file;
        const audioPath = path.join(audioDir, audioFile);
        // Find matching story entry by startTime + character
        const storyEntry = speakingEntries.find(
          (e) => e.character === mEntry.character && Math.abs(e.startTime - mEntry.startTime) < 0.5
        );
        fileMapping.push({
          entry: storyEntry || { character: mEntry.character, startTime: mEntry.startTime, endTime: mEntry.endTime, text: mEntry.dialogue },
          audioFile,
          audioPath,
        });
      }
    } else {
      // Fallback: construct filenames based on speaking entry order (1-based)
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
        } else if (fs.existsSync(audioPathWav)) {
          audioPath = audioPathWav;
          audioFile = audioFileWav;
        }

        fileMapping.push({ entry, audioFile, audioPath });
      }
    }

    // Check each mapped audio file
    for (const { entry, audioFile, audioPath } of fileMapping) {
      if (!audioPath || !fs.existsSync(audioPath)) {
        this.addIssue('warning', `音频文件不存在: ${audioFile || 'unknown'}`, entry.startTime, '运行 dula-audio 生成音频');
        continue;
      }

      // Check duration with ffprobe
      try {
        const output = execSync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const audioDuration = parseFloat(output.trim());
        const expectedDuration = (entry.endTime || entry.startTime + 3) - entry.startTime;
        const diff = Math.abs(audioDuration - expectedDuration);

        if (diff > 1.0) {
          this.addIssue('warning', `音频时长不匹配: ${audioFile} (音频 ${audioDuration.toFixed(2)}s vs 台词 ${expectedDuration.toFixed(2)}s)`, entry.startTime, '检查 TTS 生成或调整台词时长');
        } else if (diff > 0.3) {
          this.addIssue('info', `音频时长偏差: ${audioFile} (偏差 ${diff.toFixed(2)}s)`, entry.startTime, '微调台词时长以匹配音频');
        }
      } catch (e) {
        // ffprobe failed, skip
      }

      // ── 检查音频实际音量（防止静音/音量过低）──
      this._checkAudioVolume(audioPath, audioFile, entry);
    }

    // ── 检查最终混音文件 mixed.wav 的音量 ──
    const mixedPath = path.join(audioDir, 'mixed.wav');
    if (fs.existsSync(mixedPath)) {
      this._checkAudioVolume(mixedPath, 'mixed.wav', { startTime: null });
    } else {
      this.addIssue('warning', `最终混音文件 mixed.wav 不存在`, null, '运行 dula-audio 生成完整音频');
    }

    // Check BGM endTime coverage
    const bgmMatches = storyText.matchAll(/\{Music:Play\|([^}]+)\}/g);
    for (const m of bgmMatches) {
      const params = m[1];
      const endTimeMatch = params.match(/endTime=([\d.]+)/);
      if (endTimeMatch) {
        const bgmEnd = parseFloat(endTimeMatch[1]);
        if (bgmEnd < totalDuration) {
          this.addIssue('warning', `BGM endTime(${bgmEnd}s) 短于剧本总时长(${totalDuration.toFixed(1)}s)，末尾将出现静音`, null, `将 endTime 设为 ${Math.ceil(totalDuration)} 或更长`, 'BUG-8');
        }
      }
    }

    // Check SFX existence
    const sfxMatches = storyText.matchAll(/\{SFX:Play\|([^}]+)\}/g);
    for (const m of sfxMatches) {
      const params = m[1];
      const nameMatch = params.match(/name=([^|]+)/);
      if (nameMatch) {
        const sfxName = nameMatch[1].trim();
        const materialsSfxDir = path.join(context.episodeDir, 'materials', 'sfx');
        const assetsSfxDir = path.join(audioDir, 'sfx');

        const hasInMaterials = fs.existsSync(materialsSfxDir) && fs.readdirSync(materialsSfxDir).some((f) => f.includes(sfxName));
        const hasInAssets = fs.existsSync(assetsSfxDir) && fs.readdirSync(assetsSfxDir).some((f) => f.includes(sfxName));

        if (!hasInMaterials && !hasInAssets) {
          this.addIssue('warning', `SFX "${sfxName}" 素材缺失`, null, `将 ${sfxName}.wav 放入 materials/sfx/ 或使用已知 SFX 名`, 'BUG-7');
        }
      }
    }

    // Check manifest.json sync
    if (manifest) {
      const manifestEntries = manifest.entries || manifest.lines || [];
      if (manifestEntries.length !== speakingEntries.length) {
        this.addIssue('warning', `manifest.json 条目数(${manifestEntries.length}) 与剧本台词条目数(${speakingEntries.length}) 不匹配`, null, '重新运行 dula-audio 生成音频');
      }
    }

    // Check for orphaned audio files
    if (fs.existsSync(audioDir)) {
      const audioFiles = fs.readdirSync(audioDir).filter((f) => f.endsWith('.wav') || f.endsWith('.mp3'));
      const referencedFiles = new Set(fileMapping.map((m) => m.audioFile).filter(Boolean));
      referencedFiles.add('mixed.wav');
      for (const file of audioFiles) {
        if (file === 'mixed.wav' || file.startsWith('_temp_')) continue;
        if (!referencedFiles.has(file)) {
          this.addIssue('info', `未引用的音频文件: ${file}`, null, '检查是否多余的音频文件');
        }
      }
    }
  }

  /**
   * 使用 ffmpeg volumedetect 滤镜检测音频音量
   * 避免 amovie 在 Windows 路径下的问题
   */
  _checkAudioVolume(audioPath, audioFile, entry) {
    try {
      // ffmpeg with -f null - always exits with code 1 on Windows, so we catch the error
      let volOutput = '';
      try {
        volOutput = execSync(
          `ffmpeg -i "${audioPath}" -af "volumedetect" -f null - 2>&1`,
          { encoding: 'utf-8', timeout: 15000 }
        );
      } catch (e) {
        // ffmpeg exits with code 1 when outputting to null, but stderr contains the data
        volOutput = e.stdout || e.stderr || '';
      }

      const meanMatch = volOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      const maxMatch = volOutput.match(/max_volume:\s*([-\d.]+)\s*dB/);

      if (meanMatch && maxMatch) {
        const meanVol = parseFloat(meanMatch[1]);
        const maxVol = parseFloat(maxMatch[1]);

        const isMixed = audioFile === 'mixed.wav';
        const fileLabel = isMixed ? '最终混音 mixed.wav' : `音频 "${audioFile}"`;

        if (maxVol < -60 || meanVol < -60) {
          this.addIssue('error', `${fileLabel} 几乎静音 (最大音量 ${maxVol.toFixed(1)} dB, 平均 ${meanVol.toFixed(1)} dB)${isMixed ? '，视频将无声音' : '，台词将无声音'}`, entry.startTime, isMixed ? '检查 dula-audio 混音流程或重新生成音频' : '检查 TTS 生成或重新运行 dula-audio', 'BUG-AUDIO-MUTE');
        } else if (maxVol < -45) {
          this.addIssue('warning', `${fileLabel} 音量过低 (最大音量 ${maxVol.toFixed(1)} dB)，可能听不清`, entry.startTime, isMixed ? '检查混音参数' : '检查 TTS 生成参数或手动调整音量', 'BUG-AUDIO-LOW');
        } else if (meanVol < -50) {
          this.addIssue('warning', `${fileLabel} 平均音量过低 (${meanVol.toFixed(1)} dB)，可能部分片段听不清`, entry.startTime, '检查音频生成质量', 'BUG-AUDIO-LOW');
        }
      } else {
        this.addIssue('error', `音频 "${audioFile}" 无法检测音量，可能为静音或损坏文件`, entry.startTime, '重新运行 dula-audio 生成音频', 'BUG-AUDIO-MUTE');
      }
    } catch (e) {
      // ffmpeg failed, try ffprobe with astats as fallback (using forward slashes)
      try {
        const safePath = audioPath.replace(/\\/g, '/');
        const astatsOutput = execSync(
          `ffprobe -v error -f lavfi -i "amovie=${safePath},astats=metadata=1:reset=1" -show_entries frame_tags=lavfi.astats.Overall.RMS_level -of csv=p=0`,
          { encoding: 'utf-8', timeout: 15000 }
        );
        const rmsLines = astatsOutput.trim().split('\n').filter((l) => l && !isNaN(parseFloat(l)));
        const rmsValues = rmsLines.map((l) => parseFloat(l)).filter((v) => !isNaN(v) && v !== -Infinity);

        if (rmsValues.length > 0) {
          const maxRms = Math.max(...rmsValues);
          if (maxRms < -60) {
            this.addIssue('error', `音频 "${audioFile}" 几乎静音 (RMS ${maxRms.toFixed(1)} dB)`, entry.startTime, '重新运行 dula-audio 生成音频', 'BUG-AUDIO-MUTE');
          } else if (maxRms < -45) {
            this.addIssue('warning', `音频 "${audioFile}" 音量过低 (RMS ${maxRms.toFixed(1)} dB)`, entry.startTime, '检查 TTS 生成参数', 'BUG-AUDIO-LOW');
          }
        }
      } catch (e2) {
        // Both methods failed
      }
    }
  }
}
