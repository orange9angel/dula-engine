import * as THREE from 'three';
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

const storyboard = new Storyboard(renderer, camera);

async function renderFrames() {
  await storyboard.load('./subtitles/script.srt', './assets/audio/manifest.json');

  const totalDuration = Math.max(...storyboard.entries.map((e) => e.endTime)) + 1.5;
  const totalFrames = Math.ceil(totalDuration * fps);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    storyboard.update(t);
    storyboard.render();

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
