import * as THREE from 'three';
import { Storyboard } from '../storyboard/Storyboard.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false });
renderer.setSize(320, 180);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 320 / 180, 0.1, 1000);
camera.position.set(0, 3, 10);
camera.lookAt(0, 1.5, 0);

try {
  await import('/episode/bootstrap.js');
} catch (e) {
  console.warn('No bootstrap.js found:', e.message);
}

const storyboard = new Storyboard(renderer, camera);

window.loadStoryboard = async () => {
  await storyboard.load('/episode/script.story', '/episode/assets/audio/manifest.json');
};

function activeAnimations(character, time) {
  const body = [];
  const fx = [];
  const face = [];
  for (const anim of character.animations || []) {
    if (time < anim.startTime || time > anim.endTime) continue;
    const name = anim.instance?.name || 'Unknown';
    if (name.startsWith('FX')) fx.push(name);
    else if (name.startsWith('Face')) face.push(name);
    else body.push(name);
  }
  return { body, face, fx };
}

function faceTrace(character) {
  if (!character.headGroup) {
    return {
      headX: null,
      headY: null,
      headZ: null,
      headYaw: null,
      headLocalYaw: null,
      headLocalPitch: null,
      headLocalRoll: null,
      faceDirX: null,
      faceDirY: null,
      faceDirZ: null,
    };
  }

  character.headGroup.updateWorldMatrix(true, false);
  const headPos = new THREE.Vector3();
  const headQuat = new THREE.Quaternion();
  character.headGroup.getWorldPosition(headPos);
  character.headGroup.getWorldQuaternion(headQuat);

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(headQuat).normalize();
  const flatLen = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  const headYaw = flatLen > 0.0001 ? Math.atan2(forward.x, forward.z) : null;

  return {
    headX: headPos.x,
    headY: headPos.y,
    headZ: headPos.z,
    headYaw,
    headLocalYaw: character.headGroup.rotation.y,
    headLocalPitch: character.headGroup.rotation.x,
    headLocalRoll: character.headGroup.rotation.z,
    faceDirX: forward.x,
    faceDirY: forward.y,
    faceDirZ: forward.z,
  };
}

function serializeHitEvent(ev, index) {
  return {
    index,
    time: ev.time,
    triggerTime: ev.triggerTime ?? null,
    attacker: ev.attacker,
    defender: ev.defender,
    anim: ev.anim,
    sfx: ev.sfx,
    reaction: ev.reaction,
    hitstop: ev.hitstop,
    shake: ev.shake,
    profile: ev.profile || null,
    hitPoint: ev.hitPoint || null,
    preContactDistance: ev.preContactDistance,
    preContactGap: ev.preContactGap,
    contactDistance: ev.contactDistance,
    contactGap: ev.contactGap,
    hitVolume: ev.hitVolume || null,
    visualHitVolume: ev.visualHitVolume || null,
    projectilePath: ev.projectilePath || null,
    projectileHitTime: ev.projectileHitTime ?? null,
    projectileImpactPoint: ev.projectileImpactPoint || null,
    correctedAtHit: ev.correctedAtHit === true,
    triggered: ev.triggered === true,
  };
}

function serializeVolume(volume, character, sourceOverride = null) {
  if (!volume) return null;
  return {
    character,
    type: volume.type || 'capsule',
    source: sourceOverride || volume.source || '',
    start: volume.start?.toArray?.() || null,
    end: volume.end?.toArray?.() || null,
    radius: volume.radius ?? null,
    length: volume.length ?? (volume.start && volume.end ? volume.start.distanceTo(volume.end) : null),
  };
}

function activeEffectVolumes(character) {
  const volumes = [];
  const sword = character.getSpiritSwordVolume?.();
  if (sword) volumes.push(serializeVolume(sword, character.name));

  const spiritGunBeam = character.getSpiritGunBeamVolume?.();
  if (spiritGunBeam) volumes.push(serializeVolume(spiritGunBeam, character.name));

  return volumes.filter(Boolean);
}

