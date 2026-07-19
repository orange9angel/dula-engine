#!/usr/bin/env node
/**
 * Dula Audio CLI
 * Usage: dula-audio <episode-dir> [--provider=edge|elevenlabs|dashscope|f5-tts]
 *
 * Spawns the Python audio pipeline.
 * Providers:
 *   edge        - edge-tts (free, default)
 *   elevenlabs  - ElevenLabs TTS (free tier: 10k chars/month)
 *   dashscope   - Alibaba DashScope CosyVoice
 *   f5-tts      - edge-tts + sox personality effects + F5-TTS voice cloning
 *
 * When installed via npm, this allows story projects to run:
 *   npx dula-audio .
 *   npx dula-audio . --provider=elevenlabs
 *   npx dula-audio . --provider=f5-tts --device cpu
 *   npx dula-audio . --provider=f5-tts --force
 */
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse arguments
let EPISODE = '.';
let provider = 'edge';
let force = false;
const extraArgs = [];

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--provider=')) {
    provider = arg.slice('--provider='.length);
  } else if (arg === '--provider') {
    provider = process.argv[++i];
  } else if (
    arg === '--device' ||
    arg === '--ref-strategy' ||
    arg === '--ref-duration' ||
    arg === '--character' ||
    arg === '-c'
  ) {
    extraArgs.push(arg, process.argv[++i]);
  } else if (arg === '--force') {
    force = true;
  } else if (
    arg === '--use-sox' ||
    arg === '--no-sox'
  ) {
    extraArgs.push(arg);
  } else if (!arg.startsWith('--')) {
    EPISODE = arg;
  }
}

// Map provider to Python script
const providerScripts = {
  edge: 'generate_audio.py',
  elevenlabs: 'generate_audio_elevenlabs.py',
  dashscope: 'generate_audio_dashscope.py',
  'f5-tts': 'generate_audio_f5tts.py',
};

const scriptName = providerScripts[provider];
if (!scriptName) {
  console.error(`[dula-audio] Unknown provider: ${provider}`);
  console.error(`[dula-audio] Available: edge, elevenlabs, dashscope, f5-tts`);
  process.exit(1);
}
if (force) {
  if (provider === 'edge' || provider === 'f5-tts') {
    extraArgs.push('--force');
  } else {
    console.warn(`[dula-audio] --force is not supported by provider '${provider}', ignoring it.`);
  }
}

const pyPath = path.resolve(__dirname, '..', 'tools', scriptName);

// Determine python command (Windows usually has 'python', *nix often 'python3')
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

console.log(`[dula-audio] Episode: ${path.resolve(EPISODE)}`);
console.log(`[dula-audio] Provider: ${provider}`);
console.log(`[dula-audio] Python script: ${pyPath}`);

if (provider === 'elevenlabs') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.log('[dula-audio] ELEVENLABS_API_KEY not set. Will fallback to edge-tts.');
    console.log('[dula-audio] To use ElevenLabs, get a free key from https://elevenlabs.io/');
  }
}

// Export Combat:Action SFX events so the Python mixer can include them.
const exportPath = path.resolve(__dirname, '..', 'tools', 'export_combat_sfx.js');
console.log('[dula-audio] Exporting combat SFX events...');
const exportResult = spawnSync('node', [exportPath, EPISODE], { stdio: 'inherit' });
if (exportResult.error) {
  console.error('[dula-audio] Failed to export combat SFX:', exportResult.error.message);
  process.exit(1);
}
if (exportResult.status !== 0) {
  console.error(`[dula-audio] Combat SFX export exited with code ${exportResult.status}`);
  process.exit(exportResult.status ?? 1);
}

const proc = spawn(pythonCmd, [pyPath, EPISODE, ...extraArgs], { stdio: 'inherit' });

proc.on('error', (err) => {
  console.error(`[dula-audio] Failed to spawn ${pythonCmd}:`, err.message);
  if (err.code === 'ENOENT') {
    console.error(`[dula-audio] Please ensure Python and required packages are installed.`);
  }
  process.exit(1);
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
