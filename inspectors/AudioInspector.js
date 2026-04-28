import { InspectorBase } from './InspectorBase.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * AudioInspector — D7 音频检查
 *
 * 检查范围:
 * - 音频文件存在性
 * - 音频时长与台词匹配
 * - BGM endTime 与总时长对比
 * - SFX 素材存在性
 * - manifest.json 同步性
 * - 孤立音频文件
 */
export class AudioInspector extends InspectorBase {
  constructor() {
    super('AudioInspector', 'D7');
  }

  inspect(context) {
    this.reset();
    const { entries, audioDir, totalDuration, manifest, storyText } = context;

    // Check audio file existence per entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.text || !entry.character) continue;

      const audioFileWav = `${String(i + 1).padStart(3, '0')}_${entry.character}.wav`;
      const audioFileMp3 = `${String(i + 1).padStart(3, '0')}_${entry.character}.mp3`;
      const audioPathWav = path.join(audioDir, audioFileWav);
      const audioPathMp3 = path.join(audioDir, audioFileMp3);

      let audioPath = null;
      let audioFile = null;
      if (fs.existsSync(audioPathMp3)) {
        audioPath = audioPathMp3;
        audioFile = audioFileMp3;
      } else if (fs.existsSync(audioPathWav)) {
        audioPath = audioPathWav;
        audioFile = audioFileWav;
      }

      if (!audioPath) {
        this.addIssue('warning', `音频文件不存在: ${audioFileMp3} 或 ${audioFileWav}`, entry.startTime, '运行 dula-audio 生成音频');
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
        // Check if SFX exists in materials/sfx/ or assets/audio/sfx/
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
      const storyEntryCount = entries.filter((e) => e.character && e.text).length;
      if (manifestEntries.length !== storyEntryCount) {
        this.addIssue('warning', `manifest.json 条目数(${manifestEntries.length}) 与剧本台词条目数(${storyEntryCount}) 不匹配`, null, '重新运行 dula-audio 生成音频');
      }
    }

    // Check for orphaned audio files
    if (fs.existsSync(audioDir)) {
      const audioFiles = fs.readdirSync(audioDir).filter((f) => f.endsWith('.wav') || f.endsWith('.mp3'));
      const referencedFiles = new Set();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.character && entry.text) {
          referencedFiles.add(`${String(i + 1).padStart(3, '0')}_${entry.character}.wav`);
          referencedFiles.add(`${String(i + 1).padStart(3, '0')}_${entry.character}.mp3`);
        }
      }
      for (const file of audioFiles) {
        if (file === 'mixed.wav' || file.startsWith('_temp_')) continue;
        if (!referencedFiles.has(file)) {
          this.addIssue('info', `未引用的音频文件: ${file}`, null, '检查是否多余的音频文件');
        }
      }
    }
  }
}
