import { InspectorBase } from './InspectorBase.js';

/**
 * AnimationInspector — D3 动作语义检查
 *
 * 检查范围:
 * - 动画是否在 AnimationRegistry 中注册
 * - 移动事件速度/时长合理性
 * - 动画重叠检测
 * - 动画-角色能力匹配
 */
export class AnimationInspector extends InspectorBase {
  constructor() {
    super('AnimationInspector', 'D3');
  }

  inspect(context) {
    this.reset();
    const { entries, registeredAnims, storyText, episodeDir } = context;

    const usedAnimations = new Set();
    const charAnimations = new Map();

    // Known animations from dula-assets
    const knownAnims = new Set([
      // Common
      'Walk', 'Run', 'WaveHand', 'Jump', 'StompFoot', 'SwayBody', 'Nod', 'ShakeHead',
      'TurnToCamera', 'SwingRacket', 'Bow', 'LookAround', 'PointForward', 'ScratchHead',
      'HandsOnHips', 'ClapHands', 'Celebrate', 'Shrug', 'SurprisedJump', 'Tremble',
      'Think', 'SitDown', 'CrossArms', 'FlailArms', 'LookUp', 'ReachOut',
      // Doraemon
      'PullOutRacket', 'TakeOutFromPocket', 'Spin', 'PanicSpin', 'NoseBlink',
      'Float', 'WaddleWalk', 'ReachHand',
      // Nobita
      'Cry', 'LazyStretch', 'Grovel', 'StudyDespair', 'TriumphPose', 'RunAway',
      'CrashLand', 'FallPanic', 'FlyPose',
      // Shizuka
      'Curtsy', 'Giggle', 'PlayViolin', 'Scold', 'Blush', 'Baking', 'LookUpSky', 'WaveUp',
      // Xiaoyue / Xingzai
      'TandemFlight',
    ]);

    for (const entry of entries) {
      if (entry.animations) {
        for (const anim of entry.animations) {
          usedAnimations.add(anim);
          if (entry.character) {
            if (!charAnimations.has(entry.character)) {
              charAnimations.set(entry.character, []);
            }
            charAnimations.get(entry.character).push({ name: anim, start: entry.startTime, end: entry.endTime });
          }
        }
      }

      // Check move events
      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.name === 'Move') {
            const opts = ev.options;
            const dx = opts.x || 0;
            const dy = opts.y || 0;
            const dz = opts.z || 0;
            const duration = opts.duration || 1.0;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const speed = dist / duration;

            if (speed > 15) {
              this.addIssue('warning', `角色 ${opts.character || entry.character} 移动速度过快 (${speed.toFixed(1)} m/s)`, entry.startTime, '降低移动距离或增加 duration');
            }
            if (duration < 0.1) {
              this.addIssue('warning', `角色 ${opts.character || entry.character} 移动时间过短 (${duration.toFixed(2)}s)`, entry.startTime, '增加 duration 到至少 0.3s');
            }
          }
        }
      }
    }

    // Check animation registry
    for (const animName of usedAnimations) {
      const isRegistered = registeredAnims.has(animName) || knownAnims.has(animName);
      // Also check if bootstrap imports from dula-assets (which registers known anims)
      const hasBootstrap = context.bootstrapText && context.bootstrapText.includes('registerAll');
      const isKnownViaAssets = hasBootstrap && knownAnims.has(animName);
      if (!isRegistered && !isKnownViaAssets) {
        this.addIssue('error', `动画 "${animName}" 未在 AnimationRegistry 中注册`, null, `在 dula-assets 中注册动画或使用正确的动画名`, 'BUG-3');
      }
    }

    // Check animation overlap
    for (const [charName, anims] of charAnimations) {
      for (let i = 0; i < anims.length; i++) {
        for (let j = i + 1; j < anims.length; j++) {
          const a1 = anims[i];
          const a2 = anims[j];
          if (a1.start < a2.end && a2.start < a1.end) {
            this.addIssue('info', `角色 ${charName} 在 ${a1.start.toFixed(2)}s-${Math.min(a1.end, a2.end).toFixed(2)}s 有重叠动画 (${a1.name} + ${a2.name})`, a1.start, '确保动画可以叠加执行');
          }
        }
      }
    }

    // Check animation-character capability matching
    const animCharRestrictions = {
      'Float': ['Doraemon'],
      'PullOutRacket': ['Doraemon'],
      'TakeOutFromPocket': ['Doraemon'],
      'PanicSpin': ['Doraemon'],
      'NoseBlink': ['Doraemon'],
      'WaddleWalk': ['Doraemon'],
      'Cry': ['Nobita'],
      'LazyStretch': ['Nobita'],
      'Grovel': ['Nobita'],
      'StudyDespair': ['Nobita'],
      'TriumphPose': ['Nobita'],
      'RunAway': ['Nobita'],
      'CrashLand': ['Nobita'],
      'FallPanic': ['Nobita'],
      'FlyPose': ['Nobita'],
      'Curtsy': ['Shizuka'],
      'Giggle': ['Shizuka'],
      'PlayViolin': ['Shizuka'],
      'Scold': ['Shizuka'],
      'Blush': ['Shizuka'],
      'Baking': ['Shizuka'],
      'LookUpSky': ['Shizuka'],
      'WaveUp': ['Shizuka'],
    };

    for (const entry of entries) {
      if (!entry.animations || !entry.character) continue;
      for (const animName of entry.animations) {
        const allowedChars = animCharRestrictions[animName];
        if (allowedChars && !allowedChars.includes(entry.character)) {
          this.addIssue('warning', `动画 "${animName}" 是 ${allowedChars.join('/')} 专属，角色 ${entry.character} 可能不支持`, entry.startTime, `更换为通用动画或 ${allowedChars.join('/')} 专属动画`);
        }
      }
    }
  }
}
