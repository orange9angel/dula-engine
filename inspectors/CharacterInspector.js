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
 */
export class CharacterInspector extends InspectorBase {
  constructor() {
    super('CharacterInspector', 'D2');
  }

  inspect(context) {
    this.reset();
    const { entries, registeredChars, voiceConfig } = context;

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

    // Check face=self (BUG-6)
    const storyLines = context.storyText.split('\n');
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
}
