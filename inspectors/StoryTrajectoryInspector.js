import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * StoryTrajectoryInspector — D17 文本故事轨迹图
 *
 * 生成纯文本俯视图时间线，展示：
 * - 角色位置（X-Z 平面俯视图）
 * - 角色朝向（箭头表示）
 * - 动作链标注
 * - 对话标注
 * - 光效标注
 * - 命中事件标记
 *
 * 输出格式：ASCII 艺术俯视图 + 时间线表格
 * 目的：在生成视频前验证时间线上的动作、光效、方向合理性
 */
export class StoryTrajectoryInspector extends InspectorBase {
  constructor() {
    super('StoryTrajectoryInspector', 'D17');
    this.trajectoryText = '';
  }

  inspect(context) {
    this.reset();
    this.trajectoryText = '';
    const { entries, episodeDir } = context;

    const combatTrace = this._loadCombatTrace(episodeDir);
    if (!combatTrace) {
      this.addIssue('info',
        '未找到 combat_trace.json，无法生成轨迹图。请先运行战斗轨迹采集。',
        null,
        '运行 node tools/combat_trace.js <episode-dir> 生成轨迹数据',
        'D17-NO-TRACE'
      );
      return;
    }

    // Generate trajectory visualization
    this.trajectoryText = this._generateTrajectoryMap(entries, combatTrace);

    // Run checks based on trajectory analysis
    this._checkTrajectoryConsistency(entries, combatTrace);
    this._checkActionEffectTiming(entries, combatTrace);
    this._checkDirectionReasonableness(entries, combatTrace);
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
   * 生成纯文本俯视图轨迹图
   */
  _generateTrajectoryMap(entries, combatTrace) {
    const samples = combatTrace.samples || [];
    if (samples.length === 0) return '';

    const lines = [];
    lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                    📍 故事轨迹俯视图（X-Z 平面，Y轴向上）                       ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    lines.push('║  图例: ▲=角色朝向  ●=角色位置  ✦=命中  ⚡=光效  💬=对话  ⚔️=战斗              ║');
    lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Collect all characters
    const allChars = new Set();
    for (const s of samples) {
      for (const c of s.characters || []) allChars.add(c.name);
    }
    const charList = Array.from(allChars);

    // Build character color/symbol mapping
    const charSymbols = {};
    const symbols = ['A', 'B', 'C', 'D', 'E', 'F'];
    charList.forEach((c, i) => { charSymbols[c] = symbols[i] || '?'; });

    // Determine bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of samples) {
      for (const c of s.characters || []) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minZ = Math.min(minZ, c.z);
        maxZ = Math.max(maxZ, c.z);
      }
    }
    // Add padding
    const pad = 3;
    minX -= pad; maxX += pad;
    minZ -= pad; maxZ += pad;
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;

    // Grid dimensions
    const gridW = 60;
    const gridH = 24;

    // Sample at key time points (every ~5s + hit moments)
    const keyTimes = new Set();
    for (let t = 0; t <= (combatTrace.endTime || 130); t += 5) keyTimes.add(Math.round(t));
    for (const hit of (combatTrace.finalHitEvents || [])) {
      if (hit.time != null) keyTimes.add(Math.round(hit.time));
    }
    const sortedTimes = Array.from(keyTimes).sort((a, b) => a - b);

