import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const EPISODE = args.find((arg) => !arg.startsWith('--')) || '.';
const EPISODE_DIR = path.isAbsolute(EPISODE) ? EPISODE : path.resolve(process.cwd(), EPISODE);
const OUT_DIR = path.join(EPISODE_DIR, 'storyboard', 'pose_trace');

const options = {
  fps: numberArg('--fps', 60),
  startTime: numberArg('--start', 0),
  endTime: numberArg('--end', null),
};

console.log(`Episode dir: ${EPISODE_DIR}`);
console.log(`Pose trace fps: ${options.fps}`);

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  if (reqPath.startsWith('/episode/')) {
    const relPath = reqPath.slice('/episode/'.length);
    serveFile(path.join(EPISODE_DIR, relPath), res, reqPath);
    return;
  }

  if (reqPath.startsWith('/node_modules/')) {
    const relPath = reqPath.slice('/node_modules/'.length);
    let filePath = path.join(EPISODE_DIR, 'node_modules', relPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'node_modules', relPath);
    }
    if (!fs.existsSync(filePath)) {
      const firstSeg = relPath.split('/')[0];
      if (firstSeg === 'dula-engine' || firstSeg === 'dula-assets') {
        filePath = path.join(ROOT, '..', relPath);
      }
    }
    serveFile(filePath, res, reqPath);
    return;
  }

  serveFile(path.join(ROOT, reqPath === '/' ? 'tools/pose_trace.html' : reqPath), res, reqPath);
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`Server listening on http://localhost:${port}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  try {
    await page.goto(`http://localhost:${port}/tools/pose_trace.html`, {
      waitUntil: 'networkidle2',
    });

    await page.evaluate(async () => {
      await window.loadStoryboard();
    });

    const trace = await page.evaluate(async (traceOptions) => {
      return await window.collectPoseTrace(traceOptions);
    }, options);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Raw JSON
    const jsonPath = path.join(OUT_DIR, 'pose_trace.json');
    fs.writeFileSync(jsonPath, JSON.stringify(trace, null, 2), 'utf-8');

    // CSV: per-joint per-frame
    const csvPath = path.join(OUT_DIR, 'pose_trace.csv');
    fs.writeFileSync(csvPath, toCsv(trace), 'utf-8');

    // CSV: pose offset values (what the animation actually outputs)
    const offsetCsvPath = path.join(OUT_DIR, 'pose_offsets.csv');
    fs.writeFileSync(offsetCsvPath, toOffsetCsv(trace), 'utf-8');

    // SVG: joint trajectory visualization
    const svgPath = path.join(OUT_DIR, 'pose_trace.svg');
    fs.writeFileSync(svgPath, toSvg(trace), 'utf-8');

    // Markdown summary
    const mdPath = path.join(OUT_DIR, 'pose_trace_summary.md');
    fs.writeFileSync(mdPath, toMarkdown(trace), 'utf-8');

    // Animation-specific analysis
    const analysisPath = path.join(OUT_DIR, 'pose_analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analyzePoses(trace), null, 2), 'utf-8');

    console.log(`Pose Trace JSON: ${jsonPath}`);
    console.log(`Joint CSV:       ${csvPath}`);
    console.log(`Offset CSV:      ${offsetCsvPath}`);
    console.log(`SVG:             ${svgPath}`);
    console.log(`Summary:         ${mdPath}`);
    console.log(`Analysis:        ${analysisPath}`);
  } finally {
    await browser.close();
    server.close();
  }
});

function numberArg(name, fallback) {
  const item = args.find((arg) => arg === name || arg.startsWith(`${name}=`));
  if (!item) return fallback;
  if (item === name) {
    const idx = args.indexOf(item);
    const value = args[idx + 1];
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(item.slice(name.length + 1));
  return Number.isFinite(n) ? n : fallback;
}

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
    '.svg': 'image/svg+xml',
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

// ─── CSV Export ───────────────────────────────────────────────────────────────

function toCsv(trace) {
  const joints = [
    'headGroup', 'rightShoulder', 'rightElbow', 'rightWrist',
    'leftShoulder', 'leftElbow', 'leftWrist',
    'rightHip', 'rightKnee', 'rightAnkle',
    'leftHip', 'leftKnee', 'leftAnkle',
    'mesh',
  ];
  const axes = ['rx', 'ry', 'rz'];
  const meshAxes = ['x', 'y', 'z', 'rx', 'ry', 'rz'];

  const headers = ['time', 'scene', 'character', 'activeBody', 'activeFace'];
  for (const joint of joints) {
    const keys = joint === 'mesh' ? meshAxes : axes;
    for (const key of keys) {
      headers.push(`${joint}_${key}`);
    }
  }

  const rows = [headers.join(',')];
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      const cells = [
        fixed(sample.time),
        q(sample.scene || ''),
        q(ch.name),
        q((ch.activeBody || []).join('|')),
        q((ch.activeFace || []).join('|')),
      ];
      for (const joint of joints) {
        const jdata = ch.joints?.[joint];
        const keys = joint === 'mesh' ? meshAxes : axes;
        for (const key of keys) {
          cells.push(fixed(jdata?.[key]));
        }
      }
      rows.push(cells.join(','));
    }
  }
  return rows.join('\n') + '\n';
}

