#!/usr/bin/env node
/**
 * dula-inspect — Quality Inspector CLI
 *
 * Usage:
 *   dula-inspect <episode-dir> [--format=console|html] [--output=report.html]
 *
 * Example:
 *   dula-inspect ./episodes/dunk_master_doraemon
 *   dula-inspect ./episodes/dunk_master_doraemon --format=html --output=report.html
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 简单 ANSI 颜色
const chalk = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

// Parse arguments
const args = process.argv.slice(2);
const episodeDir = args[0];
let format = 'console';
let outputPath = null;

for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--format=')) {
    format = args[i].slice('--format='.length);
  } else if (args[i].startsWith('--output=')) {
    outputPath = args[i].slice('--output='.length);
  }
}

if (!episodeDir) {
  console.error(chalk.red('Usage: dula-inspect <episode-dir> [--format=console|html] [--output=report.html]'));
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

console.log(chalk.blue(`🔍 Dula Quality Inspector`));
console.log(chalk.gray(`Episode: ${absEpisodeDir}`));
console.log(chalk.gray(`Story:   ${storyPath}`));
console.log();

// Parse story entries (lightweight parser, no Three.js needed)
const entries = parseStory(storyText);
const audioDir = path.join(absEpisodeDir, 'assets', 'audio');
const outputDir = path.join(absEpisodeDir, 'output');

// Run all inspectors
const reports = [
  runCharacterInspector(entries, absEpisodeDir),
  runSceneInspector(entries, absEpisodeDir),
  runAnimationInspector(entries, absEpisodeDir),
  runAVSyncInspector(entries, audioDir, outputDir),
  runNarrativeConsistencyInspector(entries, absEpisodeDir),
];

// Output report
if (format === 'html') {
  const html = generateHtmlReport(reports, absEpisodeDir);
  const out = outputPath || path.join(outputDir, 'inspect_report.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(chalk.green(`\n✅ HTML report saved to: ${out}`));
} else {
  printConsoleReport(reports);
}

const totalErrors = reports.reduce((sum, r) => sum + r.summary.errors, 0);
process.exit(totalErrors > 0 ? 1 : 0);

// ───────────────────────────────────────────────
// Lightweight Story Parser
// ───────────────────────────────────────────────
function parseStory(text) {
  const lines = text.split('\n');
  const entries = [];
  let currentEntry = null;
  let currentTime = 0;
  let currentScene = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;

    // Character line: "Doraemon: Hello!" or "[Doraemon] ..."
    let charMatch = line.match(/^([A-Z][a-zA-Z0-9_]*):\s*(.+)$/);
    if (!charMatch) {
      charMatch = line.match(/^\[([A-Z][a-zA-Z0-9_]*)\]\s*(.+)$/);
      if (charMatch) {
        // Reorder groups to match expected format
        charMatch = [charMatch[0], charMatch[1], charMatch[2]];
      }
    }
    if (charMatch) {
      if (currentEntry) {
        currentEntry.endTime = currentTime;
        entries.push(currentEntry);
      }
      // Strip all namespaced tags from text for duration estimation
      let text = charMatch[2];
      text = text
        .replace(/\{Animation:[^}]+\}\s*/g, '')
        .replace(/\{Camera:[^}]+\}\s*/g, '')
        .replace(/\{Prop:[^}]+\}\s*/g, '')
        .replace(/\{Position:[^}]+\}\s*/g, '')
        .replace(/\{SFX:[^}]+\}\s*/g, '')
        .replace(/\{Transition:[^}]+\}\s*/g, '')
        .replace(/\{Event:[^}]+\}\s*/g, '')
        .trim();
      const duration = estimateDuration(text);
      currentEntry = {
        line: i + 1,
        character: charMatch[1],
        text: text,
        startTime: currentTime,
        endTime: currentTime + duration,
        scene: currentScene,
        animations: [],
        storyEvents: [],
        propOps: [],
        audioFile: null,
      };
      // Extract inline Prop tags from the raw line
      const propRegex = /\{Prop:([^}]+)\}/g;
      let propMatch;
      const rawText = charMatch[2];
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
        currentEntry.propOps.push({ name, options });
      }
      currentTime += duration;
      continue;
    }

    // Extract inline Animation tags from character lines (e.g. [Xiaoyue]{Animation:Wave})
    if (charMatch && currentEntry) {
      const animRegex = /\{Animation:([^}]+)\}/g;
      let animMatch;
      while ((animMatch = animRegex.exec(charMatch[2])) !== null) {
        currentEntry.animations.push(animMatch[1]);
      }
    }

    // Event tag: {Event:Move|character=Doraemon|x=2|z=3|duration=1}
    const eventMatch = line.match(/^\{Event:([^|]+)\|(.+)\}$/);
    if (eventMatch && currentEntry) {
      const eventName = eventMatch[1];
      const opts = {};
      eventMatch[2].split('|').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k && v !== undefined) {
          opts[k] = isNaN(v) ? v : parseFloat(v);
        }
      });
      currentEntry.storyEvents.push({ name: eventName, options: opts });
      continue;
    }

    // Scene tag: @RoomScene or {Scene:RoomScene}
    const sceneMatch = line.match(/^@(\w+)/);
    if (sceneMatch) {
      if (currentEntry) {
        currentEntry.endTime = currentTime;
        entries.push(currentEntry);
      }
      // Set current scene context (don't create a separate entry)
      currentScene = sceneMatch[1];
      currentEntry = null;
      continue;
    }
    const sceneMatch2 = line.match(/^\{Scene:([^}]+)\}$/);
    if (sceneMatch2) {
      currentScene = sceneMatch2[1];
      continue;
    }

    // Position tag: {Position:Doraemon|x=1|y=0|z=2}
    const posMatch = line.match(/^\{Position:([^|]+)\|(.+)\}$/);
    if (posMatch && currentEntry) {
      currentEntry.position = posMatch[1];
      continue;
    }

    // Camera tag: {Camera:orbit|target=Doraemon|distance=5}
    const camMatch = line.match(/^\{Camera:([^|]+)\|(.+)\}$/);
    if (camMatch && currentEntry) {
      currentEntry.camera = camMatch[1];
      continue;
    }

    // Transition tag: {Transition:Fade|duration=0.5}
    const transMatch = line.match(/^\{Transition:([^|]+)\|(.+)\}$/);
    if (transMatch) {
      if (currentEntry) {
        currentEntry.transition = transMatch[1];
      }
      continue;
    }

    // Audio tag: {Audio:file.mp3}
    const audioMatch = line.match(/^\{Audio:([^}]+)\}$/);
    if (audioMatch && currentEntry) {
      currentEntry.audioFile = audioMatch[1];
      continue;
    }
  }

  if (currentEntry) {
    currentEntry.endTime = currentTime;
    entries.push(currentEntry);
  }

  return entries;
}

