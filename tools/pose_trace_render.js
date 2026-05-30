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

/**
 * 13关节点姿势数据采集
 * 
 * 控制点映射到角色骨骼：
 *   headGroup     → character.headGroup
 *   rightShoulder → character.rightArm
 *   rightElbow    → character.rightElbow
 *   rightWrist    → character.rightWrist
 *   leftShoulder  → character.leftArm
 *   leftElbow     → character.leftElbow
 *   leftWrist     → character.leftWrist
 *   rightHip      → character.rightLeg
 *   rightKnee     → character.rightKnee
 *   rightAnkle    → character.rightAnkle
 *   leftHip       → character.leftLeg
 *   leftKnee      → character.leftKnee
 *   leftAnkle     → character.leftAnkle
 *   mesh          → character.mesh (整体位移/旋转)
 */
const JOINT_MAP = {
  headGroup: 'headGroup',
  rightShoulder: 'rightArm',
  rightElbow: 'rightElbow',
  rightWrist: 'rightWrist',
  leftShoulder: 'leftArm',
  leftElbow: 'leftElbow',
  leftWrist: 'leftWrist',
  rightHip: 'rightLeg',
  rightKnee: 'rightKnee',
  rightAnkle: 'rightAnkle',
  leftHip: 'leftLeg',
  leftKnee: 'leftKnee',
  leftAnkle: 'leftAnkle',
};

function captureJointState(character) {
  const joints = {};
  for (const [poseName, charProp] of Object.entries(JOINT_MAP)) {
    const obj = character[charProp];
    if (!obj) continue;
    joints[poseName] = {
      rx: obj.rotation.x,
      ry: obj.rotation.y,
      rz: obj.rotation.z,
    };
  }

  // Mesh (root) state
  if (character.mesh) {
    joints.mesh = {
      x: character.mesh.position.x,
      y: character.mesh.position.y,
      z: character.mesh.position.z,
      rx: character.mesh.rotation.x,
      ry: character.mesh.rotation.y,
      rz: character.mesh.rotation.z,
    };
  }

  return joints;
}

function captureWorldPositions(character) {
  const worldPos = {};
  for (const [poseName, charProp] of Object.entries(JOINT_MAP)) {
    const obj = character[charProp];
    if (!obj) continue;
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);
    worldPos[poseName] = { x: pos.x, y: pos.y, z: pos.z };
  }
  if (character.mesh) {
    character.mesh.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    character.mesh.getWorldPosition(pos);
    worldPos.mesh = { x: pos.x, y: pos.y, z: pos.z };
  }
  return worldPos;
}

function computeWorldDirections(character) {
  // Compute arm/leg directions in world space
  const dirs = {};
  const c = character;
  
  // Helper: get world position
  const getWorldPos = (obj) => {
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);
    return pos;
  };
  
  // Right arm direction (shoulder → elbow → wrist)
  const rs = getWorldPos(c.rightArm);
  const re = getWorldPos(c.rightElbow);
  const rw = getWorldPos(c.rightWrist);
  if (rs && re && rw) {
    const upperArm = new THREE.Vector3().subVectors(re, rs).normalize();
    const forearm = new THREE.Vector3().subVectors(rw, re).normalize();
    dirs.rightUpperArm = { x: upperArm.x, y: upperArm.y, z: upperArm.z };
    dirs.rightForearm = { x: forearm.x, y: forearm.y, z: forearm.z };
  }
  
  // Left arm direction
  const ls = getWorldPos(c.leftArm);
  const le = getWorldPos(c.leftElbow);
  const lw = getWorldPos(c.leftWrist);
  if (ls && le && lw) {
    const upperArm = new THREE.Vector3().subVectors(le, ls).normalize();
    const forearm = new THREE.Vector3().subVectors(lw, le).normalize();
    dirs.leftUpperArm = { x: upperArm.x, y: upperArm.y, z: upperArm.z };
    dirs.leftForearm = { x: forearm.x, y: forearm.y, z: forearm.z };
  }
  
  // Right leg direction
  const rh = getWorldPos(c.rightLeg);
  const rk = getWorldPos(c.rightKnee);
  const ra = getWorldPos(c.rightAnkle);
  if (rh && rk && ra) {
    const thigh = new THREE.Vector3().subVectors(rk, rh).normalize();
    const shin = new THREE.Vector3().subVectors(ra, rk).normalize();
    dirs.rightThigh = { x: thigh.x, y: thigh.y, z: thigh.z };
    dirs.rightShin = { x: shin.x, y: shin.y, z: shin.z };
  }
  
  // Left leg direction
  const lh = getWorldPos(c.leftLeg);
  const lk = getWorldPos(c.leftKnee);
  const la = getWorldPos(c.leftAnkle);
  if (lh && lk && la) {
    const thigh = new THREE.Vector3().subVectors(lk, lh).normalize();
    const shin = new THREE.Vector3().subVectors(la, lk).normalize();
    dirs.leftThigh = { x: thigh.x, y: thigh.y, z: thigh.z };
    dirs.leftShin = { x: shin.x, y: shin.y, z: shin.z };
  }
  
  return dirs;
}

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

function getPoseMatrixOffset(character) {
  // The controller is stored as character._actionMatrix (private in CharacterBase)
  const controller = character._actionMatrix;
  if (!controller) return null;
  
  // Try different ways to access the state
  let pose = null;
  if (controller.currentPose) {
    pose = controller.currentPose;
  } else if (controller.getMatrixState) {
    const state = controller.getMatrixState();
    pose = state?.pose;
  }
  
  if (!pose) return null;
  
  const offset = {};
  for (const joint of Object.keys(JOINT_MAP).concat(['mesh'])) {
    if (pose[joint]) {
      offset[joint] = { ...pose[joint] };
    }
  }
  return offset;
}

function getBaselinePose(character) {
  const controller = character._actionMatrix;
  if (!controller) return null;
  
  // Try _baselinePose (private) or baselinePose (public)
  const base = controller._baselinePose || controller.baselinePose;
  if (!base) return null;
  
  const result = {};
  for (const joint of Object.keys(JOINT_MAP).concat(['mesh'])) {
    if (base[joint]) {
      result[joint] = { ...base[joint] };
    }
  }
  return result;
}

window.collectPoseTrace = async (options = {}) => {
  const fps = options.fps || 60;
  const episodeEnd = Math.max(...storyboard.entries.map((e) => e.endTime), 0);
  const startTime = options.startTime ?? 0;
  const endTime = options.endTime ?? episodeEnd;
  const dt = 1 / fps;
  const samples = [];

  for (let t = startTime; t <= endTime + 0.0001; t += dt) {
    storyboard.update(t);

    const characters = [];
    for (const [name, character] of storyboard.characters) {
      if (!character.mesh) continue;
      const anims = activeAnimations(character, t);
      const joints = captureJointState(character);
      const worldPos = captureWorldPositions(character);
      const poseOffset = getPoseMatrixOffset(character);
      const baseline = getBaselinePose(character);

      const worldDirs = computeWorldDirections(character);

      characters.push({
        name,
        joints,
        worldPos,
        worldDirs,
        poseOffset,
        baseline,
        activeBody: anims.body,
        activeFace: anims.face,
        activeFx: anims.fx,
      });
    }

    samples.push({
      time: Number(t.toFixed(4)),
      scene: storyboard.currentSceneName,
      characters,
    });
  }

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
    })),
    samples,
  };
};
