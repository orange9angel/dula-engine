import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * PoseTraceInspector — D19 姿势轨迹合理性检查
 *
 * 基于 pose_trace 运行时数据（13关节点姿势矩阵）进行深度分析：
 * - D19-1: 动画姿势有效性（关节角度是否在合理范围）
 * - D19-2: 动画-姿势一致性（动画声明与实际关节运动是否匹配）
 * - D19-3: 基线校准检查（additive offset 是否正确应用）
 * - D19-4: 动作连贯性（同一角色相邻动画的关节过渡是否平滑）
 * - D19-5: 特定动作姿势验证（DragonPunch 的右臂垂直、左臂护脸等）
 * - D19-6: 面部表情-身体姿势协调性
 * - D19-7: 跳跃/位移动作的高度曲线合理性
 */
export class PoseTraceInspector extends InspectorBase {
  constructor() {
    super('PoseTraceInspector', 'D19');
  }

  inspect(context) {
    this.reset();
    const { entries, episodeDir } = context;

    const poseTrace = this._loadPoseTrace(episodeDir);
    if (!poseTrace) {
      this.addIssue('info',
        'pose_trace 数据不可用。运行 `node node_modules/dula-engine/tools/pose_trace.js <episode-dir>` 生成数据后可进行姿势深度分析',
        null,
        '运行 pose_trace 工具生成姿势轨迹数据',
        'D19-NO-DATA'
      );
      return;
    }

    this._checkJointAngleValidity(poseTrace);
    this._checkAnimationPoseConsistency(poseTrace);
    this._checkBaselineCalibration(poseTrace);
    this._checkPoseTransitionSmoothness(poseTrace);
    this._checkSpecificActionPoses(poseTrace);
    this._checkJumpHeightCurve(poseTrace);
    this._checkFaceBodyCoordination(poseTrace);
  }

  _loadPoseTrace(episodeDir) {
    if (!episodeDir) return null;
    const tracePath = path.join(episodeDir, 'storyboard', 'pose_trace', 'pose_trace.json');
    const analysisPath = path.join(episodeDir, 'storyboard', 'pose_trace', 'pose_analysis.json');
    if (!fs.existsSync(tracePath)) return null;
    try {
      const trace = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
      if (fs.existsSync(analysisPath)) {
        trace.analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
      }
      return trace;
    } catch {
      return null;
    }
  }

