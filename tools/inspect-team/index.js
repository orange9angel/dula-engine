/**
 * Dula Inspect Team — 闭环质检团队
 *
 * 多维度并行检查 + 交叉分析引擎
 *
 * Usage:
 *   node tools/inspect-team/index.js <episode-dir> [--format=console|html] [--output=report.html] [--visual]
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import {
  InspectionContext,
  getAllInspectors,
} from '../../inspectors/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI colors
const chalk = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
};

// Parse arguments
const args = process.argv.slice(2);
const episodeDir = args[0];
let format = 'console';
let outputPath = null;
let visualMode = false;

for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--format=')) {
    format = args[i].slice('--format='.length);
  } else if (args[i].startsWith('--output=')) {
    outputPath = args[i].slice('--output='.length);
  } else if (args[i] === '--visual') {
    visualMode = true;
  }
}

if (!episodeDir) {
  console.error(chalk.red('Usage: dula-inspect-team <episode-dir> [--format=console|html] [--output=report.html] [--visual]'));
  process.exit(1);
}

const absEpisodeDir = path.resolve(episodeDir);
if (!fs.existsSync(absEpisodeDir)) {
  console.error(chalk.red(`Episode directory not found: ${absEpisodeDir}`));
  process.exit(1);
}

// Find story file
const storyFiles = fs.readdirSync(absEpisodeDir).filter((f) => f.endsWith('.story'));
if (storyFiles.length === 0) {
  console.error(chalk.red(`No .story file found in ${absEpisodeDir}`));
  process.exit(1);
}
const storyPath = path.join(absEpisodeDir, storyFiles[0]);
const storyText = fs.readFileSync(storyPath, 'utf-8');

// Parse story entries
const entries = parseStory(storyText);

// Create inspection context
const context = new InspectionContext(absEpisodeDir, entries, storyText, storyPath);

console.log(chalk.cyan(`🔍 Dula Inspect Team — 闭环质检团队`));
console.log(chalk.gray(`Episode: ${absEpisodeDir}`));
console.log(chalk.gray(`Story:   ${storyPath}`));
console.log(chalk.gray(`Entries: ${entries.length}`));
console.log(chalk.gray(`Duration: ${context.totalDuration.toFixed(1)}s`));
console.log();

// ── Pre-flight Checklist ──
const { runPreflight } = await import('./preflight.js');
const preflight = runPreflight(context);

console.log(chalk.magenta('═─ 起飞前检查单 ─═'));
console.log();

// Group checklist by category
const byCategory = new Map();
for (const item of preflight.checklist) {
  if (!byCategory.has(item.category)) byCategory.set(item.category, []);
  byCategory.get(item.category).push(item);
}

for (const [category, items] of byCategory) {
  console.log(chalk.blue(`  [${category}]`));
  for (const item of items) {
    const color = item.status === '❌' ? 'red' : item.status === '⚠️' ? 'yellow' : 'green';
    console.log(chalk[color](`    ${item.status} ${item.item} — ${item.detail}`));
  }
}

console.log();

if (preflight.issues.length > 0) {
  for (const issue of preflight.issues) {
    const color = issue.severity === 'error' ? 'red' : 'yellow';
    const icon = issue.severity === 'error' ? '🔴' : '🟡';
    console.log(chalk[color](`  ${icon} ${issue.message}`));
    if (issue.fix) console.log(chalk.gray(`     💡 ${issue.fix}`));
  }
  console.log();
}

const pfColor = preflight.passed ? 'green' : 'red';
console.log(chalk[pfColor](`  起飞前检查: ${preflight.passed ? '通过' : '未通过'} (${preflight.errorCount} 错误 / ${preflight.warningCount} 警告)`));
console.log();

if (preflight.errorCount > 0) {
  console.log(chalk.red('  ⚠️  存在阻塞性问题，建议先修复再运行完整质检'));
  console.log();
}

// Run all inspectors
const inspectors = getAllInspectors();
const reports = [];

for (const inspector of inspectors) {
  try {
    inspector.inspect(context);
    reports.push(inspector.getReport());
  } catch (e) {
    console.error(chalk.red(`Inspector ${inspector.name} failed: ${e.message}`));
    reports.push({
      inspector: inspector.name,
      dimension: inspector.dimension,
      summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
      issues: [{ severity: 'error', message: `Inspector 崩溃: ${e.message}` }],
    });
  }
}

// Cross-dimensional analysis
const crossAnalysis = runCrossAnalysis(reports);

// Output
if (format === 'html') {
  const html = generateHtmlReport(reports, crossAnalysis, absEpisodeDir);
  const out = outputPath || path.join(absEpisodeDir, 'output', 'inspect_team_report.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(chalk.green(`\n✅ HTML report saved to: ${out}`));
} else {
  printConsoleReport(reports, crossAnalysis);
}

const totalErrors = reports.reduce((sum, r) => sum + r.summary.errors, 0);
process.exit(totalErrors > 0 ? 1 : 0);

// ───────────────────────────────────────────────
// Story Parser (enhanced from inspect.js)
// ───────────────────────────────────────────────
function parseStory(text) {
  const lines = text.split('\n');
  const entries = [];
  let currentEntry = null;
  let currentTime = 0;
  let currentScene = null;
  let entryIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;

    // SRT time line: 00:00:00,000 --> 00:00:01,500
    const timeMatch = line.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (timeMatch) {
      currentTime = parseSrtTime(timeMatch[1]);
      continue;
    }

    // Scene tag: @RoomScene
    const sceneMatch = line.match(/^@(\w+)/);
    if (sceneMatch) {
      currentScene = sceneMatch[1];
      continue;
    }

    // Character line: [Doraemon]{WaveHand} 台词...
    const charMatch = line.match(/^\[([A-Z][a-zA-Z0-9_]*)\](.*)$/);
    if (charMatch) {
      entryIndex++;
      const rawText = charMatch[2];
      let text = rawText
        .replace(/\{Animation:[^}]+\}\s*/g, '')
        .replace(/\{Camera:[^}]+\}\s*/g, '')
        .replace(/\{Prop:[^}]+\}\s*/g, '')
        .replace(/\{Position:[^}]+\}\s*/g, '')
        .replace(/\{SFX:[^}]+\}\s*/g, '')
        .replace(/\{Transition:[^}]+\}\s*/g, '')
        .replace(/\{Event:[^}]+\}\s*/g, '')
        .replace(/\{Music:[^}]+\}\s*/g, '')
        .trim();

      const duration = estimateDuration(text);
      const endTime = currentTime + duration;

      // Extract animations
      const animations = [];
      const animRegex = /\{Animation:([^}]+)\}/g;
      let animMatch;
      while ((animMatch = animRegex.exec(rawText)) !== null) {
        animations.push(animMatch[1]);
      }

      // Extract bare animation tags (capitalized, not namespaced)
      // Match {Name} where Name starts with capital and is not a known namespace
      const bareAnimRegex = /\{([A-Z][a-zA-Z0-9]+)\}/g;
      const namespaces = ['Camera', 'Music', 'Ball', 'Prop', 'Position', 'SFX', 'Transition', 'Event', 'Dunk'];
      while ((animMatch = bareAnimRegex.exec(rawText)) !== null) {
        const name = animMatch[1];
        if (!namespaces.includes(name) && !animations.includes(name)) {
          animations.push(name);
        }
      }

      // Also extract namespaced Animation tags: {Animation:Name}
      const namespacedAnimRegex = /\{Animation:([^}]+)\}/g;
      while ((animMatch = namespacedAnimRegex.exec(rawText)) !== null) {
        const name = animMatch[1];
        if (!animations.includes(name)) {
          animations.push(name);
        }
      }

      // Extract prop ops
      const propOps = [];
      const propRegex = /\{Prop:([^}]+)\}/g;
      let propMatch;
      while ((propMatch = propRegex.exec(rawText)) !== null) {
        const propInner = propMatch[1];
        const parts = propInner.split('|').map((s) => s.trim());
        const name = parts[0];
        const options = {};
        for (let j = 1; j < parts.length; j++) {
          const eqIdx = parts[j].indexOf('=');
          if (eqIdx === -1) continue;
          const key = parts[j].slice(0, eqIdx).trim();
          const val = parts[j].slice(eqIdx + 1).trim();
          options[key] = isNaN(Number(val)) ? val : Number(val);
        }
        propOps.push({ name, options });
      }

      // Extract story events
      const storyEvents = [];
      const eventRegex = /\{Event:([^|]+)\|([^}]+)\}/g;
      let eventMatch;
      while ((eventMatch = eventRegex.exec(rawText)) !== null) {
        const eventName = eventMatch[1];
        const opts = {};
        eventMatch[2].split('|').forEach((pair) => {
          const [k, v] = pair.split('=');
          if (k && v !== undefined) {
            opts[k.trim()] = isNaN(v) ? v.trim() : parseFloat(v);
          }
        });
        storyEvents.push({ name: eventName, options: opts });
      }

      // Extract camera
      let camera = null;
      const camMatch = rawText.match(/\{Camera:([^|}]+)/);
      if (camMatch) camera = camMatch[1];

      // Extract transition
      let transition = null;
      const transMatch = rawText.match(/\{Transition:([^|}]+)/);
      if (transMatch) transition = transMatch[1];

      currentEntry = {
        index: entryIndex,
        line: i + 1,
        character: charMatch[1],
        text: text,
        rawText: rawText,
        startTime: currentTime,
        endTime: endTime,
        scene: currentScene,
        animations,
        propOps,
        storyEvents,
        camera,
        transition,
      };
      entries.push(currentEntry);
      currentTime = endTime;
      continue;
    }

    // Non-character line with text (potential BUG-1)
    // But skip lines that are purely tags (Position, Music, etc. on their own lines)
    const isPureTagLine = /^\{[A-Z][a-zA-Z]+:[^}]+\}$/.test(line) || /^\{[A-Z][a-zA-Z]+\}$/.test(line);
    if (line && !line.startsWith('{') && !line.startsWith('@') && !/^\d+$/.test(line) && !isPureTagLine) {
      entryIndex++;
      const duration = estimateDuration(line);
      const endTime = currentTime + duration;
      currentEntry = {
        index: entryIndex,
        line: i + 1,
        character: null,
        text: line,
        rawText: line,
        startTime: currentTime,
        endTime: endTime,
        scene: currentScene,
        animations: [],
        propOps: [],
        storyEvents: [],
        camera: null,
        transition: null,
      };
      entries.push(currentEntry);
      currentTime = endTime;
    }
  }

  return entries;
}

