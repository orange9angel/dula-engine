import * as THREE from 'three';
import { Storyboard, PostProcessRegistry } from 'dula-engine';

const width = 1920;
const height = 1080;
const fps = 30;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
camera.position.set(0, 3, 10);
camera.lookAt(0, 1.5, 0);

const storyboard = new Storyboard(renderer, camera);

// Patch fetch for correct asset paths from /tools/ base URL
const originalFetch = window.fetch;
window.fetch = async (url, ...args) => {
  if (typeof url === 'string' && url.startsWith('assets/audio/')) {
    url = '../episode/' + url;
  }
  return originalFetch(url, ...args);
};

async function init() {
  // Load Story bootstrap (registers assets + custom plugins)
  try {
    await import('../episode/bootstrap.js');
  } catch (e) {
    console.warn('No bootstrap.js found, running with empty registries:', e.message);
  }
  await storyboard.load('../episode/script.story', '../episode/assets/audio/manifest.json');
  window.storyboardReady = true;
}

window.renderShot = async (startTime, endTime, shotFps) => {
  // Initialize post-processing after bootstrap is loaded
  if (storyboard.postProcesses.length === 0) {
    for (const [name, EffectClass] of Object.entries(PostProcessRegistry)) {
      try {
        const effect = new EffectClass(renderer, width, height);
        storyboard.addPostProcess(effect);
      } catch (e) {
        console.warn(`[PostProcess] Failed to attach ${name}:`, e.message);
      }
    }
  }

  const totalFrames = Math.ceil((endTime - startTime) * shotFps);
  for (let i = 0; i < totalFrames; i++) {
    const t = startTime + i / shotFps;
    storyboard.update(t);
    storyboard.render();
    for (const effect of storyboard.postProcesses) {
      if (effect.update) effect.update(1 / shotFps);
    }
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    await window.saveShotFrame(i + 1, base64);
  }
  window.onShotRenderComplete(totalFrames);
};

init().catch((err) => {
  console.error('Shot render init failed:', err);
});