function toOffsetCsv(trace) {
  const joints = [
    'headGroup', 'rightShoulder', 'rightElbow', 'rightWrist',
    'leftShoulder', 'leftElbow', 'leftWrist',
    'rightHip', 'rightKnee', 'rightAnkle',
    'leftHip', 'leftKnee', 'leftAnkle',
    'mesh',
  ];
  const axes = ['rx', 'ry', 'rz'];
  const meshAxes = ['x', 'y', 'z', 'rx', 'ry', 'rz'];

  const headers = ['time', 'scene', 'character', 'activeBody'];
  for (const joint of joints) {
    const keys = joint === 'mesh' ? meshAxes : axes;
    for (const key of keys) {
      headers.push(`${joint}_${key}`);
    }
  }

  const rows = [headers.join(',')];
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      const cells = [
        fixed(sample.time),
        q(sample.scene || ''),
        q(ch.name),
        q((ch.activeBody || []).join('|')),
      ];
      for (const joint of joints) {
        const jdata = ch.poseOffset?.[joint];
        const keys = joint === 'mesh' ? meshAxes : axes;
        for (const key of keys) {
          cells.push(fixed(jdata?.[key]));
        }
      }
      rows.push(cells.join(','));
    }
  }
  return rows.join('\n') + '\n';
}

// ─── SVG Visualization ────────────────────────────────────────────────────────

