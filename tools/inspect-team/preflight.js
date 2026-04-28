/**
 * Pre-flight Checklist — 起飞前检查单
 *
 * 在开始正式质检前，先检查 episode 的资产完整性。
 * 防止"偷懒"：确保场景、角色、动画、配乐、配音等都已配置。
 */

import fs from 'fs';
import path from 'path';

/**
 * 运行起飞前检查
 * @param {InspectionContext} context
 * @returns {Object} { passed: boolean, issues: [], checklist: [] }
 */
export function runPreflight(context) {
  const issues = [];
  const checklist = [];

  const { entries, storyText, episodeDir, configDir, audioDir } = context;

  // ── 1. 场景检查 ──
  const scenes = new Set();
  const sceneMatches = storyText.matchAll(/^@(\w+)/gm);
  for (const m of sceneMatches) scenes.add(m[1]);

  const knownScenes = ['RoomScene', 'ParkScene', 'SkyScene', 'StarSkyScene', 'NightRoomScene', 'NightStreetScene', 'BasketballArenaScene', 'GLTFArenaScene', 'BeachScene'];
  const customScenesDir = path.join(episodeDir, 'scenes');

  for (const scene of scenes) {
    const hasCustomScene = fs.existsSync(path.join(customScenesDir, `${scene}.js`));
    const isKnown = knownScenes.includes(scene);
    const status = hasCustomScene || isKnown ? '✅' : '❌';
    checklist.push({ category: '场景', item: scene, status, detail: hasCustomScene ? '自定义场景' : isKnown ? '官方场景' : '未找到' });

    if (!hasCustomScene && !isKnown) {
      issues.push({ severity: 'error', message: `场景 "${scene}" 未找到 — 既非官方场景，也无自定义文件`, fix: `在 scenes/${scene}.js 创建场景，或改用已知场景: ${knownScenes.join(', ')}` });
    }
  }

  if (scenes.size === 0) {
    checklist.push({ category: '场景', item: '(无)', status: '⚠️', detail: '剧本未声明任何场景' });
    issues.push({ severity: 'warning', message: '剧本未声明任何场景', fix: '使用 @RoomScene 等声明场景' });
  }

  // ── 2. 角色检查 ──
  const characters = new Set();
  const charMatches = storyText.matchAll(/^\[([A-Z][a-zA-Z0-9_]*)\]/gm);
  for (const m of charMatches) characters.add(m[1]);

  const knownChars = ['Doraemon', 'Nobita', 'Shizuka', 'Xiaoyue', 'Xingzai', 'RockLee'];
  const customCharsDir = path.join(episodeDir, 'characters');

  for (const char of characters) {
    const hasCustomChar = fs.existsSync(path.join(customCharsDir, `${char}.js`));
    const isKnown = knownChars.includes(char);
    const status = hasCustomChar || isKnown ? '✅' : '❌';
    checklist.push({ category: '角色', item: char, status, detail: hasCustomChar ? '自定义角色' : isKnown ? '官方角色' : '未找到' });

    if (!hasCustomChar && !isKnown) {
      issues.push({ severity: 'error', message: `角色 "${char}" 未找到 — 既非官方角色，也无自定义文件`, fix: `在 characters/${char}.js 创建角色，或改用已知角色: ${knownChars.join(', ')}` });
    }
  }

  if (characters.size === 0) {
    checklist.push({ category: '角色', item: '(无)', status: '⚠️', detail: '剧本未声明任何角色' });
    issues.push({ severity: 'error', message: '剧本未声明任何角色', fix: '使用 [Character] 标签声明角色' });
  }

  // ── 3. 动画检查 ──
  const usedAnims = new Set();
  const animRegex = /\{([A-Z][a-zA-Z0-9]+)\}/g;
  const namespaces = ['Camera', 'Music', 'Ball', 'Prop', 'Position', 'SFX', 'Transition', 'Event', 'Dunk'];
  let m;
  while ((m = animRegex.exec(storyText)) !== null) {
    if (!namespaces.includes(m[1])) usedAnims.add(m[1]);
  }
  const nsAnimRegex = /\{Animation:([^}]+)\}/g;
  while ((m = nsAnimRegex.exec(storyText)) !== null) {
    usedAnims.add(m[1]);
  }

  const knownAnims = new Set(['Walk', 'Run', 'WaveHand', 'Jump', 'StompFoot', 'SwayBody', 'Nod', 'ShakeHead', 'TurnToCamera', 'SwingRacket', 'Bow', 'LookAround', 'PointForward', 'ScratchHead', 'HandsOnHips', 'ClapHands', 'Celebrate', 'Shrug', 'SurprisedJump', 'Tremble', 'Think', 'SitDown', 'CrossArms', 'FlailArms', 'LookUp', 'ReachOut', 'PullOutRacket', 'TakeOutFromPocket', 'Spin', 'PanicSpin', 'NoseBlink', 'Float', 'WaddleWalk', 'ReachHand', 'Cry', 'LazyStretch', 'Grovel', 'StudyDespair', 'TriumphPose', 'RunAway', 'CrashLand', 'FallPanic', 'FlyPose', 'Curtsy', 'Giggle', 'PlayViolin', 'Scold', 'Blush', 'Baking', 'LookUpSky', 'WaveUp', 'TandemFlight']);
  const customAnimsDir = path.join(episodeDir, 'animations');

  for (const anim of usedAnims) {
    const hasCustomAnim = fs.existsSync(path.join(customAnimsDir, `${anim}.js`));
    const isKnown = knownAnims.has(anim);
    const status = hasCustomAnim || isKnown ? '✅' : '❌';
    checklist.push({ category: '动画', item: anim, status, detail: hasCustomAnim ? '自定义动画' : isKnown ? '官方动画' : '未注册' });

    if (!hasCustomAnim && !isKnown) {
      issues.push({ severity: 'error', message: `动画 "${anim}" 未注册`, fix: `在 animations/${anim}.js 创建动画，或改用已知动画` });
    }
  }

  // ── 4. 配音检查 ──
  const voiceConfigPath = path.join(configDir, 'voice_config.json');
  const hasVoiceConfig = fs.existsSync(voiceConfigPath);
  checklist.push({ category: '配置', item: 'voice_config.json', status: hasVoiceConfig ? '✅' : '❌', detail: hasVoiceConfig ? '已配置' : '缺失' });

  if (!hasVoiceConfig) {
    issues.push({ severity: 'warning', message: '缺少 voice_config.json', fix: '创建 config/voice_config.json 配置角色声线' });
  } else {
    const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
    for (const char of characters) {
      if (!voiceConfig[char]) {
        checklist.push({ category: '配音', item: char, status: '❌', detail: '未配置声线' });
        issues.push({ severity: 'warning', message: `角色 ${char} 缺少声线配置`, fix: `在 voice_config.json 中添加 ${char} 的 TTS 声线` });
      } else {
        checklist.push({ category: '配音', item: char, status: '✅', detail: voiceConfig[char].voice || '已配置' });
      }
    }
  }

  // ── 5. BGM 检查 ──
  const bgmMatches = storyText.matchAll(/\{Music:Play\|([^}]+)\}/g);
  const bgmList = [];
  for (const m of bgmMatches) {
    const nameMatch = m[1].match(/name=([^|]+)/);
    if (nameMatch) bgmList.push(nameMatch[1]);
  }

  const materialsBgmDir = path.join(episodeDir, 'materials', 'bgm');
  const generatedBgmDir = path.join(audioDir, 'music');

  for (const bgm of bgmList) {
    const hasManual = fs.existsSync(materialsBgmDir) && fs.readdirSync(materialsBgmDir).some((f) => f.includes(bgm));
    const hasGenerated = fs.existsSync(generatedBgmDir) && fs.readdirSync(generatedBgmDir).some((f) => f.includes(bgm));
    const status = hasManual || hasGenerated ? '✅' : '⚠️';
    checklist.push({ category: 'BGM', item: bgm, status, detail: hasManual ? '手动素材' : hasGenerated ? '已生成' : '将使用 procedural 回退' });
  }

  if (bgmList.length === 0) {
    checklist.push({ category: 'BGM', item: '(无)', status: '⚠️', detail: '剧本未配置 BGM' });
    issues.push({ severity: 'info', message: '剧本未配置 BGM', fix: '添加 {Music:Play|name=xxx|fadeIn=1.0} 配置背景音乐' });
  }

  // ── 6. 过渡配置检查 ──
  const transitionsPath = path.join(configDir, 'transitions.json');
  const hasTransitions = fs.existsSync(transitionsPath);
  checklist.push({ category: '配置', item: 'transitions.json', status: hasTransitions ? '✅' : '❌', detail: hasTransitions ? '已配置' : '缺失' });

  if (!hasTransitions && scenes.size > 1) {
    issues.push({ severity: 'warning', message: '多场景剧本缺少 transitions.json', fix: '创建 config/transitions.json 配置场景切换坐标' });
  }

  // ── 7. bootstrap.js 检查 ──
  const bootstrapPath = path.join(episodeDir, 'bootstrap.js');
  const hasBootstrap = fs.existsSync(bootstrapPath);
  checklist.push({ category: '配置', item: 'bootstrap.js', status: hasBootstrap ? '✅' : '❌', detail: hasBootstrap ? '已配置' : '缺失' });

  if (!hasBootstrap) {
    issues.push({ severity: 'error', message: '缺少 bootstrap.js', fix: '创建 bootstrap.js 注册资产' });
  }

  // ── 8. 综合评分 ──
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    passed: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    checklist,
    summary: {
      scenes: scenes.size,
      characters: characters.size,
      animations: usedAnims.size,
      bgm: bgmList.length,
    },
  };
}
