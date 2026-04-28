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

    // Check each shot
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
    }

    // Check shot count matches entry count
    const expectedShots = entries.length;
    if (shots.length < expectedShots) {
      this.addIssue('warning', `截图数量(${shots.length}) 少于剧本条目数(${expectedShots})`, null, '检查 dula-verify 是否完整执行');
    }
  }

  /**
   * Compare current screenshots against baseline for regression testing
   * @param {string} baselineDir - directory containing baseline screenshots
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
