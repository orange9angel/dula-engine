import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * CombatTraceInspector — D4 战斗轨迹合理性检查
 *
 * 基于剧本标签静态分析 + combat_trace 运行时数据：
 * - 战斗双方是否在同一场景
 * - 攻击动画与受击反应是否配对
 * - 连段之间是否有足够衔接时间
 * - 战斗角色是否已面向对方（通过 Position 标签推断 + 运行时 facing 数据）
 * - 攻击范围与实际距离是否匹配（利用 combat_trace 命中数据）
 * - 打击距离合理性：preContactDistance vs profile.range
 * - 角色说话时朝向合理性：对话期间是否面向对手/镜头
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
    this._checkCombatPositionFacing(entries, context);
    this._checkCombatSceneConsistency(entries);

    // 利用 combat_trace 运行时数据进行深度检查
    const combatTrace = this._loadCombatTrace(episodeDir);
    if (combatTrace) {
      this._checkHitDistance合理性(combatTrace);
      this._checkFacingAtHit(combatTrace);
      this._checkDialogueFacing(entries, context);
      this._checkCombatTrajectorySmoothness(combatTrace);
    }
  }

  _loadCombatTrace(episodeDir) {
    if (!episodeDir) return null;
    const tracePath = path.join(episodeDir, 'storyboard', 'combat_trace', 'combat_trace.json');
    if (!fs.existsSync(tracePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
    } catch {
      return null;
    }
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

      const validActions = new Set([
        'Setup', 'Attack', 'Combo', 'Block', 'Dodge', 'Counter',
        'Hit', 'Stagger', 'Knockdown', 'GetUp', 'Projectile',
        'BulletTime', 'Emotion', 'Override', 'Staging',
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

        const windowStart = entry.startTime;
        const windowEnd = entry.endTime + 0.5;
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
   * 检查连段时机
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
   * 增强版：检查战斗角色的 Position 标签是否设置了合理的面对面站位
   * 新增：实际距离计算、朝向验证
   */
  _checkCombatPositionFacing(entries, context) {
    const charPositionTimeline = this._buildCharPositionTimeline(entries, context);

    const combatEntries = [];
    const combatAnims = new Set([
      'Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
      'SpiritSwordSwing', 'SpiritGunFire', 'DashForward',
      'HitStagger', 'Knockdown', 'Block', 'Dodge'
    ]);

    for (const entry of entries) {
      if (!entry.animations) continue;
      const hasCombat = entry.animations.some((a) => combatAnims.has(a));
      if (hasCombat && entry.character) {
        combatEntries.push(entry);
      }
    }

    for (const entry of combatEntries) {
      const char = entry.character;
      const pos = this._getCharPositionAtTime(charPositionTimeline, entry.startTime, char);
      if (!pos) continue;

      const opponents = this._findOpponentsInWindow(entries, char, entry.startTime, entry.endTime);
      for (const opp of opponents) {
        const oppPos = this._getCharPositionAtTime(charPositionTimeline, entry.startTime, opp);
        if (!oppPos) continue;

        const dx = pos.x - oppPos.x;
        const dz = pos.z - oppPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        const isMelee = entry.animations?.some((a) =>
          ['Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack', 'SpiritSwordSwing'].includes(a)
        );
        if (isMelee) {
          if (distance > 4.0) {
            this.addIssue('warning',
              `${char} 使用近战攻击时与 ${opp} 距离过远（${distance.toFixed(2)}m），超出合理近战范围（<=3m）。观众可能感觉攻击"隔空命中"`,
              entry.startTime,
              `缩短 ${char} 与 ${opp} 的间距至 1.5~3m，或在攻击前添加 DashForward/Move 接近对手`,
              'COMBAT-DIST-001'
            );
          } else if (distance < 0.8) {
            this.addIssue('warning',
              `${char} 与 ${opp} 距离过近（${distance.toFixed(2)}m），角色模型可能穿模`,
              entry.startTime,
              `拉开间距至至少 1.0m`,
              'COMBAT-DIST-002'
            );
          }
        }

        const faceDir = this._resolveFaceDirection(pos.face, pos, oppPos);
        const toOpp = { x: oppPos.x - pos.x, z: oppPos.z - pos.z };
        const toOppLen = Math.sqrt(toOpp.x * toOpp.x + toOpp.z * toOpp.z);
        if (toOppLen > 0.001) {
          toOpp.x /= toOppLen;
          toOpp.z /= toOppLen;
          const dot = faceDir.x * toOpp.x + faceDir.z * toOpp.z;
          if (dot < 0.5) {
            this.addIssue('warning',
              `${char} 在战斗时未面向对手 ${opp}（夹角约 ${Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI | 0}度）。战斗中角色应始终面向对手`,
              entry.startTime,
              `设置 {Position:${char}|face=${opp}} 或调整 face 方向使其面向对手`,
              'COMBAT-FACE-001'
            );
          }
        }
      }
    }

    const sceneCombatChars = new Map();
    let currentScene = null;
    for (const entry of entries) {
      if (entry.scene) currentScene = entry.scene;
      if (entry.character && combatEntries.some((e) => e.character === entry.character)) {
        if (!sceneCombatChars.has(currentScene)) sceneCombatChars.set(currentScene, new Set());
        sceneCombatChars.get(currentScene).add(entry.character);
      }
    }

    for (const [scene, chars] of sceneCombatChars) {
      if (chars.size >= 2) {
        const hasExplicitPositions = entries.some((e) =>
          e.positions?.some((p) => chars.has(p.name || p.character)) ||
          (e.rawText && Array.from(chars).some((c) => e.rawText.includes(`Position:${c}`)))
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

  _buildCharPositionTimeline(entries, context) {
    const timeline = [];
    let currentPositions = {};

    // Load choreography.json initial positions if available
    if (context && context.choreography && context.choreography.placements) {
      for (const p of context.choreography.placements) {
        currentPositions[p.character] = {
          x: p.x ?? 0,
          z: p.z ?? 0,
          y: p.y ?? 0,
          face: p.face ?? 'forward',
        };
      }
    }

    for (const entry of entries) {
      const posList = entry.positions || entry.positionOps;
      if (posList && posList.length > 0) {
        for (const pos of posList) {
          const charName = pos.name || pos.character;
          if (charName) {
            const opts = pos.options || {};
            currentPositions[charName] = {
              x: opts.x ?? 0,
              z: opts.z ?? 0,
              y: opts.y ?? 0,
              face: opts.face ?? 'forward',
            };
          }
        }
      }

      if (entry.rawText) {
        const posRegex = /\{Position:([^|}]+)\|([^}]+)\}/g;
        let m;
        while ((m = posRegex.exec(entry.rawText)) !== null) {
          const charName = m[1];
          const optsStr = m[2];
          const xMatch = optsStr.match(/x=([-\d.]+)/);
          const zMatch = optsStr.match(/z=([-\d.]+)/);
          const faceMatch = optsStr.match(/face=([^|}]+)/);
          currentPositions[charName] = {
            x: xMatch ? parseFloat(xMatch[1]) : 0,
            z: zMatch ? parseFloat(zMatch[1]) : 0,
            face: faceMatch ? faceMatch[1].trim() : 'forward',
          };
        }
      }

      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.name === 'Move' && ev.options?.character) {
            const charName = ev.options.character;
            const x = ev.options.x ?? currentPositions[charName]?.x ?? 0;
            const z = ev.options.z ?? currentPositions[charName]?.z ?? 0;
            currentPositions[charName] = {
              ...currentPositions[charName],
              x, z,
            };
          }
        }
      }

      timeline.push({
        time: entry.startTime,
        positions: { ...currentPositions },
      });
    }

    return timeline;
  }

  _getCharPositionAtTime(timeline, time, charName) {
    let best = null;
    for (const record of timeline) {
      if (record.time <= time + 0.1) {
        best = record;
      }
    }
    if (!best) return null;
    return best.positions[charName] || null;
  }

  _findOpponentsInWindow(entries, charName, startTime, endTime) {
    const opponents = new Set();
    for (const entry of entries) {
      if (entry.startTime > endTime + 1) break;
      if (entry.startTime < startTime - 1) continue;
      if (entry.combat && entry.combat.length > 0) {
        for (const c of entry.combat) {
          const opts = c.options || {};
          if (opts.attacker === charName && opts.defender) opponents.add(opts.defender);
          if (opts.defender === charName && opts.attacker) opponents.add(opts.attacker);
        }
      }
    }
    if (opponents.size === 0) {
      for (const entry of entries) {
        if (entry.startTime > endTime + 1) break;
        if (entry.startTime < startTime - 1) continue;
        if (entry.character && entry.character !== charName) {
          opponents.add(entry.character);
        }
      }
    }
    return Array.from(opponents);
  }

  _resolveFaceDirection(face, fromPos, toPos) {
    if (!face) return { x: 0, z: 1 };
    if (face === 'forward') return { x: 0, z: 1 };
    if (face === 'back') return { x: 0, z: -1 };
    if (face === 'left') return { x: -1, z: 0 };
    if (face === 'right') return { x: 1, z: 0 };
    if (face === 'center') {
      const dx = -fromPos.x;
      const dz = -fromPos.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.001) return { x: dx / len, z: dz / len };
      return { x: 0, z: 1 };
    }
    if (typeof face === 'string') {
      const dx = toPos.x - fromPos.x;
      const dz = toPos.z - fromPos.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.001) return { x: dx / len, z: dz / len };
    }
    return { x: 0, z: 1 };
  }

  /**
   * D4-6: 打击距离合理性检查（combat_trace 数据驱动）
   */
  _checkHitDistance合理性(combatTrace) {
    const hits = combatTrace.initialHitEvents || [];
    for (const hit of hits) {
      const { time, attacker, defender, anim, profile, preContactDistance, contactGap } = hit;
      if (!profile) continue;

      const range = profile.range || 1.0;
      const hitRadius = profile.hitRadius || 0.35;

      if (preContactDistance !== null && preContactDistance !== undefined) {
        const expectedMax = range + hitRadius + 0.5;
        if (preContactDistance > expectedMax) {
          this.addIssue('warning',
            `命中 #${hit.index}: ${attacker} 的 ${anim} 打击前距离(${preContactDistance.toFixed(2)}m) 远大于攻击范围(${range}m + ${hitRadius}m)。观众可能感觉"隔空命中"`,
            time,
            `缩短 ${attacker} 与 ${defender} 的间距，或增加 DashForward 接近动作`,
            'COMBAT-TRACE-DIST-001'
          );
        }
      }

      if (contactGap !== null && contactGap !== undefined && profile.type === 'melee') {
        if (contactGap > 0.1) {
          this.addIssue('warning',
            `命中 #${hit.index}: ${attacker} 的 ${anim} 接触间隙(${contactGap.toFixed(3)}m) 过大，近战攻击应直接接触`,
            time,
            `检查 ${attacker} 与 ${defender} 的动画同步，确保攻击帧与受击帧对齐`,
            'COMBAT-TRACE-GAP-001'
          );
        }
      }

      if (profile.type === 'projectile') {
        const projDist = hit.projectileDistance;
        if (projDist !== null && projDist !== undefined && projDist > range * 0.5) {
          this.addIssue('info',
            `命中 #${hit.index}: ${attacker} 的 ${anim} 弹道距离(${projDist.toFixed(2)}m) 较短，可能影响视觉冲击力`,
            time,
            `增加弹道飞行距离或调整发射位置`,
            'COMBAT-TRACE-PROJ-001'
          );
        }
      }
    }
  }

  /**
   * D4-7: 命中时角色朝向检查（combat_trace 数据驱动）
   */
  _checkFacingAtHit(combatTrace) {
    const continuity = combatTrace.hitContinuity || [];
    for (const hit of continuity) {
      const { time, attacker, defender, anim, facingErrorAtHit, attackerFaceErrorAtHit, defenderFaceErrorAtHit } = hit;

      if (facingErrorAtHit > 0.3) {
        this.addIssue('warning',
          `命中 #${hit.index}: ${attacker} 与 ${defender} 的 ${anim} 命中时双方未正对（facingError=${facingErrorAtHit.toFixed(3)}rad 约 ${(facingErrorAtHit * 180 / Math.PI).toFixed(0)}度）。打击感会减弱`,
          time,
          `确保命中时双方角色面向彼此（face 参数指向对手）`,
          'COMBAT-TRACE-FACE-001'
        );
      }

      if (attackerFaceErrorAtHit > 0.5) {
        this.addIssue('warning',
          `命中 #${hit.index}: 攻击者 ${attacker} 在 ${anim} 命中时未面向防御者（faceError=${attackerFaceErrorAtHit.toFixed(3)}rad 约 ${(attackerFaceErrorAtHit * 180 / Math.PI).toFixed(0)}度）`,
          time,
          `设置 ${attacker} 的 face=${defender}，确保攻击时面向目标`,
          'COMBAT-TRACE-FACE-002'
        );
      }

      if (defenderFaceErrorAtHit > 1.0) {
        this.addIssue('info',
          `命中 #${hit.index}: 防御者 ${defender} 在受击时大幅背对攻击者（faceError=${defenderFaceErrorAtHit.toFixed(3)}rad 约 ${(defenderFaceErrorAtHit * 180 / Math.PI).toFixed(0)}度）。受击反应可能不自然`,
          time,
          `考虑让 ${defender} 在受击时面向 ${attacker}，或添加转身动画`,
          'COMBAT-TRACE-FACE-003'
        );
      }
    }
  }

  /**
   * D4-8: 角色说话时朝向合理性（增强版：支持多角色场景 + Event:Face 检测）
   */
  _checkDialogueFacing(entries, context) {
    const dialogueEntries = entries.filter((e) => e.character && (e.dialogue || e.text));
    const charPositionTimeline = this._buildCharPositionTimeline(entries, context);

    // Collect all face events: { time, character, target }
    const faceEvents = [];
    for (const entry of entries) {
      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.name === 'Face' && ev.options?.character && ev.options?.target) {
            faceEvents.push({
              time: entry.startTime,
              character: ev.options.character,
              target: ev.options.target,
            });
          }
        }
      }
    }

    // Build per-entry character set (who is present at each dialogue)
    const charPresence = this._buildCharPresence(entries);

    for (const entry of dialogueEntries) {
      const char = entry.character;
      const pos = this._getCharPositionAtTime(charPositionTimeline, entry.startTime, char);
      if (!pos) continue;

      // Determine who is present in the scene at this time
      const presentChars = charPresence.get(entry.startTime) || new Set();
      const otherPresent = Array.from(presentChars).filter((c) => c !== char);

      // Determine intended listener from dialogue content
      const dialogueText = (entry.dialogue || entry.text || '').toLowerCase();
      let talkingTo = null;
      for (const other of otherPresent) {
        const lowerOther = other.toLowerCase();
        const nameAliases = {
          yusuke: ['yusuke', '幽助'],
          kuwabara: ['kuwabara', '桑原'],
          yokai: ['yokai', '妖怪'],
        };
        const aliases = nameAliases[lowerOther] || [lowerOther];
        if (aliases.some((a) => dialogueText.includes(a))) {
          talkingTo = other;
          break;
        }
      }

      // Fallback: nearest other character in time
      if (!talkingTo && otherPresent.length > 0) {
        for (const other of otherPresent) {
          const otherEntries = entries.filter((e) =>
            e.character === other &&
            Math.abs(e.startTime - entry.startTime) < 5
          );
          if (otherEntries.length > 0) {
            talkingTo = other;
            break;
          }
        }
      }

      if (talkingTo) {
        const oppPos = this._getCharPositionAtTime(charPositionTimeline, entry.startTime, talkingTo);
        if (oppPos) {
          const faceDir = this._resolveFaceDirection(pos.face, pos, oppPos);
          const toOpp = { x: oppPos.x - pos.x, z: oppPos.z - pos.z };
          const toOppLen = Math.sqrt(toOpp.x * toOpp.x + toOpp.z * toOpp.z);
          if (toOppLen > 0.001) {
            toOpp.x /= toOppLen;
            toOpp.z /= toOppLen;
            const dot = faceDir.x * toOpp.x + faceDir.z * toOpp.z;
            const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;

            // Check if there's a Face event that corrects this
            const hasFaceEvent = faceEvents.some((fe) =>
              fe.character === char &&
              fe.target === talkingTo &&
              Math.abs(fe.time - entry.startTime) < 0.5
            );

            if (dot < 0.3 && !hasFaceEvent) {
              const isMultiChar = otherPresent.length >= 2;
              const multiHint = isMultiChar
                ? `。注意：当前场景有 ${otherPresent.length + 1} 个角色在场，${char} 的 face=${pos.face || 'forward'} 可能指向了错误的对象`
                : '';
              this.addIssue('warning',
                `对话合理性: ${char} 在说"${(entry.dialogue || entry.text || '').substring(0, 15)}..."时未面向 ${talkingTo}（夹角约 ${angle | 0}度）${multiHint}`,
                entry.startTime,
                `设置 {Position:${char}|face=${talkingTo}} 或在对话前添加 {Event:Face|character=${char}|target=${talkingTo}}`,
                'COMBAT-DIALOGUE-FACE-001'
              );
            }
          }
        }
      }
    }
  }

  /**
   * Build character presence timeline: at each time point, which characters are in the scene
   */
  _buildCharPresence(entries) {
    const presence = new Map();
    const charScenes = new Map();
    let currentScene = null;

    for (const entry of entries) {
      if (entry.scene) currentScene = entry.scene;
      if (entry.character) {
        if (!charScenes.has(entry.character)) charScenes.set(entry.character, []);
        charScenes.get(entry.character).push({ start: entry.startTime, end: entry.endTime, scene: currentScene });
      }
      // Also include characters from Position tags
      if (entry.positions) {
        for (const pos of entry.positions) {
          const name = pos.name || pos.character;
          if (name && !charScenes.has(name)) {
            charScenes.set(name, [{ start: entry.startTime, end: Infinity, scene: currentScene }]);
          }
        }
      }
    }

    for (const entry of entries) {
      if (entry.scene) currentScene = entry.scene;
      const present = new Set();
      for (const [char, ranges] of charScenes) {
        for (const r of ranges) {
          if (r.scene === currentScene && entry.startTime >= r.start && entry.startTime <= r.end + 1) {
            present.add(char);
            break;
          }
        }
      }
      presence.set(entry.startTime, present);
    }

    return presence;
  }

  /**
   * D4-9: 战斗轨迹平滑度检查
   */
  _checkCombatTrajectorySmoothness(combatTrace) {
    const continuity = combatTrace.hitContinuity || [];
    for (let i = 1; i < continuity.length; i++) {
      const prev = continuity[i - 1];
      const curr = continuity[i];
      const gap = curr.time - prev.time;

      if (curr.attacker === prev.attacker && gap < 0.3) {
        this.addIssue('info',
          `连段过密: ${curr.attacker} 的两次攻击间隔仅 ${gap.toFixed(2)}s（${prev.anim} -> ${curr.anim}），观众可能看不清动作`,
          curr.time,
          `增加攻击间隔至至少 0.5s，或合并为 Combo 动画`,
          'COMBAT-TRACE-RAPID-001'
        );
      }

      if (curr.startGap > 2.0) {
        this.addIssue('warning',
          `命中 #${curr.index}: ${curr.attacker} 的 ${curr.anim} 需要 ${curr.startGap.toFixed(2)}m 的初始距离修正。角色起始位置可能过远`,
          curr.time,
          `调整 ${curr.attacker} 的起始位置，使其更接近 ${curr.defender}`,
          'COMBAT-TRACE-STARTGAP-001'
        );
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
