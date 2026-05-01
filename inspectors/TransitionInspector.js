import { InspectorBase } from './InspectorBase.js';

/**
 * TransitionInspector — D11 场景过渡检测
 *
 * 检测范围:
 * - 场景切换时角色是否有退场动画（禁止直接消失/瞬移）
 * - 场景切换时角色是否有入场交代
 * - 场景切换是否有过渡效果（Fade/Wipe 等）
 * - transitions.json 配置完整性
 * - 有飞行/移动能力的角色是否利用了能力退场
 *
 * 核心原则：角色不应凭空消失或出现，场景切换需要视觉交代。
 */
export class TransitionInspector extends InspectorBase {
  constructor() {
    super('TransitionInspector', 'D11');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText, transitions } = context;

    // 构建场景序列
    const sceneSequence = this._buildSceneSequence(entries);
    if (sceneSequence.length < 2) return;

    // 每个场景中的角色集合
    const sceneChars = this._buildSceneCharacters(entries);

    // 检查每个场景切换
    for (let i = 1; i < sceneSequence.length; i++) {
      const prev = sceneSequence[i - 1];
      const curr = sceneSequence[i];
      const prevChars = sceneChars.get(prev.scene) || new Set();
      const currChars = sceneChars.get(curr.scene) || new Set();

      // 检查是否有 Transition 标签
      const hasTransition = this._hasTransitionTag(storyText, curr.scene);

      // 检查 transitions.json
      const hasExit = transitions.exits && transitions.exits[prev.scene];
      const hasEntrance = transitions.entrances && transitions.entrances[curr.scene];

      // ── D11-1: 场景切换无转场效果 ──
      if (!hasTransition) {
        this.addIssue('warning',
          `场景切换 ${prev.scene} → ${curr.scene} 缺少转场效果（如 Fade/Wipe），切换会显得突兀`,
          curr.startTime,
          `添加 {Transition:Fade|duration=1.0} 或 {Transition:Wipe|duration=0.8}`,
          'BUG-TRANS-NO-TRANSITION'
        );
      }

      // ── D11-2: 角色直接消失（无退场动画）──
      // 在场景A有台词的角色，在场景切换前是否有退场动画
      const disappearingChars = [...prevChars].filter((c) => !currChars.has(c));
      for (const char of disappearingChars) {
        const hasExitAnim = this._hasExitAnimation(entries, char, prev.scene, prev.endTime, curr.startTime);
        if (!hasExitAnim) {
          this.addIssue('error',
            `角色 ${char} 在场景 ${prev.scene} 中消失后无退场动画，直接"凭空消失"。观众不知道 ${char} 去了哪里`,
            prev.endTime,
            `添加退场动画: {Event:Move|character=${char}|x=...|z=...|duration=...} 走出屏幕，或添加 Walk/Run 动画`,
            'BUG-TRANS-VANISH'
          );
        }
      }

      // ── D11-3: 角色凭空出现（无入场交代）──
      const appearingChars = [...currChars].filter((c) => !prevChars.has(c));
      for (const char of appearingChars) {
        const hasEntrance = this._hasEntrance(entries, char, curr.scene, curr.startTime);
        if (!hasEntrance) {
          this.addIssue('error',
            `角色 ${char} 在场景 ${curr.scene} 中凭空出现（前一场景 ${prev.scene} 未出现），缺少入场交代`,
            curr.startTime,
            `添加 {Position:${char}|...} 定位，或添加 {Event:Move|character=${char}|...} 入场动画`,
            'BUG-TRANS-APPEAR'
          );
        }
      }

      // ── D11-4: 持续角色无过渡 ──
      const continuingChars = [...prevChars].filter((c) => currChars.has(c));
      for (const char of continuingChars) {
        const hasReentry = this._hasPositionInScene(entries, char, curr.scene);
        if (!hasReentry) {
          this.addIssue('warning',
            `角色 ${char} 从 ${prev.scene} 持续到 ${curr.scene}，但新场景中缺少 {Position:${char}} 重新定位`,
            curr.startTime,
            `添加 {Position:${char}|x=...|z=...|face=...} 确定 ${char} 在新场景中的位置`,
            'BUG-TRANS-NO-POS'
          );
        }
      }

      // ── D11-5: transitions.json 配置缺失 ──
      if (!hasExit) {
        this.addIssue('warning',
          `场景 ${prev.scene} 在 transitions.json 中缺少 exit 配置`,
          prev.endTime,
          `在 config/transitions.json exits 中添加 "${prev.scene}": {"x": ..., "z": ...}`,
          'BUG-TRANS-NO-EXIT-CONFIG'
        );
      }
      if (!hasEntrance) {
        this.addIssue('warning',
          `场景 ${curr.scene} 在 transitions.json 中缺少 entrance 配置`,
          curr.startTime,
          `在 config/transitions.json entrances 中添加 "${curr.scene}": {"x": ..., "z": ...}`,
          'BUG-TRANS-NO-ENTRANCE-CONFIG'
        );
      }
    }

