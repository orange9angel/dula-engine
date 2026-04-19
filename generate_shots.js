#!/usr/bin/env node
/**
 * Shot-by-shot video generator.
 * Reads episode script.story and outputs one MP4 per entry to episode output/shots/.
 * Each shot is rendered independently with its corresponding audio segment.
 */
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { StoryParser } from './lib/StoryParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8765;
const FPS = 30;

// Resolve episode path from CLI argument
const EPISODE = process.argv[2] || path.join(__dirname, 'content', 'episodes', 'bichong_qiupai');
const EPISODE_DIR = path.isAbsolute(EPISODE) ? EPISODE : path.join(__dirname, EPISODE);

const MIXED_AUDIO = path.join(EPISODE_DIR, 'assets', 'audio', 'mixed.wav');
const STORY_PATH = path.join(EPISODE_DIR, 'script.story');
const OUTPUT_DIR = path.join(EPISODE_DIR, 'output', 'shots');
const FRAMES_BASE = path.join(EPISODE_DIR, 'storyboard', 'shots');

console.log(`Episode dir: ${EPISODE_DIR}`);

// Parse story
const storyText = fs.readFileSync(STORY_PATH, 'utf-8');
const entries = StoryParser.parse(storyText);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Simple static file server with episode mount point
const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  // Serve episode content under /episode/
  if (reqPath.startsWith('/episode/')) {
    const relPath = reqPath.slice('/episode/'.length);
    const filePath = path.join(EPISODE_DIR, relPath);
    serveFile(filePath, res);
    return;
  }

  // Serve engine files from engine root
  const filePath = path.join(__dirname, reqPath === '/' ? 'render.html' : reqPath);
  serveFile(filePath, res);
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.story': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.webm': 'video/webm',
    '.png': 'image/png',
    '.wav': 'audio/wav',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  let currentShotIdx = 0;
  let currentFrameCount = 0;
  let renderDone = false;

  const page = await browser.newPage();

  await page.exposeFunction('saveShotFrame', (frameIdx, base64Data) => {
    const shotDir = path.join(FRAMES_BASE, `shot_${String(currentShotIdx + 1).padStart(2, '0')}`);
    const framesDir = path.join(shotDir, 'frames');
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = path.join(framesDir, `frame_${String(frameIdx).padStart(5, '0')}.png`);
    fs.writeFileSync(filename, buffer);
    if (frameIdx % 30 === 0 || frameIdx === 1) {
      process.stdout.write(`\r  Rendering frame ${frameIdx}...`);
    }
  });

  await page.exposeFunction('onShotRenderComplete', (frameCount) => {
    currentFrameCount = frameCount;
    renderDone = true;
  });

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('Failed to load resource')) {
      console.log('PAGE LOG:', text);
    }
  });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  await page.goto(`http://localhost:${PORT}/tools/shot_render.html`, {
    waitUntil: 'networkidle2',
  });

  // Wait for storyboard init
  await page.waitForFunction(() => window.storyboardReady === true, { timeout: 60000 });
  console.log('Storyboard ready.\n');

  const startTs = Date.now();

  for (let i = 0; i < entries.length; i++) {
    currentShotIdx = i;
    renderDone = false;
    const entry = entries[i];
    const duration = entry.endTime - entry.startTime;
    const totalFrames = Math.ceil(duration * FPS);

    const label = [];
    if (entry.scene) label.push(`Scene:${entry.scene}`);
    if (entry.character) label.push(`${entry.character}`);
    if (entry.dialogue) label.push(`"${entry.dialogue.slice(0, 30)}${entry.dialogue.length > 30 ? '...' : ''}"`);

    console.log(
      `[${String(i + 1).padStart(2, '0')}/${entries.length}] Shot ${String(i + 1).padStart(2, '0')} | ${entry.startTime.toFixed(2)}s ~ ${entry.endTime.toFixed(2)}s | ${totalFrames} frames`
    );
    if (label.length) console.log(`  Content: ${label.join(' | ')}`);

    // Prepare shot directory
    const shotDir = path.join(FRAMES_BASE, `shot_${String(i + 1).padStart(2, '0')}`);
    if (fs.existsSync(shotDir)) {
      fs.rmSync(shotDir, { recursive: true });
    }
    fs.mkdirSync(shotDir, { recursive: true });

    // Render shot frames (fire-and-forget in browser, poll for completion)
    const renderStart = Date.now();
    await page.evaluate((startTime, endTime, fps) => {
      window.renderShot(startTime, endTime, fps);
    }, entry.startTime, entry.endTime, FPS);

    while (!renderDone) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const renderMs = Date.now() - renderStart;
    process.stdout.write(`\r  Rendered ${currentFrameCount} frames in ${(renderMs / 1000).toFixed(1)}s          \n`);

    // Cut audio segment
    const shotAudio = path.join(shotDir, 'audio.wav');
    const audioStart = entry.startTime.toFixed(3);
    const audioDur = duration.toFixed(3);
    try {
      execSync(
        `ffmpeg -y -ss ${audioStart} -t ${audioDur} -i "${MIXED_AUDIO}" -c copy "${shotAudio}"`,
        { stdio: 'ignore' }
      );
    } catch (e) {
      console.warn(`  Audio cut failed, will encode without audio`);
    }

    // Encode video
    const framesPattern = path.join(shotDir, 'frames', 'frame_%05d.png');
    const outputPath = path.join(OUTPUT_DIR, `shot_${String(i + 1).padStart(2, '0')}.mp4`);
    const hasAudio = fs.existsSync(shotAudio);
    const videoCmd = hasAudio
      ? `ffmpeg -y -framerate ${FPS} -i "${framesPattern}" -i "${shotAudio}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${outputPath}"`
      : `ffmpeg -y -framerate ${FPS} -i "${framesPattern}" -c:v libx264 -pix_fmt yuv420p "${outputPath}"`;

    const encodeStart = Date.now();
    try {
      execSync(videoCmd, { stdio: 'pipe' });
      const encodeMs = Date.now() - encodeStart;
      const size = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
      console.log(`  -> Encoded in ${(encodeMs / 1000).toFixed(1)}s | ${size} MB`);
    } catch (e) {
      console.error(`  -> ENCODE FAILED: ${e.message}`);
    }

    // Cleanup shot frames
    fs.rmSync(shotDir, { recursive: true, force: true });
    console.log('');
  }

  const totalMs = Date.now() - startTs;
  await browser.close();
  server.close();

  console.log('='.repeat(60));
  console.log(`Done! ${entries.length} shots rendered in ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('='.repeat(60));
});
