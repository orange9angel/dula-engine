import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * NarrativeInspector — D5/D6 叙事一致性检查
 *
 * 检查范围:
 * - 台词提及道具但无 Prop 标签
 * - 环境描述与场景效果不匹配
 * - Prop 标签孤立检测
 * - 动画-角色道具匹配
 * - 动作目标一致性
 */
export class NarrativeInspector extends InspectorBase {
  constructor() {
    super('NarrativeInspector', 'D5/D6');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText, episodeDir } = context;

    this._checkPropMentions(entries, storyText, episodeDir);
    this._checkEnvironmentConsistency(entries);
    this._checkOrphanedProps(storyText);
    this._checkAnimPropRequirements(entries, episodeDir);
    this._checkActionTargets(entries);
    this._checkActionReasonability(entries, storyText);
    // this._checkNoLazyShortcuts(entries, storyText);  // TODO: implement
  }

  _checkPropMentions(entries, storyText, episodeDir) {
    const propKeywords = [
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
      { regex: /竹蜻蜓/, name: '竹蜻蜓', propType: 'takecopter', severity: 'info' },
    ];

    // Collect all Prop tags
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

    for (const entry of entries) {
      if (!entry.text) continue;
      const text = entry.text;

      for (const pk of propKeywords) {
        if (pk.regex.test(text)) {
          const hasPropTag = entry.propOps?.some((po) => {
            const typeMatch = pk.propType && po.name.toLowerCase() === pk.propType;
            const charMatch = po.options.character === entry.character;
            return typeMatch && charMatch;
          });

          const sceneHasBuiltInProp = this._checkSceneHasBuiltInProp(entry.scene, pk.propType, episodeDir);

          if (!hasPropTag && !sceneHasBuiltInProp) {
            this.addIssue(pk.severity, `台词提及"${pk.name}"但场景中无对应道具: "${text}"`, entry.startTime, `添加 {Prop:${pk.propType}|character=${entry.character}}`);
          }
        }
      }
    }
  }

  _checkEnvironmentConsistency(entries) {
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
          const hasEvent = entry.storyEvents?.some((ev) => {
            const evName = ev.name.toLowerCase();
            return evName.includes(ek.sceneEffect) || evName.includes('weather');
          });

          const sceneImpliesEffect = entry.scene?.toLowerCase().includes(ek.sceneEffect);

          if (!hasEvent && !sceneImpliesEffect) {
            this.addIssue(ek.severity, `台词提及"${ek.name}"但场景无对应效果: "${text}"`, entry.startTime, `添加 {Event:SetWeather|type=${ek.sceneEffect}} 或修改场景`);
          }
        }
      }
    }
  }

  _checkOrphanedProps(storyText) {
    const storyLines = storyText.split('\n');
    for (let i = 0; i < storyLines.length; i++) {
      const line = storyLines[i].trim();
      if (!line) continue;

      const propMatch = line.match(/\{Prop:([^}]+)\}/);
      if (propMatch) {
        const hasCharacter = line.match(/\[\w+\]/);
        if (!hasCharacter) {
          this.addIssue('error', `Prop 标签 "${propMatch[0]}" 放在没有角色的孤立行上，引擎会忽略它`, null, '将 Prop 标签移到 [Character] 行内');
        }
      }
    }
  }

  _checkAnimPropRequirements(entries, episodeDir) {
    const animPropRequirements = {
      'XingzaiFloat': { prop: 'takeCopter', method: 'attachTakeCopter', chars: ['Xingzai'] },
      'Float': { prop: 'takeCopter', method: 'attachTakeCopter', chars: ['Xingzai'] },
    };

    const charsDir = path.join(episodeDir, 'characters');
    const assetsCharsDir = path.resolve(episodeDir, '..', '..', '..', 'dula-assets', 'characters');

    for (const entry of entries) {
      if (!entry.animations || !entry.character) continue;
      for (const animName of entry.animations) {
        const req = animPropRequirements[animName];
        if (!req) continue;

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
          this.addIssue('error', `动画 "${animName}" 需要角色 ${entry.character} 支持 ${req.method}()，但该角色未实现此方法`, entry.startTime, `在 ${entry.character}.js 中添加 ${req.method}() 或更换动画`);
        }
      }
    }
  }

  _checkActionTargets(entries) {
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
          const nearbyEntries = entries.filter((e) => {
            if (e === entry || !e.character || e.character === entry.character) return false;
            const timeDiff = Math.abs(e.startTime - entry.startTime);
            return timeDiff < 3.0;
          });

          if (nearbyEntries.length === 0) {
            this.addIssue(at.severity, `台词包含"${at.name}"但附近无其他角色作为目标: "${text}"`, entry.startTime, '确保目标角色在场，或添加 {Position:...} 让角色进入场景');
          }
        }
      }
    }
  }

  _checkSceneHasBuiltInProp(sceneName, propType, episodeDir) {
    if (!sceneName || !propType) return false;

    const scenesDir = path.join(episodeDir, 'scenes');
    if (!fs.existsSync(scenesDir)) return false;

    const sceneFile = path.join(scenesDir, `${sceneName}.js`);
    let sceneText = '';

    if (fs.existsSync(sceneFile)) {
      sceneText = fs.readFileSync(sceneFile, 'utf-8');
    } else {
      const assetsScenesDir = path.resolve(episodeDir, '..', '..', '..', 'dula-assets', 'scenes');
      const assetsSceneFile = path.join(assetsScenesDir, `${sceneName}.js`);
      if (!fs.existsSync(assetsSceneFile)) return false;
      sceneText = fs.readFileSync(assetsSceneFile, 'utf-8');
    }

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

  _checkActionReasonability(entries, storyText) {
    // 1. 检查"凭空消失"：角色在场景A有台词/动作，场景B无退场动画且无 Position
    const charSceneHistory = new Map(); // char -> [{ scene, entry, hasExit }]
    
    for (const entry of entries) {
      if (!entry.character || !entry.scene) continue;
      
      if (!charSceneHistory.has(entry.character)) {
        charSceneHistory.set(entry.character, []);
      }
      const history = charSceneHistory.get(entry.character);
      
      // 检查是否有退场相关事件/动画
      const hasExitAnim = entry.animations?.some((a) => 
        /walk|run|leave|exit|fade|move/i.test(a)
      );
      const hasExitEvent = entry.storyEvents?.some((e) => 
        e.name === 'Move' || e.name === 'FadeOut' || e.name === 'Exit'
      );
      
      history.push({
        scene: entry.scene,
        entry,
        hasExit: hasExitAnim || hasExitEvent,
      });
    }

    // 检查场景切换时的角色连续性
    for (const [char, history] of charSceneHistory) {
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        
        // 场景变化且无前一个场景的退场
        if (prev.scene !== curr.scene && !prev.hasExit) {
          // 检查新场景中是否有任何条目包含该角色的 Position 标签（重新入场）
          const sceneEntries = entries.filter((e) => e.scene === curr.scene);
          const positionRegex = new RegExp(`Position:${char}`, 'i');
          const hasReentry = sceneEntries.some((e) => 
            e.positionOps?.some((po) => po.character === char) ||
            (e.rawText && positionRegex.test(e.rawText))
          );
          
          // 也检查 storyText 全局（捕获未被 parse 的纯标签行）
          const hasReentryGlobal = hasReentry || positionRegex.test(storyText);
          
          if (!hasReentryGlobal) {
            this.addIssue('warning',
              `角色 ${char} 从 ${prev.scene} 切换到 ${curr.scene} 时无退场动画，在新场景也无 Position 重新入场，可能"凭空消失"`,
              curr.entry.startTime,
              `在 ${prev.scene} 的最后一条目添加退场动画（如 {Walk} 或 {Event:Move}），或在 ${curr.scene} 第一条目添加 {Position:${char}}`,
              'BUG-NARR-VANISH'
            );
          }
        }
      }
    }

    // 2. 检查"冲进海里"等移动描述但无 Event:Move
    const moveKeywords = [
      { regex: /冲进|冲进海里|跑向|冲向|飞向|跳向/, action: '移动', needsEvent: 'Event:Move' },
      { regex: /逃走|逃跑|跑开|跑走/, action: '逃跑', needsEvent: 'Event:Move' },
      { regex: /游向|游过去|游回来/, action: '游动', needsEvent: 'Event:Move' },
    ];

    for (const entry of entries) {
      if (!entry.text) continue;
      for (const mk of moveKeywords) {
        if (mk.regex.test(entry.text)) {
          const hasMoveEvent = entry.storyEvents?.some((e) => e.name === 'Move') ||
            entry.rawText?.includes('Event:Move');
          if (!hasMoveEvent) {
            this.addIssue('warning',
              `台词描述"${mk.action}"但无 ${mk.needsEvent} 事件: "${entry.text}"`,
              entry.startTime,
              `添加 {${mk.needsEvent}|character=${entry.character}|x=...|z=...|duration=...} 让角色实际移动`,
              'BUG-NARR-NO-MOVE'
            );
          }
        }
      }
    }

    // 3. 检查静态姿势代替动态动作
    const poseVsAction = [
      { pose: 'FlyPose', desc: '飞行/飞起', needs: 'Float 动画或 Event:Move' },
      { pose: 'Stand', desc: '走动', needs: 'Walk 动画' },
    ];
    for (const entry of entries) {
      if (!entry.animations) continue;
      for (const anim of entry.animations) {
        const mismatch = poseVsAction.find((p) => p.pose === anim);
        if (mismatch) {
          const text = entry.text || '';
          const hasMove = /飞|飞起|飞起来|走|走过去|走过来/.test(text);
          if (hasMove) {
            this.addIssue('info',
              `动画 "${anim}" 是静态姿势，但台词描述"${mismatch.desc}"，可能需要 ${mismatch.needs}`,
              entry.startTime,
              `考虑添加 ${mismatch.needs}`
            );
          }
        }
      }
    }
  }
}
