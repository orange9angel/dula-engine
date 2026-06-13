import * as THREE from 'three';
import { StoryParser } from '../lib/StoryParser.js';
import { SceneRegistry } from '../scenes/index.js';
import { CharacterRegistry } from '../characters/index.js';
import { VoiceRegistry } from '../voices/index.js';
import { AnimationRegistry } from '../animations/index.js';
import { CameraMoveRegistry } from '../camera/index.js';
import { DirectorRegistry } from '../lib/DirectorRegistry.js';
import { TransitionRegistry } from '../transitions/index.js';
import { PostProcessRegistry } from '../postprocessing/index.js';
import { MusicDirector, MusicCue } from '../lib/MusicDirector.js';
import { HitstopManager } from '../lib/HitstopManager.js';
import { generateMouthCue } from '../lib/AudioMouthCue.js';


const DEFAULT_TRANSITIONS = {
  exits: {},
  entrances: {},
};

const HURDLE_START_Z = -50;
const HURDLE_START_TO_FIRST = 13.72;
const HURDLE_SPACING = 9.14;
const HURDLE_ZS = Array.from(
  { length: 10 },
  (_, i) => HURDLE_START_Z + HURDLE_START_TO_FIRST + i * HURDLE_SPACING
);

export class Storyboard {
  constructor(renderer, camera, audioDestination = null, outlineEffect = null) {
    this.renderer = renderer;
    this.camera = camera;
    // outlineEffect is deprecated, use postProcesses array instead
    this.outlineEffect = outlineEffect;
    this.postProcesses = [];
    if (outlineEffect) {
      this.postProcesses.push(outlineEffect);
    }
    this.currentScene = null;
    this.currentSceneName = null;
    this.characters = new Map(); // name -> instance
    this.entries = [];
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.audioDestination = audioDestination;
    this.audioBuffers = new Map(); // index -> AudioBuffer
    this.mouthCues = new Map(); // index -> audio-derived mouth cue
    this.activeSources = [];
    this.startTime = 0;
    this.isPlaying = false;
    this.pausedAt = 0;
    this.cameraMoves = []; // queued camera movements
    this.courtDirector = null;
    this.ballEvents = [];  // precomputed ball trajectories for ParkScene
    this.musicDirector = new MusicDirector();
    this.transitions = DEFAULT_TRANSITIONS;
    this.choreography = null;
    this.activeTransition = null;
    this.transitionScene = new THREE.Scene();
    this.hitstopManager = new HitstopManager();
    this.combatDirector = null;
    this.cinematicAdapter = null;
    this.sceneDirector = null;
    this.timeScaleEvents = []; // { startTime, endTime, scale }
  }

  _queueHurdleRun(char, ev) {
    const options = ev.options || {};
    const numberOption = (key, fallback) => {
      const n = Number(options[key]);
      return Number.isFinite(n) ? n : fallback;
    };
    const numberValue = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const startTime = ev.startTime;
    const duration = Math.max(0.1, numberValue(options.duration ?? ev.duration, 1.0));
    const x = numberOption('x', char.mesh.position.x);
    const fromZ = numberOption('fromZ', char.mesh.position.z);
    const toZ = numberValue(options.z ?? options.toZ, char.mesh.position.z);
    const groundY = numberValue(options.groundY ?? options.y, 0);
    const finalY = numberOption('landY', groundY);
    const jumpHeight = numberOption('jumpHeight', 1.35);
    // 跨栏专用：更大的起跳/落地区间，让抛物线更明显
    const takeoffDistance = Math.max(0.3, numberOption('takeoffDistance', 1.45));
    const landingDistance = Math.max(0.3, numberOption('landingDistance', 1.55));
    const jumpDuration = Math.max(0.55, numberOption('jumpDuration', 0.95));
    const direction = toZ >= fromZ ? 1 : -1;
    const totalDistance = Math.max(0.001, Math.abs(toZ - fromZ));
    const lowZ = Math.min(fromZ, toZ);
    const highZ = Math.max(fromZ, toZ);

    const isInsideSegment = (z, margin = 0.05) => z > lowZ + margin && z < highZ - margin;
    const addWaypoint = (points, z, y) => {
      if (!isInsideSegment(z, -0.001)) return;
      const previous = points[points.length - 1];
      if (previous && Math.abs(previous.z - z) < 0.001 && Math.abs(previous.y - y) < 0.001) return;
      points.push({ x, y, z });
    };

    const hurdleZs = HURDLE_ZS
      .filter((z) => isInsideSegment(z))
      .sort((a, b) => direction * (a - b));

    // 构建路径点：起跳点(y=0) → 栏架前上升点 → 栏架顶点(y=jumpHeight) → 栏架后下降点 → 落地点(y=0)
    const waypoints = [];
    for (const hurdleZ of hurdleZs) {
      // 起跳点：提前开始上升
      addWaypoint(waypoints, hurdleZ - direction * takeoffDistance, groundY);
      // 上升中点：已经离地
      addWaypoint(waypoints, hurdleZ - direction * takeoffDistance * 0.45, groundY + jumpHeight * 0.55);
      // 栏架顶点：最高处
      addWaypoint(waypoints, hurdleZ, groundY + jumpHeight);
      // 下降中点：开始下落
      addWaypoint(waypoints, hurdleZ + direction * landingDistance * 0.45, groundY + jumpHeight * 0.55);
      // 落地点：回到地面
      addWaypoint(waypoints, hurdleZ + direction * landingDistance, groundY);
    }
    waypoints.push({ x, y: finalY, z: toZ });

    let cursor = startTime;
    for (let i = 0; i < waypoints.length; i++) {
      const point = waypoints[i];
      const progress = Math.min(1, Math.max(0, Math.abs(point.z - fromZ) / totalDistance));
      const pointTime = i === waypoints.length - 1
        ? startTime + duration
        : startTime + duration * progress;
      if (pointTime <= cursor + 0.03) continue;
      char.moveTo(point, cursor, pointTime - cursor);
      cursor = pointTime;
    }

    // 播放跑步动画（全程）
    const MoveAnimClass = AnimationRegistry[options.action || 'Run'];
    if (MoveAnimClass) {
      char.playAnimation(MoveAnimClass, startTime, duration, options);
    }

    // 为每个栏架播放跳跃动画，与路径同步
    const JumpAnimClass = AnimationRegistry['CrouchJump'];
    const DustAnimClass = AnimationRegistry['FXDustKick'];
    for (const hurdleZ of hurdleZs) {
      const progress = Math.min(1, Math.max(0, Math.abs(hurdleZ - fromZ) / totalDistance));
      const peakTime = startTime + duration * progress;
      // 跳跃动画提前开始（包含起跳蓄力），与路径同步
      const jumpStart = Math.max(startTime, peakTime - jumpDuration * 0.6);
      if (JumpAnimClass) {
        char.playAnimation(JumpAnimClass, jumpStart, jumpDuration, {
          ...options,
          height: jumpHeight,
          duration: jumpDuration,
          arms: options.arms || 'balance',
        });
      }
      // 落地尘土效果
      if (DustAnimClass && options.dust !== false && options.dust !== 'false') {
        char.playAnimation(
          DustAnimClass,
          Math.min(startTime + duration - 0.1, peakTime + jumpDuration * 0.35),
          undefined,
          options
        );
      }
    }
  }

  async load(storyPath, manifestPath) {
    // Load SRT
    const storyResponse = await fetch(storyPath);
    const storyText = await storyResponse.text();
    this.entries = StoryParser.parse(storyText);

    // Derive episode base URL from storyPath (e.g., "/episode/script.story" -> "/episode/")
    const episodeBase = storyPath.substring(0, storyPath.lastIndexOf('/') + 1);

    // Load transitions config
    try {
      const transResponse = await fetch(`${episodeBase}config/transitions.json`);
      this.transitions = await transResponse.json();
    } catch (e) {
      console.warn('No transitions config found, using defaults.');
    }

    // Load choreography config
    try {
      const choreoResponse = await fetch(`${episodeBase}config/choreography.json`);
      this.choreography = await choreoResponse.json();
    } catch (e) {
      console.warn('No choreography config found.');
    }

    // Load audio manifest
    let manifest = { entries: [] };
    try {
      const manifestResponse = await fetch(manifestPath);
      manifest = await manifestResponse.json();
    } catch (e) {
      console.warn('No audio manifest found, running silent mode.');
    }

    // Decode audio files & record actual durations
    const manifestBase = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1);
    this.audioDurations = new Map();
    for (const item of manifest.entries) {
      try {
        const audioUrl = item.file.startsWith('/') ? item.file : manifestBase + item.file;
        const resp = await fetch(audioUrl);
        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.audioBuffers.set(item.index, audioBuffer);
        const mouthCue = generateMouthCue(audioBuffer);
        if (mouthCue) {
          this.mouthCues.set(item.index, mouthCue);
        }
        if (item.audioDuration) {
          this.audioDurations.set(item.index, item.audioDuration);
        }
      } catch (err) {
        console.error(`Failed to load audio for entry ${item.index}:`, err);
      }
    }

