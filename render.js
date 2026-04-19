import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { Storyboard } from './storyboard/Storyboard.js';

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

const outlineEffect = new OutlineEffect(renderer, {
  defaultThickness: 0.003,
  defaultColor: new THREE.Color(0x000000),
  defaultAlpha: 0.85,
  defaultKeepAlive: true,
});

const storyboard = new Storyboard(renderer, camera, null, outlineEffect);
const fadeDiv = document.getElementById('fade');

async function renderFrames() {
  await storyboard.load('/episode/script.story', '/episode/assets/audio/manifest.json');

  const totalDuration = Math.max(...storyboard.entries.map((e) => e.endTime)) + 1.5;
  const totalFrames = Math.ceil(totalDuration * fps);

  let lastSceneName = null;
  let fadeRemaining = 0; // frames remaining for fade-in from black
  const FADE_LENGTH = 10;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    storyboard.update(t);

    // Detect scene transition and trigger fade
    if (storyboard.currentSceneName !== lastSceneName) {
      if (lastSceneName !== null) {
        fadeRemaining = FADE_LENGTH;
      }
      lastSceneName = storyboard.currentSceneName;
    }

    storyboard.render();

    // Apply fade overlay
    if (fadeRemaining > 0) {
      fadeDiv.style.opacity = fadeRemaining / FADE_LENGTH;
      fadeRemaining--;
    } else {
      fadeDiv.style.opacity = 0;
    }

    const dataUrl = renderer.domElement.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    await window.saveFrame(i + 1, base64);
  }

  window.onRenderComplete(totalFrames);
}

renderFrames().catch((err) => {
  console.error('Render failed:', err);
  window.onRenderComplete(0);
});