    // For each key time, generate a mini map
    for (const time of sortedTimes) {
      const sample = this._findSampleAtTime(samples, time);
      if (!sample) continue;

      // Build grid
      const grid = Array(gridH).fill(null).map(() => Array(gridW).fill(' '));

      // Draw axes
      const originX = Math.round((0 - minX) / rangeX * (gridW - 1));
      const originZ = Math.round((0 - minZ) / rangeZ * (gridH - 1));
      if (originX >= 0 && originX < gridW) {
        for (let z = 0; z < gridH; z++) grid[z][originX] = '│';
      }
      if (originZ >= 0 && originZ < gridH) {
        for (let x = 0; x < gridW; x++) grid[originZ][x] = '─';
      }
      if (originX >= 0 && originX < gridW && originZ >= 0 && originZ < gridH) {
        grid[originZ][originX] = '┼';
      }

      // Draw characters
      for (const c of sample.characters || []) {
        const gx = Math.round((c.x - minX) / rangeX * (gridW - 1));
        const gz = Math.round((c.z - minZ) / rangeZ * (gridH - 1));
        if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridH) continue;

        const sym = charSymbols[c.name] || '?';
        grid[gz][gx] = sym;

        // Draw facing arrow
        const fx = c.faceDirX ?? Math.cos(c.yaw || 0);
        const fz = c.faceDirZ ?? Math.sin(c.yaw || 0);
        const arrowLen = 2;
        const ax = Math.round(gx + fx * arrowLen);
        const az = Math.round(gz + fz * arrowLen);
        if (ax >= 0 && ax < gridW && az >= 0 && az < gridH && grid[az][ax] === ' ') {
          grid[az][ax] = this._arrowChar(fx, fz);
        }
      }

      // Find active events at this time
      const activeEntries = entries.filter(e => e.startTime <= time && e.endTime >= time);
      const activeAnims = [];
      const activeFX = [];
      const activeDialogue = [];
      for (const e of activeEntries) {
        if (e.animations) activeAnims.push(...e.animations.filter(a => !a.startsWith('Face') && a !== 'FaceReset'));
        if (e.animations) activeFX.push(...e.animations.filter(a => a.startsWith('FX')));
        if (e.character && (e.text || e.dialogue)) activeDialogue.push(e.character);
      }

      // Find hits at this time
      const hitsAtTime = (combatTrace.finalHitEvents || []).filter(h => Math.abs(h.time - time) < 1);

      // Render map
      lines.push(`┌─ T=${time.toFixed(1)}s ─${'─'.repeat(gridW - 12)}┐`);
      for (let z = 0; z < gridH; z++) {
        lines.push('│' + grid[z].join('') + '│');
      }
      lines.push(`└${'─'.repeat(gridW)}┘`);

      // Legend for this frame
      const legendParts = [];
      for (const c of sample.characters || []) {
        const sym = charSymbols[c.name] || '?';
        const facing = c.facingDir === 1 ? '→' : c.facingDir === -1 ? '←' : '?';
        const anims = (c.activeBody || []).join(',');
        const fx = (c.activeFx || []).join(',');
        legendParts.push(`  ${sym}=${c.name}${facing}(${c.x.toFixed(1)},${c.z.toFixed(1)}) body=[${anims}] fx=[${fx}]`);
      }
      for (const part of legendParts) lines.push(part);

