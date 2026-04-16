import { SRTParser } from '../lib/SRTParser.js';
import { SceneRegistry } from '../scenes/index.js';
import { CharacterRegistry } from '../characters/index.js';
import { VoiceRegistry } from '../voices/index.js';
import { AnimationRegistry } from '../animations/index.js';

export class Storyboard {
  constructor(renderer, camera, audioDestination = null) {
    this.renderer = renderer;
    this.camera = camera;
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
  }

  async load(srtPath, manifestPath) {
    // Load SRT
    const srtResponse = await fetch(srtPath);
    const srtText = await srtResponse.text();
    this.entries = SRTParser.parse(srtText);

    // Load audio manifest
    let manifest = { entries: [] };
    try {
      const manifestResponse = await fetch(manifestPath);
      manifest = await manifestResponse.json();
    } catch (e) {
      console.warn('No audio manifest found, running silent mode.');
    }

    // Decode audio files
    for (const item of manifest.entries) {
      try {
        const resp = await fetch(item.file);
        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.audioBuffers.set(item.index, audioBuffer);
      } catch (err) {
        console.error(`Failed to load audio for entry ${item.index}:`, err);
      }
    }

    // Initialize first scene if specified
    const firstSceneEntry = this.entries.find((e) => e.scene);
    if (firstSceneEntry) {
      this.switchScene(firstSceneEntry.scene);
    } else {
      this.switchScene('RoomScene');
    }

    // Spawn characters mentioned in SRT
    const mentionedChars = new Set(this.entries.map((e) => e.character).filter(Boolean));
    for (const name of mentionedChars) {
      const CharClass = CharacterRegistry[name];
      if (CharClass) {
        const instance = new CharClass();
        this.characters.set(name, instance);
        if (this.currentScene) {
          this.currentScene.addCharacter(instance);
        }
      }
    }

    // Position characters
    this.arrangeCharacters();

    // Queue animations from SRT entries
    for (const entry of this.entries) {
      if (entry.character && entry.animation) {
        const AnimClass = AnimationRegistry[entry.animation];
        const char = this.characters.get(entry.character);
        if (AnimClass && char) {
          char.playAnimation(AnimClass, entry.startTime, entry.endTime - entry.startTime);
        }
      }
    }
  }

  switchScene(sceneName) {
    if (this.currentSceneName === sceneName) return;
    const SceneClass = SceneRegistry[sceneName];
    if (!SceneClass) {
      console.warn(`Scene ${sceneName} not found in registry.`);
      return;
    }
    const newScene = new SceneClass();
    newScene.build();

    // Migrate existing characters
    for (const [name, char] of this.characters) {
      if (this.currentScene) {
        this.currentScene.removeCharacter(char);
      }
      newScene.addCharacter(char);
    }

    this.currentScene = newScene;
    this.currentSceneName = sceneName;
    this.arrangeCharacters();
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
        this.switchScene(entry.scene);
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
          char.speak(entry.startTime, entry.endTime - entry.startTime);
        }
      }
    }

    if (this.currentScene) {
      this.currentScene.update(t, 0.016);
    }
  }

  render() {
    if (this.currentScene) {
      this.renderer.render(this.currentScene.scene, this.camera);
    }
  }
}