function estimateDuration(text) {
  // 中文约 4 字/秒，英文约 15 词/分钟
  const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const duration = cnChars / 4 + enWords / 3;
  return Math.max(1.5, Math.min(duration + 0.5, 8));
}

// ───────────────────────────────────────────────
// Inspector Implementations (Node.js, no Three.js)
// ───────────────────────────────────────────────

function makeReport(name, issues) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');
  return {
    inspector: name,
    summary: { total: issues.length, errors: errors.length, warnings: warnings.length, infos: infos.length },
    issues,
  };
}

function runCharacterInspector(entries, episodeDir) {
  const issues = [];
  const characters = new Set();
  const characterScenes = new Map();
  const sceneCharacters = new Map(); // scene -> [{char, firstLine, firstTime}]

  for (const entry of entries) {
    if (entry.character) {
      characters.add(entry.character);
      if (entry.scene) {
        if (!characterScenes.has(entry.character)) {
          characterScenes.set(entry.character, new Set());
        }
        characterScenes.get(entry.character).add(entry.scene);

        // Track which characters appear in which scene and when
        if (!sceneCharacters.has(entry.scene)) {
          sceneCharacters.set(entry.scene, []);
        }
        const existing = sceneCharacters.get(entry.scene).find((c) => c.char === entry.character);
        if (!existing) {
          sceneCharacters.get(entry.scene).push({
            char: entry.character,
            firstLine: entry.line,
            firstTime: entry.startTime,
          });
        }
      }
    }
  }

  if (characters.size === 0) {
    issues.push({ severity: 'error', message: '剧本中没有任何角色', fix: '在 .story 文件中添加角色和台词' });
    return makeReport('CharacterInspector', issues);
  }

  // Try to load bootstrap.js to check character registries
  const bootstrapPath = path.join(episodeDir, 'bootstrap.js');
  let registeredChars = new Set();
  if (fs.existsSync(bootstrapPath)) {
    const bootstrapText = fs.readFileSync(bootstrapPath, 'utf-8');
    // Simple regex to find character registrations
    const regMatches = bootstrapText.matchAll(/CharacterRegistry\.register\(['"`]([^'"`]+)['"`]/g);
    for (const m of regMatches) {
      registeredChars.add(m[1]);
    }
  }

  for (const charName of characters) {
    // Check if character is registered
    if (registeredChars.size > 0 && !registeredChars.has(charName)) {
      issues.push({ severity: 'error', message: `角色 ${charName} 未在 CharacterRegistry 中注册`, fix: `在 bootstrap.js 中注册 ${charName}` });
    }

    // Check if character appears in multiple scenes
    const scenes = characterScenes.get(charName);
    if (scenes && scenes.size > 1) {
      issues.push({ severity: 'info', message: `角色 ${charName} 出现在 ${scenes.size} 个场景中`, fix: '确保场景切换时角色位置正确' });
    }

    // Check if character has too few lines
    const lineCount = entries.filter((e) => e.character === charName).length;
    if (lineCount === 1) {
      issues.push({ severity: 'info', message: `角色 ${charName} 只有 1 句台词`, fix: '考虑增加角色戏份或移除' });
    }
  }

  // Check for characters appearing in scenes before their first line
  for (const [sceneName, chars] of sceneCharacters) {
    // Sort characters by first appearance time
    const sorted = chars.sort((a, b) => a.firstTime - b.firstTime);
    const firstChar = sorted[0];
    
    for (let i = 1; i < sorted.length; i++) {
      const laterChar = sorted[i];
      const timeDiff = laterChar.firstTime - firstChar.firstTime;
      
      // If a character appears > 3s after the scene starts and another character already spoke,
      // flag as potential "character shouldn't be here yet"
      if (timeDiff > 3.0) {
        issues.push({
          severity: 'warning',
          message: `角色 ${laterChar.char} 在场景 ${sceneName} 中 ${timeDiff.toFixed(1)}s 后才首次开口，但场景开始时已存在`,
          fix: `检查 ${laterChar.char} 是否应该在场景开始时就在场，或应在 ${laterChar.firstTime.toFixed(1)}s 后才出现`,
          time: laterChar.firstTime,
        });
      }
    }
  }

  return makeReport('CharacterInspector', issues);
}

function runSceneInspector(entries, episodeDir) {
  const issues = [];
  const scenes = new Set();
  const sceneEntries = new Map();

  for (const entry of entries) {
    if (entry.scene) {
      scenes.add(entry.scene);
      if (!sceneEntries.has(entry.scene)) {
        sceneEntries.set(entry.scene, []);
      }
      sceneEntries.get(entry.scene).push(entry);
    }
  }

  if (scenes.size === 0) {
    issues.push({ severity: 'warning', message: '剧本中没有显式声明场景', fix: '使用 {Scene:SceneName} 声明场景' });
  }

  // Check scene registry
  const bootstrapPath = path.join(episodeDir, 'bootstrap.js');
  let registeredScenes = new Set();
  if (fs.existsSync(bootstrapPath)) {
    const bootstrapText = fs.readFileSync(bootstrapPath, 'utf-8');
    const regMatches = bootstrapText.matchAll(/SceneRegistry\.register\(['"`]([^'"`]+)['"`]/g);
    for (const m of regMatches) {
      registeredScenes.add(m[1]);
    }
  }

  // 场景-主题语义匹配检查
  const allDialogue = entries.filter((e) => e.text).map((e) => e.text).join('');
  const themeKeywords = extractThemeKeywords(allDialogue);
  
  for (const sceneName of scenes) {
    if (registeredScenes.size > 0 && !registeredScenes.has(sceneName)) {
      issues.push({ severity: 'error', message: `场景 ${sceneName} 未在 SceneRegistry 中注册`, fix: `在 bootstrap.js 中注册 ${sceneName}` });
    }

    const ents = sceneEntries.get(sceneName);
    const hasDialogue = ents.some((e) => e.character && e.text && e.text.trim());
    if (!hasDialogue) {
      issues.push({ severity: 'warning', message: `场景 ${sceneName} 没有角色台词`, fix: '添加角色对白或考虑删除该场景' });
    }

    // 检查场景名称是否与剧情主题冲突
    const mismatch = checkSceneThemeMismatch(sceneName, themeKeywords);
    if (mismatch) {
      issues.push({ severity: 'warning', message: `场景 "${sceneName}" 与剧情主题可能不匹配: ${mismatch}`, fix: '检查场景选择是否符合故事设定' });
    }
  }

  // Check scene transitions
  let lastScene = null;
  for (const entry of entries) {
    if (entry.scene) {
      if (lastScene && lastScene !== entry.scene && !entry.transition) {
        issues.push({ severity: 'info', message: `场景切换 ${lastScene} → ${entry.scene} 没有转场效果`, fix: '添加 {Transition:Fade|duration=0.5} 使切换更平滑', time: entry.startTime });
      }
      lastScene = entry.scene;
    }
  }

  return makeReport('SceneInspector', issues);
}

/**
 * 从台词中提取主题关键词
 */
function extractThemeKeywords(dialogue) {
  const keywords = [];
  const patterns = [
    { regex: /(夜晚|晚上|夜空|星空|星星|月亮|黑夜|星夜)/g, theme: '夜晚/星空', minCount: 2 },
    { regex: /(街道|城市|马路|霓虹|高楼)/g, theme: '城市街道', minCount: 3 },
    { regex: /(公园|花园|草地|庭院|院子|花草)/g, theme: '户外/公园', minCount: 2 },
    { regex: /(房间|屋内|家里|客厅|屋子|室内)/g, theme: '室内/房间', minCount: 2 },
    { regex: /(天空|飞行|飞翔|起飞|降落|空中)/g, theme: '天空/飞行', minCount: 2 },
    { regex: /(快递|包裹|送货|收件|物流)/g, theme: '快递/物流', minCount: 2 },
    { regex: /(飞船|宇宙|太空|星球|外星|母星)/g, theme: '科幻/太空', minCount: 2 },
    { regex: /(雨|下雨|雨天|淋雨)/g, theme: '雨天', minCount: 2 },
    { regex: /(雪|下雪|冬天|寒冷)/g, theme: '雪景/冬天', minCount: 2 },
    { regex: /(海边|海滩|海洋|沙滩|浪花)/g, theme: '海边/海滩', minCount: 2 },
    { regex: /(森林|树林|树木|丛林)/g, theme: '森林', minCount: 2 },
    { regex: /(沙漠|沙丘|荒漠)/g, theme: '沙漠', minCount: 2 },
  ];
  
  for (const p of patterns) {
    const matches = dialogue.match(p.regex);
    if (matches && matches.length >= (p.minCount || 1)) {
      keywords.push(p.theme);
    }
  }
  return keywords;
}

/**
 * 检查场景名称与主题是否冲突
 */
function checkSceneThemeMismatch(sceneName, themeKeywords) {
  // 场景名称蕴含的环境特征
  const sceneTraits = [];
  if (/Room|房间|室内|客厅|屋子|家/i.test(sceneName)) sceneTraits.push('室内');
  if (/Park|公园|花园|草地|庭院/i.test(sceneName)) sceneTraits.push('户外/公园');
  if (/Street|街道|城市|马路|路/i.test(sceneName)) sceneTraits.push('城市街道');
  if (/Sky|天空|空中|飞行/i.test(sceneName)) sceneTraits.push('天空/飞行');
  if (/Beach|海边|海滩|沙滩|海洋/i.test(sceneName)) sceneTraits.push('海边/海滩');
  if (/Forest|森林|树林|丛林/i.test(sceneName)) sceneTraits.push('森林');
  if (/Desert|沙漠|沙丘/i.test(sceneName)) sceneTraits.push('沙漠');
  if (/Snow|雪|冰|冬天/i.test(sceneName)) sceneTraits.push('雪景/冬天');
  if (/Rain|雨|下雨/i.test(sceneName)) sceneTraits.push('雨天');
  if (/Night|夜晚|黑夜|夜间|星空|星夜/i.test(sceneName)) sceneTraits.push('夜晚/星空');
  
  if (sceneTraits.length === 0) return null;
  
  // 检查特定的不合理组合（主题与场景严重冲突）
  for (const theme of themeKeywords) {
    for (const trait of sceneTraits) {
      // 定义已知的不合理组合
      const badCombos = [
        { theme: '夜晚/星空', trait: '室内', reason: '夜晚/星空主题的故事不应主要发生在室内' },
        { theme: '夜晚/星空', trait: '户外/公园', reason: '夜晚/星空主题需要夜景场景，而非普通公园' },
        { theme: '雨天', trait: '室内', reason: '雨天主题的故事不应完全发生在室内' },
        { theme: '海边/海滩', trait: '室内', reason: '海边主题不应主要发生在室内' },
        { theme: '海边/海滩', trait: '城市街道', reason: '海边主题不应主要发生在城市街道' },
        { theme: '森林', trait: '室内', reason: '森林主题不应主要发生在室内' },
        { theme: '森林', trait: '城市街道', reason: '森林主题不应主要发生在城市街道' },
        { theme: '沙漠', trait: '室内', reason: '沙漠主题不应主要发生在室内' },
        { theme: '沙漠', trait: '城市街道', reason: '沙漠主题不应主要发生在城市街道' },
        { theme: '雪景/冬天', trait: '室内', reason: '雪景主题不应完全发生在室内' },
      ];
      const bad = badCombos.find((c) => c.theme === theme && c.trait === trait);
      if (bad) return bad.reason;
    }
  }
  
  return null;
}

function runAnimationInspector(entries, episodeDir) {
  const issues = [];
  const usedAnimations = new Set();
  const charAnimations = new Map(); // char -> [{name, start, end}]

  for (const entry of entries) {
    if (entry.animations) {
      for (const anim of entry.animations) {
        usedAnimations.add(anim);
        if (entry.character) {
          if (!charAnimations.has(entry.character)) {
            charAnimations.set(entry.character, []);
          }
          charAnimations.get(entry.character).push({ name: anim, start: entry.startTime, end: entry.endTime });
        }
      }
    }

    // Check move events
    if (entry.storyEvents) {
      for (const ev of entry.storyEvents) {
        if (ev.name === 'Move') {
          const opts = ev.options;
          const dx = opts.x || 0;
          const dy = opts.y || 0;
          const dz = opts.z || 0;
          const duration = opts.duration || 1.0;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const speed = dist / duration;

          if (speed > 15) {
            issues.push({ severity: 'warning', message: `角色 ${opts.character || entry.character} 移动速度过快 (${speed.toFixed(1)} m/s)`, fix: '降低移动距离或增加 duration', time: entry.startTime });
          }
          if (duration < 0.1) {
            issues.push({ severity: 'warning', message: `角色 ${opts.character || entry.character} 移动时间过短 (${duration.toFixed(2)}s)`, fix: '增加 duration 到至少 0.3s', time: entry.startTime });
          }
        }
      }
    }
  }

  // Check animation registry
  const bootstrapPath = path.join(episodeDir, 'bootstrap.js');
  let registeredAnims = new Set();
  if (fs.existsSync(bootstrapPath)) {
    const bootstrapText = fs.readFileSync(bootstrapPath, 'utf-8');
    const regMatches = bootstrapText.matchAll(/AnimationRegistry\.register\(['"`]([^'"`]+)['"`]/g);
    for (const m of regMatches) {
      registeredAnims.add(m[1]);
    }
  }

  for (const animName of usedAnimations) {
    if (registeredAnims.size > 0 && !registeredAnims.has(animName)) {
      issues.push({ severity: 'error', message: `动画 "${animName}" 未在 AnimationRegistry 中注册`, fix: `在 dula-assets 中注册动画或使用正确的动画名` });
    }
  }

  // Check animation overlap
  for (const [charName, anims] of charAnimations) {
    for (let i = 0; i < anims.length; i++) {
      for (let j = i + 1; j < anims.length; j++) {
        const a1 = anims[i];
        const a2 = anims[j];
        if (a1.start < a2.end && a2.start < a1.end) {
          issues.push({ severity: 'info', message: `角色 ${charName} 在 ${a1.start.toFixed(2)}s-${Math.min(a1.end, a2.end).toFixed(2)}s 有重叠动画 (${a1.name} + ${a2.name})`, fix: '确保动画可以叠加执行' });
        }
      }
    }
  }

  return makeReport('AnimationInspector', issues);
}

// ───────────────────────────────────────────────
// Narrative Consistency Inspector
// 检测台词与视觉表现之间的不一致（剧情漏洞）
// ───────────────────────────────────────────────

function runNarrativeConsistencyInspector(entries, episodeDir) {
  const issues = [];

  // 1. 道具提及检测：台词中提到了某道具，但场景中没有对应的 Prop 标签或场景内建道具
  const propKeywords = [
    // 格式: [关键词正则, 道具名称, 需要的Prop类型(可选)]
    { regex: /这封信|那封信|信纸|信件|信封|信在发光|信上|手里.*信/, name: '信/信件', propType: 'letter', severity: 'error' },
    { regex: /包裹|快递|盒子|箱子|背包/, name: '包裹/箱子', propType: 'package', severity: 'error' },
    { regex: /手机|电话|打电话/, name: '手机', propType: 'phone', severity: 'warning' },
    { regex: /书|书本|笔记本|日记/, name: '书/笔记本', propType: 'book', severity: 'warning' },
    { regex: /球|篮球|足球|网球/, name: '球', propType: 'ball', severity: 'error' },
    { regex: /雨伞|伞|撑伞/, name: '雨伞', propType: 'umbrella', severity: 'error' },
    { regex: /花|花朵|一束花|玫瑰花/, name: '花', propType: 'flower', severity: 'warning' },
    { regex: /照片|相片|画像/, name: '照片', propType: 'photo', severity: 'warning' },
    { regex: /钥匙|开锁/, name: '钥匙', propType: 'key', severity: 'warning' },
    { regex: /地图|导航/, name: '地图', propType: 'map', severity: 'warning' },
    { regex: /钱|钞票|金币|钱包/, name: '钱/钱包', propType: 'wallet', severity: 'warning' },
    { regex: /武器|剑|刀|枪/, name: '武器', propType: 'weapon', severity: 'error' },
    { regex: /魔法棒|魔杖|法杖/, name: '魔法棒', propType: 'wand', severity: 'error' },
    { regex: /竹蜻蜓/, name: '竹蜻蜓', propType: 'takecopter', severity: 'info' }, // 角色专属道具，通常内建
  ];

  // 收集所有 Prop 标签
  const storyText = fs.readFileSync(storyPath, 'utf-8');
  const propTags = [];
  const propRegex = /\{Prop:([^|}]+)(?:\|([^}]*))?\}/g;
  let propMatch;
  while ((propMatch = propRegex.exec(storyText)) !== null) {
    propTags.push({
      action: propMatch[1].toLowerCase(),
      options: propMatch[2] || '',
      line: storyText.substring(0, propMatch.index).split('\n').length,
    });
  }

  // 检查每个 entry 的台词
  for (const entry of entries) {
    if (!entry.text) continue;
    const text = entry.text;

    for (const pk of propKeywords) {
      if (pk.regex.test(text)) {
        // 台词中提到了这个道具，检查是否有对应的 Prop 标签（在同一 entry 内）
        const hasPropTag = entry.propOps?.some((po) => {
          const typeMatch = pk.propType && po.name.toLowerCase() === pk.propType;
          const charMatch = po.options.character === entry.character;
          return typeMatch && charMatch;
        });

        // 也检查场景文件是否内建了该道具（通过扫描场景JS文件）
        const sceneHasBuiltInProp = checkSceneHasBuiltInProp(entry.scene, pk.propType, episodeDir);

        if (!hasPropTag && !sceneHasBuiltInProp) {
          issues.push({
            severity: pk.severity,
            message: `台词提及"${pk.name}"但场景中无对应道具: "${text}"`,
            fix: `在同一行添加 {Prop:${pk.propType}|character=${entry.character}}，如: [${entry.character}]{Prop:${pk.propType}|character=${entry.character}} ${text}`,
            time: entry.startTime,
          });
        }
      }
    }
  }

  // 2. 环境描述一致性检测
  const envKeywords = [
    { regex: /下雨|雨天|淋雨|雨滴|暴雨/, name: '雨天', sceneEffect: 'rain', severity: 'error' },
    { regex: /下雪|雪花|雪地|冰天雪地/, name: '雪景', sceneEffect: 'snow', severity: 'error' },
    { regex: /刮风|大风|狂风|风暴/, name: '大风', sceneEffect: 'wind', severity: 'warning' },
    { regex: /雾|迷雾|大雾|浓雾/, name: '雾天', sceneEffect: 'fog', severity: 'warning' },
    { regex: /彩虹/, name: '彩虹', sceneEffect: 'rainbow', severity: 'warning' },
    { regex: /闪电|打雷|雷声|雷电/, name: '雷电', sceneEffect: 'lightning', severity: 'error' },
  ];

  for (const entry of entries) {
    if (!entry.text) continue;
    const text = entry.text;

    for (const ek of envKeywords) {
      if (ek.regex.test(text)) {
        // 检查是否有对应的环境事件标签
        const hasEvent = entry.storyEvents?.some((ev) => {
          const evName = ev.name.toLowerCase();
          return evName.includes(ek.sceneEffect) || evName.includes('weather');
        });

        // 检查场景名称是否暗示该环境
        const sceneImpliesEffect = entry.scene?.toLowerCase().includes(ek.sceneEffect);

        if (!hasEvent && !sceneImpliesEffect) {
          issues.push({
            severity: ek.severity,
            message: `台词提及"${ek.name}"但场景无对应效果: "${text}"`,
            fix: `添加 {Event:SetWeather|type=${ek.sceneEffect}} 或修改场景名称/代码`,
            time: entry.startTime,
          });
        }
      }
    }
  }

  // 3. Prop 标签孤立检测 — 检查 Prop 标签是否放在没有角色的行上（会被引擎忽略）
  const storyLines = storyText.split('\n');
  let currentEntryLine = null;
  for (let i = 0; i < storyLines.length; i++) {
    const line = storyLines[i].trim();
    if (!line) continue;
    // 检测是否是 entry 开始行（有角色或场景声明）
    if (line.match(/^\d+\s*$/) || line.match(/^\d+\s*-->/) || line.match(/^@\w+/)) {
      currentEntryLine = i;
    }
    // 检测 Prop 标签
    const propMatch = line.match(/\{Prop:([^}]+)\}/);
    if (propMatch) {
      // 检查这一行是否有角色
      const hasCharacter = line.match(/\[\w+\]/);
      if (!hasCharacter) {
        issues.push({
          severity: 'error',
          message: `Prop 标签 "${propMatch[0]}" 放在没有角色的孤立行上，引擎会忽略它`,
          fix: '将 Prop 标签移到同一 entry 的 [Character] 行内，如: [Xiaoyue]{Prop:letter|character=Xiaoyue} 台词',
        });
      }
    }
  }

  // 4. 动画-角色道具匹配检测
  const animPropRequirements = {
    'XingzaiFloat': { prop: 'takeCopter', method: 'attachTakeCopter', chars: ['Xingzai'] },
    'Float': { prop: 'takeCopter', method: 'attachTakeCopter', chars: ['Xingzai'] },
  };

  // 扫描角色文件检查是否有所需方法
  const charsDir = path.join(episodeDir, 'characters');
  const assetsCharsDir = path.resolve(episodeDir, '..', '..', '..', 'dula-assets', 'characters');

  for (const entry of entries) {
    if (!entry.animations || !entry.character) continue;
    for (const animName of entry.animations) {
      const req = animPropRequirements[animName];
      if (!req) continue;
      // 检查角色是否支持该道具
      const charFilePaths = [
        path.join(charsDir, `${entry.character}.js`),
        path.join(assetsCharsDir, `${entry.character}.js`),
      ];
      let hasMethod = false;
      for (const cf of charFilePaths) {
        if (fs.existsSync(cf)) {
          const charText = fs.readFileSync(cf, 'utf-8');
          if (charText.includes(req.method)) {
            hasMethod = true;
            break;
          }
        }
      }
      if (!hasMethod) {
        issues.push({
          severity: 'error',
          message: `动画 "${animName}" 需要角色 ${entry.character} 支持 ${req.method}()，但该角色未实现此方法`,
          fix: `在 ${entry.character}.js 中添加 ${req.method}() 方法，或更换为其他动画`,
          time: entry.startTime,
        });
      }
    }
  }

  // 5. 角色动作与目标一致性检测
  const actionTargets = [
    { regex: /指向|指着|看那边|那边/, name: '指向动作', needsTarget: true, severity: 'warning' },
    { regex: /递给|交给|给你|接住/, name: '递送动作', needsTarget: true, severity: 'warning' },
    { regex: /拥抱|抱住/, name: '拥抱动作', needsTarget: true, severity: 'warning' },
    { regex: /推|拉|拽/, name: '推拉动作', needsTarget: true, severity: 'warning' },
  ];

  for (const entry of entries) {
    if (!entry.text) continue;
    const text = entry.text;

    for (const at of actionTargets) {
      if (at.regex.test(text)) {
        // 检查是否有另一个角色在同一时间附近
        const nearbyEntries = entries.filter((e) => {
          if (e === entry || !e.character || e.character === entry.character) return false;
          const timeDiff = Math.abs(e.startTime - entry.startTime);
          return timeDiff < 3.0; // 3秒内
        });

        if (nearbyEntries.length === 0) {
          issues.push({
            severity: at.severity,
            message: `台词包含"${at.name}"但附近无其他角色作为目标: "${text}"`,
            fix: '确保目标角色在场，或添加 {Position:...} 让角色进入场景',
            time: entry.startTime,
          });
        }
      }
    }
  }

  return makeReport('NarrativeConsistencyInspector', issues);
}

/**
 * 检查场景JS文件是否内建了指定道具
 */
function checkSceneHasBuiltInProp(sceneName, propType, episodeDir) {
  if (!sceneName || !propType) return false;

  // 扫描场景文件
  const scenesDir = path.join(episodeDir, 'scenes');
  if (!fs.existsSync(scenesDir)) return false;

  const sceneFile = path.join(scenesDir, `${sceneName}.js`);
  if (!fs.existsSync(sceneFile)) {
    // 也检查 dula-assets/scenes
    const assetsScenesDir = path.resolve(episodeDir, '..', '..', '..', 'dula-assets', 'scenes');
    const assetsSceneFile = path.join(assetsScenesDir, `${sceneName}.js`);
    if (!fs.existsSync(assetsSceneFile)) return false;
    const sceneText = fs.readFileSync(assetsSceneFile, 'utf-8');
    return sceneTextIncludesProp(sceneText, propType);
  }

  const sceneText = fs.readFileSync(sceneFile, 'utf-8');
  return sceneTextIncludesProp(sceneText, propType);
}

function sceneTextIncludesProp(sceneText, propType) {
  const propPatterns = {
    letter: /letter|信封|信件|信纸|envelope|mail|paper/i,
    package: /package|包裹|box|箱子|快递|parcel/i,
    phone: /phone|手机|telephone/i,
    book: /book|书|notebook/i,
    ball: /ball|球|basketball|soccer/i,
    umbrella: /umbrella|雨伞|rain/i,
    flower: /flower|花|rose|bouquet/i,
    photo: /photo|照片|picture|frame/i,
    key: /key|钥匙/i,
    map: /map|地图/i,
    wallet: /wallet|钱|money|coin/i,
    weapon: /weapon|剑|sword|刀|knife|枪|gun/i,
    wand: /wand|魔法棒|魔杖/i,
    takecopter: /takecopter|竹蜻蜓|propeller/i,
  };

  const pattern = propPatterns[propType];
  if (!pattern) return false;
  return pattern.test(sceneText);
}

function runAVSyncInspector(entries, audioDir, outputDir) {
  const issues = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.text || !entry.character) continue;

    // Check audio file existence
    // dula-audio generates files like 001_Kira.mp3 (1-based index)
    const audioFileWav = entry.audioFile || `${String(i + 1).padStart(3, '0')}_${entry.character}.wav`;
    const audioFileMp3 = entry.audioFile || `${String(i + 1).padStart(3, '0')}_${entry.character}.mp3`;
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
      issues.push({ severity: 'warning', message: `音频文件不存在: ${audioFileMp3} 或 ${audioFileWav}`, fix: '运行 dula-audio 生成音频', time: entry.startTime });
      continue;
    }

    // Check audio duration with ffprobe
    try {
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const audioDuration = parseFloat(output.trim());
      const expectedDuration = entry.endTime - entry.startTime;
      const diff = Math.abs(audioDuration - expectedDuration);

      if (diff > 1.0) {
        issues.push({ severity: 'warning', message: `音频时长不匹配: ${audioFile} (音频 ${audioDuration.toFixed(2)}s vs 台词 ${expectedDuration.toFixed(2)}s)`, fix: '检查 TTS 生成或调整台词时长', time: entry.startTime });
      } else if (diff > 0.3) {
        issues.push({ severity: 'info', message: `音频时长偏差: ${audioFile} (偏差 ${diff.toFixed(2)}s)`, fix: '微调台词时长以匹配音频', time: entry.startTime });
      }
    } catch (e) {
      // ffprobe 失败，跳过
    }
  }

  // Check for orphaned audio files (skip auto-generated numbered files)
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
      if (file === 'mixed.wav') continue; // skip mixed output
      if (!referencedFiles.has(file)) {
        issues.push({ severity: 'info', message: `未引用的音频文件: ${file}`, fix: '检查是否多余的音频文件' });
      }
    }
  }

  return makeReport('AVSyncInspector', issues);
}

// ───────────────────────────────────────────────
// Report Output
// ───────────────────────────────────────────────

function printConsoleReport(reports) {
  for (const report of reports) {
    const { inspector, summary, issues } = report;
    const color = summary.errors > 0 ? 'red' : summary.warnings > 0 ? 'yellow' : 'green';

    console.log(chalk[color](`┌─ ${inspector}`));
    console.log(chalk[color](`│  问题: ${summary.errors} 错误 / ${summary.warnings} 警告 / ${summary.infos} 提示`));

    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
      const timeStr = issue.time != null ? ` [${issue.time.toFixed(2)}s]` : '';
      console.log(chalk[color](`│  ${icon} ${issue.message}${timeStr}`));
      if (issue.fix) {
        console.log(chalk.gray(`│     💡 ${issue.fix}`));
      }
    }
    console.log(chalk[color](`└─`));
    console.log();
  }

  const totalErrors = reports.reduce((sum, r) => sum + r.summary.errors, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.summary.warnings, 0);

  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(chalk.green('✅ 所有检查通过！'));
  } else {
    const colorFn = totalErrors > 0 ? chalk.red : chalk.yellow;
    console.log(colorFn(`⚠️  共发现 ${totalErrors} 个错误，${totalWarnings} 个警告`));
  }
}

function generateHtmlReport(reports, episodeDir) {
  const totalErrors = reports.reduce((sum, r) => sum + r.summary.errors, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.summary.warnings, 0);

  const statusColor = totalErrors > 0 ? '#e74c3c' : totalWarnings > 0 ? '#f39c12' : '#2ecc71';
  const statusText = totalErrors > 0 ? '未通过' : totalWarnings > 0 ? '有警告' : '通过';

  const inspectorSections = reports
    .map((report) => {
      const issuesHtml = report.issues
        .map((issue) => {
          const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
          const timeStr = issue.time != null ? `<span class="time">${issue.time.toFixed(2)}s</span>` : '';
          const fixHtml = issue.fix ? `<div class="fix">💡 ${issue.fix}</div>` : '';
          return `
            <div class="issue ${issue.severity}">
              <span class="icon">${icon}</span>
              <span class="message">${issue.message}</span>
              ${timeStr}
              ${fixHtml}
            </div>
          `;
        })
        .join('');

      return `
        <div class="inspector">
          <h2>${report.inspector}</h2>
          <div class="summary">
            <span class="badge error">${report.summary.errors} 错误</span>
            <span class="badge warning">${report.summary.warnings} 警告</span>
            <span class="badge info">${report.summary.infos} 提示</span>
          </div>
          <div class="issues">${issuesHtml || '<p class="no-issues">✅ 无问题</p>'}</div>
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Dula Quality Report — ${path.basename(episodeDir)}</title>
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
    .issue { padding: 12px; border-radius: 8px; margin-bottom: 8px; }
    .issue.error { background: #fff5f5; border-left: 4px solid #e74c3c; }
    .issue.warning { background: #fffbf0; border-left: 4px solid #f39c12; }
    .issue.info { background: #f0f8ff; border-left: 4px solid #3498db; }
    .issue .icon { margin-right: 8px; }
    .issue .message { font-weight: 500; }
    .issue .time { color: #666; font-size: 12px; margin-left: 8px; }
    .issue .fix { color: #666; font-size: 13px; margin-top: 4px; padding-left: 28px; }
    .no-issues { color: #2ecc71; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Dula 质量检查报告</h1>
      <div class="meta">剧集: ${path.basename(episodeDir)}</div>
      <div class="meta">路径: ${episodeDir}</div>
      <div class="meta">时间: ${new Date().toLocaleString('zh-CN')}</div>
      <div class="status" style="background: ${statusColor}">${statusText}</div>
    </div>
    ${inspectorSections}
  </div>
</body>
</html>`;
}