  /**
   * D19-1: 关节角度有效性检查
   * 各关节的旋转角度应在生物力学合理范围内
   */
  _checkJointAngleValidity(poseTrace) {
    // 生物力学合理范围（弧度）
    const jointLimits = {
      rightShoulder: { rx: { min: -Math.PI, max: Math.PI / 2 }, ry: { min: -Math.PI / 2, max: Math.PI / 2 }, rz: { min: -Math.PI / 2, max: Math.PI / 2 } },
      leftShoulder:  { rx: { min: -Math.PI, max: Math.PI / 2 }, ry: { min: -Math.PI / 2, max: Math.PI / 2 }, rz: { min: -Math.PI / 2, max: Math.PI / 2 } },
      rightElbow:    { rx: { min: -Math.PI * 0.1, max: Math.PI * 1.5 } },
      leftElbow:     { rx: { min: -Math.PI * 0.1, max: Math.PI * 1.5 } },
      rightHip:      { rx: { min: -Math.PI / 2, max: Math.PI / 2 } },
      leftHip:       { rx: { min: -Math.PI / 2, max: Math.PI / 2 } },
      rightKnee:     { rx: { min: -Math.PI * 0.1, max: Math.PI * 1.2 } },
      leftKnee:      { rx: { min: -Math.PI * 0.1, max: Math.PI * 1.2 } },
      headGroup:     { rx: { min: -Math.PI / 3, max: Math.PI / 3 }, ry: { min: -Math.PI / 2, max: Math.PI / 2 }, rz: { min: -Math.PI / 4, max: Math.PI / 4 } },
    };

    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        if (!ch.joints) continue;
        for (const [jointName, limits] of Object.entries(jointLimits)) {
          const jdata = ch.joints[jointName];
          if (!jdata) continue;
          for (const [axis, bound] of Object.entries(limits)) {
            const val = jdata[axis];
            if (!Number.isFinite(val)) continue;
            if (val < bound.min || val > bound.max) {
              const severity = Math.abs(val) > Math.PI * 2 ? 'error' : 'warning';
              this.addIssue(severity,
                `姿势有效性: ${ch.name} 的 ${jointName}.${axis}=${this._fmtAngle(val)} 超出生物力学合理范围 [${this._fmtAngle(bound.min)}, ${this._fmtAngle(bound.max)}]。可能是 additive offset 未正确叠加基线值`,
                sample.time,
                `检查 ${jointName} 的 PoseMatrix 值是否考虑了角色基线旋转`,
                'D19-JOINT-LIMIT'
              );
            }
          }
        }
      }
    }
  }

  /**
   * D19-2: 动画-姿势一致性
   * 动画播放时应有对应的关节运动
   */
  _checkAnimationPoseConsistency(poseTrace) {
    // Group by animation name
    const animRanges = new Map(); // animName -> { char -> [{ start, end, samples }] }

    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        for (const anim of ch.activeBody || []) {
          if (!animRanges.has(anim)) animRanges.set(anim, new Map());
          const charMap = animRanges.get(anim);
          if (!charMap.has(ch.name)) charMap.set(ch.name, []);
          const ranges = charMap.get(ch.name);
          const last = ranges[ranges.length - 1];
          if (last && sample.time - last.end < 0.05) {
            last.end = sample.time;
            last.samples.push(sample);
          } else {
            ranges.push({ start: sample.time, end: sample.time, samples: [sample] });
          }
        }
      }
    }

    for (const [animName, charMap] of animRanges) {
      for (const [charName, ranges] of charMap) {
        for (const range of ranges) {
          if (range.samples.length < 3) continue;

          // Check if any joint moved significantly
          let maxMovement = 0;
          const first = range.samples[0];
          const last = range.samples[range.samples.length - 1];
          const firstCh = first.characters.find((c) => c.name === charName);
          const lastCh = last.characters.find((c) => c.name === charName);
          if (!firstCh?.joints || !lastCh?.joints) continue;

          for (const [jointName, fj] of Object.entries(firstCh.joints)) {
            const lj = lastCh.joints[jointName];
            if (!lj) continue;
            for (const axis of ['rx', 'ry', 'rz', 'x', 'y', 'z']) {
              if (fj[axis] !== undefined && lj[axis] !== undefined) {
                maxMovement = Math.max(maxMovement, Math.abs(lj[axis] - fj[axis]));
              }
            }
          }

          if (maxMovement < 0.05) {
            this.addIssue('warning',
              `动画一致性: ${charName} 的 ${animName} 在 ${range.start.toFixed(2)}s-${range.end.toFixed(2)}s 期间关节最大移动仅 ${maxMovement.toFixed(3)} rad。动画可能未正确应用或姿势值过小`,
              range.start,
              `检查 ${animName} 的 PoseMatrix 值 — 可能所有偏移量接近零`,
              'D19-ANIM-NO-MOVE'
            );
          }
        }
      }
    }
  }

  /**
   * D19-3: 基线校准检查
   * 检查 poseOffset + baseline 是否等于 actual joint value
   */
  _checkBaselineCalibration(poseTrace) {
    const checkJoints = ['rightShoulder', 'leftShoulder', 'rightElbow', 'leftElbow', 'rightHip', 'leftHip'];

    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        if (!ch.poseOffset || !ch.baseline) continue;
        for (const joint of checkJoints) {
          const actual = ch.joints?.[joint]?.rx;
          const offset = ch.poseOffset?.[joint]?.rx ?? 0;
          const base = ch.baseline?.[joint]?.rx ?? 0;
          const expected = base + offset;
          if (Number.isFinite(actual) && Number.isFinite(expected)) {
            const diff = Math.abs(actual - expected);
            if (diff > 0.02) {
              this.addIssue('error',
                `基线校准: ${ch.name} ${joint}.rx 实际值(${this._fmtAngle(actual)}) ≠ 基线(${this._fmtAngle(base)}) + 偏移(${this._fmtAngle(offset)}) = ${this._fmtAngle(expected)}，偏差 ${diff.toFixed(3)} rad。ActionMatrixController 可能未正确应用 offset`,
                sample.time,
                `检查 ActionMatrixController._applyPose() 中 ${joint} 的应用逻辑`,
                'D19-BASELINE-MISMATCH'
              );
            }
          }
        }

        // Check mesh Y
        const actualY = ch.joints?.mesh?.y;
        const offsetY = ch.poseOffset?.mesh?.y ?? 0;
        const baseY = ch.baseline?.mesh?.y ?? 0;
        const expectedY = baseY + offsetY;
        if (Number.isFinite(actualY) && Number.isFinite(expectedY)) {
          const diffY = Math.abs(actualY - expectedY);
          if (diffY > 0.02) {
            this.addIssue('error',
              `基线校准: ${ch.name} mesh.y 实际值(${actualY.toFixed(3)}) ≠ 基线(${baseY.toFixed(3)}) + 偏移(${offsetY.toFixed(3)}) = ${expectedY.toFixed(3)}，偏差 ${diffY.toFixed(3)}`,
              sample.time,
              `检查 ActionMatrixController._applyPose() 中 mesh.y 的应用逻辑`,
              'D19-BASELINE-MESHY'
            );
          }
        }
      }
    }
  }

  /**
   * D19-4: 姿势过渡平滑性
   * 相邻动画之间的关节角度变化不应有突变
   */
  _checkPoseTransitionSmoothness(poseTrace) {
    const byChar = new Map();
    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        if (!byChar.has(ch.name)) byChar.set(ch.name, []);
        byChar.get(ch.name).push({ time: sample.time, joints: ch.joints, activeBody: ch.activeBody });
      }
    }

    for (const [charName, samples] of byChar) {
      for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1];
        const curr = samples[i];
        const dt = curr.time - prev.time;
        if (dt > 0.1) continue; // Only check consecutive frames

        // Detect animation change
        const prevAnims = new Set(prev.activeBody || []);
        const currAnims = new Set(curr.activeBody || []);
        const changed = [...prevAnims].some((a) => !currAnims.has(a)) || [...currAnims].some((a) => !prevAnims.has(a));
        if (!changed) continue;

        // Check for sudden joint jumps
        const checkJoints = ['rightShoulder', 'leftShoulder', 'rightElbow', 'leftElbow', 'rightHip', 'leftHip'];
        for (const joint of checkJoints) {
          const pv = prev.joints?.[joint]?.rx;
          const cv = curr.joints?.[joint]?.rx;
          if (!Number.isFinite(pv) || !Number.isFinite(cv)) continue;
          const delta = Math.abs(cv - pv);
          const speed = delta / dt;
          if (speed > 15) { // More than 15 rad/s is suspicious
            this.addIssue('warning',
              `过渡平滑性: ${charName} 在 ${curr.time.toFixed(2)}s 动画切换时 ${joint}.rx 突变 ${this._fmtAngle(delta)} (${speed.toFixed(1)} rad/s)。${[...prevAnims].join(',')} → ${[...currAnims].join(',')}`,
              curr.time,
              `增加过渡时间或使用 PoseMatrix.lerp 平滑过渡`,
              'D19-TRANSITION-JUMP'
            );
          }
        }
      }
    }
  }

  /**
   * D19-5: 特定动作姿势验证
   * 对关键动作（DragonPunch, FightingStance 等）进行姿势语义检查
   */
  _checkSpecificActionPoses(poseTrace) {
    // DragonPunch: 右臂应垂直向上（uppercut），左臂应护脸
    this._checkDragonPunchPose(poseTrace);
    // FightingStance: 双臂应在前方防御位置
    this._checkFightingStancePose(poseTrace);
  }

  _checkDragonPunchPose(poseTrace) {
    const dpSamples = [];
    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        if ((ch.activeBody || []).includes('DragonPunch')) {
          dpSamples.push({ time: sample.time, character: ch.name, joints: ch.joints, poseOffset: ch.poseOffset, baseline: ch.baseline });
        }
      }
    }

    if (dpSamples.length === 0) return;

    // Find peak phase (highest mesh Y)
    const peak = dpSamples.reduce((best, s) => {
      const my = s.joints?.mesh?.y ?? 0;
      return my > (best?.joints?.mesh?.y ?? 0) ? s : best;
    }, null);

    if (!peak) return;

    // At peak: right shoulder should be raised high (rx near vertical-up)
    // For Yusuke: baseline arm points down (from lookAt + rotateX), so to go UP we need rx offset ≈ +π
    const rs = peak.joints?.rightShoulder;
    const ls = peak.joints?.leftShoulder;
    const re = peak.joints?.rightElbow;
    const le = peak.joints?.leftElbow;

    if (rs) {
      // For a proper uppercut, right arm should point roughly upward
      // In Yusuke's coordinate system: rx ≈ 0 means arm points down (baseline)
      // rx ≈ -π/2 means arm points forward
      // rx ≈ +π means arm points UP (180° from down)
      // But we need to check the actual world orientation, not just local rx
      const isArmUp = rs.rx < -1.0 || rs.rx > 2.0; // rough heuristic
      if (!isArmUp) {
        this.addIssue('warning',
          `DragonPunch 姿势: ${peak.character} 在峰值时刻(t=${peak.time.toFixed(2)}s) rightShoulder.rx=${this._fmtAngle(rs.rx)}，右臂未呈现垂直上勾姿势。升龙拳需要右臂高举`,
          peak.time,
          `调整 DragonPunch PoseMatrix: rightShoulder.rx 需要更大的负值或正值使手臂垂直向上。当前基线=${this._fmtAngle(peak.baseline?.rightShoulder?.rx)}，需要 offset 使总和接近垂直`,
          'D19-DP-ARM-UP'
        );
      }
    }

    if (ls) {
      // Left arm should guard face (bent, near head)
      const isGuard = ls.rx < -0.5 && le && le.rx < -0.5;
      if (!isGuard) {
        this.addIssue('info',
          `DragonPunch 姿势: ${peak.character} 在峰值时刻 leftShoulder.rx=${this._fmtAngle(ls?.rx)} leftElbow.rx=${this._fmtAngle(le?.rx)}，左臂未呈现护脸姿势`,
          peak.time,
          `调整 leftShoulder.rx 和 leftElbow.rx 使左臂弯曲护在脸前`,
          'D19-DP-LEFT-GUARD'
        );
      }
    }

    // Check crouch phase visibility
    const crouchSamples = dpSamples.filter((s) => s.time < peak.time && s.time <= peak.time - 0.2);
    if (crouchSamples.length > 0) {
      const firstCrouch = crouchSamples[0];
      const meshY = firstCrouch.joints?.mesh?.y;
      if (Number.isFinite(meshY) && meshY > 0.3) {
        this.addIssue('info',
          `DragonPunch 蓄力: ${firstCrouch.character} 下蹲阶段 mesh.y=${meshY.toFixed(3)}，下蹲不够明显。蓄力阶段应有明显的身体下沉`,
          firstCrouch.time,
          `增加 mesh.y 负偏移（如 -0.5）使下蹲更明显，或延长蓄力阶段持续时间`,
          'D19-DP-CROUCH'
        );
      }
    }

    // Check jump height
    const maxY = Math.max(...dpSamples.map((s) => s.joints?.mesh?.y ?? 0));
    if (maxY < 1.0) {
      this.addIssue('warning',
        `DragonPunch 高度: ${peak.character} 最大跳跃高度仅 ${maxY.toFixed(2)}m。升龙拳应有明显的腾空高度（建议 >2m）`,
        peak.time,
        `增加 mesh.y 偏移使角色跳得更高`,
        'D19-DP-HEIGHT'
      );
    }
  }

  _checkFightingStancePose(poseTrace) {
    const fsSamples = [];
    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        if ((ch.activeBody || []).includes('FightingStance')) {
          fsSamples.push({ time: sample.time, character: ch.name, joints: ch.joints });
        }
      }
    }

    if (fsSamples.length === 0) return;

    // Fighting stance: arms should be in front (not T-pose)
    const midSample = fsSamples[Math.floor(fsSamples.length / 2)];
    const rs = midSample.joints?.rightShoulder;
    const ls = midSample.joints?.leftShoulder;

    if (rs && ls) {
      const armSum = Math.abs(rs.rx) + Math.abs(ls.rx);
      if (armSum < 0.3) {
        this.addIssue('warning',
          `格斗架势: ${midSample.character} FightingStance 时双臂角度和仅 ${armSum.toFixed(3)} rad，接近 T-pose。格斗架势应有双臂前伸防御姿势`,
          midSample.time,
          `检查 FightingStance 的 PoseMatrix 值，确保 shoulders 和 elbows 有非零偏移`,
          'D19-FS-TPOSE'
        );
      }
    }
  }

  /**
   * D19-6: 面部表情-身体姿势协调性
   */
  _checkFaceBodyCoordination(poseTrace) {
    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        const hasFace = (ch.activeFace || []).length > 0;
        const hasBody = (ch.activeBody || []).length > 0;
        if (!hasFace || !hasBody) continue;

        // FacePain should accompany HitStagger/Knockdown
        if (ch.activeFace.includes('FacePain')) {
          const hasHit = (ch.activeBody || []).some((a) => ['HitStagger', 'Knockdown'].includes(a));
          if (!hasHit) {
            this.addIssue('info',
              `表情协调: ${ch.name} 使用 FacePain 但无受击动画 (${ch.activeBody.join(', ')})。痛苦表情应配合受击动作`,
              sample.time,
              `添加 HitStagger/Knockdown 或将 FacePain 改为其他表情`,
              'D19-FACE-PAIN-NO-HIT'
            );
          }
        }
      }
    }
  }

  /**
   * D19-7: 跳跃高度曲线合理性
   */
  _checkJumpHeightCurve(poseTrace) {
    const byChar = new Map();
    for (const sample of poseTrace.samples) {
      for (const ch of sample.characters) {
        if (!byChar.has(ch.name)) byChar.set(ch.name, []);
        byChar.get(ch.name).push({ time: sample.time, y: ch.joints?.mesh?.y, activeBody: ch.activeBody });
      }
    }

    for (const [charName, samples] of byChar) {
      // Find jump sequences (consecutive frames with mesh.y > 0.3)
      let inJump = false;
      let jumpStart = null;
      let jumpSamples = [];

      for (const s of samples) {
        const isJumping = Number.isFinite(s.y) && s.y > 0.3;
        const hasJumpAnim = (s.activeBody || []).some((a) =>
          ['DragonPunch', 'JumpAttack', 'JumpFlyingKick', 'HeroLanding'].includes(a)
        );

        if (isJumping && hasJumpAnim) {
          if (!inJump) {
            inJump = true;
            jumpStart = s.time;
            jumpSamples = [s];
          } else {
            jumpSamples.push(s);
          }
        } else if (inJump && (!isJumping || s.time - jumpSamples[jumpSamples.length - 1].time > 0.1)) {
          // Jump ended
          this._analyzeJumpCurve(charName, jumpStart, jumpSamples);
          inJump = false;
          jumpSamples = [];
        }
      }
      if (inJump && jumpSamples.length > 0) {
        this._analyzeJumpCurve(charName, jumpStart, jumpSamples);
      }
    }
  }

  _analyzeJumpCurve(charName, jumpStart, jumpSamples) {
    if (jumpSamples.length < 5) return;

    const ys = jumpSamples.map((s) => s.y);
    const maxY = Math.max(...ys);
    const maxIdx = ys.indexOf(maxY);

    // Check if peak is near middle (parabolic)
    const peakRatio = maxIdx / ys.length;
    if (peakRatio < 0.2) {
      this.addIssue('info',
        `跳跃曲线: ${charName} 跳跃峰值出现在 ${peakRatio.toFixed(2)} 处（过早），建议峰值在中间附近以形成抛物线`,
        jumpStart,
        `调整动画时间分配：蓄力更长，腾空时间更均匀`,
        'D19-JUMP-PEAK-EARLY'
      );
    }

    // Check landing
    const lastY = ys[ys.length - 1];
    if (lastY > 0.2) {
      this.addIssue('info',
        `跳跃曲线: ${charName} 跳跃结束时 mesh.y=${lastY.toFixed(3)}，未完全落地。应在动画结束前恢复 y=0`,
        jumpSamples[jumpSamples.length - 1].time,
        `在动画最后阶段将 mesh.y 平滑过渡回 0`,
        'D19-JUMP-NO-LAND'
      );
    }
  }

  _fmtAngle(rad) {
    if (!Number.isFinite(rad)) return '?';
    const deg = (rad * 180 / Math.PI).toFixed(0);
    return `${rad.toFixed(2)}rad(${deg}°)`;
  }
}
