import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8765;
const FPS = 30;
const FRAMES_DIR = path.join(__dirname, 'storyboard', 'frames');
const MIXED_AUDIO = path.join(__dirname, 'assets', 'audio', 'mixed.wav');
const OUTPUT_VIDEO = path.join(__dirname, 'output.mp4');

// Simple static file server
const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, reqPath === '/' ? 'render.html' : reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.srt': 'text/plain',
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
});

async function combineVideo(totalFrames) {
  const framePattern = path.join(FRAMES_DIR, 'frame_%05d.png');
  const cmd = `ffmpeg -y -framerate ${FPS} -i "${framePattern}" -i "${MIXED_AUDIO}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${OUTPUT_VIDEO}"`;
  console.log('Combining frames and audio with ffmpeg...');
  execSync(cmd, { stdio: 'inherit' });
}

function cleanup() {
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true });
    console.log('Cleaned up frames directory.');
  }
}

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  // Prepare frames directory
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  // Launch puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();

  let totalFrames = 0;
  let renderDone = false;

  await page.exposeFunction('saveFrame', (idx, base64Data) => {
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = path.join(FRAMES_DIR, `frame_${String(idx).padStart(5, '0')}.png`);
    fs.writeFileSync(filename, buffer);
    if (idx % 30 === 0) {
      console.log(`Rendered ${idx} frames...`);
    }
  });

  await page.exposeFunction('onRenderComplete', (frameCount) => {
    totalFrames = frameCount;
    renderDone = true;
  });

  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  await page.goto(`http://localhost:${PORT}/render.html`, {
    waitUntil: 'networkidle2',
  });

  // Wait for render completion
  while (!renderDone) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await browser.close();
  server.close();

  // Combine video
  await combineVideo(totalFrames);

  // Cleanup
  cleanup();

  console.log(`Done. Video saved to ${OUTPUT_VIDEO}`);
});
