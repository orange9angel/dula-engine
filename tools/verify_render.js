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

window.captureAtTime = async (time) => {
  // Pre-warm: seek to just before time to initialize moves/animations state
  const PREWARM_TIME = Math.max(0, time - 0.5);
  storyboard.update(PREWARM_TIME);
  storyboard.update(time);
  storyboard.render();
  return renderer.domElement.toDataURL('image/jpeg', 0.92);
};