    // DialogueScheduler: apply manifest-adjusted start/end times to entries
    // This prevents audio overlaps by using the scheduled times from generate_audio.py
    let scheduleAdjustments = 0;
    let maxAudioEnd = 0;
    for (const item of manifest.entries) {
      const entry = this.entries.find(e => e.index === item.index);
      if (entry && item.startTime !== undefined) {
        const startDiff = Math.abs(item.startTime - entry.startTime);
        if (startDiff > 0.01) {
          console.log(`[DialogueScheduler] Entry ${item.index} (${entry.character}): ${entry.startTime.toFixed(2)}s -> ${item.startTime.toFixed(2)}s (+${(item.startTime - entry.startTime).toFixed(2)}s)`);
          entry.startTime = item.startTime;
          scheduleAdjustments++;
        }
        if (item.endTime !== undefined && Math.abs(item.endTime - entry.endTime) > 0.01) {
          entry.endTime = item.endTime;
        }
      }
      // Track the maximum audio end time for total duration calculation
      if (item.audioDuration && item.startTime !== undefined) {
        maxAudioEnd = Math.max(maxAudioEnd, item.startTime + item.audioDuration);
      }
    }
    if (scheduleAdjustments > 0) {
      console.log(`[DialogueScheduler] Applied ${scheduleAdjustments} schedule adjustment(s) to prevent audio overlaps.`);
    }
    // Expose total audio duration so renderer can match video length to audio
    this.totalAudioDuration = maxAudioEnd > 0 ? maxAudioEnd : null;

    // Extract story-level choreography from .story DSL tags early
    // so switchScene can apply placements & props for the initial scene.
    this.storyPlacements = [];
    this.storyProps = [];
    this.storyBallEvents = [];
    this.storyEvents = [];

