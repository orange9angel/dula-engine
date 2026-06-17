import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * TimelineTraceInspector — D16 Timeline 轨迹合理性检查
 *
 * 核心目标：确保故事板上角色、光效、动作在 timeline 上的综合轨迹合理
 *
 * 检查维度：
 * - D16-1: 角色位置轨迹连续性（无瞬移、穿墙、越界）
 * - D16-2: 角色移动与动画同步（Walk/Run 时应有位移，Dash 时应有 FX）
 * - D16-3: 光效时间线合理性（光效起止与动作匹配、无 orphan 光效）
 * - D16-4: 动作序列连贯性（攻击->受击->恢复 的合理时序）
 * - D16-5: 角色-角色交互轨迹（双方距离变化应与 combat 标签一致）
 * - D16-6: 相机-动作-光效三位一体（相机切换时动作/光效应有合理过渡）
 * - D16-7: 情绪曲线一致性（Face 表情变化应与台词情绪、动作强度匹配）
 */
export class TimelineTraceInspector extends InspectorBase {
  constructor() {
    super('TimelineTraceInspector', 'D16');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText, episodeDir } = context;

    // Build comprehensive timeline state
    const timeline = this._buildTimeline(entries);

    // Run all checks
    this._checkCharacterPositionContinuity(timeline, entries);
    this._checkMovementAnimationSync(timeline, entries);
    this._checkEffectTimeline合理性(timeline, entries);
    this._checkActionSequenceCoherence(timeline, entries);
    this._checkCharacterInteractionTrajectory(timeline, entries);
    this._checkCameraActionEffectTrinity(timeline, entries);
    this._checkEmotionCurveConsistency(timeline, entries);

    // If combat_trace data exists, do deeper trajectory analysis
    const combatTrace = this._loadCombatTrace(episodeDir);
    if (combatTrace) {
      this._checkTrajectoryAgainstCombatTrace(timeline, combatTrace, entries);
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
   * Build a comprehensive timeline state for each entry
   */
  _buildTimeline(entries) {
    const timeline = [];
    let currentPositions = {};
    let currentScene = null;

    for (const entry of entries) {
      if (entry.scene) currentScene = entry.scene;

      // Update positions
      const posList = entry.positions || entry.positionOps;
      if (posList && posList.length > 0) {
        for (const pos of posList) {
          const charName = pos.name || pos.character;
          if (charName) {
            const opts = pos.options || {};
            currentPositions[charName] = {
              x: opts.x ?? currentPositions[charName]?.x ?? 0,
              z: opts.z ?? currentPositions[charName]?.z ?? 0,
              y: opts.y ?? currentPositions[charName]?.y ?? 0,
              face: opts.face ?? currentPositions[charName]?.face ?? 'forward',
            };
          }
        }
      }

      // Parse rawText Position tags
      if (entry.rawText) {
        const posRegex = /\{Position:([^|}]+)\|([^}]+)\}/g;
        let m;
        while ((m = posRegex.exec(entry.rawText)) !== null) {
          const charName = m[1];
          const optsStr = m[2];
          const xMatch = optsStr.match(/x=([-\d.]+)/);
          const zMatch = optsStr.match(/z=([-\d.]+)/);
          const yMatch = optsStr.match(/y=([-\d.]+)/);
          const faceMatch = optsStr.match(/face=([^|}]+)/);
          currentPositions[charName] = {
            x: xMatch ? parseFloat(xMatch[1]) : (currentPositions[charName]?.x ?? 0),
            z: zMatch ? parseFloat(zMatch[1]) : (currentPositions[charName]?.z ?? 0),
            y: yMatch ? parseFloat(yMatch[1]) : (currentPositions[charName]?.y ?? 0),
            face: faceMatch ? faceMatch[1].trim() : (currentPositions[charName]?.face ?? 'forward'),
          };
        }
      }

