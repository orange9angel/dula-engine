import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const PORT = 8769;
const EPISODE_DIR = path.resolve(ROOT, '..', 'dula-story', 'episodes', 'dunk_master_doraemon');
const CHECK_DIR = path.join(EPISODE_DIR, 'storyboard');

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];
  if (reqPath.startsWith('/episode/')) {
    const relPath = reqPath.slice('/episode/'.length);
    const filePath = path.join(EPISODE_DIR, relPath);
    serveFile(filePath, res);
    return;
  }
  if (reqPath.startsWith('/node_modules/')) {
    const relPath = reqPath.slice('/node_modules/'.length);
    let filePath = path.join(EPISODE_DIR, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(ROOT, '..', 'dula-story', 'node_modules', relPath);
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(ROOT, 'node_modules', relPath);
    }
    serveFile(filePath, res);
    return;
  }
  const filePath = path.join(ROOT, reqPath === '/' ? 'render.html' : reqPath);
  serveFile(filePath, res);
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
    '.story': 'text/plain', '.mp3': 'audio/mpeg', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wav': 'audio/wav',
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  // Patch verify_render.js to expose storyboard and renderer
  const verifyRenderPath = path.join(__dirname, 'verify_render.js');
  const originalVerifyRender = fs.readFileSync(verifyRenderPath, 'utf-8');
  const patchedVerifyRender = originalVerifyRender.replace(
    'const storyboard = new Storyboard(renderer, camera);',
    'const storyboard = new Storyboard(renderer, camera);\nwindow.storyboard = storyboard;\nwindow.renderer = renderer;'
  );
  fs.writeFileSync(verifyRenderPath, patchedVerifyRender);

  await page.goto(`http://localhost:${PORT}/tools/verify.html`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(async () => { await window.loadStoryboard(); });

  const times = [5.2, 6.5, 8.0, 9.5];
  for (const t of times) {
    const dataUrl = await page.evaluate(async (time) => {
      const PREWARM_TIME = Math.max(0, time - 0.5);
      window.storyboard.update(PREWARM_TIME);
      window.storyboard.update(time);
      window.storyboard.render();
      return window.renderer.domElement.toDataURL('image/jpeg', 0.92);
    }, t);

    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    fs.mkdirSync(CHECK_DIR, { recursive: true });
    const filename = path.join(CHECK_DIR, `orbit_shot_t${Math.round(t * 10)}.jpg`);
    fs.writeFileSync(filename, buffer);
    console.log(`Orbit shot saved: ${filename}`);
  }

  // Restore original verify_render.js
  fs.writeFileSync(verifyRenderPath, originalVerifyRender);

  await browser.close();
  server.close();
});
