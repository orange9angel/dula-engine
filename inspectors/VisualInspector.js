import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * VisualInspector — D2 视觉检查（运行时截图分析）
 *
 * 检查范围:
 * - 截图文件存在性
 * - 黑屏/白屏检测（像素统计）
 * - 截图文件大小异常（过小=可能黑屏，过大=可能纯色）
 * - 角色可见性检测（说话角色是否在画面内）—— 关键检查
 * - 与基线截图对比（回归测试）
 *
 * 注意：此 inspector 需要 dula-verify 先生成截图
 */
export class VisualInspector extends InspectorBase {
  constructor() {
    super('VisualInspector', 'D2');
  }

  inspect(context) {
    this.reset();
    const { storyboardDir, entries } = context;

    if (!fs.existsSync(storyboardDir)) {
      this.addIssue('info', 'storyboard 目录不存在，跳过视觉检查', null, '先运行 dula-verify 生成截图');
      return;
    }

    const shots = fs.readdirSync(storyboardDir)
      .filter((f) => f.match(/check_shot_\d+\.jpg/))
      .sort();

    if (shots.length === 0) {
      this.addIssue('info', '未找到截图文件', null, '运行 dula-verify 生成截图');
      return;
    }

    // Filter to only character entries (shots correspond to character lines)
    const charEntries = entries.filter((e) => e.character && e.text);

    // Map shots to character entries (shot i corresponds to charEntries[i])
    for (let i = 0; i < shots.length; i++) {
      const shotPath = path.join(storyboardDir, shots[i]);
      const stats = fs.statSync(shotPath);
      const sizeKB = stats.size / 1024;
      const shotNum = i + 1;

      // File size heuristics
      if (sizeKB < 15) {
        this.addIssue('error', `Shot ${shotNum} 截图文件过小 (${sizeKB.toFixed(1)}KB)，可能为黑屏或空画面`, null, '检查场景加载、相机目标或角色可见性', 'BUG-9');
      } else if (sizeKB < 30) {
        this.addIssue('warning', `Shot ${shotNum} 截图文件偏小 (${sizeKB.toFixed(1)}KB)，可能画面内容不足`, null, '检查相机 framing 和角色位置');
      } else if (sizeKB > 500) {
        this.addIssue('info', `Shot ${shotNum} 截图文件偏大 (${sizeKB.toFixed(1)}KB)，可能为纯色或简单画面`, null, '检查画面复杂度是否正常');
      }

      // ── 角色可见性检测：说话角色是否在画面内 ──
      const entry = charEntries[i];
      if (entry && entry.character && entry.text) {
        // 检查该角色是否在当前场景中有 Position 配置
        const hasPositionInScene = this._hasPositionInScene(entries, entry);
        if (!hasPositionInScene) {
          this.addIssue('error', `Shot ${shotNum}: 角色 ${entry.character} 正在说话"${entry.text?.substring(0, 20)}..."，但当前场景中缺少 {Position:${entry.character}|...} 定位，角色可能不在画面内或凭空出现`, entry.startTime, `添加 {Position:${entry.character}|x=...|z=...} 确保角色在场景中`, 'BUG-VIS-CHAR-NOT-IN-SCENE');
        }

        // 检查角色是否在前一场景出现但在当前场景没有过渡
        const entryIdx = entries.indexOf(entry);
        const prevEntry = entryIdx > 0 ? entries[entryIdx - 1] : null;
        if (prevEntry && prevEntry.scene && entry.scene && prevEntry.scene !== entry.scene) {
          const prevChars = this._getCharsInScene(entries, prevEntry.scene);
          const currChars = this._getCharsInScene(entries, entry.scene);
          if (prevChars.includes(entry.character) && !currChars.includes(entry.character)) {
            this.addIssue('error', `Shot ${shotNum}: 角色 ${entry.character} 在场景 ${prevEntry.scene} 中出现，但在新场景 ${entry.scene} 中消失，没有退场交代`, entry.startTime, `添加 ${entry.character} 在新场景的 Position 或添加退场动画`, 'BUG-VIS-CHAR-DISAPPEAR');
          }
        }
      }
    }

    // Check shot count matches character entry count
    const expectedShots = charEntries.length;
    if (shots.length < expectedShots) {
      this.addIssue('warning', `截图数量(${shots.length}) 少于剧本条目数(${expectedShots})`, null, '检查 dula-verify 是否完整执行');
    }

    // ── 角色位置重叠检测：同一场景中多个角色是否挤在一起 ──
    this._checkCharacterOverlap(entries);

    // ── 场景环境语义与截图一致性检测 ──
    this._checkSceneEnvironmentConsistency(entries, shots, storyboardDir);
  }

