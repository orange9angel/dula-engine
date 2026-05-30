import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const EPISODE = args.find((arg) => !arg.startsWith('--')) || '.';
const EPISODE_DIR = path.isAbsolute(EPISODE) ? EPISODE : path.resolve(process.cwd(), EPISODE);
const OUT_DIR = path.join(EPISODE_DIR, 'storyboard', 'pose_trace');

const options = {
  fps: numberArg('--fps', 30),
  startTime: numberArg('--start', 0),
  endTime: numberArg('--end', null),
  width: numberArg('--width', 1920),
  height: numberArg('--height', 1080),
};

// Keyframe times to capture for DragonPunch verification
const keyframes = [
  { time: 1.50, label: '01_crouch_start' },
  { time: 1.65, label: '02_crouch_deep' },
  { time: 1.80, label: '03_explode_mid' },
  { time: 1.95, label: '04_explode_peak' },
  { time: 2.10, label: '05_peak_hold' },
  { time: 2.25, label: '06_fall_start' },
  { time: 2.55, label: '07_land_recovery' },
  { time: 3.00, label: '08_idle_transition' },
  { time: 4.50, label: '09_fighting_stance' },
];

console.log(`Episode dir: ${EPISODE_DIR}`);
console.log(`Output dir: ${OUT_DIR}`);

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  if (reqPath.startsWith('/episode/')) {
    const relPath = reqPath.slice('/episode/'.length);
    serveFile(path.join(EPISODE_DIR, relPath), res, reqPath);
    return;
  }

  if (reqPath.startsWith('/node_modules/')) {
    const relPath = reqPath.slice('/node_modules/'.length);
    let filePath = path.join(EPISODE_DIR, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'node_modules', relPath);
    }
    if (!fs.existsSync(filePath)) {
      const firstSeg = relPath.split('/')[0];
      if (firstSeg === 'dula-engine' || firstSeg === 'dula-assets') {
        filePath = path.join(ROOT, '..', relPath);
      }
    }
    serveFile(filePath, res, reqPath);
    return;
  }

  serveFile(path.join(ROOT, reqPath === '/' ? 'tools/pose_trace.html' : reqPath), res, reqPath);
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`Server listening on http://localhost:${port}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.setViewport({ width: options.width, height: options.height });
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  try {
    await page.goto(`http://localhost:${port}/tools/pose_trace.html`, {
      waitUntil: 'networkidle2',
    });

    await page.evaluate(async () => {
      await window.loadStoryboard();
    });

    // Wait for models to load
    await new Promise((r) => setTimeout(r, 3000));

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const kf of keyframes) {
      // Update scene to this time
      await page.evaluate(async (time) => {
        if (window.storyboard) {
          window.storyboard.update(time);
        }
      }, kf.time);

      // Wait a frame for render
      await new Promise((r) => setTimeout(r, 100));

      // Screenshot
      const screenshotPath = path.join(OUT_DIR, `dragonpunch_${kf.label}_t${kf.time.toFixed(2)}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`✓ ${kf.label} @ t=${kf.time.toFixed(2)}s -> ${screenshotPath}`);
    }

    console.log(`\nAll ${keyframes.length} keyframes captured.`);
  } finally {
    await browser.close();
    server.close();
  }
});

function numberArg(name, fallback) {
  const item = args.find((arg) => arg === name || arg.startsWith(`${name}=`));
  if (!item) return fallback;
  if (item === name) {
    const idx = args.indexOf(item);
    const value = args[idx + 1];
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(item.slice(name.length + 1));
  return Number.isFinite(n) ? n : fallback;
}

function serveFile(filePath, res, reqPath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.story': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.svg': 'image/svg+xml',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log('404:', reqPath || filePath);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    res.end(data);
  });
}
