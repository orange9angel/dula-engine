import * as THREE from 'three';
import { Storyboard } from '../storyboard/Storyboard.js';

const width = 1920;
const height = 1080;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
camera.position.set(0, 3, 10);
camera.lookAt(0, 1.5, 0);

// Load Story bootstrap (registers assets)
try {
  await import('/episode/bootstrap.js');
} catch (e) {
  console.warn('No bootstrap.js found:', e.message);
}

const storyboard = new Storyboard(renderer, camera);
window.storyboard = storyboard;

// Patch fetch so assets/audio paths resolve correctly from /tools/ base URL
const originalFetch = window.fetch;
window.fetch = async (url, ...args) => {
  if (typeof url === 'string' && url.startsWith('assets/audio/')) {
    url = '../episode/' + url;
  }
  return originalFetch(url, ...args);
};

window.loadStoryboard = async () => {
  await storyboard.load('/episode/script.story', '/episode/assets/audio/manifest.json');
};

let lastCaptureTime = 0;

window.captureAtTime = async (time) => {
  // Sequential seek from the previous captured time so that short camera moves
  // (which only start when the current time falls inside their [startTime,
  // endTime] window) get a chance to initialize and leave the camera in the
  // correct final position.
  const STEP = 0.1;
  const start = Math.min(lastCaptureTime, time);
  for (let t = start; t < time; t += STEP) {
    storyboard.update(Math.min(t, time));
  }
  storyboard.update(time);
  storyboard.render();
  lastCaptureTime = time;
  return renderer.domElement.toDataURL('image/jpeg', 0.92);
};

/**
 * Export Combat:Action SFX events for the Python audio pipeline.
 * Returns a JSON-serializable array of { time, name, volume, pitch }.
 */
window.exportCombatSFX = () => {
  const list = (storyboard.combatActionSFX || [])
    .filter((ev) => ev.name)
    .map((ev) => ({
      time: ev.time,
      name: ev.name,
      volume: ev.volume !== undefined ? ev.volume : 1.0,
      pitch: ev.pitch !== undefined ? ev.pitch : 1.0,
    }));
  return list;
};