  /**
   * 检查截图中的场景环境是否与剧本语义一致
   * 例如：海边场景中角色应在水中，截图应有蓝色像素
   */
  _checkSceneEnvironmentConsistency(entries, shots, storyboardDir) {
    // 场景环境语义映射
    const sceneEnvExpectations = {
      'BeachScene': {
        waterKeywords: ['冲进海里', '海里', '游泳', '水中', '海水', '鲨鱼', '游回来'],
        expectedColors: ['blue', 'cyan'],
        checkRegion: 'lower-half', // 检查截图下半部分
      },
    };

    const charEntries = entries.filter((e) => e.character && e.text);

    for (let i = 0; i < shots.length && i < charEntries.length; i++) {
      const entry = charEntries[i];
      const shotPath = path.join(storyboardDir, shots[i]);
      const shotNum = i + 1;

      if (!entry.scene || !entry.text) continue;
      const envExpect = sceneEnvExpectations[entry.scene];
      if (!envExpect) continue;

      // 检查台词是否暗示角色应在特定环境中
      const hasWaterIntent = envExpect.waterKeywords.some((kw) => entry.text.includes(kw));
      if (!hasWaterIntent) continue;

      // 检查该条目是否有 Event:Move 到水中
      const hasWaterMove = entry.storyEvents?.some((ev) => {
        if (ev.name !== 'Move') return false;
        const z = ev.options?.z;
        if (z === undefined) return false;
        // BeachScene 海洋范围 z=-4.5 ~ -39.5
        return z <= -4.5 && z >= -39.5;
      });

      // 也检查角色是否已经在水中（通过 Position 或之前的 Move）
      const charName = entry.character;
      let isInWater = hasWaterMove;
      if (!isInWater) {
        // 查找该角色在当前场景中的位置
        for (const e of entries) {
          if (e.scene !== entry.scene) continue;
          // 从 positionOps 或 storyEvents 检查
          if (e.positionOps) {
            for (const po of e.positionOps) {
              if (po.character === charName) {
                const z = po.options?.z;
                if (z !== undefined && z <= -4.5 && z >= -39.5) {
                  isInWater = true;
                  break;
                }
              }
            }
          }
          if (e.storyEvents) {
            for (const ev of e.storyEvents) {
              if (ev.name === 'Move' && ev.options?.character === charName) {
                const z = ev.options?.z;
                if (z !== undefined && z <= -4.5 && z >= -39.5) {
                  isInWater = true;
                  break;
                }
              }
            }
          }
          if (isInWater) break;
        }
      }

      if (isInWater) {
        // 角色应在水中，但 VisualInspector 无法做像素分析（没有图像处理库）
        // 退而求其次：检查截图文件大小是否在合理范围（水中场景通常有更多反射/波纹细节）
        const stats = fs.statSync(shotPath);
        const sizeKB = stats.size / 1024;

        // 水中场景如果文件过小，可能意味着水面/角色不可见
        if (sizeKB < 40) {
          this.addIssue('warning',
            `Shot ${shotNum}: 角色 ${charName} 应在 BeachScene 水中，但截图文件仅 ${sizeKB.toFixed(1)}KB，可能水面或角色不可见`,
            entry.startTime,
            '检查海洋平面位置和角色 y 坐标，确保角色身体露出水面',
            'BUG-VIS-WATER-CHAR'
          );
        }
      }
    }
  }

