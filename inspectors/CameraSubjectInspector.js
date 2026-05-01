import { InspectorBase } from './InspectorBase.js';

/**
 * CameraSubjectInspector — D10 说话角色-相机目标匹配检测
 *
 * 检测范围:
 * - CloseUp/TrackingCloseUp 的目标角色是否等于说话角色
 * - OverShoulder 中说话角色是否被放在 shooter 位置（导致看不到脸）
 * - TwoShot 中说话角色是否在画面内
 * - ReactionShot 是否错误地用于说话角色
 * - ZoomIn 目标与说话角色一致性
 *
 * 核心原则：谁说话，镜头应该主要展示谁的脸。
 */
export class CameraSubjectInspector extends InspectorBase {
  constructor() {
    super('CameraSubjectInspector', 'D10');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText } = context;

    // 提取所有 camera 标签及其所在行
    const cameraTags = this._extractCameraTags(storyText);

    // 建立行号到 entry 的映射
    const lineToEntry = this._buildLineToEntryMap(entries, storyText);

    for (const tag of cameraTags) {
      const entry = lineToEntry.get(tag.line);
      if (!entry || !entry.character) continue;

      const speaker = entry.character;
      const { moveName, params } = tag;

      switch (moveName) {
        case 'CloseUp':
        case 'TrackingCloseUp': {
          const target = params.characterName;
          if (target && target !== speaker) {
            this.addIssue('error',
              `相机目标错误: ${speaker} 正在说话，但 ${moveName} 的目标角色是 ${target}，观众将看到 ${target} 的脸而非说话者`,
              entry.startTime,
              `将 {Camera:${moveName}|characterName=${target}} 改为 characterName=${speaker}，或改用 OverShoulder|shooter=${target}|target=${speaker}`,
              'BUG-CAM-SUBJECT-MISMATCH'
            );
          }
          break;
        }

        case 'OverShoulder': {
          const shooter = params.shooter;
          const target = params.target ?? params.subject;
          if (shooter === speaker) {
            // 说话角色是 shooter，相机在其身后，观众看不到其脸 — 这是严重错误
            if (target && target !== speaker) {
              this.addIssue('error',
                `OverShoulder 严重错误: ${speaker} 正在说话，但相机位于其身后（shooter=${speaker}），观众完全看不到 ${speaker} 的脸，只能看到 ${target} 的背影`,
                entry.startTime,
                `将 shooter 改为 ${target}、target 改为 ${speaker}，让相机从 ${speaker} 正面拍摄；或改用 CloseUp|characterName=${speaker}`,
                'BUG-CAM-SUBJECT-OS-BEHIND'
              );
            } else {
              this.addIssue('error',
                `OverShoulder 严重错误: ${speaker} 正在说话，但相机位于其身后（shooter=${speaker}），观众完全看不到说话者的脸`,
                entry.startTime,
                `将 shooter 改为听者的名字、target 改为 ${speaker}；或改用 CloseUp|characterName=${speaker}`,
                'BUG-CAM-SUBJECT-OS-BEHIND'
              );
            }
          } else if (target === speaker) {
            // 说话角色是 target，相机在其正面 — 这是正确的，无需报错
            // 但可以给一个提示
          } else if (target && shooter && target !== speaker && shooter !== speaker) {
            // shooter 和 target 都不是说话者 — 说话者完全不在画面中
            this.addIssue('error',
              `OverShoulder 严重错误: ${speaker} 正在说话，但画面中只有 ${shooter} 和 ${target}，说话者完全不在镜头内`,
              entry.startTime,
              `将 target 改为 ${speaker}，让相机对准说话者；或改用 CloseUp|characterName=${speaker}`,
              'BUG-CAM-SUBJECT-OS-MISSING'
            );
          }
          break;
        }

        case 'TwoShot': {
          const left = params.left ?? params.characterA;
          const right = params.right ?? params.characterB;
          const charsInShot = [left, right].filter(Boolean);
          if (charsInShot.length > 0 && !charsInShot.includes(speaker)) {
            this.addIssue('warning',
              `TwoShot 画面缺失: ${speaker} 正在说话，但 TwoShot 中只有 ${charsInShot.join(' 和 ')}，${speaker} 不在画面主体中`,
              entry.startTime,
              `将 ${speaker} 加入 TwoShot（如 left=${speaker}|right=${charsInShot[0]}），或改用 CloseUp|characterName=${speaker}`,
              'BUG-CAM-SUBJECT-NOT-IN-SHOT'
            );
          }
          break;
        }

        case 'ReactionShot': {
          const target = params.characterName;
          if (target === speaker) {
            this.addIssue('warning',
              `ReactionShot 误用: ${speaker} 正在说话，但使用了 ReactionShot。ReactionShot 应用于"听"的角色以展示反应，而非说话者`,
              entry.startTime,
              `将 ReactionShot 目标改为听 ${speaker} 说话的角色，或改用 CloseUp|characterName=${speaker}`,
              'BUG-CAM-SUBJECT-REACTION'
            );
          }
          break;
        }

        case 'ZoomIn': {
          const target = params.characterName;
          if (target && target !== speaker) {
            this.addIssue('info',
              `ZoomIn 目标与说话角色不一致: ${speaker} 正在说话，但 ZoomIn 目标是 ${target}。如需要展示说话者，改为 characterName=${speaker}`,
              entry.startTime,
              `确认是否故意展示 ${target}，否则改为 characterName=${speaker}`,
              'BUG-CAM-SUBJECT-ZOOM'
            );
          }
          break;
        }

        case 'FollowCharacter': {
          const target = params.characterName;
          if (target && target !== speaker) {
            this.addIssue('info',
              `FollowCharacter 跟踪非说话角色: ${speaker} 正在说话，但相机跟踪 ${target}。观众注意力会被引向 ${target}`,
              entry.startTime,
              `如需要展示说话者，改为 characterName=${speaker}，或确保 ${target} 的动作比 ${speaker} 的台词更值得关注`,
              'BUG-CAM-SUBJECT-FOLLOW'
            );
          }
          break;
        }
      }
    }
  }

  _extractCameraTags(storyText) {
    const tags = [];
    const lines = storyText.split('\n');
    const regex = /\{Camera:([^|]+)\|([^}]+)\}/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m;
      while ((m = regex.exec(line)) !== null) {
        const moveName = m[1].trim();
        const params = this._parseParams(m[2]);
        tags.push({ moveName, params, line: lineIdx + 1, raw: m[0] });
      }
    }
    return tags;
  }

  _parseParams(paramStr) {
    const params = {};
    const pairs = paramStr.split('|');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) {
        params[pair.trim()] = true;
        continue;
      }
      const key = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      params[key] = val;
    }
    return params;
  }

  _buildLineToEntryMap(entries, storyText) {
    const map = new Map();
    const lines = storyText.split('\n');

    // 为每个 entry 找到其对应的行号范围
    for (const entry of entries) {
      if (!entry.character || !entry.text) continue;
      // 在 storyText 中查找包含该角色和台词的行
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(`[${entry.character}]`) && line.includes(entry.text.substring(0, 10))) {
          map.set(i + 1, entry);
          break;
        }
      }
    }
    return map;
  }
}
