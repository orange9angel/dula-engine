#!/usr/bin/env node
/**
 * Export Combat:Action SFX events for the Python audio pipeline.
 *
 * Usage: node export_combat_sfx.js <episode-dir>
 *
 * Loads the episode in a headless browser (via verify.html), expands all
 * {Combat:Action} tags, collects their normalized sfx events with absolute
 * trigger times, and writes them to:
 *   <episode-dir>/assets/audio/combat_sfx.json
 */
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const PORT = 8767;

const EPISODE = process.argv[2] || '.';
const EPISODE_DIR = path.isAbsolute(EPISODE) ? EPISODE : path.resolve(process.cwd(), EPISODE);
const OUTPUT_PATH = path.join(EPISODE_DIR, 'assets', 'audio', 'combat_sfx.json');

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
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
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

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  if (reqPath.startsWith('/episode/')) {
    const relPath = decodeURIComponent(reqPath.slice('/episode/'.length));
    const filePath = path.join(EPISODE_DIR, relPath);
    serveFile(filePath, res, reqPath);
    return;
  }

  if (reqPath.startsWith('/node_modules/')) {
    const relPath = decodeURIComponent(reqPath.slice('/node_modules/'.length));
    let filePath = path.join(EPISODE_DIR, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'node_modules', relPath);
    }
    serveFile(filePath, res, reqPath);
    return;
  }

  const filePath = path.join(ROOT, reqPath === '/' ? 'render.html' : decodeURIComponent(reqPath));
  serveFile(filePath, res, reqPath);
});

server.listen(PORT, async () => {
  console.log(`[export_combat_sfx] Episode dir: ${EPISODE_DIR}`);
  console.log(`[export_combat_sfx] Server listening on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  try {
    await page.goto(`http://localhost:${PORT}/tools/verify.html`, {
      waitUntil: 'networkidle2',
    });

    // Wait for module script to execute
    await new Promise((r) => setTimeout(r, 1000));

    // Initialize storyboard (loads script.story)
    await page.evaluate(async () => {
      await window.loadStoryboard();
    });

    // Wait for GLTF models and combat actions to expand
    await new Promise((r) => setTimeout(r, 4000));

    // Export combat SFX events
    const sfxEvents = await page.evaluate(() => window.exportCombatSFX());

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sfxEvents, null, 2), 'utf-8');
    console.log(`[export_combat_sfx] Wrote ${sfxEvents.length} event(s) to ${OUTPUT_PATH}`);
    for (const ev of sfxEvents) {
      console.log(`  - ${ev.name} @ ${ev.time.toFixed(3)}s (vol=${ev.volume})`);
    }
  } catch (err) {
    console.error('[export_combat_sfx] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
});
