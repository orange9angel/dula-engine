#!/usr/bin/env node
/**
 * Dula Pose Trace CLI
 * Usage: dula-pose-trace <episode-dir> [--fps=60] [--start=0] [--end=30]
 *
 * Collects 13-joint pose trajectory data and generates:
 *   - pose_trace.json    : raw joint rotation/position per frame
 *   - pose_trace.csv     : joint values CSV
 *   - pose_offsets.csv   : PoseMatrix offset values CSV
 *   - pose_trace.svg     : trajectory visualization
 *   - pose_trace_summary.md : markdown report
 *   - pose_analysis.json : automated pose issue detection
 */
import '../tools/pose_trace.js';
