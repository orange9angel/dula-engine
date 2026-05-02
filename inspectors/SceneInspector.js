import { InspectorBase } from './InspectorBase.js';
import path from 'path';
import fs from 'fs';

/**
 * SceneInspector — D1 场景一致性检查
 *
 * 检查范围:
 * - 场景是否在 SceneRegistry 中注册
 * - 场景切换是否有过渡效果
 * - transitions.json 配置完整性
 * - 场景-主题语义匹配
 * - 场景内是否有对白
 */
export class SceneInspector extends InspectorBase {
  constructor() {
    super('SceneInspector', 'D1');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText, transitions, registeredScenes, totalDuration } = context;

    const scenes = new Set();
    const sceneEntries = new Map();
    let lastScene = null;
    const sceneTransitions = [];

    for (const entry of entries) {
      if (entry.scene) {
        scenes.add(entry.scene);
        if (!sceneEntries.has(entry.scene)) {
          sceneEntries.set(entry.scene, []);
        }
        sceneEntries.get(entry.scene).push(entry);

        if (lastScene && lastScene !== entry.scene) {
          sceneTransitions.push({ from: lastScene, to: entry.scene, time: entry.startTime, hasTransition: !!entry.transition });
        }
        lastScene = entry.scene;
      }
    }

    if (scenes.size === 0) {
      this.addIssue('warning', '剧本中没有显式声明场景', null, '使用 @SceneName 声明场景');
    }

    // Check scene registry
    for (const sceneName of scenes) {
      // Note: we can't fully check SceneRegistry without loading dula-assets,
      // but we can check against known scenes and bootstrap explicit registrations
      const knownScenes = ['RoomScene', 'ParkScene', 'SkyScene', 'StarSkyScene', 'NightRoomScene', 'NightStreetScene', 'BasketballArenaScene', 'GLTFArenaScene', 'BeachScene', 'BrightMoonScene', 'FrightZoneScene', 'WhisperingWoodsScene'];
      const isRegistered = registeredScenes.has(sceneName) || knownScenes.includes(sceneName);

      if (!isRegistered && registeredScenes.size > 0) {
        this.addIssue('error', `场景 ${sceneName} 未在 SceneRegistry 中注册`, null, `在 bootstrap.js 中注册 ${sceneName} 或使用已知场景名`, 'BUG-2');
      }

      const ents = sceneEntries.get(sceneName);
      const hasDialogue = ents.some((e) => e.character && e.text && e.text.trim());
      if (!hasDialogue) {
        this.addIssue('warning', `场景 ${sceneName} 没有角色台词`, null, '添加角色对白或考虑删除该场景');
      }
    }

    // Check scene transitions
    for (const st of sceneTransitions) {
      if (!st.hasTransition) {
        this.addIssue('info', `场景切换 ${st.from} → ${st.to} 没有转场效果`, st.time, '添加 {Transition:Fade|duration=0.5} 使切换更平滑');
      }

      // Check transitions.json
      const hasExit = transitions.exits && transitions.exits[st.from];
      const hasEntrance = transitions.entrances && transitions.entrances[st.to];

      if (!hasExit) {
        this.addIssue('warning', `场景 ${st.from} 缺少 exit 配置`, st.time, `在 transitions.json exits 中添加 ${st.from}`, 'BUG-10');
      }
      if (!hasEntrance) {
        this.addIssue('warning', `场景 ${st.to} 缺少 entrance 配置`, st.time, `在 transitions.json entrances 中添加 ${st.to}`, 'BUG-10');
      }
    }

    // Scene-theme semantic mismatch
    const allDialogue = entries.filter((e) => e.text).map((e) => e.text).join('');
    const themeKeywords = this._extractThemeKeywords(allDialogue);

    for (const sceneName of scenes) {
      const mismatch = this._checkSceneThemeMismatch(sceneName, themeKeywords);
      if (mismatch) {
        this.addIssue('warning', `场景 "${sceneName}" 与剧情主题可能不匹配: ${mismatch}`, null, '检查场景选择是否符合故事设定');
      }
    }

    // Check for entries with text but no character (BUG-1)
    for (const entry of entries) {
      if (entry.text && entry.text.trim() && !entry.character) {
        this.addIssue('warning', `Entry ${entry.line || '?'} 有对白文本但无 [Character] 标签`, entry.startTime, '添加 [Character] 标签或移除文本', 'BUG-1');
      }
    }