      if (activeDialogue.length > 0) lines.push(`  💬 对话: ${[...new Set(activeDialogue)].join(', ')}`);
      if (activeFX.length > 0) lines.push(`  ⚡ 光效: ${[...new Set(activeFX)].join(', ')}`);
      if (hitsAtTime.length > 0) {
        for (const h of hitsAtTime) {
          lines.push(`  ✦ 命中: ${h.attacker} → ${h.defender} (${h.anim})`);
        }
      }
      lines.push('');
    }

    // Summary table
    lines.push('');
    lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                          📋 角色动作时间线总览                                ║');
    lines.push('╠════════════════════╦═════════════════════════════════════════════════════════╣');
    lines.push('║ 时间  │ 角色       │ 位置        │ 朝向 │ 动作链              │ 光效           ║');
    lines.push('╠═══════╪════════════╪═════════════╪══════╪═════════════════════╪════════════════╣');

    // Build per-character timeline from entries
    for (const entry of entries) {
      if (!entry.character) continue;
      const time = entry.startTime;
      const char = entry.character;

      // Find position from nearest sample
      const sample = this._findSampleAtTime(samples, time);
      let posStr = '---';
      let facingStr = '---';
      if (sample) {
        const c = sample.characters.find(ch => ch.name === char);
        if (c) {
          posStr = `(${c.x.toFixed(1)},${c.z.toFixed(1)})`;
          facingStr = c.facingDir === 1 ? '→' : c.facingDir === -1 ? '←' : '?';
        }
      }

      const anims = (entry.animations || []).filter(a => !a.startsWith('Face') && a !== 'FaceReset').join('→') || '-';
      const fx = (entry.animations || []).filter(a => a.startsWith('FX')).join(',') || '-';
      const text = (entry.text || entry.dialogue || '').substring(0, 12);

      const timeStr = `${time.toFixed(1)}s`.padStart(5);
      const charStr = char.padEnd(10);
      const posPad = posStr.padEnd(11);
      const facePad = facingStr.padEnd(4);
      const animPad = anims.padEnd(19);
      const fxPad = fx.padEnd(14);
      const textPad = text.padEnd(12);

      lines.push(`║ ${timeStr} │ ${charStr} │ ${posPad} │ ${facePad} │ ${animPad} │ ${fxPad} ║`);
      if (text) {
        lines.push(`║       │            │             │      │ 💬 ${textPad} │                ║`);
      }
    }

    lines.push('╚═══════╧════════════╧═════════════╧══════╧═════════════════════╧════════════════╝');
    lines.push('');

    // Action-reaction pairing matrix
    lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                        ⚔️  动作-反应配对矩阵                                  ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');

    const attackAnims = ['Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack', 'SpiritSwordSwing', 'SpiritGunFire'];
    const reactionAnims = ['HitStagger', 'Knockdown', 'Block', 'Dodge'];

    const attacks = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.character || !e.animations) continue;
      for (const a of e.animations) {
        if (attackAnims.includes(a)) {
          attacks.push({ entry: e, anim: a, index: i });
        }
      }
    }

    for (const atk of attacks) {
      const e = atk.entry;
      const windowEnd = e.endTime + 1.5;
      let foundReaction = false;
      let reactionStr = '❌ 无反应';

      for (let j = atk.index + 1; j < entries.length && entries[j].startTime <= windowEnd; j++) {
        const other = entries[j];
        if (other.character && other.character !== e.character && other.animations) {
          const reactions = other.animations.filter(a => reactionAnims.includes(a));
          if (reactions.length > 0) {
            foundReaction = true;
            reactionStr = `✅ ${other.character}: ${reactions.join(',')}`;
            break;
          }
        }
      }

      const hit = (combatTrace.finalHitEvents || []).find(h =>
        Math.abs(h.time - e.startTime) < 2 && h.attacker === e.character
      );
      const hitStr = hit ? `✦命中(${hit.defender})` : '';

      lines.push(`  ${e.startTime.toFixed(1)}s  ${e.character.padEnd(10)} ${atk.anim.padEnd(18)} → ${reactionStr} ${hitStr}`);
    }

    lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  _findSampleAtTime(samples, time) {
    let best = null;
    let bestDiff = Infinity;
    for (const s of samples) {
      const diff = Math.abs(s.time - time);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    return bestDiff <= 2 ? best : null;
  }

  _arrowChar(fx, fz) {
    const angle = Math.atan2(fz, fx) * 180 / Math.PI;
    if (angle >= -22.5 && angle < 22.5) return '→';
    if (angle >= 22.5 && angle < 67.5) return '↘';
    if (angle >= 67.5 && angle < 112.5) return '↓';
    if (angle >= 112.5 && angle < 157.5) return '↙';
    if (angle >= 157.5 || angle < -157.5) return '←';
    if (angle >= -157.5 && angle < -112.5) return '↖';
    if (angle >= -112.5 && angle < -67.5) return '↑';
    return '↗';
  }

  /**
   * D17-1: 轨迹一致性检查
   * - 角色位置不应出现不合理的跳跃
   * - 角色朝向应与动作方向一致
   */
  _checkTrajectoryConsistency(entries, combatTrace) {
    const samples = combatTrace.samples || [];
    if (samples.length < 2) return;

    const charTrails = new Map();
    for (const s of samples) {
      for (const c of s.characters || []) {
        if (!charTrails.has(c.name)) charTrails.set(c.name, []);
        charTrails.get(c.name).push({ time: s.time, x: c.x, z: c.z, yaw: c.yaw, faceDirX: c.faceDirX, faceDirZ: c.faceDirZ });
      }
    }

    for (const [char, trail] of charTrails) {
      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1];
        const curr = trail[i];
        const dt = curr.time - prev.time;
        if (dt < 0.1) continue;

        const dx = curr.x - prev.x;
        const dz = curr.z - prev.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const speed = dist / dt;

        // Check for teleport (speed > 15 m/s is unrealistic)
        if (speed > 15 && dist > 2) {
          this.addIssue('warning',
            `轨迹: ${char} 在 ${prev.time.toFixed(1)}s→${curr.time.toFixed(1)}s 间速度达 ${speed.toFixed(1)}m/s（位移 ${dist.toFixed(2)}m），疑似瞬移`,
            curr.time,
            `检查是否有 Move 事件或 DashForward 动画配合，或修正位置数据`,
            'D17-TELEPORT'
          );
        }

        // Check for facing direction vs movement direction mismatch
        if (dist > 0.3) {
          const moveDirX = dx / dist;
          const moveDirZ = dz / dist;
          const faceDirX = curr.faceDirX ?? Math.cos(curr.yaw || 0);
          const faceDirZ = curr.faceDirZ ?? Math.sin(curr.yaw || 0);
          const dot = moveDirX * faceDirX + moveDirZ * faceDirZ;
          // If moving backward (dot < -0.5) without dodge animation, warn
          if (dot < -0.5) {
            // Check if there's a dodge animation
            const entryAtTime = entries.find(e =>
              e.character === char &&
              e.startTime <= curr.time && e.endTime >= curr.time &&
              e.animations?.includes('Dodge')
            );
            if (!entryAtTime) {
              this.addIssue('info',
                `轨迹: ${char} 在 ${curr.time.toFixed(1)}s 移动方向与朝向相反（夹角 > 120°）。角色可能正在倒退行走`,
                curr.time,
                `确认是否为预期行为（如后退防御），或修正 face 方向`,
                'D17-FACE-MOVE-MISMATCH'
              );
            }
          }
        }
      }
    }
  }

  /**
   * D17-2: 动作-光效时机检查
   * - 光效应与动作同时出现
   * - 光效不应在动作结束后持续太久
   */
  _checkActionEffectTiming(entries, combatTrace) {
    const samples = combatTrace.samples || [];

    for (const entry of entries) {
      if (!entry.animations) continue;
      const hasAction = entry.animations.some(a =>
        !a.startsWith('Face') && !a.startsWith('FX') && a !== 'FaceReset'
      );
      const hasFX = entry.animations.some(a => a.startsWith('FX'));

      if (hasFX && !hasAction) {
        // FX without action — check if it's ambient
        const ambientFX = ['FXScreenShake'];
        const nonAmbient = entry.animations.filter(a => a.startsWith('FX') && !ambientFX.includes(a));
        if (nonAmbient.length > 0) {
          this.addIssue('info',
            `光效时机: 条目 ${entry.index} (${entry.character}) 有光效(${nonAmbient.join(',')})但无动作动画。纯光效可能缺乏触发源`,
            entry.startTime,
            `添加对应动作动画，或将光效移至有动作的条目`,
            'D17-FX-NO-ACTION'
          );
        }
      }
    }

    // Check FX duration from samples
    const fxDurations = new Map(); // char -> fxName -> { start, end }
    for (const s of samples) {
      for (const c of s.characters || []) {
        for (const fx of c.activeFx || []) {
          const key = `${c.name}|${fx}`;
          if (!fxDurations.has(key)) {
            fxDurations.set(key, { start: s.time, end: s.time, char: c.name, fx });
          } else {
            fxDurations.get(key).end = s.time;
          }
        }
      }
    }

    for (const [key, dur] of fxDurations) {
      const duration = dur.end - dur.start;
      if (duration > 5) {
        this.addIssue('info',
          `光效时长: ${dur.char} 的 ${dur.fx} 持续了 ${duration.toFixed(1)}s。长时间光效可能视觉疲劳`,
          dur.start,
          `检查光效是否应在动作结束后停止`,
          'D17-FX-LONG'
        );
      }
    }
  }

  /**
   * D17-3: 方向合理性检查
   * - 攻击时角色应面向对手
   * - 对话时角色应面向对话对象
   * - 命中时双方应大致相向
   */
  _checkDirectionReasonableness(entries, combatTrace) {
    const samples = combatTrace.samples || [];
    const hits = combatTrace.finalHitEvents || [];

    for (const hit of hits) {
      const sample = this._findSampleAtTime(samples, hit.time);
      if (!sample) continue;

      const attacker = sample.characters.find(c => c.name === hit.attacker);
      const defender = sample.characters.find(c => c.name === hit.defender);
      if (!attacker || !defender) continue;

      const aFaceX = attacker.faceDirX ?? Math.cos(attacker.yaw || 0);
      const aFaceZ = attacker.faceDirZ ?? Math.sin(attacker.yaw || 0);
      const toDefX = defender.x - attacker.x;
      const toDefZ = defender.z - attacker.z;
      const dist = Math.sqrt(toDefX * toDefX + toDefZ * toDefZ);
      if (dist < 0.001) continue;

      const toDefDirX = toDefX / dist;
      const toDefDirZ = toDefZ / dist;
      const dot = aFaceX * toDefDirX + aFaceZ * toDefDirZ;

      if (dot < 0) {
        this.addIssue('error',
          `方向错误: 命中 #${hit.index} 时 ${hit.attacker} 背对 ${hit.defender}（夹角 > 90°）。攻击者必须面向目标`,
          hit.time,
          `设置 {Position:${hit.attacker}|face=${hit.defender}} 或使用 {Event:Face|character=${hit.attacker}|target=${hit.defender}}`,
          'D17-HIT-BACKWARD'
        );
      } else if (dot < 0.5) {
        this.addIssue('warning',
          `方向偏差: 命中 #${hit.index} 时 ${hit.attacker} 与 ${hit.defender} 夹角约 ${Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI | 0}°。攻击者应更正对目标`,
          hit.time,
          `调整 ${hit.attacker} 的 face 方向使其面向 ${hit.defender}`,
          'D17-HIT-OFF-ANGLE'
        );
      }
    }

    // Check dialogue facing
    const dialogueEntries = entries.filter(e => e.character && (e.text || e.dialogue));
    for (const entry of dialogueEntries) {
      const sample = this._findSampleAtTime(samples, entry.startTime + 0.5);
      if (!sample) continue;

      const char = sample.characters.find(c => c.name === entry.character);
      if (!char) continue;

      // Find who they should be talking to
      const otherChars = sample.characters.filter(c => c.name !== entry.character);
      if (otherChars.length === 0) continue;

      // Try to infer target from dialogue text
      const text = (entry.text || entry.dialogue || '').toLowerCase();
      let target = otherChars[0];
      for (const o of otherChars) {
        const aliases = {
          yusuke: ['yusuke', '幽助'],
          kuwabara: ['kuwabara', '桑原'],
        };
        const nameLower = o.name.toLowerCase();
        const checks = aliases[nameLower] || [nameLower];
        if (checks.some(a => text.includes(a))) {
          target = o;
          break;
        }
      }

      const cFaceX = char.faceDirX ?? Math.cos(char.yaw || 0);
      const cFaceZ = char.faceDirZ ?? Math.sin(char.yaw || 0);
      const toTargetX = target.x - char.x;
      const toTargetZ = target.z - char.z;
      const tDist = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ);
      if (tDist < 0.001) continue;

      const toTargetDirX = toTargetX / tDist;
      const toTargetDirZ = toTargetZ / tDist;
      const dot = cFaceX * toTargetDirX + cFaceZ * toTargetDirZ;

      if (dot < 0.3) {
        this.addIssue('warning',
          `对话方向: ${entry.character} 在说"${(entry.text || entry.dialogue || '').substring(0, 15)}..."时未面向 ${target.name}（夹角约 ${Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI | 0}°）`,
          entry.startTime,
          `设置 {Event:Face|character=${entry.character}|target=${target.name}} 或调整 face 参数`,
          'D17-DIALOGUE-FACE'
        );
      }
    }
  }

  getReport() {
    const report = super.getReport();
    report.trajectoryText = this.trajectoryText;
    return report;
  }
}
