import * as THREE from 'three';
import { StoryParser } from '../lib/StoryParser.js';
import { SceneRegistry } from '../scenes/index.js';
import { CharacterRegistry } from '../characters/index.js';
import { VoiceRegistry } from '../voices/index.js';
import { AnimationRegistry } from '../animations/index.js';
import { CameraMoveRegistry } from '../camera/index.js';
import { DirectorRegistry } from '../lib/DirectorRegistry.js';
import { TransitionRegistry } from '../transitions/index.js';
import { MusicDirector, MusicCue } from '../lib/MusicDirector.js';
import { HitstopManager } from '../lib/HitstopManager.js';


const DEFAULT_TRANSITIONS = {
  exits: {},
  entrances: {},
};

export class Storyboard {
  constructor(renderer, camera, audioDestination = null, outlineEffect = null) {
    this.renderer = renderer;
    this.camera = camera;
    this.outlineEffect = outlineEffect;
    this.currentScene = null;
    this.currentSceneName = null;
    this.characters = new Map(); // name -> instance
    this.entries = [];
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.audioDestination = audioDestination;
    this.audioBuffers = new Map(); // index -> AudioBuffer
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
        if (item.audioDuration) {
          this.audioDurations.set(item.index, item.audioDuration);
        }
      } catch (err) {
        console.error(`Failed to load audio for entry ${item.index}:`, err);
      }
    }

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
    this.switchScene(initialSceneName);

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

    // Spawn characters mentioned in SRT
    const mentionedChars = new Set(this.entries.map((e) => e.character).filter(Boolean));
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
    const currentPlacements = this.storyPlacements?.filter(p => p.scene === initialSceneName) || [];
    // First pass: set all positions
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
      'SwayBody', 'Walk', 'Run', 'Swim', 'Tremble', 'FlailArms',
      'FXEnergyAura', 'FightingStance',
    ]);
    for (const entry of this.entries) {
      if (entry.character && entry.animations && entry.animations.length > 0) {
        const char = this.characters.get(entry.character);
        if (char) {
          const entryDuration = entry.endTime - entry.startTime;
          for (const animName of entry.animations) {
            const AnimClass = AnimationRegistry[animName];
            if (AnimClass) {
              const inst = new AnimClass();
              const isLooping = LOOPING_ANIMATIONS.has(animName);
              const isFX = animName.startsWith('FX');
              // For looping animations or FX, stretch to fill the entry duration
              // For one-shot body animations, also stretch if entry is longer
              // (they will hold their final pose via the blend system)
              if (isLooping || isFX || entryDuration > inst.duration) {
                char.playAnimation(AnimClass, entry.startTime, entryDuration);
              } else {
                char.playAnimation(AnimClass, entry.startTime);
              }
            }
          }
        }
      }
    }

    // Auto-insert idle animations for characters with long gaps between animations
    this._scheduleIdleAnimations();

    // Queue camera moves from SRT entries
    for (const entry of this.entries) {
      if (entry.cameraMove) {
        const { name, options } = entry.cameraMove;
        const MoveClass = CameraMoveRegistry[name];
        if (MoveClass) {
          this.playCameraMove(MoveClass, entry.startTime, entry.endTime - entry.startTime, options);
        } else {
          console.warn(`Camera move "${name}" not found in registry.`);
        }
      }
    }

    // Auto-detect hit pairs and store hitstop data for runtime triggering
    const ATTACK_ANIMATIONS = ['Punch', 'SpiritSwordSwing', 'SpiritGunFire', 'ComboPunch', 'Kick'];
    const REACTION_ANIMATIONS = ['HitStagger', 'Block'];
    for (let i = 0; i < this.entries.length - 1; i++) {
      const entry = this.entries[i];
      const nextEntry = this.entries[i + 1];
      if (!entry.character || !nextEntry.character) continue;
      if (entry.character === nextEntry.character) continue;
      if (!entry.animations || !nextEntry.animations) continue;
      const hasAttack = entry.animations.some((a) => ATTACK_ANIMATIONS.includes(a));
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
        entry._explicitHitstop = { time: entry.startTime, duration, shake };
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

    // Queue generic story events (Event:Move, Event:Animate) for all scenes
    for (const ev of this.storyEvents) {
      const char = this.characters.get(ev.character);
      if (!char) continue;
      if (ev.type === 'move') {
        let targetPos;
        if (ev.relative) {
          const current = { x: char.mesh.position.x, y: char.mesh.position.y, z: char.mesh.position.z };
          targetPos = {
            x: current.x + (ev.x || 0),
            y: current.y + (ev.y || 0),
            z: current.z + (ev.z || 0),
          };
        } else {
          targetPos = { x: ev.x || 0, y: ev.y || 0, z: ev.z || 0 };
        }
        char.moveTo(targetPos, ev.startTime, ev.duration || 1.0);
        // Auto-play movement animation (Walk by default, or specified action like Swim)
        const moveAnimName = ev.action || 'Walk';
        const MoveAnimClass = AnimationRegistry[moveAnimName];
        if (MoveAnimClass) {
          char.playAnimation(MoveAnimClass, ev.startTime, ev.duration || 1.0);
        }
      } else if (ev.type === 'animate') {
        const AnimClass = AnimationRegistry[ev.action];
        if (AnimClass) {
          char.playAnimation(AnimClass, ev.startTime, ev.duration);
        }
      }
    }

    // Tennis ball & swing choreography is handled in switchScene('ParkScene')
    // via CourtDirector, so that trajectories are computed from actual positions.

    // BasketballArenaScene dunk choreography: must run AFTER characters are spawned
    if (this.currentSceneName === 'BasketballArenaScene') {
      this._setupDunkEvents();
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
        if (char.moves) {
          char.moves = [];
        }
        // Reset rotation to upright when entering a new scene
        // (prevents flipped characters from previous scene animations/moves)
        if (char.mesh) {
          char.mesh.rotation.x = 0;
          char.mesh.rotation.z = 0;
        }
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
      this.arrangeCharacters();
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
            y: current.y + (ev.y || 0),
            z: current.z + (ev.z || 0),
          };
        } else {
          targetPos = { x: ev.x || 0, y: ev.y || 0, z: ev.z || 0 };
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
    // Only consider placements for the current scene
    const scenePlacements = this.storyPlacements?.filter(p => p.scene === this.currentSceneName) || [];
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

    // Hitstop: check if we are in a freeze frame
    const isHitstop = this.hitstopManager.update(t);

    // Trigger auto-detected and explicit hitstops at their designated times
    for (const entry of this.entries) {
      if (entry._autoHitstop && t >= entry._autoHitstop.time && t < entry._autoHitstop.time + 0.05) {
        if (!entry._autoHitstopTriggered) {
          entry._autoHitstopTriggered = true;
          this.hitstopManager.trigger(entry._autoHitstop.duration, entry._autoHitstop.shake, true);
        }
      }
      if (entry._explicitHitstop && t >= entry._explicitHitstop.time && t < entry._explicitHitstop.time + 0.05) {
        if (!entry._explicitHitstopTriggered) {
          entry._explicitHitstopTriggered = true;
          this.hitstopManager.trigger(entry._explicitHitstop.duration, entry._explicitHitstop.shake, true);
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
      // Dynamic character add/remove based on speaking time
      // Characters are added to scene just before their first line and removed after their last line
      if (this.currentScene) {
        for (const entry of this.entries) {
          if (!entry.character) continue;
          const char = this.characters.get(entry.character);
          if (!char) continue;

          const isInScene = this.currentScene.characters.includes(char);
          const isSpeakingWindow = t >= entry.startTime - 0.5 && t <= entry.endTime + 0.3;
          const isCurrentScene = this.currentSceneName && this.characterScenes.get(entry.character)?.has(this.currentSceneName);

          if (isSpeakingWindow && isCurrentScene && !isInScene) {
            // Character enters scene just before speaking
            // console.log('[update] adding', entry.character, 'to', this.currentSceneName, 't=', t.toFixed(2), 'for speaking');
            this.currentScene.addCharacter(char);
            // Teleport to a reasonable position if no prior position set
            if (char.mesh.position.x === 0 && char.mesh.position.z === 0) {
              const charsInScene = this.currentScene.characters.length;
              if (charsInScene === 1) {
                char.setPosition(0, 0, 0);
              } else if (charsInScene === 2) {
                char.setPosition(1.5, 0, 0);
              } else {
                const spacing = 2;
                const offset = ((charsInScene - 1) * spacing) / 2;
                char.setPosition((charsInScene - 1) * spacing - offset, 0, 0);
              }
              char.mesh.lookAt(0, 1.5, 5);
            }
          }
        }

        // Remove characters whose last line in this scene has ended (with small grace period)
        for (const [name, char] of this.characters) {
          if (!this.currentScene.characters.includes(char)) {
            // console.log('[update] skip remove', name, 'not in scene');
            continue;
          }
          const scenes = this.characterScenes.get(name);
          if (!scenes || !scenes.has(this.currentSceneName)) {
            // console.log('[update] skip remove', name, 'not in characterScenes for', this.currentSceneName);
            continue;
          }

          // Find the last entry for this character in the current scene
          let lastEndTime = -1;
          let sceneCursor = this.entries.find((e) => e.scene)?.scene || this.currentSceneName;
          for (const entry of this.entries) {
            if (entry.scene) sceneCursor = entry.scene;
            if (entry.character === name && sceneCursor === this.currentSceneName) {
              lastEndTime = Math.max(lastEndTime, entry.endTime);
            }
          }

          // Also consider storyEvents (e.g., Event:Move) for this character in this scene
          let eventEndTime = -1;
          let eventSceneCursor = this.entries.find((e) => e.scene)?.scene || this.currentSceneName;
          for (const entry of this.entries) {
            if (entry.scene) eventSceneCursor = entry.scene;
            if (eventSceneCursor === this.currentSceneName && entry.storyEvents) {
              for (const ev of entry.storyEvents) {
                if (ev.options.character === name) {
                  const evEnd = entry.startTime + (ev.options.duration || 1.0);
                  eventEndTime = Math.max(eventEndTime, evEnd);
                }
              }
            }
          }

          // Also consider storyPlacements: if character has explicit positions in this scene,
          // extend their presence to the end of the scene (last entry in this scene)
          let placementEndTime = -1;
          let placementSceneCursor = this.entries.find((e) => e.scene)?.scene || this.currentSceneName;
          for (const entry of this.entries) {
            if (entry.scene) placementSceneCursor = entry.scene;
            if (placementSceneCursor === this.currentSceneName && entry.positions) {
              for (const pos of entry.positions) {
                if (pos.name === name) {
                  placementEndTime = Math.max(placementEndTime, entry.endTime);
                }
              }
            }
          }

          const effectiveLastEndTime = Math.max(lastEndTime, eventEndTime, placementEndTime);

          // If current time is past their last line/event/placement + grace, remove them
          if (effectiveLastEndTime > 0 && t > effectiveLastEndTime + 1.0) {
            // console.log('[update] removing', name, 'from', this.currentSceneName, 't=', t.toFixed(2), 'lastEndTime=', lastEndTime, 'eventEndTime=', eventEndTime, 'placementEndTime=', placementEndTime);
            this.currentScene.removeCharacter(char);
          }
        }
        // console.log('[update t=' + t.toFixed(2) + '] chars in', this.currentSceneName, ':', this.currentScene.characters.map(c => c.constructor.name).join(','));
      }

      // Character speaking states - only speak if there's actual audio/subtitle
      for (const char of this.characters.values()) {
        char.stopSpeaking();
      }
      for (const entry of this.entries) {
        if (entry.character && t >= entry.startTime && t <= entry.endTime) {
          const char = this.characters.get(entry.character);
          if (char) {
            const slotDuration = entry.endTime - entry.startTime;
            const audioDur = this.audioDurations.get(entry.index);
            // Only speak if there's actual audio duration (real voice/subtitle)
            if (audioDur && audioDur > 0) {
              const speakDuration = Math.min(audioDur + 0.15, slotDuration);
              char.speak(entry.startTime, speakDuration);
            }
          }
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
              if (typeof this.currentScene[sceneMethod] === 'function') {
                this.currentScene[sceneMethod]();
              }
              // Also try exact match (for methods like summonCourierShip)
              if (typeof this.currentScene[ev.name] === 'function') {
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
            }
          }
        }
        // console.log('[update t=' + t.toFixed(2) + '] BEFORE currentScene.update, chars count=', this.currentScene.characters.length);
        this.currentScene.update(t, 0.016);
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

  render() {
    if (this.currentScene) {
      if (this.outlineEffect) {
        this.outlineEffect.render(this.currentScene.scene, this.camera);
      } else {
        this.renderer.render(this.currentScene.scene, this.camera);
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
   * Auto-schedule idle SwayBody animations for characters that have
   * gaps longer than 1 second with no active animation.
   */
  _scheduleIdleAnimations() {
    const SwayBody = AnimationRegistry['SwayBody'];
    if (!SwayBody) return;

    for (const [charName, char] of this.characters) {
      // Collect all animation time ranges for this character
      const ranges = [];
      for (const anim of char.animations) {
        ranges.push({ start: anim.startTime, end: anim.endTime });
      }
      // Also include move durations as "active" time
      for (const move of char.moves) {
        ranges.push({ start: move.startTime, end: move.endTime });
      }
      ranges.sort((a, b) => a.start - b.start);

      // Merge overlapping ranges
      const merged = [];
      for (const r of ranges) {
        if (merged.length === 0 || r.start > merged[merged.length - 1].end + 0.1) {
          merged.push({ start: r.start, end: r.end });
        } else {
          merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
        }
      }

      // Find gaps > 1s and fill with SwayBody
      let lastEnd = 0;
      for (const m of merged) {
        if (m.start - lastEnd > 1.0) {
          char.playAnimation(SwayBody, lastEnd + 0.1, m.start - lastEnd - 0.2);
        }
        lastEnd = m.end;
      }
      // Fill gap after last animation to end of episode
      const episodeEnd = Math.max(...this.entries.map(e => e.endTime), 0) + 2;
      if (episodeEnd - lastEnd > 1.0) {
        char.playAnimation(SwayBody, lastEnd + 0.1, episodeEnd - lastEnd - 0.2);
      }
    }
  }

  /**
   * Trigger visual effects synchronized with SFX events.
   * When an SFX fires, create a brief visual pulse on the character.
   */
  _updateSFXVisuals(t) {
    for (const entry of this.entries) {
      if (!entry.sfxEvents || entry.sfxEvents.length === 0) continue;
      for (const sfx of entry.sfxEvents) {
        const offset = sfx.options.offset || 0;
        const triggerTime = entry.startTime + offset;
        if (t >= triggerTime && t < triggerTime + 0.05) {
          const key = `${entry.index}_${sfx.name}_${offset}`;
          if (!this._sfxTriggered) this._sfxTriggered = new Set();
          if (this._sfxTriggered.has(key)) continue;
          this._sfxTriggered.add(key);

          const char = this.characters.get(entry.character);
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
}
