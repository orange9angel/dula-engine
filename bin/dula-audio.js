#!/usr/bin/env node
/**
 * Dula Audio CLI
 * Usage: dula-audio <episode-dir> [--provider=edge|elevenlabs|dashscope]
 *
 * Spawns the Python audio pipeline.
 * Providers:
 *   edge        - edge-tts (free, default)
 *   elevenlabs  - ElevenLabs TTS (free tier: 10k chars/month)
 *   dashscope   - Alibaba DashScope CosyVoice
 *
 * When installed via npm, this allows story projects to run:
 *   npx dula-audio .
 *   npx dula-audio . --provider=elevenlabs
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse arguments
let EPISODE = '.';
let provider = 'edge';

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--provider=')) {
    provider = arg.slice('--provider='.length);
  } else if (!arg.startsWith('--')) {
    EPISODE = arg;
  }
}

// Map provider to Python script
const providerScripts = {
  edge: 'generate_audio.py',
  elevenlabs: 'generate_audio_elevenlabs.py',
  dashscope: 'generate_audio_dashscope.py',
};

const scriptName = providerScripts[provider];
if (!scriptName) {
  console.error(`[dula-audio] Unknown provider: ${provider}`);
  console.error(`[dula-audio] Available: edge, elevenlabs, dashscope`);
  process.exit(1);
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

const proc = spawn(pythonCmd, [pyPath, EPISODE], { stdio: 'inherit' });

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
