#!/usr/bin/env node
/**
 * dula-inspect-team — 闭环质检团队 CLI
 *
 * Usage:
 *   dula-inspect-team <episode-dir> [--format=console|html] [--output=report.html] [--visual]
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Delegate to the main implementation
const mainPath = path.resolve(__dirname, '..', 'tools', 'inspect-team', 'index.js');
await import('file://' + mainPath.replace(/\\/g, '/'));
