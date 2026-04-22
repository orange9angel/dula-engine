import * as THREE from 'three';
import { Storyboard } from './storyboard/Storyboard.js';

const width = 1920;
const height = 1080;
const fps = 30;

// Parse segment parameters from URL query string
const urlParams = new URLSearchParams(window.location.search);
const SEGMENT_START = parseFloat(urlParams.get('start') || '0');
const SEGMENT_DURATION = parseFloat(urlParams.get('duration') || '0'); // 0 means render all
const FRAME_OFFSET = parseInt(urlParams.get('frameOffset') || '0');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
camera.position.set(0, 3, 10);
camera.lookAt(0, 1.5, 0);

// Load Story bootstrap (registers assets + custom plugins)
try {
  await import('/episode/bootstrap.js');
} catch (e) {
  console.warn('No bootstrap.js found, running with empty registries:', e.message);
}

const storyboard = new Storyboard(renderer, camera, null, null);
const fadeDiv = document.getElementById('fade');

async function renderFrames() {
  await storyboard.load('/episode/script.story', '/episode/assets/audio/manifest.json');

  const totalDuration = Math.max(...storyboard.entries.map((e) => e.endTime)) + 1.5;

  // Determine render range
  const startTime = SEGMENT_START;
  const endTime = SEGMENT_DURATION > 0
    ? Math.min(startTime + SEGMENT_DURATION, totalDuration)
    : totalDuration;

  const startFrame = Math.floor(startTime * fps);
  const endFrame = Math.ceil(endTime * fps);
  const segmentFrames = endFrame - startFrame;

  console.log(`[Segment] start=${startTime}s, duration=${endTime - startTime}s, frames=${segmentFrames}, frameOffset=${FRAME_OFFSET}`);
  if (window.setFrameOffset) {
    window.setFrameOffset(FRAME_OFFSET);
  }

  // Pre-warm: seek to just before startTime to initialize moves/animations state
  // This fixes the issue where moves that began before startTime would have
  // incorrect startPos snapshot when rendered mid-segment.
  const PREWARM_TIME = Math.max(0, startTime - 0.5);
  storyboard.update(PREWARM_TIME);

  // Wait for async scene assets (e.g., GLTF models) to finish loading
  if (storyboard.currentScene && storyboard.currentScene.readyPromise) {
    console.log('[Render] Waiting for scene async assets...');
    await storyboard.currentScene.readyPromise;
    console.log('[Render] Scene assets ready.');
  }

  let lastSceneName = null;
  let fadeRemaining = 0; // frames remaining for fade-in from black
  const FADE_LENGTH = 10;

  // Only apply fade if this is the very beginning of the video
  const isFirstSegment = startTime <= 0;

  for (let i = startFrame; i < endFrame; i++) {
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
    // Frame index is 1-based relative to the segment (for ffmpeg pattern matching)
    const frameIdx = i - startFrame + 1;
    const absFrameIdx = frameIdx + FRAME_OFFSET;
    await window.saveFrame(absFrameIdx, base64);
    // Also log absolute frame number for debugging
    if (frameIdx % 30 === 0 || frameIdx === segmentFrames) {
      console.log(`[Render] frame ${absFrameIdx} (segment ${frameIdx}/${segmentFrames})`);
    }
  }

  window.onRenderComplete(segmentFrames);
}

renderFrames().catch((err) => {
  console.error('Render failed:', err);
  window.onRenderComplete(0);
});
