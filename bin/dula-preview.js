#!/usr/bin/env node
/**
 * Dula Preview CLI
 * Usage: dula-preview <episode-dir> [options]
 *
 * Generates a storyboard collage preview from check_shot_*.jpg files.
 * Must run 'dula-verify' first to generate the per-shot screenshots.
 *
 * Options are forwarded to generate_preview.py:
 *   --cols N          Number of columns in the grid
 *   --thumb-width W   Thumbnail width in pixels
 *   --gap G           Gap between thumbnails
 *   --bg R G B        Background color
 *   --quality Q       JPEG quality
 *   --output NAME     Output filename
 *
 * Example:
 *   dula-preview ./episodes/she_ra --cols 4 --thumb-width 400
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error('Usage: dula-preview <episode-dir> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --cols N          Number of columns');
  console.error('  --thumb-width W   Thumbnail width (default: 480)');
  console.error('  --gap G           Gap between thumbnails (default: 4)');
  console.error('  --bg R G B        Background color (default: 32 32 32)');
  console.error('  --quality Q       JPEG quality 0-100 (default: 92)');
  console.error('  --output NAME     Output filename (default: preview.jpg)');
  process.exit(1);
}

const extraArgs = process.argv.slice(3);

const scriptPath = path.resolve(__dirname, '..', 'tools', 'generate_preview.py');
const proc = spawn('python', [scriptPath, episodeDir, ...extraArgs], {
  stdio: 'inherit',
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