function parseSrtTime(srt) {
  const [h, m, s] = srt.replace(',', '.').split(':');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

function estimateDuration(text) {
  const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const duration = cnChars / 4 + enWords / 3;
  return Math.max(1.5, Math.min(duration + 0.5, 8));
}

// ───────────────────────────────────────────────
// Cross Analysis Engine
// ───────────────────────────────────────────────
function runCrossAnalysis(reports) {
  const allIssues = [];
  for (const report of reports) {
    for (const issue of report.issues) {
      allIssues.push({ ...issue, inspector: report.inspector, dimension: report.dimension });
    }
  }

  const findings = [];

  // Find issues that appear in multiple dimensions
  const messageGroups = new Map();
  for (const issue of allIssues) {
    const key = issue.message;
    if (!messageGroups.has(key)) {
      messageGroups.set(key, []);
    }
    messageGroups.get(key).push(issue);
  }

  for (const [message, issues] of messageGroups) {
    if (issues.length > 1) {
      const dims = [...new Set(issues.map((i) => i.dimension).filter(Boolean))];
      if (dims.length > 1) {
        findings.push({
          type: 'cross-dimensional',
          message: message,
          dimensions: dims,
          inspectors: issues.map((i) => i.inspector),
          severity: issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : 'info',
        });
      }
    }
  }

  // Root cause clustering
  const rootCauses = [];
  const sceneErrors = allIssues.filter((i) => i.message.includes('未在 SceneRegistry'));
  if (sceneErrors.length > 0) {
    rootCauses.push({
      type: 'root-cause',
      cause: '场景未注册',
      impact: `影响 ${sceneErrors.length} 个检查维度`,
      fix: '在 bootstrap.js 或 dula-assets 中注册缺失的场景',
    });
  }

  const animErrors = allIssues.filter((i) => i.message.includes('未在 AnimationRegistry'));
  if (animErrors.length > 0) {
    rootCauses.push({
      type: 'root-cause',
      cause: '动画未注册',
      impact: `影响 ${animErrors.length} 个条目`,
      fix: '在 dula-assets 中注册缺失的动画',
    });
  }

  return { findings, rootCauses, totalIssues: allIssues.length };
}

// ───────────────────────────────────────────────
// Console Output
// ───────────────────────────────────────────────
function printConsoleReport(reports, crossAnalysis) {
  for (const report of reports) {
    const { inspector, dimension, summary, issues } = report;
    if (issues.length === 0) continue;

    const color = summary.errors > 0 ? 'red' : summary.warnings > 0 ? 'yellow' : 'green';
    const dimLabel = dimension ? ` [${dimension}]` : '';

    console.log(chalk[color](`┌─ ${inspector}${dimLabel}`));
    console.log(chalk[color](`│  问题: ${summary.errors} 错误 / ${summary.warnings} 警告 / ${summary.infos} 提示`));

    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
      const timeStr = issue.time != null ? ` [${issue.time.toFixed(2)}s]` : '';
      const codeStr = issue.code ? ` {${issue.code}}` : '';
      console.log(chalk[color](`│  ${icon} ${issue.message}${timeStr}${codeStr}`));
      if (issue.fix) {
        console.log(chalk.gray(`│     💡 ${issue.fix}`));
      }
    }
    console.log(chalk[color](`└─`));
    console.log();
  }

  // Cross-analysis summary
  if (crossAnalysis.findings.length > 0 || crossAnalysis.rootCauses.length > 0) {
    console.log(chalk.magenta('═─ 交叉分析 ─═'));
    console.log();

    for (const rc of crossAnalysis.rootCauses) {
      console.log(chalk.magenta(`🔥 根因: ${rc.cause}`));
      console.log(chalk.gray(`   影响: ${rc.impact}`));
      console.log(chalk.gray(`   修复: ${rc.fix}`));
      console.log();
    }

    for (const fd of crossAnalysis.findings) {
      console.log(chalk.cyan(`🔗 跨维度: ${fd.message}`));
      console.log(chalk.gray(`   维度: ${fd.dimensions.join(' + ')}`));
      console.log(chalk.gray(`   检查器: ${fd.inspectors.join(', ')}`));
      console.log();
    }
  }

  const totalErrors = reports.reduce((sum, r) => sum + r.summary.errors, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.summary.warnings, 0);
  const totalInfos = reports.reduce((sum, r) => sum + r.summary.infos, 0);

  console.log(chalk.gray('─'.repeat(50)));
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(chalk.green(`✅ 全部通过 — ${totalInfos} 个提示`));
  } else {
    const colorFn = totalErrors > 0 ? chalk.red : chalk.yellow;
    console.log(colorFn(`⚠️  共发现 ${totalErrors} 个错误，${totalWarnings} 个警告，${totalInfos} 个提示`));
    console.log(chalk.gray(`   跨维度问题: ${crossAnalysis.findings.length} 个`));
    console.log(chalk.gray(`   根因聚类: ${crossAnalysis.rootCauses.length} 个`));
  }
}

