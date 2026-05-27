import { InspectorBase } from './InspectorBase.js';

/**
 * EffectInspector — D5 特效合理性检查
 *
 * 检查范围:
 * - Camera:Shake 滥用检测（频率、强度、与情绪匹配度）
 * - FX 光效标签合理性（FXChargeGlow, FXHitSpark, FXSpeedLines 等）
 * - 光效与动作匹配度
 * - 光效叠加检测
 * - 光效缺失检测（应有光效但无标签）
 * - 静态对话场景不必要的光效
 */
export class EffectInspector extends InspectorBase {
  constructor() {
    super('EffectInspector', 'D5');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText } = context;

    // Extract all effect tags
    const shakeEvents = this._extractShakeEvents(entries, storyText);
    const sfxEvents = this._extractSFXEvents(entries, storyText);
    const fxEvents = this._extractFXEventsFromEntries(entries);

    // Run checks
    this._checkShakeFrequency(shakeEvents, entries);
    this._checkShakeIntensity(shakeEvents);
    this._checkShakeEmotionMatch(shakeEvents, entries);
    this._checkConsecutiveEffects(shakeEvents, sfxEvents, entries);
    this._checkUnnecessaryShake(shakeEvents, entries);

    // FX 光效检查
    this._checkFXAbuse(fxEvents, entries);
    this._checkFXActionMatch(fxEvents, entries);
    this._checkFXMissing(fxEvents, entries);
    this._checkFXStacking(fxEvents, entries);
    this._checkFXLightingConsistency(fxEvents, entries);
    this._checkFXDirectionConsistency(fxEvents, entries, storyText);
  }

  // ─── Shake 检查（原有逻辑）───

  _extractShakeEvents(entries, storyText) {
    const events = [];
    const lines = storyText.split('\n');
    const regex = /\{Camera:Shake\|([^}]+)\}/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m;
      while ((m = regex.exec(line)) !== null) {
        const params = this._parseParams(m[1]);
        const entry = this._findEntryForLine(entries, lineIdx);
        events.push({
          params,
          line: lineIdx + 1,
          entry,
          intensity: params.intensity !== undefined ? parseFloat(params.intensity) : 0.5,
          duration: params.duration !== undefined ? parseFloat(params.duration) : 0.5,
        });
      }
    }
    return events;
  }

  _extractSFXEvents(entries, storyText) {
    const events = [];
    const lines = storyText.split('\n');
    const regex = /\{SFX:Play\|([^}]+)\}/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m;
      while ((m = regex.exec(line)) !== null) {
        const entry = this._findEntryForLine(entries, lineIdx);
        events.push({ line: lineIdx + 1, entry });
      }
    }
    return events;
  }

  /**
   * 从 entries 的 animations 中提取 FX 标签事件
   * 更可靠：直接利用 StoryParser 已解析的数据
   */
  _extractFXEventsFromEntries(entries) {
    const events = [];
    for (const entry of entries) {
      if (!entry.animations) continue;
      for (const anim of entry.animations) {
        if (anim.startsWith('FX')) {
          events.push({
            fxName: anim,
            params: {},
            entry,
          });
        }
      }
    }
    return events;
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
      const n = parseFloat(val);
      params[key] = isNaN(n) ? val : n;
    }
    return params;
  }

  _findEntryForLine(entries, lineIdx) {
    for (const entry of entries) {
      if (entry.index === lineIdx - 1) return entry;
    }
    return null;
  }

  _checkShakeFrequency(shakeEvents, entries) {
    if (shakeEvents.length === 0) return;

    const timedEvents = shakeEvents
      .filter((e) => e.entry && e.entry.startTime !== undefined)
      .sort((a, b) => a.entry.startTime - b.entry.startTime);

    const WINDOW = 10;
    const MAX_SHAKES_IN_WINDOW = 2;

    for (let i = 0; i < timedEvents.length; i++) {
      const startTime = timedEvents[i].entry.startTime;
      let count = 0;
      const windowEvents = [];

      for (let j = i; j < timedEvents.length; j++) {
        if (timedEvents[j].entry.startTime - startTime <= WINDOW) {
          count++;
          windowEvents.push(timedEvents[j]);
        } else {
          break;
        }
      }

      if (count > MAX_SHAKES_IN_WINDOW) {
        this.addIssue('warning',
          `Camera:Shake 过于密集：在 ${startTime.toFixed(1)}s 后的 ${WINDOW} 秒内使用了 ${count} 次抖动。频繁抖动会让观众视觉疲劳，削弱冲击力`,
          startTime,
          `建议将 ${count} 次 Shake 减少到 <=${MAX_SHAKES_IN_WINDOW} 次，或改用其他运镜（如 CloseUp、ZoomIn）表达情绪`,
          'BUG-EFF-SHAKE-FREQUENCY'
        );
        i += count - 1;
      }
    }

    const totalCharEntries = entries.filter((e) => e.character).length;
    if (totalCharEntries > 0) {
      const ratio = shakeEvents.length / totalCharEntries;
      if (ratio > 0.3) {
        this.addIssue('warning',
          `Camera:Shake 使用频率过高（${shakeEvents.length}/${totalCharEntries} 个角色条目，占比 ${(ratio * 100).toFixed(0)}%）。Shake 是强特效，应保留给真正需要冲击力的时刻`,
          null,
          `将 Shake 使用率控制在 30% 以下，仅在 panic/scared/angry 等强情绪时使用`,
          'BUG-EFF-SHAKE-OVERUSE'
        );
      }
    }
  }

  _checkShakeIntensity(shakeEvents) {
    for (const ev of shakeEvents) {
      if (ev.intensity > 0.8) {
        this.addIssue('warning',
          `Camera:Shake 强度过高 (${ev.intensity})，可能导致画面严重失真、角色面部不可辨认`,
          ev.entry?.startTime,
          `建议 intensity <= 0.5（轻微抖动）或 <= 0.8（强烈抖动）。如需更强冲击力，可配合 ZoomIn + SFX`,
          'BUG-EFF-SHAKE-TOO-STRONG'
        );
      } else if (ev.intensity < 0.05) {
        this.addIssue('info',
          `Camera:Shake 强度过低 (${ev.intensity})，观众可能察觉不到抖动效果`,
          ev.entry?.startTime,
          `建议 intensity >= 0.1，或移除 Shake 改用静态运镜`,
          'BUG-EFF-SHAKE-TOO-WEAK'
        );
      }

      if (ev.duration > 2.0) {
        this.addIssue('warning',
          `Camera:Shake 持续时间过长 (${ev.duration}s)，长时间抖动会造成视觉不适`,
          ev.entry?.startTime,
          `建议 duration <= 1.0s。如需持续紧张感，可间歇性使用多个短 Shake`,
          'BUG-EFF-SHAKE-TOO-LONG'
        );
      }
    }
  }

  _checkShakeEmotionMatch(shakeEvents, entries) {
    const highEnergyEmotions = ['panic', 'scared', 'angry', 'excited', 'exasperated', 'worried'];
    const lowEnergyEmotions = ['calm', 'happy', 'gentle', 'daydreaming', 'proud', 'teasing', 'defiant'];

    for (const ev of shakeEvents) {
      if (!ev.entry) continue;

      const emotion = ev.entry.voiceEmotion || this._inferEmotionFromText(ev.entry.dialogue || '');
      if (!emotion) continue;

      if (lowEnergyEmotions.includes(emotion)) {
        this.addIssue('warning',
          `Camera:Shake 与角色情绪不匹配：条目使用 {Voice:${emotion}}（低张力），但 Shake 是高冲击特效，会产生违和感`,
          ev.entry.startTime,
          `情绪为 ${emotion} 时建议用 Static、CloseUp 或 Pan；Shake 应保留给 panic/scared/angry`,
          'BUG-EFF-SHAKE-EMOTION-MISMATCH'
        );
      }
    }
  }

  _checkConsecutiveEffects(shakeEvents, sfxEvents, entries) {
    const shakeEntryIndices = new Set();
    for (const ev of shakeEvents) {
      if (ev.entry) shakeEntryIndices.add(ev.entry.index);
    }

    const sfxEntryIndices = new Set();
    for (const ev of sfxEvents) {
      if (ev.entry) sfxEntryIndices.add(ev.entry.index);
    }

    for (const idx of shakeEntryIndices) {
      if (sfxEntryIndices.has(idx)) {
        const entry = entries.find((e) => e.index === idx);
        if (entry) {
          this.addIssue('info',
            `条目 ${idx}: 同时使用了 Camera:Shake + SFX，确保两者服务于同一叙事目的（如爆炸、撞击），避免特效堆砌`,
            entry.startTime,
            `如果只是想强调台词，保留 SFX 移除 Shake；如果是动作场面，保留两者`,
            'BUG-EFF-STACKING'
          );
        }
      }
    }
  }

  _checkUnnecessaryShake(shakeEvents, entries) {
    for (const ev of shakeEvents) {
      if (!ev.entry) continue;

      const duration = ev.entry.endTime - ev.entry.startTime;
      const hasActionAnim = ev.entry.animations && ev.entry.animations.some((a) =>
        !['Nod', 'Think', 'WaveHand', 'ScratchHead'].includes(a)
      );

      if (duration > 5 && !hasActionAnim) {
        this.addIssue('info',
          `条目 ${ev.entry.index}: 长台词 (${duration.toFixed(1)}s) 使用 Shake 但无动作动画，抖动可能分散观众对台词的注意力`,
          ev.entry.startTime,
          `长对话建议用 Static 或 CloseUp；Shake 适合配合 Jump/Run/SurprisedJump 等动作`,
          'BUG-EFF-SHAKE-STATIC-DIALOGUE'
        );
      }
    }
  }

  // ─── FX 光效检查（新增）───

  /**
   * D5-6: FX 光效滥用检测
   * - 同一 10 秒内过多 FX
   * - 连续相同 FX 重复
   */
  _checkFXAbuse(fxEvents, entries) {
    if (fxEvents.length === 0) return;

    const timedEvents = fxEvents
      .filter((e) => e.entry && e.entry.startTime !== undefined)
      .sort((a, b) => a.entry.startTime - b.entry.startTime);

    // Check frequency in 10s windows
    const WINDOW = 10;
    const MAX_FX_IN_WINDOW = 5;

    for (let i = 0; i < timedEvents.length; i++) {
      const startTime = timedEvents[i].entry.startTime;
      let count = 0;

      for (let j = i; j < timedEvents.length; j++) {
        if (timedEvents[j].entry.startTime - startTime <= WINDOW) {
          count++;
        } else {
          break;
        }
      }

      if (count > MAX_FX_IN_WINDOW) {
        this.addIssue('warning',
          `FX 光效过于密集：在 ${startTime.toFixed(1)}s 后的 ${WINDOW} 秒内使用了 ${count} 个光效。光效堆砌会削弱每个特效的视觉冲击力`,
          startTime,
          `建议将光效减少到 <=${MAX_FX_IN_WINDOW} 个，或合并为更强烈的单一特效`,
          'BUG-EFF-FX-FREQUENCY'
        );
        i += count - 1;
      }
    }

    // Check consecutive same FX
    for (let i = 1; i < timedEvents.length; i++) {
      const prev = timedEvents[i - 1];
      const curr = timedEvents[i];
      if (curr.fxName === prev.fxName &&
          curr.entry && prev.entry &&
          Math.abs(curr.entry.startTime - prev.entry.startTime) < 3) {
        this.addIssue('info',
          `连续重复光效: ${curr.fxName} 在 ${curr.entry.startTime.toFixed(1)}s 附近连续使用。相同光效密集重复会降低新鲜感`,
          curr.entry.startTime,
          `替换为不同类型的 FX（如 FXHitSpark -> FXShockwave），或增加间隔`,
          'BUG-EFF-FX-REPEAT'
        );
      }
    }
  }

  /**
   * D5-7: FX 与动作匹配度检查
   * - 攻击动作应有对应光效（Punch -> FXHitSpark, SpiritSwordSwing -> FXTrailSwipe）
   * - 蓄力动作应有 FXChargeGlow
   * - 高速移动应有 FXSpeedLines / FXAfterImage
   */
  _checkFXActionMatch(fxEvents, entries) {
    const fxByEntry = new Map();
    for (const ev of fxEvents) {
      if (!ev.entry) continue;
      if (!fxByEntry.has(ev.entry.index)) fxByEntry.set(ev.entry.index, []);
      fxByEntry.get(ev.entry.index).push(ev.fxName);
    }

    const actionFXMapping = {
      'Punch': { expected: ['FXHitSpark', 'FXDustKick'], optional: true },
      'Kick': { expected: ['FXHitSpark', 'FXDustKick'], optional: true },
      'Uppercut': { expected: ['FXHitSpark', 'FXShockwave'], optional: true },
      'ComboPunch': { expected: ['FXHitSpark'], optional: true },
      'SpinKick': { expected: ['FXTrailSwipe', 'FXHitSpark'], optional: true },
      'JumpAttack': { expected: ['FXDustKick', 'FXHitSpark'], optional: true },
      'SpiritSwordSwing': { expected: ['FXTrailSwipe'], optional: false },
      'SpiritGunCharge': { expected: ['FXChargeGlow', 'FXEnergyAura'], optional: false },
      'SpiritGunFire': { expected: ['FXTrailSwipe', 'FXShockwave'], optional: false },
      'DashForward': { expected: ['FXSpeedLines', 'FXAfterImage', 'FXDustKick'], optional: false },
      'HeroLanding': { expected: ['FXDustKick', 'FXShockwave'], optional: true },
      'Block': { expected: ['FXHitSpark'], optional: true },
      'Dodge': { expected: ['FXAfterImage'], optional: true },
    };

    for (const entry of entries) {
      if (!entry.animations) continue;
      const entryFX = fxByEntry.get(entry.index) || [];

      for (const anim of entry.animations) {
        const mapping = actionFXMapping[anim];
        if (!mapping) continue;

        const hasExpected = mapping.expected.some((fx) => entryFX.includes(fx));
        if (!hasExpected) {
          const severity = mapping.optional ? 'info' : 'warning';
          this.addIssue(severity,
            `条目 ${entry.index}: ${entry.character} 使用 ${anim} 但缺少推荐光效（${mapping.expected.join(' 或 ')}）。${mapping.optional ? '添加光效可增强视觉冲击力' : '该动作强烈建议配合光效'}`,
            entry.startTime,
            `添加 {${mapping.expected[0]}} 到该条目`,
            'BUG-EFF-FX-ACTION-MATCH'
          );
        }
      }
    }
  }

  /**
   * D5-8: 光效缺失检测
   * - 有 HitStagger/Knockdown 但无 FXHitSpark
   * - 有 SpiritGunFire 但无 FXTrailSwipe
   * - 有 DashForward 但无速度线
   * 
   * 注意：与 _checkFXActionMatch 互补，这里只检查"必须有"的情况
   */
  _checkFXMissing(fxEvents, entries) {
    const fxByEntry = new Map();
    for (const ev of fxEvents) {
      if (!ev.entry) continue;
      if (!fxByEntry.has(ev.entry.index)) fxByEntry.set(ev.entry.index, []);
      fxByEntry.get(ev.entry.index).push(ev.fxName);
    }

    for (const entry of entries) {
      if (!entry.animations) continue;
      const entryFX = fxByEntry.get(entry.index) || [];

      // Hit reactions should have spark (critical)
      if (entry.animations.includes('HitStagger') || entry.animations.includes('Knockdown')) {
        if (!entryFX.includes('FXHitSpark') && !entryFX.includes('FXShockwave') && !entryFX.includes('FXBloodSpurt')) {
          this.addIssue('warning',
            `条目 ${entry.index}: ${entry.character} 受击（HitStagger/Knockdown）但无命中光效。受击时应有 FXHitSpark 或 FXShockwave 增强打击感`,
            entry.startTime,
            `添加 {FXHitSpark} 或 {FXShockwave} 到受击条目`,
            'BUG-EFF-FX-MISSING-HIT'
          );
        }
      }

      // Charge should have glow (critical)
      if (entry.animations.includes('SpiritGunCharge')) {
        if (!entryFX.includes('FXChargeGlow') && !entryFX.includes('FXEnergyAura')) {
          this.addIssue('warning',
            `条目 ${entry.index}: ${entry.character} 蓄力（SpiritGunCharge）但无蓄力光效。蓄力过程应有 FXChargeGlow 或 FXEnergyAura 表现能量聚集`,
            entry.startTime,
            `添加 {FXChargeGlow} 到蓄力条目`,
            'BUG-EFF-FX-MISSING-CHARGE'
          );
        }
      }

      // High speed movement should have speed lines (suggestion)
      // Skip if already checked in _checkFXActionMatch (avoid duplicate)
      const hasDash = entry.animations.includes('DashForward') || entry.animations.includes('Dodge');
      const hasSpeedFX = entryFX.includes('FXSpeedLines') || entryFX.includes('FXAfterImage');
      if (hasDash && !hasSpeedFX) {
        // Only report if not already reported by _checkFXActionMatch
        // We use a different code to distinguish
        const alreadyReported = entryFX.length > 0; // if has other FX, action match may have reported
        if (!alreadyReported) {
          this.addIssue('info',
            `条目 ${entry.index}: ${entry.character} 高速移动（DashForward/Dodge）但无速度线/残影。添加 FXSpeedLines 或 FXAfterImage 可增强速度感`,
            entry.startTime,
            `添加 {FXSpeedLines} 或 {FXAfterImage}`,
            'BUG-EFF-FX-MISSING-SPEED'
          );
        }
      }
    }
  }

  /**
   * D5-9: 光效叠加检测
   * - 同一条目过多 FX（>3 个）
   * - 冲突光效同时出现（如 FXChargeGlow + FXHitSpark — 蓄力和命中不应同时）
   */
  _checkFXStacking(fxEvents, entries) {
    const fxByEntry = new Map();
    for (const ev of fxEvents) {
      if (!ev.entry) continue;
      if (!fxByEntry.has(ev.entry.index)) fxByEntry.set(ev.entry.index, []);
      fxByEntry.get(ev.entry.index).push(ev.fxName);
    }

    for (const [entryIdx, fxs] of fxByEntry) {
      if (fxs.length > 4) {
        const entry = entries.find((e) => e.index === entryIdx);
        this.addIssue('warning',
          `条目 ${entryIdx}: 同时使用了 ${fxs.length} 个光效（${fxs.join(', ')}）。光效过多会导致画面混乱，每个特效的辨识度下降`,
          entry?.startTime,
          `精简至 2-3 个核心光效，移除冗余特效`,
          'BUG-EFF-FX-STACKING'
        );
      }

      // Check conflicting FX combinations
      const hasCharge = fxs.includes('FXChargeGlow') || fxs.includes('FXEnergyAura');
      const hasHit = fxs.includes('FXHitSpark') || fxs.includes('FXBloodSpurt');
      if (hasCharge && hasHit) {
        const entry = entries.find((e) => e.index === entryIdx);
        this.addIssue('info',
          `条目 ${entryIdx}: 同时使用了蓄力光效（ChargeGlow/EnergyAura）和命中光效（HitSpark/BloodSpurt）。蓄力和命中是不同时机的特效，同时出现可能产生视觉矛盾`,
          entry?.startTime,
          `将蓄力光效放在蓄力条目，命中光效放在攻击/受击条目`,
          'BUG-EFF-FX-CONFLICT'
        );
      }
    }
  }

  /**
   * D5-10: 光效与场景光照一致性
   * - 夜间场景光效应更亮/更明显
   * - 同一战斗序列光效风格应一致
   */
  _checkFXLightingConsistency(fxEvents, entries) {
    // Group FX by time windows to check style consistency
    const timedFX = fxEvents
      .filter((e) => e.entry && e.entry.startTime !== undefined)
      .sort((a, b) => a.entry.startTime - b.entry.startTime);

    // Check for style mixing in short windows
    const WINDOW = 15;
    for (let i = 0; i < timedFX.length; i++) {
      const startTime = timedFX[i].entry.startTime;
      const windowFX = [];

      for (let j = i; j < timedFX.length; j++) {
        if (timedFX[j].entry.startTime - startTime <= WINDOW) {
          windowFX.push(timedFX[j]);
        } else {
          break;
        }
      }

      if (windowFX.length >= 3) {
        // Check if we have both "energy" style and "physical" style FX mixed
        const energyFX = ['FXChargeGlow', 'FXEnergyAura', 'FXTrailSwipe'];
        const physicalFX = ['FXHitSpark', 'FXDustKick', 'FXBloodSpurt'];

        const hasEnergy = windowFX.some((e) => energyFX.includes(e.fxName));
        const hasPhysical = windowFX.some((e) => physicalFX.includes(e.fxName));

        if (hasEnergy && hasPhysical) {
          // This is actually normal for most fights — only flag if it's excessive
          const energyCount = windowFX.filter((e) => energyFX.includes(e.fxName)).length;
          const physicalCount = windowFX.filter((e) => physicalFX.includes(e.fxName)).length;
          if (energyCount >= 3 && physicalCount >= 3) {
            this.addIssue('info',
              `${startTime.toFixed(1)}s 附近：能量系光效（${energyCount}个）与物理系光效（${physicalCount}个）密集交替。建议统一该段落的光效风格以增强视觉连贯性`,
              startTime,
              `将能量攻击段落和物理攻击段落的光效分开，或使用统一色调`,
              'BUG-EFF-FX-STYLE-MIX'
            );
          }
        }
      }
    }
  }

  /**
   * D5-11: 光效方向与角色朝向一致性
   * - FXHitSpark/FXBloodSpurt 应该出现在攻击者面向的方向
   * - FXTrailSwipe 应该与攻击方向一致
   * - FXDustKick 应该在移动方向的后方
   */
  _checkFXDirectionConsistency(fxEvents, entries, storyText) {
    // Build character position + facing timeline from Position tags
    const charStates = new Map(); // char -> { x, z, face, time }
    const positionRegex = /\{Position:([^|}]+)\|([^}]+)\}/g;
    const lines = storyText.split('\n');
    let lineIdx = 0;

    for (const entry of entries) {
      if (entry.rawText) {
        let m;
        while ((m = positionRegex.exec(entry.rawText)) !== null) {
          const charName = m[1];
          const optsStr = m[2];
          const xMatch = optsStr.match(/x=([-\d.]+)/);
          const zMatch = optsStr.match(/z=([-\d.]+)/);
          const faceMatch = optsStr.match(/face=([^|}]+)/);
          charStates.set(charName, {
            x: xMatch ? parseFloat(xMatch[1]) : 0,
            z: zMatch ? parseFloat(zMatch[1]) : 0,
            face: faceMatch ? faceMatch[1].trim() : 'forward',
            time: entry.startTime,
          });
        }
      }
      // Also check entry.positions
      if (entry.positions) {
        for (const pos of entry.positions) {
          const charName = pos.name || pos.character;
          const opts = pos.options || {};
          charStates.set(charName, {
            x: opts.x ?? 0,
            z: opts.z ?? 0,
            face: opts.face ?? 'forward',
            time: entry.startTime,
          });
        }
      }
    }

    // FX that should align with attack direction (character's facing)
    const attackAlignedFX = ['FXHitSpark', 'FXTrailSwipe', 'FXBloodSpurt'];
    // FX that should align with movement direction (behind character)
    const movementAlignedFX = ['FXDustKick', 'FXAfterImage'];
    // FX that are omnidirectional (no direction check needed)
    const omnidirectionalFX = ['FXChargeGlow', 'FXEnergyAura', 'FXShockwave', 'FXScreenShake', 'FXSpeedLines'];

    for (const ev of fxEvents) {
      if (!ev.entry || !ev.entry.character) continue;
      const char = ev.entry.character;
      const charState = charStates.get(char);
      if (!charState) continue;

      const fxName = ev.fxName;

      // Check attack-aligned FX: character should be facing an opponent
      if (attackAlignedFX.includes(fxName)) {
        const face = charState.face;
        // If face is 'forward'/'back'/'left'/'right' without context, warn
        if (['forward', 'back', 'left', 'right'].includes(face)) {
          // Check if there's a combat action in this entry
          const hasCombat = ev.entry.animations?.some((a) =>
            ['Punch', 'Kick', 'Uppercut', 'ComboPunch', 'SpinKick', 'JumpAttack', 'SpiritSwordSwing', 'Block'].includes(a)
          );
          if (hasCombat) {
            this.addIssue('info',
              `光效方向: ${char} 使用 ${fxName} 时 face=${face}（固定方向），但战斗光效应与对手方向对齐。若对手位置变化，光效可能出现在错误方向`,
              ev.entry.startTime,
              `设置 {Position:${char}|face=对手名} 使光效方向与攻击目标一致`,
              'BUG-EFF-FX-DIR-001'
            );
          }
        }
      }

      // Check movement-aligned FX: should have a movement animation
      if (movementAlignedFX.includes(fxName)) {
        const hasMoveAnim = ev.entry.animations?.some((a) =>
          ['DashForward', 'Walk', 'Run', 'Dodge', 'Jump', 'HeroLanding'].includes(a)
        );
        const hasMoveEvent = ev.entry.storyEvents?.some((e) => e.name === 'Move');
        if (!hasMoveAnim && !hasMoveEvent) {
          this.addIssue('info',
            `光效方向: ${char} 使用 ${fxName}（移动伴随光效）但无移动动画/事件。尘土/残影效果需要角色实际移动才有意义`,
            ev.entry.startTime,
            `添加 DashForward/Walk/Run 动画，或移除 ${fxName}`,
            'BUG-EFF-FX-DIR-002'
          );
        }
      }
    }

    // Multi-character scene: check if FX from different characters point at consistent targets
    const combatEntries = entries.filter((e) =>
      e.combat || e.combatAll || e.animations?.some((a) =>
        ['Punch', 'Kick', 'SpiritSwordSwing', 'SpiritGunFire'].includes(a)
      )
    );

    for (const entry of combatEntries) {
      const entryFX = fxEvents.filter((e) => e.entry === entry).map((e) => e.fxName);
      if (entryFX.length === 0) continue;

      const charsInEntry = new Set();
      if (entry.character) charsInEntry.add(entry.character);
      if (entry.combat) {
        const opts = entry.combat.options || {};
        if (opts.attacker) charsInEntry.add(opts.attacker);
        if (opts.defender) charsInEntry.add(opts.defender);
      }
      if (entry.combatAll) {
        for (const c of entry.combatAll) {
          const opts = c.options || {};
          if (opts.attacker) charsInEntry.add(opts.attacker);
          if (opts.defender) charsInEntry.add(opts.defender);
        }
      }

      // If 3+ characters involved in combat, warn about potential direction confusion
      if (charsInEntry.size >= 3) {
        const hasDirectionalFX = entryFX.some((fx) =>
          attackAlignedFX.includes(fx) || movementAlignedFX.includes(fx)
        );
        if (hasDirectionalFX) {
          this.addIssue('info',
            `多角色战斗方向: 条目 ${entry.index} 涉及 ${charsInEntry.size} 个角色且有方向性光效（${entryFX.join(', ')}）。确保每个角色的光效方向指向正确的对手`,
            entry.startTime,
            `为每个角色明确设置 face=目标角色，或使用 {Event:Face|character=X|target=Y} 动态调整朝向`,
            'BUG-EFF-FX-MULTI-DIR-001'
          );
        }
      }
    }
  }

  _inferEmotionFromText(text) {
    if (!text) return null;
    if (/救命|救我|完蛋|死了|怎么办|不要.*啊|停.*下来/.test(text)) return 'panic';
    if (/好痛|好怕|好可怕|好危险/.test(text)) return 'scared';
    if (/笨蛋|可恶|讨厌|气死|混蛋/.test(text)) return 'angry';
    if (/太棒了|真的吗|超厉害|好厉害|太好了/.test(text)) return 'excited';
    if (/才.*不会|才.*没有|才.*不是/.test(text)) return 'defiant';
    if (/真是的|每次.*都|又.*乱来/.test(text)) return 'exasperated';
    if (/没事吧|小心|要不要|还好吗/.test(text)) return 'worried';
    if (/哈哈|嘻嘻|嘿嘿|开心|高兴/.test(text)) return 'happy';
    if (/呜呜|好难过|伤心|失望|算了/.test(text)) return 'sad';
    return 'calm';
  }
}