/**
 * 获取当前时间点的对话状态信息
 * 返回每个角色的 speaking 状态以及当前活跃的 entry
 */
function getDialogueState(time) {
  const speakingChars = new Set();
  const activeEntries = [];

  for (const entry of storyboard.entries || []) {
    // 对话窗口：entry 时间范围 ± 0.3s 的缓冲
    if (time >= entry.startTime - 0.3 && time <= entry.endTime + 0.3) {
      if (entry.character && entry.dialogue) {
        speakingChars.add(entry.character);
        activeEntries.push({
          index: entry.index,
          character: entry.character,
          dialogue: entry.dialogue,
          startTime: entry.startTime,
          endTime: entry.endTime,
          scene: entry.scene,
        });
      }
    }
  }

  return { speakingChars, activeEntries };
}

/**
 * 获取场景切换信息
 */
function getSceneChanges() {
  const changes = [];
  let lastScene = null;
  for (const entry of storyboard.entries || []) {
    if (entry.scene && entry.scene !== lastScene) {
      changes.push({
        time: entry.startTime,
        scene: entry.scene,
        entryIndex: entry.index,
      });
      lastScene = entry.scene;
    }
  }
  return changes;
}

window.collectCombatTrace = async (options = {}) => {
  const fps = options.fps || 60;
  const episodeEnd = Math.max(...storyboard.entries.map((e) => e.endTime), 0);
  const startTime = options.startTime ?? 0;
  const endTime = options.endTime ?? episodeEnd;
  const dt = 1 / fps;
  const samples = [];

  const initialHitEvents = storyboard.combatDirector?.hitEvents?.map(serializeHitEvent) || [];

  for (let t = startTime; t <= endTime + 0.0001; t += dt) {
    storyboard.update(t);

    const dialogueState = getDialogueState(t);
    const characters = [];
    const volumes = [];
    for (const [name, character] of storyboard.characters) {
      if (!character.mesh) continue;
      const data = character.userData || character.mesh.userData || {};
      const anims = activeAnimations(character, t);
      const face = faceTrace(character);
      volumes.push(...activeEffectVolumes(character));

      // 判断角色是否在当前对话中发言
      const isSpeaking = dialogueState.speakingChars.has(name);
      // 判断角色是否是当前对话的听众（在场但不发言）
      const isListener = !isSpeaking && dialogueState.activeEntries.length > 0;

      characters.push({
        name,
        x: character.mesh.position.x,
        y: character.mesh.position.y,
        z: character.mesh.position.z,
        yaw: character.mesh.rotation.y,
        ...face,
        facingDir: data.facingDir ?? null,
        inCombat: data.inCombat === true,
        isSpeaking,
        isListener,
        activeBody: anims.body,
        activeFace: anims.face,
        activeFx: anims.fx,
      });
    }

    samples.push({
      time: Number(t.toFixed(4)),
      scene: storyboard.currentSceneName,
      hitstopActive: storyboard.hitstopManager?.active === true,
      dialogueActive: dialogueState.activeEntries.length > 0,
      dialogueEntries: dialogueState.activeEntries,
      characters,
      volumes,
    });
  }

  const finalHitEvents = storyboard.combatDirector?.hitEvents?.map(serializeHitEvent) || [];

  return {
    fps,
    startTime,
    endTime,
    entries: storyboard.entries.map((entry) => ({
      index: entry.index,
      startTime: entry.startTime,
      endTime: entry.endTime,
      scene: entry.scene,
      character: entry.character,
      dialogue: entry.dialogue || null,
      animations: entry.animations || [],
      combat: entry.combatAll || [],
      positions: entry.positions || [],
    })),
    sceneChanges: getSceneChanges(),
    initialHitEvents,
    finalHitEvents,
    samples,
  };
};
