import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * ActionMatrixInspector — D18 动作矩阵检查器
 *
 * 将角色动作标准化为矩阵形式：
 *   [角色, 时间, 姿势类型, 动作名称, 目标, 阶段, 光效, 相机]
 *
 * 验证维度：
 * - D18-1: 动作-反应配对完整性（每个攻击应有对应受击/防御/闪避）
 * - D18-2: 光效-动作矩阵一致性（光效应与动作类型匹配）
 * - D18-3: 相机-动作矩阵协调性（运镜应与动作强度匹配）
 * - D18-4: 姿势类型连贯性（Idle->Prep->Action->Recovery 的合理过渡）
 * - D18-5: 多角色动作矩阵冲突检测（同一时刻多个角色的动作不应矛盾）
 * - D18-6: 动作矩阵与 combat_trace 数据交叉验证
 */
export class ActionMatrixInspector extends InspectorBase {
  constructor() {
    super('ActionMatrixInspector', 'D18');
    this.matrix = [];
    this.matrixText = '';
  }

  inspect(context) {
    this.reset();
    this.matrix = [];
    this.matrixText = '';
    const { entries, episodeDir } = context;

    // Build action matrix from entries
    this.matrix = this._buildActionMatrix(entries);

    // Generate matrix text visualization
    this.matrixText = this._generateMatrixText(this.matrix);

    // Run matrix validation
    this._checkActionReactionPairing(this.matrix, entries);
    this._checkFXActionMatrixConsistency(this.matrix);
    this._checkCameraActionCoordination(this.matrix, entries);
    this._checkPoseTypeCoherence(this.matrix, entries);
    this._checkMultiCharMatrixConflict(this.matrix, entries);

    // Cross-validate with combat_trace if available
    const combatTrace = this._loadCombatTrace(episodeDir);
    if (combatTrace) {
      this._checkMatrixAgainstTrace(this.matrix, combatTrace);
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
   * 构建标准化动作矩阵
   * 每行: { time, character, poseType, action, target, phase, fx, camera, entryIndex }
   */
  _buildActionMatrix(entries) {
    const matrix = [];

    // Pose type classification
    const poseTypes = {
      idle: ['Idle', 'Breathing', 'FightingStance', 'CrossArms', 'HandsOnHips'],
      prep: ['SpiritGunCharge', 'SpiritSwordDraw', 'Ready', 'Aim', 'Crouch'],
      action: ['Punch', 'LeftPunch', 'RightPunch', 'LeftRightPunchCombo', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
               'SpiritSwordSwing', 'SpiritGunFire', 'DashForward', 'HeroLanding'],
      reaction: ['HitStagger', 'Knockdown', 'Block', 'Dodge', 'Tremble', 'FacePain'],
      recovery: ['GetUp', 'FaceReset', 'ShakeHead', 'Sigh'],
      expression: ['FaceAngry', 'FaceHappy', 'FaceSad', 'FaceSurprised', 'FaceDetermined',
                   'FaceSmirk', 'FacePain', 'FaceConfused', 'FaceBlink'],
      gesture: ['WaveHand', 'PointForward', 'Shrug', 'Nod', 'ScratchHead', 'LookAround',
                'Think', 'ThumbsUp'],
    };

    const getPoseType = (anim) => {
      for (const [type, anims] of Object.entries(poseTypes)) {
        if (anims.includes(anim)) return type;
      }
      return 'other';
    };

    for (const entry of entries) {
      if (!entry.character) continue;
      if (!entry.animations || entry.animations.length === 0) continue;

      const bodyAnims = entry.animations.filter(a =>
        !a.startsWith('Face') && !a.startsWith('FX') && a !== 'FaceReset'
      );
      const fxAnims = entry.animations.filter(a => a.startsWith('FX'));
      const faceAnims = entry.animations.filter(a => a.startsWith('Face'));

      // Determine primary action (first non-expression, non-fx animation)
      const primaryAnim = bodyAnims[0] || faceAnims[0] || 'Idle';
      const poseType = getPoseType(primaryAnim);

      // Determine target from combat tags or Position face
      let target = null;
      if (entry.combat && entry.combat.length > 0) {
        const combat = entry.combat[0];
        const opts = combat.options || {};
        if (opts.attacker === entry.character && opts.defender) {
          target = opts.defender;
        } else if (opts.defender === entry.character && opts.attacker) {
          target = opts.attacker;
        }
      }
      // Also check Position face parameter
      if (!target && entry.rawText) {
        const faceMatch = entry.rawText.match(/face=([A-Z][a-zA-Z0-9_]*)/);
        if (faceMatch && faceMatch[1] !== entry.character) {
          target = faceMatch[1];
        }
      }
      // Check Event:Face
      if (!target && entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.name === 'Face' && ev.options?.character === entry.character && ev.options?.target) {
            target = ev.options.target;
          }
        }
      }

      // Determine phase
      let phase = 'neutral';
      if (poseType === 'prep') phase = 'windup';
      else if (poseType === 'action') phase = 'execution';
      else if (poseType === 'reaction') phase = 'impact';
      else if (poseType === 'recovery') phase = 'recovery';
      else if (poseType === 'idle') phase = 'neutral';

      // Camera
      let camera = entry.camera || null;
      if (!camera && entry.rawText) {
        const camMatch = entry.rawText.match(/\{Camera:([^|}]+)/);
        if (camMatch) camera = camMatch[1];
      }

      matrix.push({
        time: entry.startTime,
        endTime: entry.endTime,
        character: entry.character,
        poseType,
        action: primaryAnim,
        target,
        phase,
        fx: fxAnims,
        camera,
        allAnims: entry.animations,
        entryIndex: entry.index,
        dialogue: entry.text || entry.dialogue || '',
      });
    }

    return matrix.sort((a, b) => a.time - b.time);
  }