    // ── D11-6: 有飞行能力的角色未利用飞行退场 ──
    this._checkFlyableCharacterExit(entries, storyText, sceneSequence, sceneChars);
  }

  _buildSceneSequence(entries) {
    const sequence = [];
    let currentScene = null;
    let sceneStart = null;
    let sceneEnd = null;
    let firstEntry = null;

    for (const entry of entries) {
      if (entry.scene && entry.scene !== currentScene) {
        if (currentScene) {
          sequence.push({
            scene: currentScene,
            startTime: sceneStart,
            endTime: sceneEnd,
            firstEntry,
          });
        }
        currentScene = entry.scene;
        sceneStart = entry.startTime;
        sceneEnd = entry.endTime || entry.startTime;
        firstEntry = entry;
      } else if (currentScene) {
        sceneEnd = Math.max(sceneEnd, entry.endTime || entry.startTime);
      }
    }
    if (currentScene) {
      sequence.push({
        scene: currentScene,
        startTime: sceneStart,
        endTime: sceneEnd,
        firstEntry,
      });
    }
    return sequence;
  }

  _buildSceneCharacters(entries) {
    const map = new Map(); // scene -> Set(characters)
    for (const entry of entries) {
      if (!entry.scene || !entry.character) continue;
      if (!map.has(entry.scene)) map.set(entry.scene, new Set());
      map.get(entry.scene).add(entry.character);
    }
    return map;
  }

  _hasTransitionTag(storyText, sceneName) {
    const lines = storyText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`@${sceneName}`)) {
        // 检查场景声明行及下几行是否有 Transition
        for (let j = i; j < Math.min(i + 3, lines.length); j++) {
          if (/\{Transition:[^}]+\}/.test(lines[j])) {
            return true;
          }
        }
      }
    }
    return false;
  }

  _hasExitAnimation(entries, charName, sceneName, sceneEndTime, nextSceneStartTime) {
    // 检查场景最后 5 秒内是否有该角色的退场相关动画/事件
    const windowStart = sceneEndTime - 5;
    const windowEnd = nextSceneStartTime + 1;

    for (const entry of entries) {
      if (entry.startTime < windowStart || entry.startTime > windowEnd) continue;
      if (!entry.rawText) continue;

      // 检查是否有该角色的 Move 事件（移出屏幕）
      const moveRegex = new RegExp(`\\{Event:Move\\|character=${charName}[^}]*\\}`, 'i');
      if (moveRegex.test(entry.rawText)) return true;

      // 检查是否有退场动画
      const exitAnims = /Walk|Run|Fly|Float|Leave|Exit|FadeOut|Disappear/i;
      if (entry.animations?.some((a) => exitAnims.test(a)) && entry.character === charName) return true;

      // 检查 storyEvents 中的 FadeOut/Exit
      if (entry.storyEvents?.some((e) =>
        (e.name === 'FadeOut' || e.name === 'Exit') &&
        (e.options?.character === charName || entry.character === charName)
      )) return true;
    }

    return false;
  }

  _hasEntrance(entries, charName, sceneName, sceneStartTime) {
    // 检查场景开始前后 3 秒内是否有该角色的 Position 或入场动画
    const windowStart = sceneStartTime - 2;
    const windowEnd = sceneStartTime + 5;

    for (const entry of entries) {
      if (entry.startTime < windowStart || entry.startTime > windowEnd) continue;
      if (!entry.rawText) continue;

      // Position 标签
      const posRegex = new RegExp(`\\{Position:${charName}[^}]*\\}`, 'i');
      if (posRegex.test(entry.rawText)) return true;

      // 入场 Move
      const moveRegex = new RegExp(`\\{Event:Move\\|character=${charName}[^}]*\\}`, 'i');
      if (moveRegex.test(entry.rawText)) return true;

      // 入场动画
      const entranceAnims = /Walk|Run|Fly|Float|Appear|FadeIn/i;
      if (entry.animations?.some((a) => entranceAnims.test(a)) && entry.character === charName) return true;
    }

    return false;
  }

  _hasPositionInScene(entries, charName, sceneName) {
    for (const entry of entries) {
      if (entry.scene !== sceneName) continue;
      if (!entry.rawText) continue;
      const posRegex = new RegExp(`\\{Position:${charName}[^}]*\\}`, 'i');
      if (posRegex.test(entry.rawText)) return true;
      if (entry.positionOps?.some((po) => po.character === charName || po.name === charName)) return true;
    }
    return false;
  }

  _checkFlyableCharacterExit(entries, storyText, sceneSequence, sceneChars) {
    // 已知有飞行能力的角色
    const flyableChars = ['Xingzai']; // 萤火虫有翅膀

    for (let i = 1; i < sceneSequence.length; i++) {
      const prev = sceneSequence[i - 1];
      const curr = sceneSequence[i];
      const prevChars = sceneChars.get(prev.scene) || new Set();
      const currChars = sceneChars.get(curr.scene) || new Set();

      for (const char of flyableChars) {
        if (prevChars.has(char) && !currChars.has(char)) {
          const hasExitAnim = this._hasExitAnimation(entries, char, prev.scene, prev.endTime, curr.startTime);
          if (!hasExitAnim) {
            this.addIssue('info',
              `角色 ${char} 有飞行能力，但场景切换时未使用飞行退场。可以考虑添加飞出屏幕的动画增强视觉效果`,
              prev.endTime,
              `添加 {Event:Move|character=${char}|y=10|duration=2.0} 让 ${char} 飞出屏幕，或使用 Fly/Float 动画`,
              'BUG-TRANS-FLYABLE-NOT-USED'
            );
          }
        }
      }
    }
  }
}
