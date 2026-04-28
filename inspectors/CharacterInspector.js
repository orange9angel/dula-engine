import { InspectorBase } from './InspectorBase.js';

/**
 * CharacterInspector — D2 角色检查（静态部分）
 *
 * 检查范围:
 * - 角色是否在 CharacterRegistry 中注册
 * - 多场景出现提示
 * - 单台词角色提示
 * - 角色出场时间差（场景开始后很久才出现）
 * - face 参数指向自身检测
 * - 场景切换时角色连续性（谁消失了、谁凭空出现）
 * - 新角色首次出场是否有入场动画
 */
export class CharacterInspector extends InspectorBase {
  constructor() {
    super('CharacterInspector', 'D2');
  }

  inspect(context) {
    this.reset();
    const { entries, registeredChars, voiceConfig, storyText } = context;

    const characters = new Set();
    const characterScenes = new Map();
    const sceneCharacters = new Map();

    for (const entry of entries) {
      if (entry.character) {
        characters.add(entry.character);
        if (entry.scene) {
          if (!characterScenes.has(entry.character)) {
            characterScenes.set(entry.character, new Set());
          }
          characterScenes.get(entry.character).add(entry.scene);

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
      this.addIssue('error', '剧本中没有任何角色', null, '在 .story 文件中添加角色和台词');
      return;
    }

    // Check character registry
    const knownChars = ['Doraemon', 'Nobita', 'Shizuka', 'Xiaoyue', 'Xingzai', 'RockLee'];
    for (const charName of characters) {
      const isRegistered = registeredChars.has(charName) || knownChars.includes(charName);
      if (!isRegistered && registeredChars.size > 0) {
        this.addIssue('error', `角色 ${charName} 未在 CharacterRegistry 中注册`, null, `在 bootstrap.js 中注册 ${charName}`);
      }

      // Voice config coverage
      if (Object.keys(voiceConfig).length > 0 && !voiceConfig[charName]) {
        this.addIssue('warning', `角色 ${charName} 缺少 voice_config.json 声线配置`, null, `在 config/voice_config.json 中添加 ${charName} 的声线`);
      }

      const scenes = characterScenes.get(charName);
      if (scenes && scenes.size > 1) {
        this.addIssue('info', `角色 ${charName} 出现在 ${scenes.size} 个场景中`, null, '确保场景切换时角色位置正确');
      }

      const lineCount = entries.filter((e) => e.character === charName).length;
      if (lineCount === 1) {
        this.addIssue('info', `角色 ${charName} 只有 1 句台词`, null, '考虑增加角色戏份或移除');
      }
    }

    // Check for characters appearing late in scene
    for (const [sceneName, chars] of sceneCharacters) {
      const sorted = chars.sort((a, b) => a.firstTime - b.firstTime);
      const firstChar = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const laterChar = sorted[i];
        const timeDiff = laterChar.firstTime - firstChar.firstTime;
        if (timeDiff > 3.0) {
          this.addIssue('warning', `角色 ${laterChar.char} 在场景 ${sceneName} 中 ${timeDiff.toFixed(1)}s 后才首次开口`, laterChar.firstTime, `检查 ${laterChar.char} 是否应该在场景开始时就在场`);
        }
      }
    }

    // ── 场景切换角色连续性检查 ──
    this._checkSceneTransitionContinuity(entries, storyText);

    // Check face=self (BUG-6)
    const storyLines = storyText.split('\n');
    for (let i = 0; i < storyLines.length; i++) {
      const line = storyLines[i];
      const posMatches = line.matchAll(/\{Position:([^|]+)\|([^}]+)\}/g);
      for (const m of posMatches) {
        const charName = m[1].trim();
        const options = m[2];
        const faceMatch = options.match(/face=([^|,]+)/);
        if (faceMatch) {
          const faceTarget = faceMatch[1].trim();
          if (faceTarget === charName) {
            this.addIssue('warning', `角色 ${charName} 的 face 参数指向自身`, null, `将 face=${charName} 改为 face=其他角色 或 face=center`, 'BUG-6');
          }
        }
      }
    }
  }

