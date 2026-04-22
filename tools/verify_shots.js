import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const PORT = 8766;

// Resolve episode path from CLI argument
const EPISODE = process.argv[2] || '.';
const EPISODE_DIR = path.isAbsolute(EPISODE) ? EPISODE : path.resolve(process.cwd(), EPISODE);
const CHECK_DIR = path.join(EPISODE_DIR, 'storyboard');

console.log(`Episode dir: ${EPISODE_DIR}`);

// Simple static file server from project root with episode mount
const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  // Serve episode content under /episode/
  if (reqPath.startsWith('/episode/')) {
    const relPath = reqPath.slice('/episode/'.length);
    const filePath = path.join(EPISODE_DIR, relPath);
    serveFile(filePath, res);
    return;
  }

  // Serve node_modules from episode directory or story root
  if (reqPath.startsWith('/node_modules/')) {
    const relPath = reqPath.slice('/node_modules/'.length);
    let filePath = path.join(EPISODE_DIR, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'node_modules', relPath);
    }
    serveFile(filePath, res);
    return;
  }

  // Serve engine files from engine root
  const filePath = path.join(ROOT, reqPath === '/' ? 'render.html' : reqPath);
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
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.wav': 'audio/wav',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // 404
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function deleteCheckFiles() {
  if (!fs.existsSync(CHECK_DIR)) return;
  const files = fs.readdirSync(CHECK_DIR).filter((f) => f.startsWith('check_shot_') && f.endsWith('.jpg'));
  for (const f of files) {
    fs.unlinkSync(path.join(CHECK_DIR, f));
  }
  if (files.length) {
    console.log(`Deleted ${files.length} temporary check file(s).`);
  }
}

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  // Clean up any previous check files
  deleteCheckFiles();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  await page.goto(`http://localhost:${PORT}/tools/verify.html`, {
    waitUntil: 'networkidle2',
  });

  // Wait a moment for module script to execute
  await new Promise((r) => setTimeout(r, 1000));

  // Initialize storyboard
  await page.evaluate(async () => {
    await window.loadStoryboard();
  });

  // Extra wait for GLTF models to load (Draco decoding can take 2-3s)
  await new Promise((r) => setTimeout(r, 4000));

  // Parse story to determine shot times
  const storyPath = path.join(EPISODE_DIR, 'script.story');
  const storyText = fs.readFileSync(storyPath, 'utf-8');
  const lines = storyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const times = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    i++; // index
    if (i >= lines.length) break;
    const timeLine = lines[i].trim();
    i++;
    const m = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!m) continue;
    const start = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000;
    const end = parseInt(m[5]) * 3600 + parseInt(m[6]) * 60 + parseInt(m[7]) + parseInt(m[8]) / 1000;
    const mid = (start + end) / 2;
    times.push({ start, end, mid });
    while (i < lines.length && lines[i].trim() !== '') i++;
  }

  for (let idx = 0; idx < times.length; idx++) {
    const t = times[idx].mid;
    const dataUrl = await page.evaluate(async (time) => {
      return await window.captureAtTime(time);
    }, t);

    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const filename = path.join(CHECK_DIR, `check_shot_${String(idx + 1).padStart(2, '0')}.jpg`);
    fs.mkdirSync(CHECK_DIR, { recursive: true });
    fs.writeFileSync(filename, buffer);
    console.log(`Shot ${String(idx + 1).padStart(2, '0')}: t=${t.toFixed(2)}s -> ${filename}`);
  }

  await browser.close();
  server.close();

  console.log('\nAll shots captured. Inspect the files above.');
  // deleteCheckFiles();
  console.log('Verification complete.');
});