      // Handle Event:Move
      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.name === 'Move' && ev.options?.character) {
            const charName = ev.options.character;
            currentPositions[charName] = {
              ...currentPositions[charName],
              x: ev.options.x ?? currentPositions[charName]?.x ?? 0,
              z: ev.options.z ?? currentPositions[charName]?.z ?? 0,
              y: ev.options.y ?? currentPositions[charName]?.y ?? 0,
            };
          }
        }
      }

      // Extract FX tags
      const fxTags = [];
      if (entry.animations) {
        for (const anim of entry.animations) {
          if (anim.startsWith('FX')) fxTags.push(anim);
        }
      }
      if (entry.rawText) {
        const fxRegex = /\{(FX[A-Z][a-zA-Z]+)(?:\|[^}]*)?\}/g;
        let m;
        while ((m = fxRegex.exec(entry.rawText)) !== null) {
          if (!fxTags.includes(m[1])) fxTags.push(m[1]);
        }
      }

      // Extract camera
      let camera = null;
      if (entry.cameraMove && typeof entry.cameraMove === 'object') {
        camera = entry.cameraMove.name;
      } else if (entry.camera && typeof entry.camera === 'string') {
        camera = entry.camera;
      } else if (entry.rawText) {
        const camMatch = entry.rawText.match(/\{Camera:([^|}]+)/);
        if (camMatch) camera = camMatch[1];
      }

      // Extract combat info
      const combatInfo = [];
      if (entry.combat && entry.combat.length > 0) {
        for (const c of entry.combat) {
          combatInfo.push({
            type: c.name,
            attacker: c.options?.attacker,
            defender: c.options?.defender,
            sequence: c.options?.sequence,
          });
        }
      }

      timeline.push({
        index: entry.index,
        startTime: entry.startTime,
        endTime: entry.endTime,
        scene: currentScene,
        character: entry.character,
        dialogue: entry.dialogue || entry.text,
        animations: entry.animations || [],
        fxTags,
        camera,
        combatInfo,
        positions: { ...currentPositions },
        rawText: entry.rawText || entry.content || '',
      });
    }

    return timeline;
  }

  /**
   * D16-1: 角色位置轨迹连续性
   * - 检查同一角色在相邻条目间的位置跳跃（瞬移）
   * - 检查角色是否越出场景合理范围
   */
  _checkCharacterPositionContinuity(timeline, entries) {
    const chars = new Set();
    for (const t of timeline) {
      if (t.character) chars.add(t.character);
      Object.keys(t.positions).forEach((c) => chars.add(c));
    }

    for (const char of chars) {
      const charTimeline = timeline.filter((t) => t.positions[char]);
      if (charTimeline.length < 2) continue;

      for (let i = 1; i < charTimeline.length; i++) {
        const prev = charTimeline[i - 1];
        const curr = charTimeline[i];
        const prevPos = prev.positions[char];
        const currPos = curr.positions[char];

        const dx = currPos.x - prevPos.x;
        const dz = currPos.z - prevPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const timeGap = curr.startTime - prev.endTime;

        // Skip teleport checks across scene changes — transitions/fades handle position changes
        if (prev.scene === curr.scene) {
          // Check for teleport (large jump in very short positive time without Move event)
          // Negative/zero time gaps usually mean the position tag sits inside/overlapping the previous entry,
          // which the engine handles correctly; do not flag those.
          if (distance > 3.0 && timeGap > 0 && timeGap < 0.3) {
            // Check if there's a Move event explaining this
            const hasMove = entries.some((e) =>
              e.startTime >= prev.startTime && e.startTime <= curr.startTime &&
              e.storyEvents?.some((ev) => ev.name === 'Move' && ev.options?.character === char)
            );
            if (!hasMove) {
              this.addIssue('warning',
                `${char} 在 ${prev.endTime.toFixed(1)}s -> ${curr.startTime.toFixed(1)}s 间瞬移了 ${distance.toFixed(2)}m（无 Move 事件）。角色位置突变会让观众困惑`,
                curr.startTime,
                `添加 {Event:Move|character=${char}|x=${currPos.x.toFixed(1)}|z=${currPos.z.toFixed(1)}|duration=1.0} 实现平滑移动`,
                'D16-TELEPORT'
              );
            }
          }
        }

        // Check for out-of-bounds
        const sceneBounds = this._getSceneBounds(curr.scene);
        if (sceneBounds) {
          if (Math.abs(currPos.x) > sceneBounds.xMax || Math.abs(currPos.z) > sceneBounds.zMax) {
            this.addIssue('warning',
              `${char} 在 ${curr.startTime.toFixed(1)}s 位于 (${currPos.x.toFixed(1)}, ${currPos.z.toFixed(1)})，可能超出场景 ${curr.scene} 的合理范围`,
              curr.startTime,
              `调整位置至场景范围内（x: +/-${sceneBounds.xMax}, z: +/-${sceneBounds.zMax}）`,
              'D16-OUT-OF-BOUNDS'
            );
          }
        }
      }
    }
  }

  _getSceneBounds(sceneName) {
    const bounds = {
      'RoomScene': { xMax: 8, zMax: 8 },
      'ParkScene': { xMax: 20, zMax: 20 },
      'BeachScene': { xMax: 30, zMax: 40 },
      'BasketballArenaScene': { xMax: 15, zMax: 20 },
      'SarayashikiRoofScene': { xMax: 15, zMax: 15 },
      'DestroyedCityScene': { xMax: 30, zMax: 30 },
      'NightStreetScene': { xMax: 20, zMax: 20 },
    };
    return bounds[sceneName] || { xMax: 25, zMax: 25 };
  }

  /**
   * D16-2: 角色移动与动画同步
   * - Walk/Run 动画时应有位置变化
   * - DashForward 时应有速度线/残影
   * - 位置变化大但无移动动画
   */
  _checkMovementAnimationSync(timeline, entries) {
    const moveAnims = new Set(['Walk', 'Run', 'DashForward']);
    const speedFX = new Set(['FXSpeedLines', 'FXAfterImage', 'FXDustKick']);

    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1];
      const curr = timeline[i];

      for (const char of Object.keys(curr.positions)) {
        const prevPos = prev.positions[char];
        const currPos = curr.positions[char];
        if (!prevPos || !currPos) continue;

        const dx = currPos.x - prevPos.x;
        const dz = currPos.z - prevPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Only check for the character of the current entry (not all characters with positions)
        if (curr.character !== char) continue;

        // Check: has move animation but no position change
        const hasMoveAnim = curr.animations?.some((a) => moveAnims.has(a));
        if (hasMoveAnim && distance < 0.1) {
          this.addIssue('info',
            `${char} 在 ${curr.startTime.toFixed(1)}s 使用了移动动画（${curr.animations.filter((a) => moveAnims.has(a)).join(', ')}）但位置几乎未变（${distance.toFixed(2)}m）。移动动画应配合位置变化`,
            curr.startTime,
            `添加 Event:Move 使角色实际位移，或改用静态动画（如 CrossArms）`,
            'D16-MOVE-NO-DISPLACEMENT'
          );
        }

        // Check: large position change but no move animation
        if (distance > 2.0 && !hasMoveAnim) {
          const hasMoveEvent = entries.some((e) =>
            e.startTime >= prev.startTime && e.startTime <= curr.startTime &&
            e.storyEvents?.some((ev) => ev.name === 'Move' && ev.options?.character === char)
          );
          if (!hasMoveEvent) {
            this.addIssue('warning',
              `${char} 在 ${prev.endTime.toFixed(1)}s -> ${curr.startTime.toFixed(1)}s 间移动了 ${distance.toFixed(2)}m，但无移动动画。位置突变应配合 Walk/Run/DashForward`,
              curr.startTime,
              `添加 Walk/Run/DashForward 动画，或使用 Event:Move 配合 action=Walk`,
              'D16-DISPLACEMENT-NO-MOVE'
            );
          }
        }

        // Check: DashForward without speed FX
        if (curr.animations?.includes('DashForward')) {
          const hasSpeedFX = curr.fxTags?.some((fx) => speedFX.has(fx));
          if (!hasSpeedFX) {
            this.addIssue('info',
              `${char} 在 ${curr.startTime.toFixed(1)}s 使用 DashForward 但无速度线/残影。高速冲刺应有 FXSpeedLines 或 FXAfterImage 增强速度感`,
              curr.startTime,
              `添加 {FXSpeedLines} 或 {FXAfterImage} 到 DashForward 条目`,
              'D16-DASH-NO-SPEEDFX'
            );
          }
        }
      }
    }
  }

  /**
   * D16-3: 光效时间线合理性
   * - 光效应与动作同时开始/结束
   * - 无动作的 orphan 光效
   * - 光效持续时间合理性
   */
  _checkEffectTimeline合理性(timeline, entries) {
    for (const t of timeline) {
      if (t.fxTags.length === 0) continue;

      // Check: FX without any action animation
      const actionAnims = t.animations?.filter((a) =>
        !a.startsWith('Face') && !a.startsWith('FX') && a !== 'FaceReset'
      );
      if (actionAnims.length === 0 && t.fxTags.length > 0 && t.dialogue) {
        // Pure dialogue with FX — might be unnecessary
        const nonAmbientFX = t.fxTags.filter((fx) =>
          !['FXScreenShake'].includes(fx)
        );
        if (nonAmbientFX.length > 0) {
          this.addIssue('info',
            `条目 ${t.index}: 纯对话条目（${t.character}）使用了光效（${nonAmbientFX.join(', ')}）。光效通常应配合动作，纯对话使用光效可能分散注意力`,
            t.startTime,
            `移除光效，或将光效移至动作条目`,
            'D16-FX-ORPHAN-DIALOGUE'
          );
        }
      }

      // Check: Charge glow without charge animation
      if (t.fxTags.includes('FXChargeGlow') || t.fxTags.includes('FXEnergyAura')) {
        const hasChargeAnim = t.animations?.some((a) =>
          a.includes('Charge') || a.includes('Draw')
        );
        if (!hasChargeAnim) {
          this.addIssue('warning',
            `条目 ${t.index}: 使用了蓄力光效（FXChargeGlow/FXEnergyAura）但无蓄力动画。蓄力光效应配合 SpiritGunCharge/SpiritSwordDraw 等蓄力动作`,
            t.startTime,
            `添加蓄力动画（SpiritGunCharge/SpiritSwordDraw）或移除蓄力光效`,
            'D16-FX-CHARGE-NO-ACTION'
          );
        }
      }
    }
  }

  /**
   * D16-4: 动作序列连贯性
   * - 攻击后应有受击反应（时间窗口内）
   * - 受击后应有恢复动作
   * - 连段应有合理的起手->中段->终结顺序
   */
  _checkActionSequenceCoherence(timeline, entries) {
    const attackAnims = new Set([
      'Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
      'SpiritSwordSwing', 'SpiritGunFire'
    ]);
    const reactionAnims = new Set(['HitStagger', 'Knockdown', 'Block', 'Dodge']);
    const recoveryAnims = new Set(['GetUp', 'FaceReset']);

    for (let i = 0; i < timeline.length; i++) {
      const t = timeline[i];
      if (!t.animations) continue;

      const hasAttack = t.animations.some((a) => attackAnims.has(a));
      const hasReaction = t.animations.some((a) => reactionAnims.has(a));

      // Check: attack followed by reaction within window
      if (hasAttack && t.combatInfo.length > 0) {
        const defender = t.combatInfo[0].defender;
        if (defender) {
          let foundReaction = false;
          for (let j = i + 1; j < timeline.length && timeline[j].startTime <= t.endTime + 1.0; j++) {
            if (timeline[j].character === defender &&
                timeline[j].animations?.some((a) => reactionAnims.has(a))) {
              foundReaction = true;
              break;
            }
          }
          if (!foundReaction) {
            this.addIssue('warning',
              `动作序列: ${t.character} 在 ${t.startTime.toFixed(1)}s 攻击 ${defender}，但 ${defender} 在 1s 内无受击反应。攻击后防御者应有 HitStagger/Knockdown/Block/Dodge`,
              t.startTime,
              `在 ${defender} 的下一条目添加受击反应动画`,
              'D16-SEQ-NO-REACTION'
            );
          }
        }
      }

      // Check: knockdown followed by getup
      if (hasReaction && t.animations.includes('Knockdown')) {
        let foundGetUp = false;
        for (let j = i + 1; j < timeline.length && timeline[j].startTime <= t.endTime + 5.0; j++) {
          if (timeline[j].character === t.character &&
              timeline[j].animations?.includes('GetUp')) {
            foundGetUp = true;
            break;
          }
          // Also check storyEvents for Animate action=GetUp
          if (timeline[j].rawText &&
              timeline[j].rawText.includes(`action=GetUp`)) {
            foundGetUp = true;
            break;
          }
        }
        if (!foundGetUp) {
          this.addIssue('info',
            `动作序列: ${t.character} 在 ${t.startTime.toFixed(1)}s 被击倒（Knockdown），但 5s 内未找到起身（GetUp）动作。被击倒后应有起身恢复`,
            t.startTime,
            `在后续条目中添加 {GetUp} 动画`,
            'D16-SEQ-NO-GETUP'
          );
        }
      }
    }
  }

  /**
   * D16-5: 角色-角色交互轨迹
   * - 双方距离变化应与 combat 标签一致
   * - 夹击/包围时角色位置应形成合理阵型
   */
  _checkCharacterInteractionTrajectory(timeline, entries) {
    for (let i = 0; i < timeline.length; i++) {
      const t = timeline[i];
      if (t.combatInfo.length === 0) continue;

      for (const combat of t.combatInfo) {
        if (combat.type === 'Staging' && combat.type === 'pincer') {
          // Check pincer formation
          const chars = combat.chars || [];
          const target = combat.target;
          if (chars.length >= 2 && target && t.positions[target]) {
            const targetPos = t.positions[target];
            const charPositions = chars.map((c) => t.positions[c]).filter(Boolean);
            if (charPositions.length >= 2) {
              // Check if chars are on opposite sides of target
              const midX = (charPositions[0].x + charPositions[1].x) / 2;
              const midZ = (charPositions[0].z + charPositions[1].z) / 2;
              const distToTarget = Math.sqrt(
                (midX - targetPos.x) ** 2 + (midZ - targetPos.z) ** 2
              );
              if (distToTarget > 3) {
                this.addIssue('info',
                  `夹击阵型: ${chars.join(', ')} 夹击 ${target} 时，夹击中心距目标 ${distToTarget.toFixed(2)}m 过远。夹击应紧密包围目标`,
                  t.startTime,
                  `将夹击者位置调整至目标两侧 1.5-2m 处`,
                  'D16-PINCER-TOO-FAR'
                );
              }
            }
          }
        }

        // Check attacker-defender distance consistency
        if (combat.attacker && combat.defender) {
          const attackerPos = t.positions[combat.attacker];
          const defenderPos = t.positions[combat.defender];
          if (attackerPos && defenderPos) {
            const dist = Math.sqrt(
              (attackerPos.x - defenderPos.x) ** 2 +
              (attackerPos.z - defenderPos.z) ** 2
            );
            if (dist > 5 && combat.sequence !== 'spirit_gun') {
              this.addIssue('warning',
                `交互轨迹: ${combat.attacker} 攻击 ${combat.defender} 时双方距离 ${dist.toFixed(2)}m 过远。近战攻击应在 3m 以内`,
                t.startTime,
                `缩短双方间距，或改用远程攻击（SpiritGunFire）`,
                'D16-INTERACT-DIST-FAR'
              );
            }
          }
        }
      }
    }
  }

  /**
   * D16-6: 相机-动作-光效三位一体
   * - 相机切换时动作应有合理过渡
   * - FightImpact 运镜时应有命中光效
   * - FightFollow 运镜时应有移动动画
   */
  _checkCameraActionEffectTrinity(timeline, entries) {
    for (let i = 0; i < timeline.length; i++) {
      const t = timeline[i];
      if (!t.camera) continue;

      // FightImpact should have hit FX
      if (t.camera.includes('FightImpact') || t.camera.includes('FightSide')) {
        const hasHitFX = t.fxTags?.some((fx) =>
          ['FXHitSpark', 'FXShockwave', 'FXBloodSpurt', 'FXTrailSwipe'].includes(fx)
        );
        if (!hasHitFX) {
          this.addIssue('info',
            `三位一体: 条目 ${t.index} 使用 ${t.camera} 运镜（冲击/侧面战斗镜头）但无命中光效。FightImpact 应配合 FXHitSpark/FXShockwave 增强打击感`,
            t.startTime,
            `添加 {FXHitSpark} 或 {FXShockwave} 到该条目`,
            'D16-TRINITY-IMPACT-NO-FX'
          );
        }
      }

      // FightFollow should have movement
      if (t.camera.includes('FightFollow') || t.camera.includes('FightBulletTimeTrack')) {
        const hasMoveAnim = t.animations?.some((a) =>
          ['DashForward', 'Dodge', 'Run', 'Walk', 'JumpAttack'].includes(a)
        );
        if (!hasMoveAnim) {
          this.addIssue('info',
            `三位一体: 条目 ${t.index} 使用 ${t.camera} 运镜（跟随镜头）但无移动动画。跟随镜头应配合角色移动`,
            t.startTime,
            `添加 DashForward/Dodge/Run 等移动动画，或改用 Static/FightImpact 运镜`,
            'D16-TRINITY-FOLLOW-NO-MOVE'
          );
        }
      }

      // CloseUp/TrackingCloseUp should have facial expression
      if (t.camera.includes('CloseUp') || t.camera.includes('ReactionShot')) {
        const hasFaceAnim = t.animations?.some((a) => a.startsWith('Face'));
        if (!hasFaceAnim && t.character) {
          this.addIssue('info',
            `三位一体: 条目 ${t.index} 使用 ${t.camera} 运镜（特写镜头）但无表情动画。特写应展示角色表情变化`,
            t.startTime,
            `添加 FaceAngry/FaceDetermined/FacePain 等表情动画`,
            'D16-TRINITY-CLOSEUP-NO-FACE'
          );
        }
      }

      // Dramatic reveal should have strong FX
      if (t.camera.includes('FightDramatic') || t.camera.includes('HeroReveal')) {
        const hasStrongFX = t.fxTags?.some((fx) =>
          ['FXShockwave', 'FXEnergyAura', 'FXChargeGlow', 'FXDustKick'].includes(fx)
        );
        if (!hasStrongFX) {
          this.addIssue('info',
            `三位一体: 条目 ${t.index} 使用 ${t.camera} 运镜（戏剧性揭示）但无强烈光效。戏剧性镜头应配合 FXShockwave/FXEnergyAura 等增强气势`,
            t.startTime,
            `添加 {FXShockwave} 或 {FXEnergyAura} 增强戏剧性`,
            'D16-TRINITY-DRAMATIC-NO-FX'
          );
        }
      }
    }
  }

  /**
   * D16-7: 情绪曲线一致性
   * - Face 表情变化应与台词情绪匹配
   * - 情绪变化应有合理过渡（不应瞬间从 calm -> angry）
   * - 战斗高潮时情绪应达到峰值
   */
  _checkEmotionCurveConsistency(timeline, entries) {
    const emotionIntensity = {
      'FaceHappy': 2, 'FaceSmirk': 2, 'FaceDetermined': 3,
      'FaceAngry': 4, 'FacePain': 4, 'FaceSurprised': 3,
      'FaceSad': 2, 'FaceConfused': 1, 'FaceBlink': 0,
      'FaceReset': 0,
    };

    for (let i = 0; i < timeline.length; i++) {
      const t = timeline[i];
      if (!t.animations) continue;

      const faceAnims = t.animations.filter((a) => a.startsWith('Face'));
      if (faceAnims.length === 0) continue;

      // Check for FaceReset followed immediately by strong emotion
      // This is actually good practice, so we only flag problematic patterns

      // Check: multiple conflicting emotions in same entry
      const emotions = faceAnims.filter((a) => a !== 'FaceReset');
      if (emotions.length >= 2) {
        const intensities = emotions.map((e) => emotionIntensity[e] || 1);
        const maxDiff = Math.max(...intensities) - Math.min(...intensities);
        if (maxDiff >= 3) {
          this.addIssue('warning',
            `情绪曲线: 条目 ${t.index} 中 ${t.character} 同时使用了冲突表情（${emotions.join(', ')}）。同一时刻不应有剧烈情绪矛盾`,
            t.startTime,
            `保留一个核心表情，移除冲突表情`,
            'D16-EMOTION-CONFLICT'
          );
        }
      }

      // Check: calm dialogue with angry face
      // Skip if entry has combat animations — FaceAngry is appropriate during combat
      const hasCombatAnim = t.animations?.some((a) =>
        ['Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack',
         'SpiritSwordSwing', 'SpiritGunFire', 'DashForward', 'Block', 'Dodge'].includes(a)
      );
      if (t.dialogue && emotions.includes('FaceAngry') && !hasCombatAnim) {
        const text = t.dialogue.toLowerCase();
        // Extended anger keywords including protective anger (竟敢伤我兄弟)
        const isActuallyAngry = /笨蛋|可恶|讨厌|气死|混蛋|去死|杀|竟敢|伤我|报仇|绝不放过/.test(text);
        if (!isActuallyAngry) {
          this.addIssue('info',
            `情绪曲线: ${t.character} 在 ${t.startTime.toFixed(1)}s 说"${t.dialogue.substring(0, 15)}..."时使用了 FaceAngry，但台词内容不愤怒。表情应与台词情绪一致`,
            t.startTime,
            `将 FaceAngry 改为 FaceDetermined/FaceSmirk，或修改台词体现愤怒`,
            'D16-EMOTION-MISMATCH'
          );
        }
      }

      // Check: pain face without hit reaction
      if (emotions.includes('FacePain')) {
        const hasHitReaction = t.animations?.some((a) =>
          ['HitStagger', 'Knockdown'].includes(a)
        );
        if (!hasHitReaction) {
          this.addIssue('info',
            `情绪曲线: ${t.character} 使用了 FacePain（痛苦表情）但无受击动画（HitStagger/Knockdown）。痛苦表情应配合受击动作`,
            t.startTime,
            `添加 HitStagger 或 Knockdown 动画，或将 FacePain 改为其他表情`,
            'D16-EMOTION-PAIN-NO-HIT'
          );
        }
      }
    }
  }

  /**
   * D16-8: 利用 combat_trace 数据验证轨迹
   */
  _checkTrajectoryAgainstCombatTrace(timeline, combatTrace, entries) {
    const continuity = combatTrace.hitContinuity || [];

    for (const hit of continuity) {
      const { time, attacker, defender, anim, startGap, finalGap, closeLeadTime } = hit;

      // Check if the hit timing aligns with the animation entry
      const hitEntry = timeline.find((t) =>
        Math.abs(t.startTime - time) < 1.0 &&
        t.character === attacker &&
        t.animations?.includes(anim)
      );

      if (!hitEntry) {
        this.addIssue('info',
          `轨迹验证: 命中 #${hit.index}（${attacker} 的 ${anim} 在 ${time.toFixed(2)}s）在 story timeline 中未找到对应动画条目。combat_trace 与 story 可能不同步`,
          time,
          `检查 ${attacker} 的 ${anim} 动画是否在正确的时间点`,
          'D16-TRACE-SYNC'
        );
      }

      // Check closeLeadTime: should be positive and reasonable
      if (closeLeadTime < 0.1) {
        this.addIssue('warning',
          `轨迹验证: 命中 #${hit.index} 的接近前置时间仅 ${closeLeadTime.toFixed(3)}s。角色可能来不及在攻击前接近对手`,
          time,
          `提前开始接近动作，或缩短双方初始距离`,
          'D16-TRACE-CLOSE-LEAD'
        );
      }

      // Check startGap: large gap means characters started too far apart
      if (startGap > 3.0) {
        this.addIssue('warning',
          `轨迹验证: 命中 #${hit.index} 需要修正 ${startGap.toFixed(2)}m 的初始距离。${attacker} 起始位置可能过远`,
          time,
          `将 ${attacker} 的初始位置调整至 ${defender} 附近`,
          'D16-TRACE-START-GAP'
        );
      }
    }
  }
}
