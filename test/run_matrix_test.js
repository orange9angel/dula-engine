import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const PORT = 8769;

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  if (reqPath.startsWith('/node_modules/')) {
    const relPath = reqPath.slice('/node_modules/'.length);
    let filePath = path.join(ROOT, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'node_modules', relPath);
    }
    serveFile(filePath, res, reqPath);
    return;
  }

  const filePath = path.join(ROOT, reqPath === '/' ? 'test/matrix_test.html' : reqPath);
  serveFile(filePath, res, reqPath);
});

function serveFile(filePath, res, reqPath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log('404:', reqPath || filePath);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1920, height: 1080 });

  page.on('console', (msg) => console.log('PAGE:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  await page.goto(`http://localhost:${PORT}/test/matrix_test.html`, {
    waitUntil: 'networkidle2',
  });

  // Wait for module script to load and init
  await new Promise((r) => setTimeout(r, 2000));

  // Let animation run for a bit
  await new Promise((r) => setTimeout(r, 1500));

  // Capture screenshots at key moments
  const shots = [
    { time: 0.1, label: 'punch_windup' },
    { time: 0.35, label: 'punch_impact' },
    { time: 0.8, label: 'punch_recovery' },
  ];

  const outputDir = path.join(ROOT, 'test', 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  for (const shot of shots) {
    // Seek to specific time by reloading page with offset
    // Actually, let's just take screenshots during the running animation
    const dataUrl = await page.evaluate(() => window.getScreenshot());
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const filename = path.join(outputDir, `matrix_test_${shot.label}.jpg`);
    fs.writeFileSync(filename, buffer);
    console.log(`Screenshot: ${filename} (${buffer.length} bytes)`);

    // Wait between shots
    await new Promise((r) => setTimeout(r, 500));
  }

  // Also capture the info overlay
  const finalDataUrl = await page.evaluate(() => window.getScreenshot());
  const finalBase64 = finalDataUrl.split(',')[1];
  const finalBuffer = Buffer.from(finalBase64, 'base64');
  const finalFilename = path.join(outputDir, 'matrix_test_final.jpg');
  fs.writeFileSync(finalFilename, finalBuffer);
  console.log(`Final screenshot: ${finalFilename}`);

  await browser.close();
  server.close();

  console.log('\n=== Matrix Animation Browser Test Complete ===');
  console.log('Check test/output/ for screenshots');
});
