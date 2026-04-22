import * as THREE from 'three';
import { StoryParser } from '../lib/StoryParser.js';
import { SceneRegistry } from '../scenes/index.js';
import { CharacterRegistry } from '../characters/index.js';
import { VoiceRegistry } from '../voices/index.js';
import { AnimationRegistry } from '../animations/index.js';
import { CameraMoveRegistry } from '../camera/index.js';
import { DirectorRegistry } from '../lib/DirectorRegistry.js';
import { MusicDirector, MusicCue } from '../lib/MusicDirector.js';

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

    for (const entry of this.entries) {
      if (entry.positions) {
        for (const pos of entry.positions) {
          this.storyPlacements.push({
            character: pos.name,
            spot: pos.options.spot,
            x: pos.options.x,
            y: pos.options.y,
            z: pos.options.z,
            face: pos.options.face,
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
    let sceneCursor = initialSceneName;
    for (const entry of this.entries) {
      if (entry.scene) sceneCursor = entry.scene;
      if (entry.character) {
        if (!this.characterScenes.has(entry.character)) {
          this.characterScenes.set(entry.character, new Set());
        }
        this.characterScenes.get(entry.character).add(sceneCursor);
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

    // Position characters
    this.arrangeCharacters();

    // Queue animations from SRT entries
    for (const entry of this.entries) {
      if (entry.character && entry.animations && entry.animations.length > 0) {
        const char = this.characters.get(entry.character);
        if (char) {
          for (const animName of entry.animations) {
            const AnimClass = AnimationRegistry[animName];
            if (AnimClass) {
              // Use the animation's own duration so one-shot actions (like PullOutRacket)
              // complete in their intended time rather than being stretched across the
              // entire dialogue slot.
              char.playAnimation(AnimClass, entry.startTime);
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
          this.playCameraMove(MoveClass, entry.startTime, entry.endTime - entry.startTime, options);
        } else {
          console.warn(`Camera move "${name}" not found in registry.`);
        }
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
        // Walk to exit before switch
        if (WalkAnim && this.transitions.exits[prevScene]) {
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
        if (this.transitions.entrances[nextScene] && nextScene !== 'ParkScene' && WalkAnim) {
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

    // Tennis ball & swing choreography is handled in switchScene('ParkScene')
    // via CourtDirector, so that trajectories are computed from actual positions.

    // BasketballArenaScene dunk choreography: must run AFTER characters are spawned
    if (this.currentSceneName === 'BasketballArenaScene') {
      this._setupDunkEvents();
    }
  }

  switchScene(sceneName, skipArrange = false) {
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
    if (!skipArrange) {
      this.arrangeCharacters();
    }

    // Generic placements from story (x/y/z, no court spot)
    if (this.storyPlacements) {
      for (const p of this.storyPlacements) {
        const char = this.characters.get(p.character);
        if (!char) continue;
        if (p.x !== undefined && p.z !== undefined) {
          char.setPosition(p.x, p.y !== undefined ? p.y : 0, p.z);
        }
        if (p.face) {
          if (p.face === 'center') {
            char.mesh.lookAt(0, 1.5, 0);
          } else {
            const targetChar = this.characters.get(p.face);
            if (targetChar) {
              char.mesh.lookAt(targetChar.mesh.position.x, targetChar.mesh.position.y + 1.5, targetChar.mesh.position.z);
            } else {
              char.mesh.lookAt(0, 1.5, 0);
            }
          }
        }
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
    if (chars.length === 1) {
      chars[0].setPosition(0, 0, 0);
      chars[0].mesh.lookAt(0, 0, 5);
    } else if (chars.length === 2) {
      chars[0].setPosition(-1.5, 0, 0);
      chars[0].mesh.lookAt(1.5, 0, 2);
      chars[1].setPosition(1.5, 0, 0);
      chars[1].mesh.lookAt(-1.5, 0, 2);
    } else {
      const spacing = 2;
      const offset = ((chars.length - 1) * spacing) / 2;
      chars.forEach((char, i) => {
        char.setPosition(i * spacing - offset, 0, 0);
        char.mesh.lookAt(0, 0, 5);
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

    // Scene switches
    for (const entry of this.entries) {
      if (entry.scene && t >= entry.startTime && t < entry.endTime) {
        this.switchScene(entry.scene, true);
        break;
      }
    }

    // Character speaking states
    for (const char of this.characters.values()) {
      char.stopSpeaking();
    }
    for (const entry of this.entries) {
      if (entry.character && t >= entry.startTime && t <= entry.endTime) {
        const char = this.characters.get(entry.character);
        if (char) {
          const slotDuration = entry.endTime - entry.startTime;
          const audioDur = this.audioDurations.get(entry.index);
          const speakDuration = audioDur ? Math.min(audioDur + 0.15, slotDuration) : slotDuration;
          char.speak(entry.startTime, speakDuration);
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
      this.currentScene.update(t, 0.016);
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
  }
}