    // ── 场景几何元数据检查 ──
    // 检查 BeachScene 中角色位置是否在海洋范围内
    this._checkSceneGeometry(entries);
  }

  /**
   * 检查场景几何：角色位置与场景元素的包含关系
   * 这是静态检查，基于场景已知几何参数
   */
  _checkSceneGeometry(entries) {
    // BeachScene 几何参数（与 BeachScene.js 保持一致）
    const beachSceneGeometry = {
      ocean: { centerZ: -22, width: 100, depth: 35, y: 0.1 },
      sand: { centerZ: 0, width: 100, depth: 60 },
    };

    for (const entry of entries) {
      if (entry.scene !== 'BeachScene') continue;
      if (!entry.storyEvents && !entry.positionOps) continue;

      // 收集该条目中所有角色的目标位置
      const charPositions = [];

      if (entry.positionOps) {
        for (const po of entry.positionOps) {
          const z = po.options?.z;
          const y = po.options?.y ?? 0;
          if (z !== undefined) {
            charPositions.push({ character: po.character, x: po.options?.x ?? 0, y, z });
          }
        }
      }

      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.name === 'Move') {
            const z = ev.options?.z;
            const y = ev.options?.y ?? 0;
            const char = ev.options?.character;
            if (z !== undefined && char) {
              charPositions.push({ character: char, x: ev.options?.x ?? 0, y, z });
            }
          }
        }
      }

      for (const pos of charPositions) {
        const { character, z, y } = pos;
        const ocean = beachSceneGeometry.ocean;
        const oceanZMin = ocean.centerZ - ocean.depth / 2; // -39.5
        const oceanZMax = ocean.centerZ + ocean.depth / 2; // -4.5
        const isInOcean = z <= oceanZMax && z >= oceanZMin;

        // 检查台词语义与位置一致性
        const text = entry.text || '';
        const isWaterIntent = /冲进海里|海里|游泳|水中|海水|鲨鱼|游回来|救命/.test(text);

        if (isWaterIntent && !isInOcean) {
          this.addIssue('error',
            `BeachScene 中角色 ${character} 台词暗示在水中活动，但位置 z=${z} 不在海洋范围内(${oceanZMin}~${oceanZMax})，角色将站在沙滩上`,
            entry.startTime,
            `将 z 调整到 ${oceanZMax - 2} ~ ${oceanZMin + 2} 之间（建议 z=-8 ~ -20），确保角色在海水中`,
            'BUG-SCENE-GEO-WATER'
          );
        }

        // 如果角色在水中，检查 y 坐标是否合理
        if (isInOcean && y < -0.5) {
          this.addIssue('warning',
            `角色 ${character} 在 BeachScene 水中但 y=${y} 过低，可能完全沉入水下不可见`,
            entry.startTime,
            `建议 y 设为 -0.2 ~ 0.0，使角色上半身露出水面`,
            'BUG-SCENE-GEO-DEPTH'
          );
        }
      }
    }
  }

  _extractThemeKeywords(dialogue) {
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
      // 海边主题：降低阈值到1，因为"海边"是强场景指示词，出现1次就应触发
      { regex: /(海边|海滩|海洋|沙滩|浪花|海水|海里|海浪)/g, theme: '海边/海滩', minCount: 1 },
      { regex: /(森林|树林|树木|丛林|低语)/g, theme: '森林', minCount: 2 },
      { regex: /(沙漠|沙丘|荒漠)/g, theme: '沙漠', minCount: 2 },
      { regex: /(城堡|宫殿|王室|公主)/g, theme: '城堡/宫殿', minCount: 1 },
      { regex: /(军团|霍达克| Horde|邪恶|反派)/g, theme: '军团/邪恶', minCount: 1 },
      { regex: /(变身|希瑞|力量|剑)/g, theme: '变身/力量', minCount: 1 },
    ];

    for (const p of patterns) {
      const matches = dialogue.match(p.regex);
      if (matches && matches.length >= (p.minCount || 1)) {
        keywords.push(p.theme);
      }
    }
    return keywords;
  }

  _checkSceneThemeMismatch(sceneName, themeKeywords) {
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
    if (/BrightMoon|明月|城堡|宫殿|王室/i.test(sceneName)) sceneTraits.push('城堡/宫殿');
    if (/FrightZone|恐惧|军团|基地|工业/i.test(sceneName)) sceneTraits.push('工业/基地');
    if (/WhisperingWoods|森林|低语|魔法/i.test(sceneName)) sceneTraits.push('森林/魔法');

    if (sceneTraits.length === 0) return null;

    const badCombos = [
      { theme: '夜晚/星空', trait: '室内', reason: '夜晚/星空主题的故事不应主要发生在室内' },
      { theme: '夜晚/星空', trait: '户外/公园', reason: '夜晚/星空主题需要夜景场景，而非普通公园' },
      { theme: '雨天', trait: '室内', reason: '雨天主题的故事不应完全发生在室内' },
      // 海边主题：公园/草地不是海边场景
      { theme: '海边/海滩', trait: '室内', reason: '海边主题不应主要发生在室内' },
      { theme: '海边/海滩', trait: '城市街道', reason: '海边主题不应主要发生在城市街道' },
      { theme: '海边/海滩', trait: '户外/公园', reason: '海边主题需要 BeachScene/SeasideScene 等有海洋元素的场景，ParkScene 没有海' },
      { theme: '森林', trait: '室内', reason: '森林主题不应主要发生在室内' },
      { theme: '森林', trait: '城市街道', reason: '森林主题不应主要发生在城市街道' },
      { theme: '沙漠', trait: '室内', reason: '沙漠主题不应主要发生在室内' },
      { theme: '沙漠', trait: '城市街道', reason: '沙漠主题不应主要发生在城市街道' },
      { theme: '雪景/冬天', trait: '室内', reason: '雪景主题不应完全发生在室内' },
      { theme: '城堡/宫殿', trait: '户外/公园', reason: '城堡主题需要宫殿场景，而非普通公园' },
      { theme: '城堡/宫殿', trait: '工业/基地', reason: '城堡主题不应发生在工业基地' },
      { theme: '军团/邪恶', trait: '城堡/宫殿', reason: '军团主题需要阴暗基地场景' },
      { theme: '变身/力量', trait: '工业/基地', reason: '变身主题更适合魔法/自然场景' },
    ];

    for (const theme of themeKeywords) {
      for (const trait of sceneTraits) {
        const bad = badCombos.find((c) => c.theme === theme && c.trait === trait);
        if (bad) return bad.reason;
      }
    }

    return null;
  }
}