function toSvg(trace) {
  // Create a multi-panel SVG showing key joint trajectories over time
  const width = 1400;
  const panelHeight = 200;
  const margin = { top: 30, right: 40, bottom: 40, left: 80 };

  // Determine which characters to show
  const allChars = new Set();
  for (const s of trace.samples) {
    for (const ch of s.characters) allChars.add(ch.name);
  }
  const charList = Array.from(allChars);

  // Panels: mesh Y, rightShoulder rx, leftShoulder rx, rightElbow rx, leftElbow rx
  const panels = [
    { title: 'Mesh Y (jump height)', joint: 'mesh', key: 'y', min: -1, max: 4 },
    { title: 'Right Shoulder rx (uppercut arm)', joint: 'rightShoulder', key: 'rx', min: -4, max: 2 },
    { title: 'Left Shoulder rx (guard arm)', joint: 'leftShoulder', key: 'rx', min: -4, max: 2 },
    { title: 'Right Elbow rx', joint: 'rightElbow', key: 'rx', min: -4, max: 4 },
    { title: 'Left Elbow rx', joint: 'leftElbow', key: 'rx', min: -4, max: 4 },
  ];

  const totalHeight = margin.top + panels.length * (panelHeight + 20) + margin.bottom;
  const chartWidth = width - margin.left - margin.right;

  const tMin = trace.startTime;
  const tMax = trace.endTime;
  const tx = (t) => margin.left + ((t - tMin) / (tMax - tMin)) * chartWidth;

  const palette = ['#00a6d6', '#f26b38', '#65a765', '#aa58b6', '#d6a800'];

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}">`,
    '<rect width="100%" height="100%" fill="#111"/>',
    `<text x="${margin.left}" y="22" fill="#eee" font-family="monospace" font-size="16">Pose Trace ${fixed(tMin)}s-${fixed(tMax)}s @ ${trace.fps}fps | ${charList.join(', ')}</text>`,
  ];

  // Draw entry time markers
  const entryColors = ['#333', '#444'];
  for (let i = 0; i < trace.entries.length; i++) {
    const entry = trace.entries[i];
    const x1 = tx(entry.startTime);
    const x2 = tx(entry.endTime);
    lines.push(`<rect x="${x1}" y="0" width="${x2 - x1}" height="${totalHeight}" fill="${entryColors[i % 2]}" opacity="0.15"/>`);
    lines.push(`<line x1="${x1}" y1="0" x2="${x1}" y2="${totalHeight}" stroke="#555" stroke-width="0.5" stroke-dasharray="2 2"/>`);
    if (entry.character) {
      lines.push(`<text x="${x1 + 4}" y="${totalHeight - 8}" fill="#666" font-family="monospace" font-size="9">#${entry.index} ${entry.character}</text>`);
    }
  }

  let yOffset = margin.top;
  for (const panel of panels) {
    const py = (v) => {
      const norm = (v - panel.min) / (panel.max - panel.min);
      return yOffset + panelHeight - norm * panelHeight;
    };

    // Panel background
    lines.push(`<rect x="${margin.left}" y="${yOffset}" width="${chartWidth}" height="${panelHeight}" fill="#1a1a1a" stroke="#333" stroke-width="1"/>`);

    // Grid lines
    for (let g = panel.min; g <= panel.max; g += 1) {
      const gy = py(g);
      lines.push(`<line x1="${margin.left}" y1="${gy}" x2="${width - margin.right}" y2="${gy}" stroke="#333" stroke-width="0.5"/>`);
      lines.push(`<text x="${margin.left - 8}" y="${gy + 4}" fill="#888" font-family="monospace" font-size="10" text-anchor="end">${g}</text>`);
    }

    // Zero line
    if (panel.min < 0 && panel.max > 0) {
      const zy = py(0);
      lines.push(`<line x1="${margin.left}" y1="${zy}" x2="${width - margin.right}" y2="${zy}" stroke="#666" stroke-width="1"/>`);
    }

    // Panel title
    lines.push(`<text x="${margin.left + 4}" y="${yOffset + 16}" fill="#ccc" font-family="monospace" font-size="12" font-weight="bold">${panel.title}</text>`);

    // Trajectories per character
    for (let ci = 0; ci < charList.length; ci++) {
      const charName = charList[ci];
      const color = palette[ci % palette.length];
      const points = [];
      for (const sample of trace.samples) {
        const ch = sample.characters.find((c) => c.name === charName);
        if (!ch) continue;
        const jdata = ch.joints?.[panel.joint];
        if (!jdata) continue;
        const v = jdata[panel.key];
        if (!Number.isFinite(v)) continue;
        points.push(`${tx(sample.time).toFixed(1)},${py(v).toFixed(1)}`);
      }
      if (points.length > 1) {
        lines.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`);
      }
    }

    yOffset += panelHeight + 20;
  }

  // Legend
  let lx = width - margin.right - 120;
  for (let ci = 0; ci < charList.length; ci++) {
    const color = palette[ci % palette.length];
    lines.push(`<rect x="${lx}" y="10" width="12" height="3" fill="${color}"/>`);
    lines.push(`<text x="${lx + 16}" y="16" fill="${color}" font-family="monospace" font-size="11">${charList[ci]}</text>`);
    lx += 80;
  }

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

// ─── Markdown Summary ─────────────────────────────────────────────────────────

function toMarkdown(trace) {
  const lines = [
    '# Pose Trace Summary',
    '',
    `- FPS: ${trace.fps}`,
    `- Window: ${fixed(trace.startTime)}s -> ${fixed(trace.endTime)}s`,
    `- Samples: ${trace.samples.length}`,
    `- Entries: ${trace.entries.length}`,
    '',
    '## Entries',
    '',
    '| # | Time | Character | Animations |',
    '|---:|---:|---|---|',
  ];
  for (const entry of trace.entries) {
    const anims = (entry.animations || []).map((a) => a.instance?.name || a).join(', ');
    lines.push(`| ${entry.index} | ${fixed(entry.startTime)}-${fixed(entry.endTime)} | ${entry.character || '-'} | ${anims} |`);
  }

  // Per-character joint range summary
  lines.push('', '## Joint Value Ranges', '');
  const allChars = new Set();
  for (const s of trace.samples) {
    for (const ch of s.characters) allChars.add(ch.name);
  }

  for (const charName of allChars) {
    lines.push(`### ${charName}`, '');
    const ranges = computeJointRanges(trace, charName);
    lines.push('| Joint | Axis | Min | Max | Range |');
    lines.push('|---|---|---|---:|---:|');
    for (const [key, r] of Object.entries(ranges).sort()) {
      lines.push(`| ${r.joint} | ${r.axis} | ${fixed(r.min)} | ${fixed(r.max)} | ${fixed(r.max - r.min)} |`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

function computeJointRanges(trace, charName) {
  const ranges = {};
  const joints = [
    'headGroup', 'rightShoulder', 'rightElbow', 'rightWrist',
    'leftShoulder', 'leftElbow', 'leftWrist',
    'rightHip', 'rightKnee', 'rightAnkle',
    'leftHip', 'leftKnee', 'leftAnkle',
    'mesh',
  ];

  for (const sample of trace.samples) {
    const ch = sample.characters.find((c) => c.name === charName);
    if (!ch || !ch.joints) continue;
    for (const joint of joints) {
      const jdata = ch.joints[joint];
      if (!jdata) continue;
      for (const [axis, val] of Object.entries(jdata)) {
        if (!Number.isFinite(val)) continue;
        const key = `${joint}_${axis}`;
        if (!ranges[key]) {
          ranges[key] = { joint, axis, min: val, max: val };
        } else {
          ranges[key].min = Math.min(ranges[key].min, val);
          ranges[key].max = Math.max(ranges[key].max, val);
        }
      }
    }
  }
  return ranges;
}

// ─── Pose Analysis ────────────────────────────────────────────────────────────

function analyzePoses(trace) {
  const analysis = {
    animations: {},
    issues: [],
  };

  // Group samples by active body animation
  const animSamples = new Map(); // animName -> [{ time, character, joints, poseOffset }]

  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      for (const animName of ch.activeBody || []) {
        if (!animSamples.has(animName)) animSamples.set(animName, []);
        animSamples.get(animName).push({
          time: sample.time,
          character: ch.name,
          joints: ch.joints,
          poseOffset: ch.poseOffset,
          baseline: ch.baseline,
        });
      }
    }
  }

  for (const [animName, samples] of animSamples) {
    const animAnalysis = {
      name: animName,
      sampleCount: samples.length,
      characters: [...new Set(samples.map((s) => s.character))],
      jointRanges: {},
      poseOffsetRanges: {},
      baselineSnapshot: null,
    };

    // Compute joint value ranges
    const joints = [
      'headGroup', 'rightShoulder', 'rightElbow', 'rightWrist',
      'leftShoulder', 'leftElbow', 'leftWrist',
      'rightHip', 'rightKnee', 'rightAnkle',
      'leftHip', 'leftKnee', 'leftAnkle', 'mesh',
    ];

    for (const joint of joints) {
      for (const sample of samples) {
        const jdata = sample.joints?.[joint];
        if (!jdata) continue;
        for (const [axis, val] of Object.entries(jdata)) {
          if (!Number.isFinite(val)) continue;
          const key = `${joint}_${axis}`;
          if (!animAnalysis.jointRanges[key]) {
            animAnalysis.jointRanges[key] = { joint, axis, min: val, max: val, values: [] };
          }
          animAnalysis.jointRanges[key].min = Math.min(animAnalysis.jointRanges[key].min, val);
          animAnalysis.jointRanges[key].max = Math.max(animAnalysis.jointRanges[key].max, val);
          animAnalysis.jointRanges[key].values.push(val);
        }
      }
    }

    // Compute pose offset ranges (animation's intended values)
    for (const joint of joints) {
      for (const sample of samples) {
        const odata = sample.poseOffset?.[joint];
        if (!odata) continue;
        for (const [axis, val] of Object.entries(odata)) {
          if (!Number.isFinite(val)) continue;
          const key = `${joint}_${axis}`;
          if (!animAnalysis.poseOffsetRanges[key]) {
            animAnalysis.poseOffsetRanges[key] = { joint, axis, min: val, max: val };
          }
          animAnalysis.poseOffsetRanges[key].min = Math.min(animAnalysis.poseOffsetRanges[key].min, val);
          animAnalysis.poseOffsetRanges[key].max = Math.max(animAnalysis.poseOffsetRanges[key].max, val);
        }
      }
    }

    // Capture baseline from first sample that has it
    for (const sample of samples) {
      if (sample.baseline) {
        animAnalysis.baselineSnapshot = sample.baseline;
        break;
      }
    }

    analysis.animations[animName] = animAnalysis;
  }

  // Detect common issues
  detectPoseIssues(trace, analysis);

  return analysis;
}

function detectPoseIssues(trace, analysis) {
  // Issue 1: Animation with no visible joint movement
  for (const [animName, anim] of Object.entries(analysis.animations)) {
    let hasMovement = false;
    for (const [key, range] of Object.entries(anim.jointRanges)) {
      if (range.max - range.min > 0.01) {
        hasMovement = true;
        break;
      }
    }
    if (!hasMovement) {
      analysis.issues.push({
        type: 'no_visible_movement',
        severity: 'warning',
        animation: animName,
        message: `${animName} has no visible joint movement across ${anim.sampleCount} samples. Animation may be broken or too subtle.`,
        fix: 'Check animation pose values — they may all be near zero or the animation may not be applying.',
      });
    }
  }

  // Issue 2: Mesh Y goes below floor
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      const meshY = ch.joints?.mesh?.y;
      if (Number.isFinite(meshY) && meshY < 0) {
        // Only flag if it's not a crouch animation
        const isCrouch = (ch.activeBody || []).some((a) => a.includes('Crouch') || a.includes('crouch'));
        if (!isCrouch) {
          analysis.issues.push({
            type: 'below_floor',
            severity: 'warning',
            time: sample.time,
            character: ch.name,
            message: `${ch.name} mesh Y=${fixed(meshY)} below floor at t=${fixed(sample.time)}s`,
            fix: 'Check mesh.y offset or floor clamp in ActionMatrixController._applyPose()',
          });
        }
      }
    }
  }

  // Issue 3: Extreme joint angles (potential gimbal lock or wrong values)
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      for (const [jointName, jdata] of Object.entries(ch.joints || {})) {
        if (!jdata) continue;
        for (const [axis, val] of Object.entries(jdata)) {
          if (axis.startsWith('r') && Math.abs(val) > Math.PI * 1.5) {
            analysis.issues.push({
              type: 'extreme_angle',
              severity: 'info',
              time: sample.time,
              character: ch.name,
              joint: jointName,
              axis,
              value: val,
              message: `${ch.name} ${jointName}.${axis}=${fixed(val)} rad (${fixed(val * 180 / Math.PI)}°) at t=${fixed(sample.time)}s — extreme angle may indicate wrong additive offset`,
              fix: 'Check if additive offset accounts for baseline rotation correctly',
            });
          }
        }
      }
    }
  }

  // Issue 4: T-pose detection (all arm angles near zero)
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      const rs = ch.joints?.rightShoulder;
      const ls = ch.joints?.leftShoulder;
      const re = ch.joints?.rightElbow;
      const le = ch.joints?.leftElbow;
      if (rs && ls && re && le) {
        const armSum = Math.abs(rs.rx) + Math.abs(ls.rx) + Math.abs(re.rx) + Math.abs(le.rx);
        if (armSum < 0.1 && (ch.activeBody || []).length > 0) {
          analysis.issues.push({
            type: 't_pose_during_animation',
            severity: 'warning',
            time: sample.time,
            character: ch.name,
            message: `${ch.name} in near T-pose (arm sum=${fixed(armSum)}) while active animations: ${(ch.activeBody || []).join(', ')} at t=${fixed(sample.time)}s`,
            fix: 'Animation may not be applying to this character, or pose values are all near zero',
          });
        }
      }
    }
  }

  // Issue 5: Pose offset vs actual joint mismatch (indicates system bug)
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      if (!ch.poseOffset || !ch.baseline) continue;
      for (const joint of ['rightShoulder', 'leftShoulder', 'rightElbow', 'leftElbow']) {
        const actual = ch.joints?.[joint]?.rx;
        const offset = ch.poseOffset?.[joint]?.rx ?? 0;
        const base = ch.baseline?.[joint]?.rx ?? 0;
        const expected = base + offset;
        if (Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) > 0.01) {
          analysis.issues.push({
            type: 'pose_mismatch',
            severity: 'error',
            time: sample.time,
            character: ch.name,
            joint,
            actual: fixed(actual),
            expected: fixed(expected),
            baseline: fixed(base),
            offset: fixed(offset),
            message: `${ch.name} ${joint}.rx mismatch: actual=${fixed(actual)} expected=${fixed(expected)} (base=${fixed(base)} + offset=${fixed(offset)}) at t=${fixed(sample.time)}s`,
            fix: 'ActionMatrixController._applyPose() may not be applying offset correctly',
          });
        }
      }
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fixed(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toFixed(3);
}

function q(s) {
  if (s === null || s === undefined) return '';
  return `"${String(s).replace(/"/g, '""')}"`;
}