    let sceneCursor = this.entries.find((e) => e.scene)?.scene || 'RoomScene';
    for (const entry of this.entries) {
      if (entry.scene) sceneCursor = entry.scene;
      if (entry.positions) {
        for (const pos of entry.positions) {
          this.storyPlacements.push({
            character: pos.name,
            spot: pos.options.spot,
            x: pos.options.x,
            y: pos.options.y,
            z: pos.options.z,
            face: pos.options.face,
            scene: sceneCursor,
            startTime: entry.startTime,
          });
        }
      }
      if (entry.propOps) {
        for (const po of entry.propOps) {
          this.storyProps.push({
            type: po.name.toLowerCase(),
            character: po.options.character,
            color: po.options.color,
          });
        }
      }
      if (entry.ballEvents) {
        for (const be of entry.ballEvents) {
          this.storyBallEvents.push({
            type: be.name.toLowerCase() === 'serve' || be.name.toLowerCase() === 'return' ? 'player' : be.name.toLowerCase(),
            startTime: entry.startTime,
            from: be.options.from,
            to: be.options.to,
            arcHeight: be.options.arcHeight,
            speed: be.options.speed,
          });
        }
      }
      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          this.storyEvents.push({
            type: ev.name.toLowerCase(),
            character: ev.options.character,
            startTime: entry.startTime,
            duration: ev.options.duration,
            relative: ev.options.relative === true || ev.options.relative === 'true' || ev.options.relative === 1,
            x: ev.options.x,
            y: ev.options.y,
            z: ev.options.z,
            action: ev.options.action,
            target: ev.options.target,
            options: ev.options,
          });
        }
      }
      if (entry.dunkEvents) {
        for (const de of entry.dunkEvents) {
          this.storyEvents.push({
            type: 'dunk',
            character: entry.character || de.options.character,
            startTime: entry.startTime,
            hoop: de.options.hoop || 'north',
            jumpHeight: de.options.jumpHeight,
            hangTime: de.options.hangTime,
            approachAngle: de.options.approachAngle,
            runUpDistance: de.options.runUpDistance,
            releaseHeight: de.options.releaseHeight,
          });
        }
      }
    }

    // Initialize first scene if specified
    const firstSceneEntry = this.entries.find((e) => e.scene);
    const initialSceneName = firstSceneEntry ? firstSceneEntry.scene : 'RoomScene';
    this.switchScene(initialSceneName, false, 0);

    // Precompute which characters appear in which scenes
    this.characterScenes = new Map();
    let charSceneCursor = initialSceneName;
    for (const entry of this.entries) {
      if (entry.scene) charSceneCursor = entry.scene;
      if (entry.character) {
        if (!this.characterScenes.has(entry.character)) {
          this.characterScenes.set(entry.character, new Set());
        }
        this.characterScenes.get(entry.character).add(charSceneCursor);
      }
      // Also include characters from Position tags
      if (entry.positions) {
        for (const pos of entry.positions) {
          if (!this.characterScenes.has(pos.name)) {
            this.characterScenes.set(pos.name, new Set());
          }
          this.characterScenes.get(pos.name).add(charSceneCursor);
        }
      }
    }

    // Spawn characters mentioned in SRT (speaking or in story events)
    const mentionedChars = new Set(this.entries.map((e) => e.character).filter(Boolean));
    for (const entry of this.entries) {
      if (entry.storyEvents) {
        for (const ev of entry.storyEvents) {
          if (ev.options && ev.options.character) {
            mentionedChars.add(ev.options.character);
          }
        }
      }
    }
    for (const name of mentionedChars) {
      const CharClass = CharacterRegistry[name];
      if (CharClass) {
        const instance = new CharClass();
        this.characters.set(name, instance);
      }
    }

    // Add only characters that belong to the initial scene
    for (const [name, char] of this.characters) {
      const scenes = this.characterScenes.get(name);
      if (scenes && scenes.has(initialSceneName) && this.currentScene) {
        this.currentScene.addCharacter(char);
      }
    }

    // Apply story placements for initial scene (before arrangeCharacters)
    // Only apply placements belonging to the current scene
    // Note: switchScene already applied placements with currentTime=0, so we skip duplicates here
    const currentPlacements = this.storyPlacements?.filter(p => p.scene === initialSceneName && (p.startTime === undefined || p.startTime <= 0)) || [];
    // First pass: set all positions (only for characters not already positioned by switchScene)
    for (const p of currentPlacements) {
      const char = this.characters.get(p.character);
      if (!char) continue;
      if (p.x !== undefined && p.z !== undefined) {
        char.setPosition(p.x, p.y !== undefined ? p.y : 0, p.z);
      }
    }
    // Second pass: apply faces (after all positions are set)
    for (const p of currentPlacements) {
      const char = this.characters.get(p.character);
      if (!char || !p.face) continue;
      if (p.face === 'center') {
        // Only rotate horizontally toward center, keep upright
        const dx = 0 - char.mesh.position.x;
        const dz = 0 - char.mesh.position.z;
        char.mesh.rotation.y = Math.atan2(dx, dz);
      } else if (p.face === 'forward') {
        char.mesh.lookAt(char.mesh.position.x, char.mesh.position.y, char.mesh.position.z + 5);
      } else if (p.face === 'right') {
        // Face +X direction
        char.mesh.rotation.y = Math.PI / 2;
      } else if (p.face === 'left') {
        // Face -X direction
        char.mesh.rotation.y = -Math.PI / 2;
      } else if (p.face === 'back') {
        // Face -Z direction
        char.mesh.rotation.y = Math.PI;
      } else {
        const targetChar = this.characters.get(p.face);
        if (targetChar) {
          // Only rotate horizontally toward target, keep upright
          const dx = targetChar.mesh.position.x - char.mesh.position.x;
          const dz = targetChar.mesh.position.z - char.mesh.position.z;
          char.mesh.rotation.y = Math.atan2(dx, dz);
        } else {
          const dx = 0 - char.mesh.position.x;
          const dz = 0 - char.mesh.position.z;
          char.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    // Position characters (only fills in missing positions/faces)
    this.arrangeCharacters();

    // Apply story props AFTER characters are created and added to scene
    if (this.storyProps) {
      for (const p of this.storyProps) {
        const char = this.characters.get(p.character);
        if (!char) continue;
        if (p.type === 'takecopter' && char.attachTakeCopter) {
          char.attachTakeCopter();
        }
        if (p.type === 'letter' && char.attachLetter) {
          char.attachLetter();
        }
      }
    }

    // Queue animations from SRT entries
    const LOOPING_ANIMATIONS = new Set([
      'Walk', 'Run', 'Swim', 'Tremble', 'FlailArms',
      'FXEnergyAura', 'FightingStance', 'CounterStance', 'Crouch',
    ]);
    const ONE_SHOT_BODY_ANIMS = new Set([
      'Punch', 'LeftPunch', 'RightPunch', 'LeftRightPunchCombo', 'ComboPunch',
      'Kick', 'SpinKick', 'ArcadeSpinKick', 'JumpFlyingKick', 'Uppercut',
      'LeftHook', 'RightHook',
      'AirTatsumaki', 'RyuHurricaneKick', 'TatsumakiSenpuuKyaku',
      'WeaveStep', 'HurricaneKick', 'DragonPunch', 'BackFist', 'SweepKick', 'KneeStrike',
      'CrouchJump',
      'SpiritSwordSwing', 'SpiritGunFire', 'SpiritGunCharge', 'SpiritSwordDraw',
      'JumpAttack', 'DashForward', 'Dodge', 'BoxerGuardHop', 'Block', 'HitStagger',
      'Knockdown', 'GetUp', 'PointForward', 'CrossArms', 'Nod',
      'Shrug', 'LookAround', 'Celebrate', 'WaveHand', 'TurnToCamera',
    ]);
    for (const entry of this.entries) {
      if (entry.animations && entry.animations.length > 0) {
        const entryDuration = entry.endTime - entry.startTime;
        const animationCues = entry.animationCues || entry.animations.map((name) => ({ name, options: {} }));
        for (const cue of animationCues) {
          const animName = cue.name;
          const animOptions = cue.options || {};
          const characterName = cue.character || animOptions.character || entry.character;
          if (!characterName) continue;
          const char = this.characters.get(characterName);
          if (!char) continue;

          const AnimClass = AnimationRegistry[animName];
          if (AnimClass) {
            const inst = new AnimClass(animOptions);
            const optionDuration = Number(animOptions.duration);
            const cueDuration = Number.isFinite(optionDuration) && optionDuration > 0 ? optionDuration : undefined;
            const isLooping = LOOPING_ANIMATIONS.has(animName);
            const isFX = animName.startsWith('FX');
            const isOneShotBody = ONE_SHOT_BODY_ANIMS.has(animName);
            // CRITICAL FIX: One-shot body animations NEVER stretch.
            // They play at natural speed, then hold final pose.
            // Only looping anims and FX stretch to fill entry duration.
            if (isLooping || isFX) {
              char.playAnimation(AnimClass, entry.startTime, cueDuration ?? entryDuration, animOptions);
            } else if (isOneShotBody) {
              // Natural duration unless the story tag explicitly sets duration.
              char.playAnimation(AnimClass, entry.startTime, cueDuration, animOptions);
            } else {
              // Facial expressions and misc: stretch to entry duration
              char.playAnimation(AnimClass, entry.startTime, cueDuration ?? entryDuration, animOptions);
            }
          }
        }
      }
    }

    // Queue camera moves from SRT entries
    for (const entry of this.entries) {
      if (entry.cameraMove) {
        const { name, options } = entry.cameraMove;
        const MoveClass = CameraMoveRegistry[name];
        if (MoveClass) {
          const optionDuration = Number(options?.duration);
          const duration = Number.isFinite(optionDuration) && optionDuration > 0
            ? optionDuration
            : entry.endTime - entry.startTime;
          this.playCameraMove(MoveClass, entry.startTime, duration, options);
        } else {
          console.warn(`Camera move "${name}" not found in registry.`);
        }
      }
    }

    // Auto-detect hit pairs and store hitstop data for runtime triggering
    const ATTACK_ANIMATIONS = ['Punch', 'LeftPunch', 'RightPunch', 'LeftRightPunchCombo', 'SpiritSwordSwing', 'SpiritGunFire', 'ComboPunch', 'Kick', 'SpinKick', 'ArcadeSpinKick', 'JumpFlyingKick', 'HurricaneKick', 'AirTatsumaki', 'RyuHurricaneKick', 'TatsumakiSenpuuKyaku', 'DragonPunch', 'BackFist', 'SweepKick', 'KneeStrike'];
    const REACTION_ANIMATIONS = ['HitStagger', 'Block'];
    for (let i = 0; i < this.entries.length - 1; i++) {
      const entry = this.entries[i];
      const nextEntry = this.entries[i + 1];
      if (!entry.character || !nextEntry.character) continue;
      if (entry.character === nextEntry.character) continue;
      if (!entry.animations || !nextEntry.animations) continue;
      const attackChar = this.characters.get(entry.character);
      const hasAttack = entry.animations.some((a) =>
        ATTACK_ANIMATIONS.includes(a) &&
        (!attackChar?.canPlayAnimationName || attackChar.canPlayAnimationName(a))
      );
      const hasReaction = nextEntry.animations.some((a) => REACTION_ANIMATIONS.includes(a));
      if (hasAttack && hasReaction) {
        // Store on the entry so we can trigger at the correct time during update
        entry._autoHitstop = { time: entry.endTime, duration: 0.1, shake: 0.4 };
      }
    }

    // Parse explicit {Hitstop|duration=...|shake=...} tags from SRT entries
    for (const entry of this.entries) {
      if (entry.hitstop) {
        const duration = entry.hitstop.options.duration ?? 0.1;
        const shake = entry.hitstop.options.shake ?? 0.3;
        const offset = entry.hitstop.options.offset ?? 0;
        entry._explicitHitstop = { time: entry.startTime + offset, duration, shake };
      }
    }

    // Parse and queue music cues from SRT entries
    for (const entry of this.entries) {
      if (entry.musicCue) {
        const { action, options } = entry.musicCue;
        if (action === 'Play' && options.name) {
          const cue = new MusicCue({
            name: options.name,
            file: `${episodeBase}assets/audio/music/${options.name}.wav`,
            startTime: entry.startTime,
            endTime: options.endTime ?? entry.endTime,
            fadeIn: options.fadeIn ?? 1.0,
            fadeOut: options.fadeOut ?? 1.0,
            baseVolume: options.baseVolume ?? 0.5,
            emotion: options.emotion || 'neutral',
            bpm: options.bpm ?? 120,
          });
          this.musicDirector.addCue(cue);
        }
      }
    }
    // Auto-generate sidechain ducking from dialogue entries
    this.musicDirector.autoDuckFromDialogues(this.entries);

    // Queue scene-transition movements (walk out / teleport / walk in)
    const WalkAnim = AnimationRegistry['Walk'];
    const TurnToCamera = AnimationRegistry['TurnToCamera'];
    let activeScene = this.currentSceneName || 'RoomScene';
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry.scene) continue;

      const switchTime = entry.startTime;
      const prevScene = activeScene;
      const nextScene = entry.scene;

      if (prevScene !== nextScene) {
        // Skip automatic walk-out/walk-in if the scene-switch entry has explicit storyPlacements
        const hasStoryPlacements = entry.positions && entry.positions.length > 0;

        // Walk to exit before switch
        if (WalkAnim && this.transitions.exits[prevScene] && !hasStoryPlacements) {
          const exit = this.transitions.exits[prevScene];
          let walkStart = switchTime - 1.5;
          if (i > 0) {
            const prevEntry = this.entries[i - 1];
            if (!prevEntry.scene || prevEntry.scene === prevScene) {
              walkStart = Math.min(prevEntry.endTime, switchTime - 0.5);
            }
          }
          const walkDuration = Math.max(0.5, switchTime - walkStart);
          for (const char of this.characters.values()) {
            char.moveTo(exit, walkStart, walkDuration);
            char.playAnimation(WalkAnim, walkStart, walkDuration);
          }
        }

        // Teleport to entrance and walk in after switch
        if (this.transitions.entrances[nextScene] && nextScene !== 'ParkScene' && WalkAnim && !hasStoryPlacements) {
          const entrance = this.transitions.entrances[nextScene];
          // Generic indoor scene walk in
          const chars = Array.from(this.characters.values());
          chars.forEach((char, idx) => {
            const targetX = chars.length === 1 ? 0 : (idx === 0 ? -1.5 : 1.5);
            char.teleport(entrance, switchTime);
            char.moveTo({ x: targetX, z: 0 }, switchTime + 0.05, 1.0);
            char.playAnimation(WalkAnim, switchTime + 0.05, 1.0);
            if (TurnToCamera) {
              char.playAnimation(TurnToCamera, switchTime + 1.05, 0.3);
            }
          });
        }
      }

      activeScene = nextScene;
    }

    // Queue generic story events (Event:Move, Event:HurdleRun, Event:Animate) for all scenes
    for (const ev of this.storyEvents) {
      const char = this.characters.get(ev.character);
      if (!char) continue;
      if (ev.type === 'hurdlerun') {
        this._queueHurdleRun(char, ev);
      } else if (ev.type === 'move') {
        let targetPos;
        if (ev.relative) {
          const current = { x: char.mesh.position.x, y: char.mesh.position.y, z: char.mesh.position.z };
          targetPos = {
            x: current.x + (ev.x || 0),
            y: ev.y !== undefined ? current.y + ev.y : current.y,
            z: current.z + (ev.z || 0),
          };
        } else {
          targetPos = {
            x: ev.x !== undefined ? ev.x : char.mesh.position.x,
            z: ev.z !== undefined ? ev.z : char.mesh.position.z,
          };
          // Only set y if explicitly provided; otherwise keep current height
          if (ev.y !== undefined) targetPos.y = ev.y;
        }
        char.moveTo(targetPos, ev.startTime, ev.duration || 1.0);
        // Auto-play movement animation (Walk by default, or specified action like Swim)
        const moveAnimName = ev.action || 'Walk';
        const MoveAnimClass = AnimationRegistry[moveAnimName];
        if (MoveAnimClass) {
          char.playAnimation(MoveAnimClass, ev.startTime, ev.duration || 1.0, ev.options || {});
        }
      } else if (ev.type === 'animate') {
        const AnimClass = AnimationRegistry[ev.action];
        if (AnimClass) {
          char.playAnimation(AnimClass, ev.startTime, ev.duration, ev.options || {});
        }
      } else if (ev.type === 'face') {
        const targetChar = this.characters.get(ev.target);
        if (targetChar && targetChar.mesh) {
          const dx = targetChar.mesh.position.x - char.mesh.position.x;
          const dz = targetChar.mesh.position.z - char.mesh.position.z;
          char.mesh.rotation.y = Math.atan2(dx, dz);
        } else if (ev.target === 'center') {
          const dx = -char.mesh.position.x;
          const dz = -char.mesh.position.z;
          char.mesh.rotation.y = Math.atan2(dx, dz);
        } else if (['forward', 'back', 'left', 'right'].includes(ev.target)) {
          const dirMap = { forward: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
          char.mesh.rotation.y = dirMap[ev.target];
        }
      }
    }

    // Tennis ball & swing choreography is handled in switchScene('ParkScene')
    // via CourtDirector, so that trajectories are computed from actual positions.

    // BasketballArenaScene dunk choreography: must run AFTER characters are spawned
    if (this.currentSceneName === 'BasketballArenaScene') {
      this._setupDunkEvents();
    }

    // CombatDirector: initialize and process combat tags
    this._setupCombatDirector();

    // SceneDirector: initialize and process scene director tags
    this._setupSceneDirector();

    // Apply initial SceneDirector formation immediately (at t=0) so characters
    // start in the correct positions instead of arrangeCharacters defaults
    if (this.sceneDirector && this.sceneDirector.formations.length > 0) {
      const initialFormation = this.sceneDirector.formations[0];
      if (initialFormation.startTime <= 0) {
        this.sceneDirector.applyFormationNow(
          initialFormation.type,
          initialFormation.center,
          initialFormation.radius,
          initialFormation.focusChar,
          initialFormation.options
        );
      }
    }
  }

  switchScene(sceneName, skipArrange = false, currentTime = null) {
    if (this.currentSceneName === sceneName) return;
    const SceneClass = SceneRegistry[sceneName];
    if (!SceneClass) {
      console.warn(`Scene ${sceneName} not found in registry.`);
      return;
    }
    const newScene = new SceneClass();
    newScene.build();

    // Migrate only characters that belong to the new scene
    for (const [name, char] of this.characters) {
      if (this.currentScene) {
        this.currentScene.removeCharacter(char);
      }
      const scenes = this.characterScenes.get(name);
      if (scenes && scenes.has(sceneName)) {
        newScene.addCharacter(char);
        // Clear pending moves from previous scenes so they don't override placement
        // Only clear moves that end before or at the current time; preserve future moves
        if (char.moves) {
          const now = currentTime !== null ? currentTime : 0;
          char.moves = char.moves.filter(m => m.endTime > now + 0.1);
        }
        // Reset rotation to upright when entering a new scene
        // (prevents flipped characters from previous scene animations/moves)
        if (char.mesh) {
          char.mesh.rotation.x = 0;
          char.mesh.rotation.z = 0;
        }
        // Clear inCombat flag when switching scenes
        if (char.userData) char.userData.inCombat = false;
        if (char.mesh && char.mesh.userData) char.mesh.userData.inCombat = false;
      }
    }

    // Hide RoomScene pocket racket when leaving for ParkScene
    if (sceneName === 'ParkScene') {
      const dora = this.characters.get('Doraemon');
      if (dora && dora.pocketRacket) {
        dora.pocketRacket.visible = false;
      }
    }

    this.currentScene = newScene;
    this.currentSceneName = sceneName;
    // console.log('[switchScene] after migrate, chars in', sceneName, ':', this.currentScene.characters.map(c => c.constructor.name).join(','));

    // Generic placements from story (x/y/z, no court spot) — apply BEFORE arrangeCharacters
    // so arrangeCharacters only fills in missing positions
    // Only apply placements belonging to the current scene
    const scenePlacements = this.storyPlacements?.filter(p => p.scene === sceneName && (currentTime === null || p.startTime === undefined || p.startTime <= currentTime)) || [];
    // First pass: set all positions
    for (const p of scenePlacements) {
      const char = this.characters.get(p.character);
      if (!char) continue;
      if (p.x !== undefined && p.z !== undefined) {
        char.setPosition(p.x, p.y !== undefined ? p.y : 0, p.z);
      }
    }
    // Second pass: apply faces (after all positions are set)
    for (const p of scenePlacements) {
      const char = this.characters.get(p.character);
      if (!char || !p.face) continue;
      if (p.face === 'center') {
        // Only rotate horizontally toward center, keep upright
        const dx = 0 - char.mesh.position.x;
        const dz = 0 - char.mesh.position.z;
        char.mesh.rotation.y = Math.atan2(dx, dz);
      } else if (p.face === 'forward') {
        char.mesh.lookAt(char.mesh.position.x, char.mesh.position.y, char.mesh.position.z + 5);
      } else if (p.face === 'camera') {
        // Face toward the camera (positive Z direction)
        char.mesh.lookAt(char.mesh.position.x, char.mesh.position.y, char.mesh.position.z + 5);
      } else {
        const targetChar = this.characters.get(p.face);
        if (targetChar) {
          // Only rotate horizontally toward target, keep upright
          const dx = targetChar.mesh.position.x - char.mesh.position.x;
          const dz = targetChar.mesh.position.z - char.mesh.position.z;
          char.mesh.rotation.y = Math.atan2(dx, dz);
        } else {
          const dx = 0 - char.mesh.position.x;
          const dz = 0 - char.mesh.position.z;
          char.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    if (!skipArrange) {
      // If CombatDirector has set up battle line, don't override with arrangeCharacters
      const hasCombatSetup = Array.from(this.characters.values()).some(char => char.userData?.inCombat);
      if (!hasCombatSetup) {
        this.arrangeCharacters();
      }
    }

    // Generic prop handling (all scenes)
    if (this.storyProps) {
      for (const p of this.storyProps) {
        const char = this.characters.get(p.character);
        if (!char) continue;
        if (p.type === 'takecopter' && char.attachTakeCopter) {
          char.attachTakeCopter();
        }
        if (p.type === 'letter' && char.attachLetter) {
          char.attachLetter();
        }
      }
    }

    // ParkScene setup: characters placement, props, ball events from choreography config
    if (this.currentSceneName === 'ParkScene') {
      const courtGeom = this.currentScene.getCourtGeometry();
      const CourtDirector = DirectorRegistry['CourtDirector'];
      if (CourtDirector) {
        this.courtDirector = new CourtDirector(courtGeom);
      }

      const parkChoreo = this.choreography ? this.choreography.parkScene : null;

      const placements = this.storyPlacements.length > 0 ? this.storyPlacements : (parkChoreo ? parkChoreo.placements : []);
      const props = this.storyProps.length > 0 ? this.storyProps : (parkChoreo ? parkChoreo.props : []);

      if (placements) {
        for (const p of placements) {
          const char = this.characters.get(p.character);
          if (!char || !p.spot) continue;
          const pos = this.courtDirector.placePlayer(p.character, p.spot, { face: p.face });
          char.setPosition(pos.x, pos.y, pos.z);
        }
      }

      if (props) {
        for (const p of props) {
          const char = this.characters.get(p.character);
          if (char && !char.racketAttached && p.type === 'racket') {
            const color = parseInt(p.color, 16);
            this.currentScene.attachRacketToCharacter(char, color);
            char.racketAttached = true;
          }
        }
      }

      // Precompute all ball events from CourtDirector
      this._setupParkBallEvents();
    }

  }

  playCameraMove(MoveClass, startTime, duration, options = {}) {
    const instance = new MoveClass(options);
    this.cameraMoves.push({
      instance,
      startTime,
      endTime: startTime + duration,
    });
  }

  /**
   * Precompute ball trajectories and queue swing animations for ParkScene.
   * Called once inside switchScene('ParkScene').
   */
  _setupParkBallEvents() {
    if (!this.courtDirector) return;
    const cd = this.courtDirector;
    this.ballEvents = [];

    const parkChoreo = this.choreography ? this.choreography.parkScene : null;
    const ballEventsCfg = this.storyBallEvents.length > 0 ? this.storyBallEvents : (parkChoreo ? parkChoreo.ballEvents : []);
    const storyEventsCfg = this.storyEvents.length > 0 ? this.storyEvents : (parkChoreo ? parkChoreo.storyEvents : []);

    for (const cfg of ballEventsCfg) {
      if (cfg.type === 'player' && cfg.from && cfg.to) {
        const flight = cd.computeBallFlight(cfg.from, cfg.to, {
          arcHeight: cfg.arcHeight,
          speed: cfg.speed,
        });
        if (flight) {
          this.ballEvents.push({
            type: 'player',
            startTime: cfg.startTime,
            flight,
            from: cfg.from,
            to: cfg.to,
          });
        }
      }
    }

    // Queue swing animations for ball events
    const SwingRacket = AnimationRegistry['SwingRacket'];
    if (SwingRacket) {
      const swingDuration = new SwingRacket().duration;
      for (const ev of this.ballEvents) {
        const hitter = this.characters.get(ev.from);
        if (hitter) {
          hitter.playAnimation(SwingRacket, ev.startTime, swingDuration);
        }
        if (ev.type === 'player' && ev.to) {
          const receiver = this.characters.get(ev.to);
          if (receiver && ev.flight) {
            const swingTime = cd.computeSwingTime(ev.flight, ev.startTime, swingDuration);
            receiver.playAnimation(SwingRacket, swingTime, swingDuration);
          }
        }
      }
    }

    // Story events (e.g., fly-away)
    for (const ev of storyEventsCfg) {
      const char = this.characters.get(ev.character);
      if (!char) continue;
      if (ev.type === 'move') {
        let targetPos;
        if (ev.relative) {
          const current = { x: char.mesh.position.x, y: char.mesh.position.y, z: char.mesh.position.z };
          targetPos = {
            x: current.x + (ev.x || 0),
            y: ev.y !== undefined ? current.y + ev.y : current.y,
            z: current.z + (ev.z || 0),
          };
        } else {
          targetPos = {
            x: ev.x !== undefined ? ev.x : char.mesh.position.x,
            z: ev.z !== undefined ? ev.z : char.mesh.position.z,
          };
          // Only set y if explicitly provided; otherwise keep current height
          if (ev.y !== undefined) targetPos.y = ev.y;
        }
        char.moveTo(targetPos, ev.startTime, ev.duration || 1.0);
      } else if (ev.type === 'animate') {
        const AnimClass = AnimationRegistry[ev.action];
        if (AnimClass) {
          char.playAnimation(AnimClass, ev.startTime, ev.duration);
        }
      }
    }
  }

  /**
   * Precompute dunk trajectories and queue moves/animations for BasketballArenaScene.
   * Called once inside switchScene('BasketballArenaScene').
   */
  _setupDunkEvents() {
    const DunkDirector = DirectorRegistry['DunkDirector'];
    const courtGeom = this.currentScene.getCourtGeometry ? this.currentScene.getCourtGeometry() : null;
    if (!DunkDirector || !courtGeom) return;

    const dd = new DunkDirector(courtGeom);
    const dunkEventsCfg = this.storyEvents.filter((ev) => ev.type === 'dunk');
    if (!dunkEventsCfg.length) return;

    const RunAnim = AnimationRegistry['Run'];
    const DunkReachAnim = AnimationRegistry['DunkReach'];

    for (const cfg of dunkEventsCfg) {
      const char = this.characters.get(cfg.character);
      if (!char) continue;

      const startPos = {
        x: char.mesh.position.x,
        y: char.mesh.position.y,
        z: char.mesh.position.z,
      };
      const hoopPos = this.currentScene.getHoopPosition(cfg.hoop);

      const traj = dd.computeDunkTrajectory(cfg.character, startPos, hoopPos, {
        jumpHeight: cfg.jumpHeight,
        hangTime: cfg.hangTime,
        approachAngle: cfg.approachAngle,
        runUpDistance: cfg.runUpDistance,
        releaseHeight: cfg.releaseHeight,
      });

      if (!traj) continue;

      // Queue character path moves
      const path = traj.characterPath;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        char.moveTo(
          { x: b.x, y: b.y, z: b.z },
          cfg.startTime + a.time,
          b.time - a.time
        );
      }

      // Queue run animation during run-up
      if (RunAnim && traj.timings.runUpEnd > 0.3) {
        char.playAnimation(RunAnim, cfg.startTime, traj.timings.runUpEnd);
      }

      // Queue arm animation (DunkReach)
      if (DunkReachAnim && traj.armSchedule.length > 0) {
        const arm = traj.armSchedule[0];
        // Store target angles for the animation to read
        char.userData = char.userData || {};
        char.userData.targetArmAngleX = arm.armAngleX;
        char.userData.targetArmAngleZ = arm.armAngleZ;
        char.playAnimation(DunkReachAnim, cfg.startTime + arm.startTime, arm.endTime - arm.startTime);
      }

      // Queue basketball trajectory on scene
      if (this.currentScene.setBasketballTrajectory && traj.ballPath.length > 0) {
        this.currentScene.setBasketballTrajectory(cfg.startTime, traj.ballPath);
      }

      // Pass dunk time window to scene for flashbulb effects and rim bend
      if (this.currentScene.setDunkWindow) {
        this.currentScene.setDunkWindow(
          cfg.startTime,
          cfg.startTime + traj.totalDuration,
          cfg.hoop,
          cfg.startTime + traj.timings.releaseTime
        );
      }

      console.log(`[DunkDirector] ${cfg.character} dunk to ${cfg.hoop}: total=${traj.totalDuration.toFixed(2)}s, release@${(cfg.startTime + traj.timings.releaseTime).toFixed(2)}s`);
    }
  }

  arrangeCharacters() {
    const chars = Array.from(this.characters.values());
    // Only consider placements for the current scene that have already started
    // Use current scene time if available, otherwise allow all (backward compat)
    const now = this._currentUpdateTime !== undefined ? this._currentUpdateTime : 0;
    const scenePlacements = this.storyPlacements?.filter(p => p.scene === this.currentSceneName && (p.startTime === undefined || p.startTime <= now)) || [];

    // Check if CombatDirector has set up a battle line for any of these characters
    const hasCombatSetup = chars.some(char => char.userData?.inCombat);

    if (hasCombatSetup) {
      // CombatDirector already handled positioning and facing
      // Only fill in missing positions for non-combat characters
      for (const char of chars) {
        if (char.userData?.inCombat) continue;
        const p = scenePlacements.find(sp => sp.character === char.name);
        if (!p || p.x === undefined) {
          char.setPosition(0, 0, 0);
        }
        if (!p || !p.face) {
          char.mesh.lookAt(0, 0, 5);
        }
      }
      return;
    }

    if (chars.length === 1) {
      // Only apply default position if not already set by storyPlacements
      if (!scenePlacements.find(p => p.character === chars[0].name && p.x !== undefined)) {
        chars[0].setPosition(0, 0, 0);
      }
      if (!scenePlacements.find(p => p.character === chars[0].name && p.face)) {
        chars[0].mesh.lookAt(0, 0, 5);
      }
    } else if (chars.length === 2) {
      // Only apply default position if not already set by storyPlacements
      const p0 = scenePlacements.find(p => p.character === chars[0].name);
      const p1 = scenePlacements.find(p => p.character === chars[1].name);
      if (!p0 || p0.x === undefined) {
        chars[0].setPosition(-1.5, 0, 0);
      }
      if (!p0 || !p0.face) {
        chars[0].mesh.lookAt(1.5, 0, 2);
      }
      if (!p1 || p1.x === undefined) {
        chars[1].setPosition(1.5, 0, 0);
      }
      if (!p1 || !p1.face) {
        chars[1].mesh.lookAt(-1.5, 0, 2);
      }
    } else {
      const spacing = 2;
      const offset = ((chars.length - 1) * spacing) / 2;
      chars.forEach((char, i) => {
        const p = scenePlacements.find(sp => sp.character === char.name);
        if (!p || p.x === undefined) {
          char.setPosition(i * spacing - offset, 0, 0);
        }
        if (!p || !p.face) {
          char.mesh.lookAt(0, 0, 5);
        }
      });
    }
  }

  play() {
    if (this.isPlaying) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    this.startTime = this.audioContext.currentTime - this.pausedAt;
    this.isPlaying = true;

    // Schedule audios that haven't played yet
    for (const entry of this.entries) {
      if (entry.character && this.audioBuffers.has(entry.index)) {
        const when = this.startTime + entry.startTime;
        if (when > this.audioContext.currentTime) {
          const buffer = this.audioBuffers.get(entry.index);
          const source = this.audioContext.createBufferSource();
          source.buffer = buffer;
          const dest = this.audioDestination || this.audioContext.destination;
          source.connect(dest);
          source.start(when);
          this.activeSources.push(source);
        }
      }
    }
  }

  pause() {
    if (!this.isPlaying) return;
    this.pausedAt = this.getCurrentTime();
    this.isPlaying = false;
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch (e) {}
    }
    this.activeSources = [];
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.pausedAt;
    return this.audioContext.currentTime - this.startTime;
  }

  update(forcedTime) {
    const t = forcedTime !== undefined ? forcedTime : this.getCurrentTime();
    this._currentUpdateTime = t;

    // Hitstop: check if we are in a freeze frame
    const isHitstop = this.hitstopManager.update(t);

    // Trigger auto-detected and explicit hitstops at their designated times
    for (const entry of this.entries) {
      if (entry._autoHitstop && t >= entry._autoHitstop.time && t < entry._autoHitstop.time + 0.05) {
        if (!entry._autoHitstopTriggered) {
          entry._autoHitstopTriggered = true;
          this.hitstopManager.trigger(t, entry._autoHitstop.duration, entry._autoHitstop.shake, true);
        }
      }
      if (entry._explicitHitstop && t >= entry._explicitHitstop.time && t < entry._explicitHitstop.time + 0.05) {
        if (!entry._explicitHitstopTriggered) {
          entry._explicitHitstopTriggered = true;
          this.hitstopManager.trigger(t, entry._explicitHitstop.duration, entry._explicitHitstop.shake, true);
        }
      }
    }

    // Scene switches — find the most recent scene entry whose startTime has passed
    let targetScene = null;
    for (const entry of this.entries) {
      if (entry.scene && t >= entry.startTime) {
        targetScene = entry.scene;
      }
    }
    if (targetScene && targetScene !== this.currentSceneName) {
      this.switchScene(targetScene, true, t);
    }

    // Transition effects
    this._updateTransitions(t);

    // SFX visual sync: trigger visual pulses when SFX events fire
    this._updateSFXVisuals(t);

    if (!isHitstop) {
      // 在慢动作期间，传递 timeScale 给场景（动画系统内部基于时间戳，会自动减速）
      if (this.currentScene && this.cinematicAdapter) {
        this.currentScene.timeScale = this.cinematicAdapter.computeTimeScale(t);
      }

      // Dynamic character add based on scene membership
      // Characters belong to a scene if they have any entry (speaking, positioned, or event) in that scene.
      // Once added, they stay for the entire scene duration unless explicitly removed.
      if (this.currentScene) {
        for (const [name, char] of this.characters) {
          const isInScene = this.currentScene.characters.includes(char);
          const isCurrentScene = this.currentSceneName && this.characterScenes.get(name)?.has(this.currentSceneName);
          if (!isCurrentScene) continue;

          // Check if this character has explicit activity (speaking, animation, story events)
          // in the current scene. Position-only characters are treated as background.
          let hasExplicitActivity = false;
          let activitySceneCursor = this.entries.find((e) => e.scene)?.scene || this.currentSceneName;
          for (const entry of this.entries) {
            if (entry.scene) activitySceneCursor = entry.scene;
            if (activitySceneCursor !== this.currentSceneName) continue;
            // Speaking or animation tags = explicit activity
            if (entry.character === name) { hasExplicitActivity = true; break; }
            // Story events = explicit activity
            if (entry.storyEvents) {
              for (const ev of entry.storyEvents) { if (ev.options.character === name) { hasExplicitActivity = true; break; } }
              if (hasExplicitActivity) break;
            }
          }

          if (!isInScene) {
            if (hasExplicitActivity) {
              // Character with explicit activity: add just before their first speaking window
              for (const entry of this.entries) {
                if (entry.character === name && t >= entry.startTime - 0.5 && t <= entry.endTime + 0.3) {
                  this.currentScene.addCharacter(char);
                  if (char.mesh.position.x === 0 && char.mesh.position.z === 0) {
                    const charsInScene = this.currentScene.characters.length;
                    if (charsInScene === 1) char.setPosition(0, 0, 0);
                    else if (charsInScene === 2) char.setPosition(1.5, 0, 0);
                    else {
                      const spacing = 2;
                      const offset = ((charsInScene - 1) * spacing) / 2;
                      char.setPosition((charsInScene - 1) * spacing - offset, 0, 0);
                    }
                    char.mesh.lookAt(0, 1.5, 5);
                  }
                  break;
                }
              }
            } else {
              // Background character (no explicit activity in this scene): add immediately and keep
              this.currentScene.addCharacter(char);
            }
          }
        }

        // console.log('[update t=' + t.toFixed(2) + '] chars in', this.currentSceneName, ':', this.currentScene.characters.map(c => c.constructor.name).join(','));
      }

      // Character speaking states - only restart lip-sync when the active
      // dialogue changes. Resetting every frame breaks viseme smoothing.
      const activeSpeakers = new Set();
      for (const entry of this.entries) {
        if (!entry.character) continue;

        const char = this.characters.get(entry.character);
        if (!char) continue;

        const audioDur = this.audioDurations.get(entry.index);
        // Only speak if there's actual audio duration (real voice/subtitle)
        if (!audioDur || audioDur <= 0) continue;

        const speakDuration = Math.max(0.05, audioDur + 0.15);
        const speechEndTime = Math.max(entry.endTime, entry.startTime + speakDuration);
        if (t >= entry.startTime && t <= speechEndTime) {
          activeSpeakers.add(entry.character);

          const dialogueText = entry.dialogue || entry.text || '';
          const mouthCue = this.mouthCues.get(entry.index) || null;
          const speakKey = `${entry.index}:${entry.startTime}:${speakDuration}:${dialogueText}:${mouthCue ? mouthCue.frames.length : 0}`;
          if (!char.isSpeaking || char._activeSpeakKey !== speakKey) {
            char.speak(entry.startTime, speakDuration, dialogueText, mouthCue);
            char._activeSpeakKey = speakKey;
          }
        }
      }
      for (const [name, char] of this.characters) {
        if (!activeSpeakers.has(name) && char.isSpeaking) {
          char._activeSpeakKey = null;
          char.stopSpeaking();
        }
      }

      // TandemFlight: Xiaoyue rides on Xingzai's back
      const xingzai = this.characters.get('Xingzai');
      const xiaoyue = this.characters.get('Xiaoyue');
      if (xingzai && xiaoyue && xingzai.mesh && xiaoyue.mesh) {
        // Check if Xingzai is currently playing TandemFlight
        const isTandemFlying = xingzai.animations.some(
          (a) => a.instance.name === 'TandemFlight' && t >= a.startTime && t <= a.endTime
        );
        if (isTandemFlying) {
          // Set Xingzai's baseY to flying altitude so the animation keeps him in the air
          const flyHeight = 4;
          xingzai.baseY = flyHeight;

          // Position Xiaoyue on Xingzai's back
          const xzPos = xingzai.mesh.position;
          const xzRot = xingzai.mesh.rotation.x;
          // When Xingzai leans forward (rot.x ~ 0.9), his back faces up-backward
          // Place Xiaoyue lower on his back, not on his head
          const offsetY = 0.5;  // lower on the back
          const offsetZ = -0.3; // slightly behind
          xiaoyue.mesh.position.set(xzPos.x, xzPos.y + offsetY, xzPos.z + offsetZ);
          xiaoyue.mesh.rotation.x = xzRot;

          // Ensure both are in the scene
          if (this.currentScene) {
            if (!this.currentScene.characters.includes(xingzai)) {
              this.currentScene.addCharacter(xingzai);
            }
            if (!this.currentScene.characters.includes(xiaoyue)) {
              this.currentScene.addCharacter(xiaoyue);
            }
          }
        }
      }

      // Park scene tennis ball choreography (driven by CourtDirector)
      if (this.currentSceneName === 'ParkScene') {
        const parkScene = this.currentScene;
        let activeEvent = null;

        for (const ev of this.ballEvents) {
          const endTime = ev.startTime + ev.flight.duration;
          if (t >= ev.startTime && t < endTime) {
            activeEvent = ev;
            break;
          }
        }

        if (activeEvent) {
          const f = activeEvent.flight;
          parkScene.setBallTrajectory(activeEvent.startTime, activeEvent.startTime + f.duration, f.startPos, f.endPos, f.arcHeight);

          // Characters track the ball with their eyes
          if (parkScene.tennisBall) {
            const ballPos = parkScene.tennisBall.position;
            const hitter = this.characters.get(activeEvent.from);
            const receiver = activeEvent.to ? this.characters.get(activeEvent.to) : null;

            if (hitter) {
              hitter.lookAtTarget(ballPos, t, t + 0.5);
            }
            if (receiver) {
              receiver.lookAtTarget(ballPos, t, t + 0.5);
            }
          }
        } else {
          parkScene.clearBallTrajectory();

          // Find the most recent completed event and park the ball there
          let lastEvent = null;
          for (const ev of this.ballEvents) {
            const endTime = ev.startTime + ev.flight.duration;
            if (t >= endTime) {
              lastEvent = ev;
            }
          }

          if (lastEvent && parkScene.tennisBall) {
            parkScene.tennisBall.position.set(lastEvent.flight.endPos.x, lastEvent.flight.endPos.y, lastEvent.flight.endPos.z);
          } else if (t < (this.ballEvents[0]?.startTime ?? Infinity) && parkScene.tennisBall) {
            // Before first rally: ball rests near Doraemon
            const doraPos = this.courtDirector?.getPlayerPosition('Doraemon');
            if (doraPos) {
              parkScene.tennisBall.position.set(doraPos.x + 0.3, doraPos.y + 1.0, doraPos.z + 0.3);
            }
          }

          // When ball is idle, characters look at each other
          const dora = this.characters.get('Doraemon');
          const nobi = this.characters.get('Nobita');
          if (dora && nobi) {
            const doraHead = new THREE.Vector3().copy(dora.mesh.position);
            doraHead.y += 1.6;
            const nobiHead = new THREE.Vector3().copy(nobi.mesh.position);
            nobiHead.y += 1.5;
            dora.lookAtTarget(nobiHead, t, t + 0.5);
            nobi.lookAtTarget(doraHead, t, t + 0.5);
          }
        }
      }

      if (this.currentScene) {
        // Trigger time-based scene events (e.g., SharkAppear at specific entry time)
        for (const entry of this.entries) {
          if (entry.storyEvents && t >= entry.startTime) {
            entry._sceneEventsTriggered = entry._sceneEventsTriggered || {};
            for (const ev of entry.storyEvents) {
              const evKey = ev.options.action ? ev.name + ':' + ev.options.action : ev.name;
              if (entry._sceneEventsTriggered[evKey]) continue; // already triggered
              entry._sceneEventsTriggered[evKey] = true;
              let handledSceneEvent = false;

              if (ev.name === 'SharkAppear' && this.currentScene.showShark) {
                this.currentScene.showShark();
              }
              // SharkOrbit: switch shark to orbit mode around a character
              if (ev.name === 'SharkOrbit' && this.currentScene.setSharkOrbitMode) {
                const targetChar = ev.options.character || 'Nobita';
                let cx = 0, cz = -8;
                for (const ch of this.currentScene.characters) {
                  if (ch.name === targetChar) {
                    cx = ch.mesh.position.x;
                    cz = ch.mesh.position.z;
                    break;
                  }
                }
                this.currentScene.setSharkOrbitMode(cx, cz, ev.options.radius ? parseFloat(ev.options.radius) : 4);
              }
              // SplashStart: activate splash particles on a character
              if (ev.name === 'SplashStart' && this.currentScene.setSplashTarget) {
                const targetChar = ev.options.character || 'Nobita';
                for (const ch of this.currentScene.characters) {
                  if (ch.name === targetChar) {
                    this.currentScene.setSplashTarget(ch.mesh);
                    break;
                  }
                }
              }
              // SplashStop: deactivate splash particles
              if (ev.name === 'SplashStop' && this.currentScene.stopSplash) {
                this.currentScene.stopSplash();
              }
              // KnockHurdle: explicit hurdle collision/fall cue
              if (ev.name === 'KnockHurdle' && this.currentScene.knockHurdle) {
                const offset = Number(ev.options.offset);
                this.currentScene.knockHurdle(
                  ev.options,
                  entry.startTime + (Number.isFinite(offset) ? offset : 0)
                );
                handledSceneEvent = true;
              }
              // Hurdle coordinate markers for debugging shot alignment
              if (ev.name === 'ShowHurdleMarkers' && this.currentScene.showHurdleMarkers) {
                this.currentScene.showHurdleMarkers(ev.options);
                handledSceneEvent = true;
              }
              if (ev.name === 'HideHurdleMarkers' && this.currentScene.hideHurdleMarkers) {
                this.currentScene.hideHurdleMarkers(ev.options);
                handledSceneEvent = true;
              }
              // RescueTakecopter: rescue character with takecopter
              if (ev.name === 'RescueTakecopter' && this.currentScene.rescueWithTakecopter) {
                this.currentScene.rescueWithTakecopter(ev.options.character || 'Nobita');
              }
              // OpenDrawer: animate drawer sliding open (DrawerScene)
              if (ev.name === 'OpenDrawer' && this.currentScene.openDrawer) {
                this.currentScene.openDrawer(entry.startTime);
              }
              // ExtinguishZodiacFlame: extinguish a zodiac flame by index
              if (ev.name === 'ExtinguishZodiacFlame' && this.currentScene.extinguishZodiacFlame) {
                const idx = ev.options.index !== undefined ? parseInt(ev.options.index) : 0;
                this.currentScene.extinguishZodiacFlame(idx);
              }
              // Generic scene event: if the scene has a method matching the event name, call it
              const sceneMethod = ev.name.charAt(0).toLowerCase() + ev.name.slice(1);
              if (!handledSceneEvent && typeof this.currentScene[sceneMethod] === 'function') {
                this.currentScene[sceneMethod]();
              }
              // Also try exact match (for methods like summonCourierShip)
              if (!handledSceneEvent && typeof this.currentScene[ev.name] === 'function') {
                this.currentScene[ev.name]();
              }
              // Hide character
              if (ev.name === 'Hide') {
                const char = this.characters.get(ev.options.character);
                if (char && char.mesh) {
                  char.mesh.visible = false;
                }
              }
              // Show character
              if (ev.name === 'Show') {
                const char = this.characters.get(ev.options.character);
                if (char && char.mesh) {
                  char.mesh.visible = true;
                }
              }
              // ShowAura: activate aura rings on a character
              if (ev.name === 'ShowAura') {
                const char = this.characters.get(ev.options.character);
                if (char && char.showAura) {
                  char.showAura();
                }
              }
              // HideAura: deactivate aura rings on a character
              if (ev.name === 'HideAura') {
                const char = this.characters.get(ev.options.character);
                if (char && char.hideAura) {
                  char.hideAura();
                }
              }
              // ShowBeam: activate beam from one character to another
              if (ev.name === 'ShowBeam') {
                const fromChar = this.characters.get(ev.options.from);
                const toChar = this.characters.get(ev.options.to);
                if (fromChar && toChar && fromChar.setBeamTarget) {
                  const targetPos = new THREE.Vector3();
                  toChar.mesh.getWorldPosition(targetPos);
                  fromChar.setBeamTarget(targetPos);
                }
              }
              // HideBeam: deactivate beam
              if (ev.name === 'HideBeam') {
                const char = this.characters.get(ev.options.character);
                if (char && char.hideBeam) {
                  char.hideBeam();
                }
              }
              // Face: rotate character to face a target (character name, 'center', or direction)
              if (ev.name === 'Face') {
                const char = this.characters.get(ev.options.character);
                const target = ev.options.target;
                if (char && char.mesh && target) {
                  const targetChar = this.characters.get(target);
                  if (targetChar && targetChar.mesh) {
                    const dx = targetChar.mesh.position.x - char.mesh.position.x;
                    const dz = targetChar.mesh.position.z - char.mesh.position.z;
                    char.mesh.rotation.y = Math.atan2(dx, dz);
                  } else if (target === 'center') {
                    const dx = -char.mesh.position.x;
                    const dz = -char.mesh.position.z;
                    char.mesh.rotation.y = Math.atan2(dx, dz);
                  } else if (['forward', 'back', 'left', 'right'].includes(target)) {
                    const dirMap = { forward: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
                    char.mesh.rotation.y = dirMap[target];
                  }
                }
              }
              // JointMarkers: toggle visual joint markers on a character
              if (ev.name === 'JointMarkers') {
                const char = this.characters.get(ev.options.character);
                if (char) {
                  const visible = ev.options.visible !== false && ev.options.visible !== 'false';
                  if (visible && Object.keys(char.jointMarkers).length === 0) {
                    char.createJointMarkers({
                      size: ev.options.size ?? 0.03,
                      opacity: ev.options.opacity ?? 0.85,
                    });
                  } else if (Object.keys(char.jointMarkers).length > 0) {
                    char.setJointMarkersVisible(visible);
                  }
                }
              }
            }
          }
        }
        const timeScale = this.cinematicAdapter ? this.cinematicAdapter.computeTimeScale(t) : 1.0;
        this.currentScene.update(t, 0.016 * timeScale);
        // console.log('[update t=' + t.toFixed(2) + '] AFTER currentScene.update, chars count=', this.currentScene.characters.length, 'scene=', this.currentScene.name);
        // DEBUG: log character positions (uncomment when needed)
        // if (this.currentSceneName === 'WhisperingWoodsScene' && t >= 101 && t <= 103) {
        //   const chars = this.currentScene.characters;
        //   console.log('[update t=' + t.toFixed(2) + '] chars in ' + this.currentSceneName + ' count=' + chars.length);
        //   for (let i = 0; i < chars.length; i++) {
        //     const c = chars[i];
        //     if (c) {
        //       console.log('  [' + i + '] name=' + c.name + ' pos=' + c.mesh.position.x.toFixed(2) + ',' + c.mesh.position.y.toFixed(2) + ',' + c.mesh.position.z.toFixed(2) + ' visible=' + c.mesh.visible + ' rot=' + c.mesh.rotation.x.toFixed(2) + ',' + c.mesh.rotation.y.toFixed(2) + ',' + c.mesh.rotation.z.toFixed(2));
        //     } else {
        //       console.log('  [' + i + '] UNDEFINED');
        //     }
        //   }
        // }
      }
    }

    // 更新 timeScale：同步到 HitstopManager
    const timeScale = this.cinematicAdapter ? this.cinematicAdapter.computeTimeScale(t) : 1.0;
    this.hitstopManager.timeScale = timeScale;

    // CinematicCombatAdapter: update staging, camera overrides, bullet time
    if (this.cinematicAdapter) {
      this.cinematicAdapter.update(t);
    } else if (this.combatDirector) {
      this.combatDirector.update(t);
    }

    // SceneDirector: update formations and character facing
    if (this.sceneDirector) {
      this.sceneDirector.update(t);
    }

    // ProjectileSystem: update all flying projectiles
    if (this.combatDirector && this.combatDirector.projectileSystem) {
      const scene = this.currentScene ? this.currentScene.scene : null;
      const delta = 1 / 30; // approximate delta
      this.combatDirector.projectileSystem.update(t, delta * timeScale, scene, this.characters);
    }

    // Camera shake from hitstop (applied even during freeze so the screen still shakes)
    if (this.hitstopManager.isShaking(t)) {
      const offset = this.hitstopManager.getShakeOffset(t);
      this.camera.position.x += offset.x;
      this.camera.position.y += offset.y;
    }

    // Camera moves
    const cameraContext = {
      renderer: this.renderer,
      scene: this.currentScene?.scene,
      characters: this.characters,
      currentScene: this.currentScene,
    };

    for (const cm of this.cameraMoves) {
      if (t >= cm.startTime && t <= cm.endTime) {
        if (!cm.instance.started) {
          cm.instance.start(this.camera, cameraContext);
        }
        const progress = (t - cm.startTime) / (cm.endTime - cm.startTime);
        cm.instance.update(progress, this.camera, cameraContext);
      } else if (t > cm.endTime && cm.instance.started && !cm.instance.ended) {
        cm.instance.end(this.camera, cameraContext);
      }
    }
  }

  /**
   * Add a post-processing effect to the chain.
   * Effects are applied in order during render().
   */
  addPostProcess(effect) {
    if (effect && typeof effect.render === 'function') {
      this.postProcesses.push(effect);
    }
  }

  /**
   * Remove a post-processing effect by instance reference.
   */
  removePostProcess(effect) {
    const idx = this.postProcesses.indexOf(effect);
    if (idx >= 0) this.postProcesses.splice(idx, 1);
  }

  render() {
    if (!this.currentScene) return;

    const enabledEffects = this.postProcesses.filter(p => p.enabled !== false);

    if (enabledEffects.length === 0) {
      // No post-processing — render directly to screen
      this.renderer.render(this.currentScene.scene, this.camera);
    } else if (enabledEffects.length === 1) {
      // Single effect — let it handle rendering (backward compatible)
      enabledEffects[0].render(this.currentScene.scene, this.camera);
    } else {
      // Multiple effects — chain rendering through offscreen targets
      // For now, each effect renders to screen sequentially.
      // Full chain with ping-pong targets can be added later.
      let currentTarget = null;
      for (let i = 0; i < enabledEffects.length; i++) {
        const effect = enabledEffects[i];
        const isLast = i === enabledEffects.length - 1;
        if (isLast) {
          this.renderer.setRenderTarget(null);
        }
        effect.render(this.currentScene.scene, this.camera, currentTarget);
      }
    }

    // Render transition overlay on top
    if (this.activeTransition && this.activeTransition.overlay) {
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.render(this.transitionScene, this.camera);
      this.renderer.autoClear = autoClear;
    }
  }

  /**
   * Trigger visual effects synchronized with SFX events.
   * SFX tags are audio cues by default. Visual feedback should come from
   * explicit FX tags or contact events; use visual=true for legacy pulses.
   */
  _updateSFXVisuals(t) {
    for (const entry of this.entries) {
      if (!entry.sfxEvents || entry.sfxEvents.length === 0) continue;
      for (const sfx of entry.sfxEvents) {
        const wantsVisual = sfx.options.visual === true ||
          sfx.options.visual === 'true' ||
          sfx.options.visual === 1 ||
          sfx.options.visual === '1';
        if (!wantsVisual) continue;

        const offset = sfx.options.offset || 0;
        const triggerTime = entry.startTime + offset;
        if (t >= triggerTime && t < triggerTime + 0.05) {
          const targetName = sfx.options.target || entry.character;
          const key = `${entry.index}_${sfx.name}_${offset}_${targetName}`;
          if (!this._sfxTriggered) this._sfxTriggered = new Set();
          if (this._sfxTriggered.has(key)) continue;
          this._sfxTriggered.add(key);

          const char = this.characters.get(targetName);
          if (!char || !char.mesh) continue;

          // Visual pulse: brief bright flash on the character
          const pulse = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 8, 8),
            new THREE.MeshBasicMaterial({
              color: 0xffffff,
              transparent: true,
              opacity: 0.3,
              depthWrite: false,
            })
          );
          pulse.position.copy(char.mesh.position);
          pulse.position.y += 1.0;
          if (this.currentScene) {
            this.currentScene.scene.add(pulse);
            // Animate and remove
            const startT = t;
            const animPulse = () => {
              const elapsed = (performance.now() / 1000) - startT;
              if (elapsed > 0.1) {
                this.currentScene.scene.remove(pulse);
                pulse.geometry.dispose();
                pulse.material.dispose();
                return;
              }
              pulse.scale.setScalar(1 + elapsed * 10);
              pulse.material.opacity = 0.3 * (1 - elapsed * 10);
              requestAnimationFrame(animPulse);
            };
            // For render loop compatibility, just set initial state and let it fade next frame
            pulse.userData.sfxPulse = true;
            pulse.userData.birthTime = t;
          }
        }
      }
    }

    // Clean up old sfx pulse meshes
    if (this.currentScene) {
      const toRemove = [];
      this.currentScene.scene.traverse((obj) => {
        if (obj.userData && obj.userData.sfxPulse) {
          const age = t - obj.userData.birthTime;
          if (age > 0.1) {
            toRemove.push(obj);
          } else {
            obj.scale.setScalar(1 + age * 10);
            obj.material.opacity = 0.3 * (1 - age * 10);
          }
        }
      });
      for (const obj of toRemove) {
        this.currentScene.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      }
    }
  }

  /**
   * Update active transition effects from SRT entries.
   */
  _updateTransitions(t) {
    // Find active transition entry (transition is active during its own duration, not the whole entry)
    let activeTransEntry = null;
    for (const entry of this.entries) {
      if (entry.transition) {
        const duration = entry.transition.options.duration ?? 0.5;
        if (t >= entry.startTime && t <= entry.startTime + duration) {
          activeTransEntry = entry;
          break;
        }
      }
    }

    if (activeTransEntry) {
      const { name, options } = activeTransEntry.transition;
      const TransClass = TransitionRegistry[name];
      if (!TransClass) {
        console.warn(`Transition "${name}" not found in registry.`);
        return;
      }

      // Start new transition if needed
      if (!this.activeTransition || this.activeTransition.name !== name) {
        // End previous transition if any
        if (this.activeTransition) {
          this.activeTransition.end(this.renderer, this.camera, { transitionScene: this.transitionScene });
        }
        this.activeTransition = new TransClass(options);
        this.activeTransition.start(this.renderer, this.camera, { transitionScene: this.transitionScene });
      }

      // Update progress (0..1 over the transition's own duration)
      const duration = this.activeTransition.duration;
      const progress = Math.min(1.0, (t - activeTransEntry.startTime) / duration);
      this.activeTransition.update(progress, this.renderer, this.camera, { transitionScene: this.transitionScene });
    } else {
      // End active transition if time is past
      if (this.activeTransition) {
        this.activeTransition.end(this.renderer, this.camera, { transitionScene: this.transitionScene });
        this.activeTransition = null;
      }
    }
  }

  /**
   * Initialize CombatDirector and process combat tags from .story entries.
   */
  _setupCombatDirector() {
    const CombatDirectorClass = DirectorRegistry['CombatDirector'];
    if (!CombatDirectorClass) return;

    this.combatDirector = new CombatDirectorClass(this);

    // 包装 CinematicCombatAdapter
    const CinematicAdapterClass = DirectorRegistry['CinematicCombatAdapter'];
    if (CinematicAdapterClass) {
      this.cinematicAdapter = new CinematicAdapterClass(this.combatDirector);
    }

    // Parse combat tags from entries（支持同一条目多个 Combat 标签）
    // Only process Setup tags that start at or before time 0 for initial positioning
    // Later Setup tags will be applied via update() when their startTime is reached
    for (const entry of this.entries) {
      const combatTags = entry.combatAll || (entry.combat ? [entry.combat] : []);
      if (combatTags.length === 0) continue;

      for (const combatTag of combatTags) {
        const { name, options } = combatTag;
        const startTime = entry.startTime;

        switch (name) {
          case 'Setup': {
            // Skip future combat setups — they will be applied when their time comes
            if (startTime > 0) break;
            const charA = options.charA;
            const charB = options.charB;
            if (charA && charB) {
              this.combatDirector.setupBattleLine(
                charA,
                charB,
                options.centerX ?? 0,
                options.centerZ ?? 0,
                options.distance ?? 4
              );
            }
            break;
          }
          case 'Combo': {
            const attacker = options.attacker;
            const defender = options.defender;
            const sequence = options.sequence;
            if (attacker && defender && sequence) {
              const noAutoCamera = options.noAutoCamera === true || options.noAutoCamera === 'true';
              if (this.cinematicAdapter) {
                this.cinematicAdapter.scheduleCombo(attacker, defender, sequence, startTime, { noAutoCamera });
              } else {
                this.combatDirector.scheduleCombo(attacker, defender, sequence, startTime);
              }
            }
            break;
          }
          case 'Attack': {
            const attacker = options.attacker;
            const defender = options.defender;
            const anim = options.anim;
            if (attacker && defender && anim) {
              const noAutoCamera = options.noAutoCamera === true || options.noAutoCamera === 'true';
              if (this.cinematicAdapter) {
                this.cinematicAdapter.scheduleAttack(attacker, defender, anim, startTime, {
                  hitFrame: options.hitFrame,
                  sfx: options.sfx,
                  reaction: options.reaction,
                  hitstop: options.hitstop,
                  shake: options.shake,
                  noStance: options.noStance,
                  noAutoCamera,
                });
              } else {
                this.combatDirector.scheduleAttack(attacker, defender, anim, startTime, {
                  hitFrame: options.hitFrame,
                  sfx: options.sfx,
                  reaction: options.reaction,
                  hitstop: options.hitstop,
                  shake: options.shake,
                  noStance: options.noStance,
                });
              }
            }
            break;
          }
          case 'Reaction': {
            const characterName = options.character;
            const anim = options.anim;
            if (characterName && anim) {
              if (this.cinematicAdapter) {
                this.cinematicAdapter.scheduleReaction(characterName, anim, startTime);
              } else {
                this.combatDirector.scheduleReaction(characterName, anim, startTime);
              }
            }
            break;
          }
          case 'BulletTime': {
            // {Combat:BulletTime|start=0.5|duration=1.2|scale=0.2|easeIn=0.1|easeOut=0.1}
            if (this.cinematicAdapter) {
              const btStart = startTime + (options.start ?? 0);
              this.cinematicAdapter.scheduleBulletTime(
                btStart,
                options.duration ?? 1.0,
                options.scale ?? 0.3,
                options.easeIn ?? 0.1,
                options.easeOut ?? 0.1
              );
              // 同时注册到 Storyboard 的 timeScaleEvents，供 update 使用
              this.timeScaleEvents.push({
                startTime: btStart,
                endTime: btStart + (options.duration ?? 1.0),
                scale: options.scale ?? 0.3,
                easeIn: options.easeIn ?? 0.1,
                easeOut: options.easeOut ?? 0.1,
              });
            }
            break;
          }
          case 'Staging': {
            // {Combat:Staging|type=pincer|chars=Yusuke,Kuwabara|target=Yokai|duration=1.0}
            if (this.cinematicAdapter) {
              this.cinematicAdapter.scheduleStaging(
                options.type ?? 'pincer',
                options.chars || options.characters || '',
                options.target,
                startTime,
                options.duration ?? 1.0,
                options
              );
            }
            break;
          }
          case 'AdHoc': {
            // {Combat:AdHoc|name=myCombo|attacker=Yusuke|defender=Yokai|moves=DashForward,null,Punch,0.25}
            if (this.cinematicAdapter && options.name && options.moves) {
              this.cinematicAdapter.registerAdHocCombo(options.name, options.moves);
              if (options.attacker && options.defender) {
                this.cinematicAdapter.scheduleAdHocCombo(
                  options.attacker,
                  options.defender,
                  options.name,
                  startTime
                );
              }
            }
            break;
          }
          case 'Override': {
            // {Combat:Override|camera=FightDramatic|lock=true|duration=3}
            if (this.cinematicAdapter && options.camera) {
              this.cinematicAdapter.scheduleCameraOverride(
                startTime,
                options.duration ?? 2.0,
                options.camera,
                options,
                options.priority ?? 10
              );
            }
            break;
          }
          case 'Emotion': {
            // {Combat:Emotion|type=closeUp|character=Yusuke|hold=1.5}
            if (this.cinematicAdapter && options.character) {
              const camType = options.type === 'closeUp' ? 'FightEmotionCloseUp' :
                              options.type === 'reveal' ? 'FightDramaticReveal' :
                              options.type === 'overhead' ? 'FightOverhead' :
                              options.type === 'bulletTrack' ? 'FightBulletTimeTrack' :
                              'FightEmotionCloseUp';
              this.cinematicAdapter.scheduleCameraOverride(
                startTime,
                options.hold ?? options.duration ?? 1.5,
                camType,
                { character: options.character, ...options },
                options.priority ?? 15
              );
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Initialize SceneDirector and process scene director tags from .story entries.
   */
  _setupSceneDirector() {
    const SceneDirectorClass = DirectorRegistry['SceneDirector'];
    if (!SceneDirectorClass) return;

    this.sceneDirector = new SceneDirectorClass(this);

    // Parse SceneDirector tags from entries
    for (const entry of this.entries) {
      if (!entry.sceneDirector || entry.sceneDirector.length === 0) continue;

      for (const sdTag of entry.sceneDirector) {
        const { name, options } = sdTag;
        const startTime = entry.startTime;

        switch (name) {
          case 'Formation': {
            const type = options.type || 'semicircle';
            let center = { x: 0, y: 0.01, z: 0 };
            if (options.center) {
              const centerStr = String(options.center);
              const centerParts = centerStr.split(',').map(s => parseFloat(s.trim()));
              center = {
                x: centerParts[0] || 0,
                y: centerParts[1] !== undefined ? centerParts[1] : 0.01,
                z: centerParts[2] !== undefined ? centerParts[2] : 0,
              };
            }
            const radius = options.radius !== undefined ? parseFloat(options.radius) : 4;
            const focusChar = options.focus || options.focusChar || null;
            this.sceneDirector.scheduleFormation(type, center, radius, focusChar, startTime, options);
            break;
          }
          case 'Gaze': {
            const mode = options.mode || 'auto';
            const target = options.target || null;
            const duration = options.duration !== undefined ? parseFloat(options.duration) : 0;
            const gazeOptions = { ...options };
            if (options.groups) {
              gazeOptions.groups = String(options.groups).split(';').map(g => g.split(',').map(s => s.trim()));
            }
            this.sceneDirector.scheduleGaze(mode, target, startTime, duration, gazeOptions);
            break;
          }
        }
      }
    }
  }
}