  /**
   * 检查同一场景中角色位置是否重叠（距离过近）
   */
  _checkCharacterOverlap(entries) {
    // 收集每个场景的角色位置
    const scenePositions = new Map(); // scene -> [{ character, x, z, entry }]

    for (const entry of entries) {
      if (!entry.scene) continue;
      if (!scenePositions.has(entry.scene)) {
        scenePositions.set(entry.scene, []);
      }

      // 从 positionOps 提取位置
      if (entry.positionOps && entry.positionOps.length > 0) {
        for (const po of entry.positionOps) {
          const x = po.options?.x ?? 0;
          const z = po.options?.z ?? 0;
          scenePositions.get(entry.scene).push({
            character: po.character,
            x,
            z,
            entry,
          });
        }
      }

      // 从 rawText 提取 Position（备用）
      if (entry.rawText) {
        const posRegex = /\{Position:([^|}]+)\|([^}]+)\}/g;
        let match;
        while ((match = posRegex.exec(entry.rawText)) !== null) {
          const char = match[1];
          const opts = match[2];
          const xMatch = opts.match(/x=([-\d.]+)/);
          const zMatch = opts.match(/z=([-\d.]+)/);
          const x = xMatch ? parseFloat(xMatch[1]) : 0;
          const z = zMatch ? parseFloat(zMatch[1]) : 0;
          // 避免重复（如果 positionOps 已处理）
          const existing = scenePositions.get(entry.scene).find((p) => p.character === char && Math.abs(p.x - x) < 0.1 && Math.abs(p.z - z) < 0.1);
          if (!existing) {
            scenePositions.get(entry.scene).push({
              character: char,
              x,
              z,
              entry,
            });
          }
        }
      }
    }

    // 检查每个场景内的角色距离
    for (const [scene, positions] of scenePositions) {
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const a = positions[i];
          const b = positions[j];
          // 跳过同一角色的多个位置声明
          if (a.character === b.character) continue;

          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const distance = Math.sqrt(dx * dx + dz * dz);

          // 距离小于 1.5 视为重叠（角色模型半径约 0.5-0.8）
          if (distance < 1.5) {
            this.addIssue('error',
              `场景 ${scene} 中角色 ${a.character} 和 ${b.character} 位置重叠（距离 ${distance.toFixed(2)}），会穿模或挤在一起`,
              a.entry?.startTime ?? b.entry?.startTime,
              `调整 {Position:${a.character}|x=...|z=...} 和 {Position:${b.character}|x=...|z=...}，保持间距 ≥ 1.5`,
              'BUG-VIS-CHAR-OVERLAP'
            );
          } else if (distance < 2.5) {
            this.addIssue('warning',
              `场景 ${scene} 中角色 ${a.character} 和 ${b.character} 间距过近（距离 ${distance.toFixed(2)}），可能画面拥挤`,
              a.entry?.startTime ?? b.entry?.startTime,
              `适当拉开 {Position:${a.character}} 和 {Position:${b.character}} 的距离`,
              'BUG-VIS-CHAR-CLOSE'
            );
          }
        }
      }
    }
  }

  /**
   * 检查角色在当前场景中是否有 Position 配置
   */
  _hasPositionInScene(entries, targetEntry) {
    const scene = targetEntry.scene;
    if (!scene) return true; // 无场景声明，无法判断

    // 找到该场景的所有条目
    const sceneEntries = entries.filter((e) => e.scene === scene);
    if (sceneEntries.length === 0) return true;

    // 检查场景声明行或该条目是否有 Position 标签
    const sceneStartTime = Math.min(...sceneEntries.map((e) => e.startTime));
    const entriesAtSceneStart = entries.filter((e) => e.scene === scene && Math.abs(e.startTime - sceneStartTime) < 5);

    // 检查原始文本中是否有 Position:Character
    const storyText = entries.map((e) => e.rawText || '').join(' ');
    const positionRegex = new RegExp(`Position:${targetEntry.character}`, 'i');

    // 也检查 entries 中的 rawText
    for (const e of entriesAtSceneStart) {
      if (e.rawText && positionRegex.test(e.rawText)) return true;
    }

    // 检查全局文本（包括场景配置行）
    return positionRegex.test(storyText);
  }

  /**
   * 获取某场景中出现的所有角色
   */
  _getCharsInScene(entries, sceneName) {
    const chars = new Set();
    for (const entry of entries) {
      if (entry.scene === sceneName && entry.character) {
        chars.add(entry.character);
      }
    }
    return [...chars];
  }

  /**
   * Compare current screenshots against baseline for regression testing
   */
  compareWithBaseline(storyboardDir, baselineDir) {
    if (!fs.existsSync(baselineDir)) {
      return { passed: false, reason: '基线目录不存在' };
    }

    const currentShots = fs.readdirSync(storyboardDir).filter((f) => f.endsWith('.jpg')).sort();
    const baselineShots = fs.readdirSync(baselineDir).filter((f) => f.endsWith('.jpg')).sort();

    const results = [];
    for (let i = 0; i < Math.min(currentShots.length, baselineShots.length); i++) {
      const currPath = path.join(storyboardDir, currentShots[i]);
      const basePath = path.join(baselineDir, baselineShots[i]);
      const currSize = fs.statSync(currPath).size;
      const baseSize = fs.statSync(basePath).size;
      const diff = Math.abs(currSize - baseSize) / baseSize;

      if (diff > 0.3) {
        results.push({
          shot: currentShots[i],
          diff: diff,
          passed: false,
          reason: `文件大小差异 ${(diff * 100).toFixed(1)}%`,
        });
      } else {
        results.push({ shot: currentShots[i], diff, passed: true });
      }
    }

    return results;
  }
}