  /**
   * 生成动作矩阵文本可视化
   */
  _generateMatrixText(matrix) {
    if (matrix.length === 0) return '';

    const lines = [];
    lines.push('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                                    ⚔️  动作矩阵（Action Matrix）                                      ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');
    lines.push('║ 格式: [时间] 角色 | 姿势类型 | 动作 → 目标 | 阶段 | 光效 | 相机                                      ║');
    lines.push('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Group by time windows for readability
    const timeWindow = 5;
    let currentWindow = -1;

    for (const row of matrix) {
      const windowStart = Math.floor(row.time / timeWindow) * timeWindow;
      if (windowStart !== currentWindow) {
        currentWindow = windowStart;
        lines.push(`┌─ 时间窗口 [${windowStart}s - ${windowStart + timeWindow}s] ${'─'.repeat(60)}┐`);
      }

      const timeStr = `${row.time.toFixed(1)}s`.padStart(6);
      const charStr = row.character.padEnd(10);
      const poseStr = row.poseType.padEnd(8);
      const actionStr = row.action.padEnd(18);
      const targetStr = row.target ? `→ ${row.target.padEnd(10)}` : '→ ---       ';
      const phaseStr = row.phase.padEnd(10);
      const fxStr = row.fx.join(',').padEnd(16);
      const camStr = (row.camera || '-').padEnd(16);

      lines.push(`│ ${timeStr} │ ${charStr} │ ${poseStr} │ ${actionStr} ${targetStr} │ ${phaseStr} │ ${fxStr} │ ${camStr} │`);

      // If there's dialogue, show it indented
      if (row.dialogue) {
        const dlg = row.dialogue.substring(0, 40);
        lines.push(`│        │            │          │ 💬 ${dlg.padEnd(54)} │`);
      }
    }
    lines.push(`└${'─'.repeat(104)}┘`);
    lines.push('');

    // Phase transition summary
    lines.push('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                                    📊 阶段转换统计                                                    ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');

    const phaseTransitions = new Map(); // char -> [phases]
    for (const row of matrix) {
      if (!phaseTransitions.has(row.character)) phaseTransitions.set(row.character, []);
      phaseTransitions.get(row.character).push({ time: row.time, phase: row.phase, action: row.action });
    }

    for (const [char, phases] of phaseTransitions) {
      const seq = phases.map(p => `${p.phase}(${p.action})`).join(' → ');
      lines.push(`  ${char.padEnd(10)}: ${seq}`);
    }
    lines.push('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Action-FX-Camera cross-reference table
    lines.push('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                              🔗 动作-光效-相机交叉参考表                                               ║');
    lines.push('╠════════════════════╦════════════════════════════════════╦════════════════════════════════════════════╣');
    lines.push('║ 动作类型            │ 推荐光效                            │ 推荐相机                                    ║');
    lines.push('╠════════════════════╬════════════════════════════════════╬════════════════════════════════════════════╣');

    const actionFXCameraMap = {
      'Punch':        { fx: 'FXHitSpark, FXDustKick',         cam: 'FightImpact, FightSide' },
      'LeftRightPunchCombo': { fx: 'FXHitSpark',              cam: 'FightFollow, FightSide' },
      'Kick':         { fx: 'FXHitSpark, FXTrailSwipe',       cam: 'FightImpact, FightOverhead' },
      'Uppercut':     { fx: 'FXHitSpark, FXShockwave',        cam: 'FightImpact, FightLowAngle' },
      'ComboPunch':   { fx: 'FXHitSpark',                     cam: 'FightFollow, FightSide' },
      'SpinKick':     { fx: 'FXTrailSwipe, FXHitSpark',       cam: 'FightOverhead, FightBulletTimeTrack' },
      'JumpAttack':   { fx: 'FXDustKick, FXHitSpark',         cam: 'FightOverhead, FightLowAngle' },
      'SpiritSwordSwing': { fx: 'FXTrailSwipe',               cam: 'FightSide, FightImpact' },
      'SpiritGunCharge':  { fx: 'FXChargeGlow, FXEnergyAura', cam: 'CloseUp, FightDramatic' },
      'SpiritGunFire':    { fx: 'FXTrailSwipe, FXShockwave',  cam: 'FightFollow, FightBulletTimeTrack' },
      'DashForward':  { fx: 'FXSpeedLines, FXAfterImage',     cam: 'FightFollow, FightSide' },
      'Block':        { fx: 'FXHitSpark',                     cam: 'FightImpact, FightSide' },
      'Dodge':        { fx: 'FXAfterImage',                   cam: 'FightFollow, FightSide' },
      'HitStagger':   { fx: 'FXHitSpark, FXBloodSpurt',       cam: 'FightImpact, ReactionShot' },
      'Knockdown':    { fx: 'FXShockwave, FXDustKick',        cam: 'FightLowAngle, FightDramatic' },
    };

    for (const [action, mapping] of Object.entries(actionFXCameraMap)) {
      const actionPad = action.padEnd(18);
      const fxPad = mapping.fx.padEnd(35);
      const camPad = mapping.cam.padEnd(42);
      lines.push(`║ ${actionPad} │ ${fxPad} │ ${camPad} ║`);
    }
    lines.push('╚════════════════════╧════════════════════════════════════╧════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * D18-1: 动作-反应配对完整性
   */
  _checkActionReactionPairing(matrix, entries) {
    const actionRows = matrix.filter(r => r.phase === 'execution');
    const reactionTypes = ['impact', 'recovery'];

    for (const actionRow of actionRows) {
      if (!actionRow.target) continue;

      // Look for reaction from target within 1.5s
      const windowEnd = actionRow.time + 1.5;
      let foundReaction = false;
      let reactionDetail = '';

      for (const other of matrix) {
        if (other.character === actionRow.target &&
            other.time >= actionRow.time && other.time <= windowEnd &&
            reactionTypes.includes(other.phase)) {
          foundReaction = true;
          reactionDetail = `${other.action}(${other.phase})`;
          break;
        }
      }

      if (!foundReaction) {
        this.addIssue('warning',
          `动作矩阵: ${actionRow.character} 的 ${actionRow.action} 攻击 ${actionRow.target}，但目标在 1.5s 内无受击反应`,
          actionRow.time,
          `在 ${actionRow.target} 的后续条目添加 HitStagger/Knockdown/Block/Dodge`,
          'D18-ACTION-NO-REACTION'
        );
      }
    }

    // Check for orphan reactions (reaction without preceding attack)
    for (const row of matrix) {
      if (row.phase !== 'impact') continue;

      const windowStart = Math.max(0, row.time - 1.5);
      let foundAttack = false;

      for (const other of matrix) {
        if (other.character !== row.character &&
            other.time >= windowStart && other.time <= row.time &&
            other.phase === 'execution' && other.target === row.character) {
          foundAttack = true;
          break;
        }
      }

      if (!foundAttack) {
        this.addIssue('info',
          `动作矩阵: ${row.character} 的 ${row.action} 受击反应没有对应的攻击动作。可能是自发反应或缺少攻击者条目`,
          row.time,
          `确认是否有遗漏的攻击动作，或该反应是否为预期行为（如摔倒）`,
          'D18-ORPHAN-REACTION'
        );
      }
    }
  }

  /**
   * D18-2: 光效-动作矩阵一致性
   */
  _checkFXActionMatrixConsistency(matrix) {
    const requiredFX = {
      'Punch': ['FXHitSpark'],
      'LeftRightPunchCombo': ['FXHitSpark'],
      'Kick': ['FXHitSpark'],
      'Uppercut': ['FXHitSpark'],
      'ComboPunch': ['FXHitSpark'],
      'SpinKick': ['FXTrailSwipe'],
      'JumpAttack': ['FXDustKick'],
      'SpiritSwordSwing': ['FXTrailSwipe'],
      'SpiritGunCharge': ['FXChargeGlow', 'FXEnergyAura'],
      'SpiritGunFire': ['FXTrailSwipe', 'FXShockwave'],
      'DashForward': ['FXSpeedLines', 'FXAfterImage'],
      'Block': ['FXHitSpark'],
      'Dodge': ['FXAfterImage'],
      'HitStagger': ['FXHitSpark', 'FXBloodSpurt'],
      'Knockdown': ['FXShockwave', 'FXDustKick'],
    };

    for (const row of matrix) {
      const required = requiredFX[row.action];
      if (!required) continue;

      const hasRequired = required.some(fx => row.fx.includes(fx));
      if (!hasRequired) {
        this.addIssue('info',
          `矩阵光效: ${row.character} 的 ${row.action} 缺少推荐光效（${required.join(' 或 ')}）`,
          row.time,
          `添加 {${required[0]}} 增强视觉效果`,
          'D18-FX-MISSING'
        );
      }
    }

    // Check for FX without matching action
    const fxActionMap = {
      'FXHitSpark': ['Punch', 'Kick', 'Uppercut', 'ComboPunch', 'Block', 'HitStagger', 'Knockdown'],
      'FXTrailSwipe': ['SpiritSwordSwing', 'SpiritGunFire', 'SpinKick', 'Kick'],
      'FXChargeGlow': ['SpiritGunCharge'],
      'FXEnergyAura': ['SpiritGunCharge'],
      'FXShockwave': ['Uppercut', 'SpiritGunFire', 'Knockdown', 'HeroLanding'],
      'FXSpeedLines': ['DashForward', 'Dodge'],
      'FXAfterImage': ['DashForward', 'Dodge'],
      'FXDustKick': ['JumpAttack', 'HeroLanding', 'Knockdown'],
      'FXBloodSpurt': ['HitStagger'],
    };

    for (const row of matrix) {
      for (const fx of row.fx) {
        const validActions = fxActionMap[fx];
        if (!validActions) continue;
        if (!validActions.includes(row.action)) {
          this.addIssue('info',
            `矩阵光效: ${row.character} 的 ${fx} 与 ${row.action} 不匹配。${fx} 通常配合 ${validActions.join('/')} 使用`,
            row.time,
            `将 ${fx} 替换为适合 ${row.action} 的光效，或更换动作`,
            'D18-FX-ACTION-MISMATCH'
          );
        }
      }
    }
  }

  /**
   * D18-3: 相机-动作矩阵协调性
   */
  _checkCameraActionCoordination(matrix, entries) {
    const cameraActionMap = {
      'FightImpact': { actions: ['Punch', 'Kick', 'Uppercut', 'Block', 'HitStagger'], intensity: 'high' },
      'FightFollow': { actions: ['DashForward', 'Run', 'Walk', 'Dodge', 'JumpAttack'], intensity: 'medium' },
      'FightSide': { actions: ['Punch', 'Kick', 'SpiritSwordSwing', 'Block', 'Dodge'], intensity: 'medium' },
      'FightOverhead': { actions: ['SpinKick', 'JumpAttack', 'ComboPunch'], intensity: 'high' },
      'FightLowAngle': { actions: ['Uppercut', 'Knockdown', 'HeroLanding'], intensity: 'high' },
      'FightDramatic': { actions: ['SpiritGunCharge', 'SpiritGunFire'], intensity: 'high' },
      'FightBulletTimeTrack': { actions: ['DashForward', 'SpiritGunFire', 'SpinKick'], intensity: 'high' },
      'CloseUp': { actions: ['SpiritGunCharge', 'FaceAngry', 'FaceDetermined'], intensity: 'low' },
      'ReactionShot': { actions: ['HitStagger', 'Knockdown', 'FacePain', 'FaceSurprised'], intensity: 'low' },
    };

    for (const row of matrix) {
      if (!row.camera) continue;

      const camMapping = cameraActionMap[row.camera];
      if (!camMapping) continue;

      if (!camMapping.actions.includes(row.action)) {
        this.addIssue('info',
          `矩阵相机: ${row.character} 使用 ${row.camera} 运镜但动作为 ${row.action}。${row.camera} 更适合 ${camMapping.actions.join('/')}`,
          row.time,
          `更换运镜或调整动作以匹配`,
          'D18-CAMERA-ACTION-MISMATCH'
        );
      }
    }

    // Check high-intensity actions without appropriate camera
    const highIntensityActions = ['Punch', 'Kick', 'Uppercut', 'SpiritSwordSwing', 'SpiritGunFire', 'Knockdown'];
    const highIntensityCameras = ['FightImpact', 'FightOverhead', 'FightSide', 'FightDramatic', 'FightBulletTimeTrack'];

    for (const row of matrix) {
      if (!highIntensityActions.includes(row.action)) continue;
      if (row.camera && highIntensityCameras.some(c => row.camera.includes(c))) continue;

      this.addIssue('info',
        `矩阵相机: ${row.character} 的高强度动作 ${row.action} 未使用战斗运镜（当前: ${row.camera || '无'}）。建议使用 FightImpact/FightSide 等增强冲击力`,
        row.time,
        `添加 {Camera:FightImpact} 或 {Camera:FightSide} 到该条目`,
        'D18-CAMERA-INTENSITY-LOW'
      );
    }
  }

  /**
   * D18-4: 姿势类型连贯性
   * - 合理的序列: idle -> prep -> action -> reaction -> recovery -> idle
   * - 禁止的跳跃: idle -> action（缺少准备）, action -> action（缺少反应/恢复）
   */
  _checkPoseTypeCoherence(matrix, entries) {
    const validTransitions = {
      'neutral': ['neutral', 'windup', 'execution'],
      'windup': ['execution', 'neutral'],
      'execution': ['impact', 'neutral'],
      'impact': ['recovery', 'impact'],
      'recovery': ['neutral', 'windup'],
    };

    const charSequences = new Map();
    for (const row of matrix) {
      if (!charSequences.has(row.character)) charSequences.set(row.character, []);
      charSequences.get(row.character).push(row);
    }

    for (const [char, seq] of charSequences) {
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1];
        const curr = seq[i];
        const validNext = validTransitions[prev.phase] || [];

        if (!validNext.includes(curr.phase)) {
          // Some transitions are warnings, some are infos
          const isProblematic =
            (prev.phase === 'neutral' && curr.phase === 'execution') || // no windup
            (prev.phase === 'execution' && curr.phase === 'execution'); // double attack no reaction

          const severity = isProblematic ? 'warning' : 'info';
          this.addIssue(severity,
            `姿势连贯性: ${char} 从 ${prev.phase}(${prev.action}) 直接跳到 ${curr.phase}(${curr.action})。阶段转换可能不自然`,
            curr.time,
            `在 ${prev.action} 和 ${curr.action} 之间添加过渡动作（如 windup 或 recovery）`,
            'D18-POSE-TRANSITION'
          );
        }
      }
    }
  }

  /**
   * D18-5: 多角色动作矩阵冲突检测
   * - 同一时刻多个角色同时执行 action（合理）
 * - 同一时刻多个角色同时受击但攻击者不足（不合理）
   * - 同一时刻 A 攻击 B 且 B 攻击 A（对攻，需确认）
   */
  _checkMultiCharMatrixConflict(matrix, entries) {
    // Group by time window (0.5s)
    const timeGroups = new Map();
    for (const row of matrix) {
      const window = Math.floor(row.time / 0.5) * 0.5;
      if (!timeGroups.has(window)) timeGroups.set(window, []);
      timeGroups.get(window).push(row);
    }

    for (const [window, rows] of timeGroups) {
      const attackers = rows.filter(r => r.phase === 'execution');
      const reactors = rows.filter(r => r.phase === 'impact');

      // Check: more reactors than attackers in same window
      if (reactors.length > attackers.length && reactors.length >= 2) {
        this.addIssue('info',
          `矩阵冲突: T=${window.toFixed(1)}s 有 ${reactors.length} 个角色同时受击但只有 ${attackers.length} 个攻击动作。可能缺少攻击者`,
          window,
          `确认每个受击都有对应的攻击动作`,
          'D18-MULTI-REACTION-IMBALANCE'
        );
      }

      // Check: mutual attack (A attacks B and B attacks A simultaneously)
      for (const a of attackers) {
        for (const b of attackers) {
          if (a.character === b.character) continue;
          if (a.target === b.character && b.target === a.character) {
            this.addIssue('info',
              `矩阵冲突: ${a.character} 和 ${b.character} 在 T=${window.toFixed(1)}s 同时对攻。对攻场面需要确认是否为预期设计`,
              window,
              `确认对攻设计，或调整时序使攻击有先后`,
              'D18-MUTUAL-ATTACK'
            );
          }
        }
      }
    }
  }

  /**
   * D18-6: 动作矩阵与 combat_trace 交叉验证
   */
  _checkMatrixAgainstTrace(matrix, combatTrace) {
    const hits = combatTrace.finalHitEvents || [];
    const samples = combatTrace.samples || [];

    for (const hit of hits) {
      // Find matching matrix row
      const matrixRow = matrix.find(r =>
        r.character === hit.attacker &&
        Math.abs(r.time - hit.time) < 1.5
      );

      if (!matrixRow) {
        this.addIssue('warning',
          `矩阵验证: 命中 #${hit.index}（${hit.attacker}→${hit.defender} @${hit.time.toFixed(2)}s）在动作矩阵中未找到对应攻击动作`,
          hit.time,
          `检查 ${hit.attacker} 在 ${hit.time.toFixed(1)}s 附近是否有攻击动画`,
          'D18-TRACE-MISSING-ACTION'
        );
        continue;
      }

      // Verify action matches hit type
      const meleeActions = ['Punch', 'LeftPunch', 'RightPunch', 'LeftRightPunchCombo', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack', 'SpiritSwordSwing'];
      const projectileActions = ['SpiritGunFire'];

      if (hit.profile?.type === 'melee' && !meleeActions.includes(matrixRow.action)) {
        this.addIssue('warning',
          `矩阵验证: 命中 #${hit.index} 为近战类型但矩阵中 ${hit.attacker} 的动作是 ${matrixRow.action}（非近战动作）`,
          hit.time,
          `确认动作类型与命中类型一致`,
          'D18-TRACE-ACTION-TYPE-MISMATCH'
        );
      }

      if (hit.profile?.type === 'projectile' && !projectileActions.includes(matrixRow.action)) {
        this.addIssue('warning',
          `矩阵验证: 命中 #${hit.index} 为弹道类型但矩阵中 ${hit.attacker} 的动作是 ${matrixRow.action}（非弹道动作）`,
          hit.time,
          `确认动作类型与命中类型一致`,
          'D18-TRACE-ACTION-TYPE-MISMATCH'
        );
      }

      // Check if defender has reaction in matrix
      const defenderRow = matrix.find(r =>
        r.character === hit.defender &&
        r.phase === 'impact' &&
        Math.abs(r.time - hit.time) < 1.5
      );

      if (!defenderRow) {
        this.addIssue('warning',
          `矩阵验证: 命中 #${hit.index} 的防御者 ${hit.defender} 在动作矩阵中无受击反应`,
          hit.time,
          `在 ${hit.defender} 的条目添加 HitStagger/Knockdown/Block`,
          'D18-TRACE-DEFENDER-NO-REACTION'
        );
      }
    }
  }

  getReport() {
    const report = super.getReport();
    report.matrixText = this.matrixText;
    return report;
  }
}
