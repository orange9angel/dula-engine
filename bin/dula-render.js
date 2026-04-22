#!/usr/bin/env node
/**
 * Dula Render CLI
 * Usage: dula-render <episode-dir> [--start N] [--duration N]
 *
 * Thin wrapper around generate_video.js.
 * When installed via npm, this allows story projects to run:
 *   npx dula-render .
 *   npx dula-render . --start 0 --duration 30
 */
import '../generate_video.js';