  /**
   * 检查场景切换时角色的连续性
   * - 哪些角色从场景A到场景B"凭空消失"（没有exit/transition）
   * - 哪些角色在场景B"凭空出现"（没有entrance/transition）
   * - 新角色首次出场是否有合理的引入
   */
  _checkSceneTransitionContinuity(entries, storyText) {
    // Build scene sequence
    const sceneSequence = [];
    let currentScene = null;
    const sceneChars = new Map(); // scene -> Set(characters)

    for (const entry of entries) {
      if (entry.scene && entry.scene !== currentScene) {
        currentScene = entry.scene;
        sceneSequence.push({
          scene: currentScene,
          startTime: entry.startTime,
          firstEntry: entry,
        });
      }
      if (entry.character && currentScene) {
        if (!sceneChars.has(currentScene)) {
          sceneChars.set(currentScene, new Set());
        }
        sceneChars.get(currentScene).add(entry.character);
      }
    }

    // Check transitions between consecutive scenes
    for (let i = 1; i < sceneSequence.length; i++) {
      const prev = sceneSequence[i - 1];
      const curr = sceneSequence[i];
      const prevChars = sceneChars.get(prev.scene) || new Set();
      const currChars = sceneChars.get(curr.scene) || new Set();

      // Characters that disappeared (in prev but not in curr)
      for (const char of prevChars) {
        if (!currChars.has(char)) {
          this.addIssue('warning', `角色 ${char} 在场景 ${prev.scene} 中出现，但在切换后的 ${curr.scene} 中消失，没有退场交代`, prev.startTime, `添加 ${char} 在 ${curr.scene} 的 Position 或添加退场动画`, 'BUG-CHAR-DISAPPEAR');
        }
      }

      // Characters that appeared out of nowhere (in curr but not in prev)
      for (const char of currChars) {
        if (!prevChars.has(char)) {
          // Check if there's any entrance animation or transition for this character
          const hasTransition = curr.firstEntry?.transition || curr.firstEntry?.rawText?.includes('Transition:');
          const hasMoveEvent = this._hasMoveEventForChar(entries, char, curr.startTime);
          const isFirstScene = i === 0;

          if (!isFirstScene && !hasTransition && !hasMoveEvent) {
            this.addIssue('error', `角色 ${char} 在场景 ${curr.scene} 中凭空出现（前一场景 ${prev.scene} 未出现），缺少入场动画或过渡`, curr.startTime, `添加 {Event:Move|character=${char}|...} 入场动画，或确保场景切换有过渡效果`, 'BUG-CHAR-APPEAR');
          }
        }
      }

      // Check if all continuing characters have position tags in the new scene
      const continuingChars = [...prevChars].filter((c) => currChars.has(c));
      // Position tags may be on the scene declaration line (@Scene) or on separate config lines
      // We need to scan the raw story text around the scene switch
      const sceneSwitchLine = this._findSceneLine(storyText, curr.scene);
      const linesAroundSwitch = storyText.split('\n').slice(Math.max(0, sceneSwitchLine - 1), sceneSwitchLine + 4);
      const rawTextAround = linesAroundSwitch.join(' ');
      for (const char of continuingChars) {
        const hasPosition = rawTextAround.includes(`Position:${char}`);
        if (!hasPosition) {
          this.addIssue('warning', `角色 ${char} 从 ${prev.scene} 切换到 ${curr.scene}，但新场景缺少 {Position:${char}|...} 定位`, curr.startTime, `添加 {Position:${char}|x=...|z=...} 确定角色位置`, 'BUG-CHAR-NO-POS');
        }
      }
    }
  }

  /**
   * 检查是否有角色的移动/入场事件
   */
  _hasMoveEventForChar(entries, charName, aroundTime) {
    const timeWindow = 2.0; // ±2 seconds
    return entries.some((e) => {
      if (Math.abs(e.startTime - aroundTime) > timeWindow) return false;
      if (!e.rawText) return false;
      // Check for Event:Move with this character
      const moveRegex = new RegExp(`\\{Event:Move\\|character=${charName}[^}]*\\}`, 'i');
      return moveRegex.test(e.rawText);
    });
  }

  /**
   * 在原始剧本文本中查找场景声明的行号
   */
  _findSceneLine(storyText, sceneName) {
    const lines = storyText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`@${sceneName}`)) {
        return i;
      }
    }
    return -1;
  }
}
