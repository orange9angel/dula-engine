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

// Parse CLI arguments: node generate_video.js <episode> [--start N] [--duration N] [--frame-start N] [--frame-end N]
function parseArgs(argv) {
  let episode = '.';
  let start = 0;
  let duration = 0;
  let frameStart = -1;
  let frameEnd = -1;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--start') {
      start = parseFloat(argv[++i]) || 0;
    } else if (argv[i] === '--duration') {
      duration = parseFloat(argv[++i]) || 0;
    } else if (argv[i] === '--frame-start') {
      const val = parseInt(argv[++i]);
      frameStart = Number.isNaN(val) ? -1 : val;
    } else if (argv[i] === '--frame-end') {
      const val = parseInt(argv[++i]);
      frameEnd = Number.isNaN(val) ? -1 : val;
    } else if (!argv[i].startsWith('--')) {
      episode = argv[i];
    }
  }
  return { episode, start, duration, frameStart, frameEnd };
}

const args = parseArgs(process.argv);
const EPISODE = args.episode;
const SEGMENT_START = args.start;
const SEGMENT_DURATION = args.duration;
const FRAME_START = args.frameStart;
const FRAME_END = args.frameEnd;

const EPISODE_DIR = path.isAbsolute(EPISODE) ? EPISODE : path.resolve(process.cwd(), EPISODE);

const FRAMES_DIR = path.join(EPISODE_DIR, 'storyboard', 'frames');
const MIXED_AUDIO = path.join(EPISODE_DIR, 'assets', 'audio', 'mixed.wav');

// Output filename includes segment range if rendering a segment
let segmentSuffix = '';
if (FRAME_START >= 0 && FRAME_END >= 0) {
  segmentSuffix = `_frames_${FRAME_START}-${FRAME_END}`;
} else if (SEGMENT_DURATION > 0) {
  segmentSuffix = `_${SEGMENT_START}-${SEGMENT_START + SEGMENT_DURATION}`;
}
const OUTPUT_VIDEO = path.join(EPISODE_DIR, 'output', `output${segmentSuffix}.mp4`);

console.log(`Episode dir: ${EPISODE_DIR}`);

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT_VIDEO), { recursive: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

// Simple static file server with episode mount point
const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  // Serve episode content under /episode/
  if (reqPath.startsWith('/episode/')) {
    const relPath = reqPath.slice('/episode/'.length);
    const filePath = path.join(EPISODE_DIR, relPath);
    serveFile(filePath, res, req.url);
    return;
  }

  // Serve node_modules from episode directory or story root
  if (reqPath.startsWith('/node_modules/')) {
    const relPath = reqPath.slice('/node_modules/'.length);
    let filePath = path.join(EPISODE_DIR, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'node_modules', relPath);
    }
    serveFile(filePath, res, req.url);
    return;
  }

  // Serve engine files from engine root
  const filePath = path.join(__dirname, reqPath === '/' ? 'render.html' : reqPath);
  serveFile(filePath, res);
});

function serveFile(filePath, res, urlPath = null) {
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
      if (urlPath) console.log(`[404] ${urlPath} -> ${filePath}`);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}

async function combineVideo(totalFrames) {
  const framePattern = path.join(FRAMES_DIR, 'frame_%05d.png');
  let audioInput = '';
  let audioOpts = '';

  if (fs.existsSync(MIXED_AUDIO)) {
    if (SEGMENT_DURATION > 0) {
      // Segment render: trim audio to match segment
      audioInput = `-i "${MIXED_AUDIO}"`;
      audioOpts = `-ss ${SEGMENT_START} -t ${SEGMENT_DURATION}`;
    } else {
      // Full render: use entire audio
      audioInput = `-i "${MIXED_AUDIO}"`;
    }
  }

  const cmd = `ffmpeg -y -framerate ${FPS} -i "${framePattern}" ${audioOpts} ${audioInput} -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${OUTPUT_VIDEO}"`;
  console.log('Combining frames and audio with ffmpeg...');
  console.log(`Command: ${cmd}`);
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
  console.log(`Episode mounted at http://localhost:${PORT}/episode/`);

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
      '--disable-cache',
      '--disable-application-cache',
      '--disable-offline-load-stale-cache',
      '--disk-cache-size=0',
    ],
  });
  const page = await browser.newPage();

  // Clear all browser data to ensure fresh module loading
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCache');
  await client.send('Network.clearBrowserCookies');
  await client.send('Storage.clearDataForOrigin', {
    origin: `http://localhost:${PORT}`,
    storageTypes: 'all',
  });

  let totalFrames = 0;
  let renderDone = false;
  let expectedTotalFrames;
  if (FRAME_START >= 0 && FRAME_END >= 0) {
    expectedTotalFrames = FRAME_END - FRAME_START + 1;
  } else if (SEGMENT_DURATION > 0) {
    expectedTotalFrames = Math.ceil(SEGMENT_DURATION * FPS);
  } else {
    expectedTotalFrames = null;
  }
  const renderStartTime = Date.now();
  let frameOffset = 0;

  function formatProgress(idx) {
    const elapsed = (Date.now() - renderStartTime) / 1000;
    const renderFps = idx / elapsed;
    const absFrame = idx + frameOffset;
    if (!expectedTotalFrames) {
      return `frame=${String(absFrame).padStart(5)} fps=${renderFps.toFixed(1)}`;
    }
    const progress = (idx / expectedTotalFrames * 100).toFixed(1);
    const barLen = 30;
    const filled = Math.round(idx / expectedTotalFrames * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    const eta = (expectedTotalFrames - idx) / renderFps;
    const etaMin = Math.floor(eta / 60);
    const etaSec = Math.floor(eta % 60);
    return `frame=${String(absFrame).padStart(5)}/${String(expectedTotalFrames + frameOffset).padStart(5)} fps=${renderFps.toFixed(1)} ${bar} ${progress}% ETA ${etaMin}m${etaSec.toString().padStart(2,'0')}s`;
  }

  await page.exposeFunction('saveFrame', (idx, base64Data) => {
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = path.join(FRAMES_DIR, `frame_${String(idx).padStart(5, '0')}.png`);
    fs.writeFileSync(filename, buffer);
    process.stdout.write('\r' + formatProgress(idx));
  });

  await page.exposeFunction('onRenderComplete', (frameCount) => {
    totalFrames = frameCount;
    renderDone = true;
    process.stdout.write('\n');
  });

  await page.exposeFunction('setFrameOffset', (offset) => {
    frameOffset = offset;
  });

  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  let renderUrl;
  if (FRAME_START >= 0 && FRAME_END >= 0) {
    const timeStart = FRAME_START / FPS;
    const timeDuration = (FRAME_END - FRAME_START + 1) / FPS;
    renderUrl = `http://localhost:${PORT}/render.html?start=${timeStart}&duration=${timeDuration}&frameOffset=${FRAME_START}`;
  } else {
    renderUrl = `http://localhost:${PORT}/render.html?start=${SEGMENT_START}&duration=${SEGMENT_DURATION}`;
  }
  console.log(`Rendering: ${renderUrl}`);
  await page.goto(renderUrl, {
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
