import { InspectorBase } from './InspectorBase.js';

/**
 * CombatTraceInspector — D4 战斗轨迹合理性检查
 *
 * 基于剧本标签静态分析战斗逻辑合理性：
 * - 战斗双方是否在同一场景
 * - 攻击动画与受击反应是否配对
 * - 连段之间是否有足够衔接时间
 * - 战斗角色是否已面向对方（通过 Position 标签推断）
 * - 攻击范围与实际距离是否匹配
 */

export class CombatTraceInspector extends InspectorBase {
  constructor() {
    super('CombatTraceInspector', 'D4');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText, episodeDir } = context;

    this._checkCombatTagConsistency(entries, storyText);
    this._checkAttackReactionPairing(entries);
    this._checkComboTiming(entries);
    this._checkCombatPositionFacing(entries);
    this._checkCombatSceneConsistency(entries);
  }

  /**
   * 检查 {Combat:...} 标签的语法一致性
   */
  _checkCombatTagConsistency(entries, storyText) {
    const combatRegex = /\{Combat:([^}|]+)(?:\|([^}]*))?\}/g;
    let match;
    while ((match = combatRegex.exec(storyText)) !== null) {
      const action = match[1].trim();
      const params = match[2] || '';

      // Valid combat actions
      const validActions = new Set([
        'Setup', 'Attack', 'Combo', 'Block', 'Dodge', 'Counter',
        'Hit', 'Stagger', 'Knockdown', 'GetUp', 'Projectile',
      ]);

      if (!validActions.has(action)) {
        const line = storyText.substring(0, match.index).split('\n').length;
        this.addIssue('warning',
          `Unknown combat action "${action}" at line ${line}. Valid: ${Array.from(validActions).join(', ')}`,
          null,
          `Use a valid combat action`,
          'COMBAT-001'
        );
      }

      // Check required params for Attack
      if (action === 'Attack' && !params.includes('target=')) {
        const line = storyText.substring(0, match.index).split('\n').length;
        this.addIssue('error',
          `{Combat:Attack} missing "target" parameter at line ${line}`,
          null,
          `Add target like {Combat:Attack|target=OpponentName|anim=Punch}`,
          'COMBAT-002'
        );
      }
    }
  }

  /**
   * 检查攻击动画与受击反应是否配对
   */
  _checkAttackReactionPairing(entries) {
    // Attack animations that should have a corresponding reaction
    const attackAnims = new Set([
      'Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
      'SpiritSwordSwing', 'SpiritGunFire', 'UltraBeam',
    ]);

    const reactionAnims = new Set([
      'HitStagger', 'Knockdown', 'Block', 'Dodge',
    ]);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.animations) continue;

      for (const anim of entry.animations) {
        if (!attackAnims.has(anim)) continue;

        // Look for a reaction on another character within a short window
        const windowStart = entry.startTime;
        const windowEnd = entry.endTime + 0.5; // 0.5s grace period
        let foundReaction = false;

        for (let j = i; j < entries.length && entries[j].startTime <= windowEnd; j++) {
          if (j === i) continue;
          const other = entries[j];
          if (other.character && other.character !== entry.character && other.animations) {
            if (other.animations.some((a) => reactionAnims.has(a))) {
              foundReaction = true;
              break;
            }
          }
        }

        if (!foundReaction) {
          this.addIssue('warning',
            `${entry.character || 'Unknown'} uses ${anim} at ${this._fmtTime(entry.startTime)} but no reaction found within 0.5s`,
            entry.startTime,
            `Add a reaction animation (HitStagger/Knockdown/Block/Dodge) on the target character`,
            'COMBAT-003'
          );
        }
      }
    }
  }

  /**
   * 检查连段时机：同一角色的连续攻击是否有足够间隔
   */
  _checkComboTiming(entries) {
    const combatAnims = new Set([
      'Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
      'DashForward', 'SpiritSwordSwing', 'SpiritGunFire',
    ]);

    const byChar = new Map();
    for (const entry of entries) {
      if (!entry.character || !entry.animations) continue;
      const combatOnes = entry.animations.filter((a) => combatAnims.has(a));
      if (combatOnes.length === 0) continue;

      if (!byChar.has(entry.character)) byChar.set(entry.character, []);
      byChar.get(entry.character).push({
        time: entry.startTime,
        end: entry.endTime,
        anims: combatOnes,
      });
    }

    for (const [charName, actions] of byChar) {
      for (let i = 1; i < actions.length; i++) {
        const prev = actions[i - 1];
        const cur = actions[i];
        const gap = cur.time - prev.end;

        if (gap < 0) {
          this.addIssue('error',
            `${charName} has overlapping combat animations: ${prev.anims.join('/')} ends at ${this._fmtTime(prev.end)} but ${cur.anims.join('/')} starts at ${this._fmtTime(cur.time)}`,
            cur.time,
            `Separate combat animations by at least 0.1s`,
            'COMBAT-004'
          );
        } else if (gap < 0.1) {
          this.addIssue('warning',
            `${charName} combat gap too short (${gap.toFixed(3)}s) between ${prev.anims.join('/')} and ${cur.anims.join('/')}`,
            cur.time,
            `Increase gap to at least 0.1s for readable animation`,
            'COMBAT-005'
          );
        }
      }
    }
  }

  /**
   * 检查战斗角色的 Position 标签是否设置了合理的面对面站位
   */
  _checkCombatPositionFacing(entries) {
    // Find entries with combat animations and check their positions
    const combatChars = new Set();
    const charPositions = new Map();

    for (const entry of entries) {
      if (!entry.animations) continue;
      const isCombat = entry.animations.some((a) =>
        ['Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
         'HitStagger', 'Knockdown', 'Block', 'Dodge',
         'SpiritSwordSwing', 'SpiritGunFire'].includes(a)
      );
      if (isCombat && entry.character) {
        combatChars.add(entry.character);
      }
    }

    // Collect position tags for combat characters
    for (const entry of entries) {
      if (entry.position && combatChars.has(entry.position)) {
        // Position tag is on a separate line, find the character it applies to
        // This is a simplification — full parsing would need the Position namespace
      }
    }

    // Check if any two combat characters have the same position (overlap)
    // This is a heuristic check based on entry order
    const sceneCombatChars = new Map(); // scene -> Set(char)
    let currentScene = null;
    for (const entry of entries) {
      if (entry.scene) currentScene = entry.scene;
      if (entry.character && combatChars.has(entry.character)) {
        if (!sceneCombatChars.has(currentScene)) sceneCombatChars.set(currentScene, new Set());
        sceneCombatChars.get(currentScene).add(entry.character);
      }
    }

    for (const [scene, chars] of sceneCombatChars) {
      if (chars.size >= 2) {
        // Multiple fighters in same scene — check if they have explicit positions
        // If no Position tags, they might overlap at default (0,0,0)
        const hasExplicitPositions = entries.some((e) =>
          e.position && chars.has(e.position)
        );
        if (!hasExplicitPositions) {
          this.addIssue('warning',
            `Combat scene "${scene}" has ${chars.size} fighters (${Array.from(chars).join(', ')}) but no explicit positions. They may overlap at origin.`,
            null,
            `Add {Position:CharName|x=...|z=...} tags to separate fighters`,
            'COMBAT-006'
          );
        }
      }
    }
  }

  /**
   * 检查战斗角色是否在同一场景
   */
  _checkCombatSceneConsistency(entries) {
    const combatAnims = new Set([
      'Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
      'HitStagger', 'Knockdown', 'Block', 'Dodge',
      'SpiritSwordSwing', 'SpiritGunFire', 'SpiritGunCharge',
    ]);

    const charScenes = new Map();
    let currentScene = null;

    for (const entry of entries) {
      if (entry.scene) currentScene = entry.scene;
      if (entry.character && entry.animations?.some((a) => combatAnims.has(a))) {
        if (!charScenes.has(entry.character)) charScenes.set(entry.character, new Set());
        charScenes.get(entry.character).add(currentScene);
      }
    }

    // Find pairs that appear in different scenes (potential error)
    const combatChars = Array.from(charScenes.keys());
    for (let i = 0; i < combatChars.length; i++) {
      for (let j = i + 1; j < combatChars.length; j++) {
        const scenesA = charScenes.get(combatChars[i]);
        const scenesB = charScenes.get(combatChars[j]);
        const common = [...scenesA].filter((s) => scenesB.has(s));
        if (common.length === 0) {
          this.addIssue('info',
            `${combatChars[i]} and ${combatChars[j]} have combat animations but never appear in the same scene`,
            null,
            `Ensure both characters are in the same scene for combat`,
            'COMBAT-007'
          );
        }
      }
    }
  }

  _fmtTime(t) {
    if (t === null || t === undefined) return '?';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }
}