// ───────────────────────────────────────────────
// HTML Report
// ───────────────────────────────────────────────
function generateHtmlReport(reports, crossAnalysis, episodeDir) {
  const totalErrors = reports.reduce((sum, r) => sum + r.summary.errors, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.summary.warnings, 0);
  const totalInfos = reports.reduce((sum, r) => sum + r.summary.infos, 0);

  const statusColor = totalErrors > 0 ? '#e74c3c' : totalWarnings > 0 ? '#f39c12' : '#2ecc71';
  const statusText = totalErrors > 0 ? '未通过' : totalWarnings > 0 ? '有警告' : '通过';

  const inspectorSections = reports
    .filter((r) => r.issues.length > 0)
    .map((report) => {
      const issuesHtml = report.issues
        .map((issue) => {
          const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
          const timeStr = issue.time != null ? `<span class="time">${issue.time.toFixed(2)}s</span>` : '';
          const codeStr = issue.code ? `<span class="code">${issue.code}</span>` : '';
          const fixHtml = issue.fix ? `<div class="fix">💡 ${issue.fix}</div>` : '';
          return `<div class="issue ${issue.severity}"><span class="icon">${icon}</span><span class="message">${issue.message}</span>${timeStr}${codeStr}${fixHtml}</div>`;
        })
        .join('');

      const dimBadge = report.dimension ? `<span class="badge dim">${report.dimension}</span>` : '';

      return `
        <div class="inspector">
          <h2>${report.inspector} ${dimBadge}</h2>
          <div class="summary">
            <span class="badge error">${report.summary.errors} 错误</span>
            <span class="badge warning">${report.summary.warnings} 警告</span>
            <span class="badge info">${report.summary.infos} 提示</span>
          </div>
          <div class="issues">${issuesHtml}</div>
        </div>
      `;
    })
    .join('');

  const crossHtml = crossAnalysis.findings.length > 0 || crossAnalysis.rootCauses.length > 0
    ? `
      <div class="cross-analysis">
        <h2>🔗 交叉分析</h2>
        ${crossAnalysis.rootCauses.map((rc) => `
          <div class="root-cause">
            <div class="rc-title">🔥 根因: ${rc.cause}</div>
            <div class="rc-detail">影响: ${rc.impact}</div>
            <div class="rc-detail">修复: ${rc.fix}</div>
          </div>
        `).join('')}
        ${crossAnalysis.findings.map((fd) => `
          <div class="cross-dim">
            <div class="cd-title">${fd.message}</div>
            <div class="cd-detail">维度: ${fd.dimensions.join(' + ')}</div>
            <div class="cd-detail">检查器: ${fd.inspectors.join(', ')}</div>
          </div>
        `).join('')}
      </div>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Dula Inspect Team Report — ${path.basename(episodeDir)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { background: white; border-radius: 12px; padding: 30px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header h1 { font-size: 24px; margin-bottom: 10px; }
    .header .meta { color: #666; font-size: 14px; }
    .status { display: inline-block; padding: 8px 16px; border-radius: 20px; color: white; font-weight: bold; margin-top: 15px; }
    .inspector { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .inspector h2 { font-size: 18px; margin-bottom: 12px; color: #333; }
    .summary { margin-bottom: 16px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-right: 8px; }
    .badge.error { background: #fee; color: #c33; }
    .badge.warning { background: #fff3e0; color: #e65100; }
    .badge.info { background: #e3f2fd; color: #1565c0; }
    .badge.dim { background: #f3e5f5; color: #7b1fa2; }
    .issue { padding: 12px; border-radius: 8px; margin-bottom: 8px; }
    .issue.error { background: #fff5f5; border-left: 4px solid #e74c3c; }
    .issue.warning { background: #fffbf0; border-left: 4px solid #f39c12; }
    .issue.info { background: #f0f8ff; border-left: 4px solid #3498db; }
    .issue .icon { margin-right: 8px; }
    .issue .message { font-weight: 500; }
    .issue .time { color: #666; font-size: 12px; margin-left: 8px; }
    .issue .code { color: #999; font-size: 11px; margin-left: 8px; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
    .issue .fix { color: #666; font-size: 13px; margin-top: 4px; padding-left: 28px; }
    .cross-analysis { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .cross-analysis h2 { font-size: 18px; margin-bottom: 16px; color: #333; }
    .root-cause { background: #fff5f5; border-radius: 8px; padding: 12px; margin-bottom: 12px; border-left: 4px solid #e74c3c; }
    .rc-title { font-weight: 600; color: #c33; margin-bottom: 4px; }
    .rc-detail { color: #666; font-size: 13px; }
    .cross-dim { background: #f0f8ff; border-radius: 8px; padding: 12px; margin-bottom: 12px; border-left: 4px solid #3498db; }
    .cd-title { font-weight: 600; color: #1565c0; margin-bottom: 4px; }
    .cd-detail { color: #666; font-size: 13px; }
    .no-issues { color: #2ecc71; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Dula 闭环质检报告</h1>
      <div class="meta">剧集: ${path.basename(episodeDir)}</div>
      <div class="meta">路径: ${episodeDir}</div>
      <div class="meta">时间: ${new Date().toLocaleString('zh-CN')}</div>
      <div class="status" style="background: ${statusColor}">${statusText}</div>
    </div>
    ${inspectorSections}
    ${crossHtml}
  </div>
</body>
</html>`;
}
