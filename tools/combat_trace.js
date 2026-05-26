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
const OUT_DIR = path.join(EPISODE_DIR, 'storyboard', 'combat_trace');

const options = {
  fps: numberArg('--fps', 60),
  startTime: numberArg('--start', 0),
  endTime: numberArg('--end', null),
};

console.log(`Episode dir: ${EPISODE_DIR}`);
console.log(`Trace fps: ${options.fps}`);

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
      // Fallback: resolve dula-engine and dula-assets from project root
      const firstSeg = relPath.split('/')[0];
      if (firstSeg === 'dula-engine' || firstSeg === 'dula-assets') {
        filePath = path.join(ROOT, '..', relPath);
      }
    }
    serveFile(filePath, res, reqPath);
    return;
  }

  serveFile(path.join(ROOT, reqPath === '/' ? 'tools/combat_trace.html' : reqPath), res, reqPath);
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
    await page.goto(`http://localhost:${port}/tools/combat_trace.html`, {
      waitUntil: 'networkidle2',
    });

    await page.evaluate(async () => {
      await window.loadStoryboard();
    });

    const trace = await page.evaluate(async (traceOptions) => {
      return await window.collectCombatTrace(traceOptions);
    }, options);
    const analysis = analyzeContinuity(trace);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonPath = path.join(OUT_DIR, 'story_trace.json');
    const csvPath = path.join(OUT_DIR, 'story_trace.csv');
    const hitCsvPath = path.join(OUT_DIR, 'combat_hits.csv');
    const effectCsvPath = path.join(OUT_DIR, 'combat_effects.csv');
    const continuityJsonPath = path.join(OUT_DIR, 'story_continuity.json');
    const continuityCsvPath = path.join(OUT_DIR, 'story_continuity.csv');
    const svgPath = path.join(OUT_DIR, 'story_trace.svg');
    const mdPath = path.join(OUT_DIR, 'story_trace_summary.md');
    // Keep backward-compatible combat_trace outputs
    const combatJsonPath = path.join(OUT_DIR, 'combat_trace.json');
    const combatCsvPath = path.join(OUT_DIR, 'combat_trace.csv');
    const combatContinuityJsonPath = path.join(OUT_DIR, 'combat_continuity.json');
    const combatContinuityCsvPath = path.join(OUT_DIR, 'combat_continuity.csv');
    const combatSvgPath = path.join(OUT_DIR, 'combat_trace.svg');
    const combatMdPath = path.join(OUT_DIR, 'combat_trace_summary.md');

    fs.writeFileSync(jsonPath, JSON.stringify(trace, null, 2), 'utf-8');
    fs.writeFileSync(csvPath, toCsv(trace), 'utf-8');
    fs.writeFileSync(hitCsvPath, hitsToCsv(trace), 'utf-8');
    fs.writeFileSync(effectCsvPath, effectsToCsv(trace), 'utf-8');
    fs.writeFileSync(continuityJsonPath, JSON.stringify(analysis, null, 2), 'utf-8');
    fs.writeFileSync(continuityCsvPath, continuityToCsv(analysis), 'utf-8');
    fs.writeFileSync(svgPath, toSvg(trace, analysis), 'utf-8');
    fs.writeFileSync(mdPath, toMarkdown(trace, analysis), 'utf-8');
    // Backward-compatible combat_trace outputs
    fs.writeFileSync(combatJsonPath, JSON.stringify(trace, null, 2), 'utf-8');
    fs.writeFileSync(combatCsvPath, toCsv(trace), 'utf-8');
    fs.writeFileSync(combatContinuityJsonPath, JSON.stringify(analysis, null, 2), 'utf-8');
    fs.writeFileSync(combatContinuityCsvPath, continuityToCsv(analysis), 'utf-8');
    fs.writeFileSync(combatSvgPath, toSvg(trace, analysis), 'utf-8');
    fs.writeFileSync(combatMdPath, toMarkdown(trace, analysis), 'utf-8');

    console.log(`Trace JSON: ${jsonPath}`);
    console.log(`Frame CSV:  ${csvPath}`);
    console.log(`Hit CSV:    ${hitCsvPath}`);
    console.log(`Effect CSV: ${effectCsvPath}`);
    console.log(`Continuity: ${continuityJsonPath}`);
    console.log(`Continuity CSV: ${continuityCsvPath}`);
    console.log(`SVG map:    ${svgPath}`);
    console.log(`Summary:    ${mdPath}`);
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

function toCsv(trace) {
  const rows = [
    'time,scene,character,x,y,z,yaw,headX,headY,headZ,headYaw,headLocalYaw,headLocalPitch,headLocalRoll,faceDirX,faceDirY,faceDirZ,facingDir,inCombat,isSpeaking,isListener,dialogueActive,activeBody,activeFace,activeFx',
  ];
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      rows.push([
        fixed(sample.time),
        q(sample.scene || ''),
        q(ch.name),
        fixed(ch.x),
        fixed(ch.y),
        fixed(ch.z),
        fixed(ch.yaw),
        fixed(ch.headX),
        fixed(ch.headY),
        fixed(ch.headZ),
        fixed(ch.headYaw),
        fixed(ch.headLocalYaw),
        fixed(ch.headLocalPitch),
        fixed(ch.headLocalRoll),
        fixed(ch.faceDirX),
        fixed(ch.faceDirY),
        fixed(ch.faceDirZ),
        ch.facingDir ?? '',
        ch.inCombat ? 1 : 0,
        ch.isSpeaking ? 1 : 0,
        ch.isListener ? 1 : 0,
        sample.dialogueActive ? 1 : 0,
        q((ch.activeBody || []).join('|')),
        q((ch.activeFace || []).join('|')),
        q((ch.activeFx || []).join('|')),
      ].join(','));
    }
  }
  return rows.join('\n') + '\n';
}

function hitsToCsv(trace) {
  const rows = [
    'index,time,triggerTime,attacker,defender,anim,type,range,preContactDistance,preContactGap,contactDistance,contactGap,correctedAtHit,triggered,hitPointX,hitPointY,hitPointZ,hitVolumeSource,hitVolumeLength,hitVolumeRadius,projectileDistance,projectileEndTime',
  ];
  for (const ev of trace.finalHitEvents || []) {
    const hp = ev.hitPoint || [];
    const hv = ev.hitVolume || {};
    const pp = ev.projectilePath || {};
    rows.push([
      ev.index,
      fixed(ev.time),
      fixed(ev.triggerTime),
      q(ev.attacker),
      q(ev.defender),
      q(ev.anim),
      q(ev.profile?.type || ''),
      fixed(ev.profile?.range),
      fixed(ev.preContactDistance),
      fixed(ev.preContactGap),
      fixed(ev.contactDistance),
      fixed(ev.contactGap),
      ev.correctedAtHit ? 1 : 0,
      ev.triggered ? 1 : 0,
      fixed(hp[0]),
      fixed(hp[1]),
      fixed(hp[2]),
      q(hv.source || ''),
      fixed(hv.length),
      fixed(hv.radius),
      fixed(pp.distance),
      fixed(pp.endTime),
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

function effectsToCsv(trace) {
  const rows = [
    'time,scene,character,source,type,startX,startY,startZ,endX,endY,endZ,radius,length',
  ];

  for (const sample of trace.samples) {
    for (const volume of sample.volumes || []) {
      const start = volume.start || [];
      const end = volume.end || [];
      rows.push([
        fixed(sample.time),
        q(sample.scene || ''),
        q(volume.character || ''),
        q(volume.source || ''),
        q(volume.type || ''),
        fixed(start[0]),
        fixed(start[1]),
        fixed(start[2]),
        fixed(end[0]),
        fixed(end[1]),
        fixed(end[2]),
        fixed(volume.radius),
        fixed(volume.length),
      ].join(','));
    }
  }

  return rows.join('\n') + '\n';
}

function continuityToCsv(analysis) {
  const rows = ['type,severity,time,character,detail,value,threshold'];
  for (const issue of analysis.issues) {
    rows.push([
      q(issue.type),
      q(issue.severity),
      fixed(issue.time),
      q(issue.character || ''),
      q(issue.detail || ''),
      fixed(issue.value),
      fixed(issue.threshold),
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

function toMarkdown(trace, analysis) {
  const hits = trace.finalHitEvents || [];
  const misses = hits.filter((hit) => isLargeGap(hit));
  const corrected = hits.filter((hit) => hit.correctedAtHit);
  const dialogueEntries = (trace.entries || []).filter((e) => e.dialogue);
  const lines = [
    '# Story Trace Summary',
    '',
    `- FPS: ${trace.fps}`,
    `- Window: ${fixed(trace.startTime)}s -> ${fixed(trace.endTime)}s`,
    `- Samples: ${trace.samples.length}`,
    `- Hits: ${hits.length}`,
    `- Large pre-contact gaps (>hitRadius, projectiles excluded): ${misses.length}`,
    `- Snap-corrected at hit: ${corrected.length}`,
    `- Continuity issues: ${analysis.issues.length}`,
    `- Sudden jumps: ${analysis.counts.suddenJump}`,
    `- Fast non-combat moves: ${analysis.counts.fastNonCombatMove}`,
    `- Late contact closures: ${analysis.counts.lateContactClosure}`,
    `- Facing errors at hit: ${analysis.counts.facingErrorAtHit}`,
    `- Face direction errors at hit: ${analysis.counts.faceErrorAtHit}`,
    `- Dialogue entries: ${dialogueEntries.length}`,
    `- Dialogue face errors: ${analysis.counts.dialogueFaceError || 0}`,
    `- Dialogue distance issues: ${(analysis.counts.dialogueTooClose || 0) + (analysis.counts.dialogueTooFar || 0)}`,
    `- Scene transition jumps: ${analysis.counts.sceneTransitionJump || 0}`,
    `- Character exit teleports: ${analysis.counts.characterExitTeleport || 0}`,
    `- Idle face-body mismatches: ${analysis.counts.idleFaceBodyMismatch || 0}`,
    '',
    '| # | Time | Attack | Volume | Range | Pre Gap | Final Gap | Corrected |',
    '|---:|---:|---|---|---:|---:|---:|---:|',
  ];
  for (const hit of hits) {
    lines.push([
      `| ${hit.index}`,
      fixed(hit.triggerTime ?? hit.time),
      `${hit.attacker}->${hit.defender} ${hit.anim}`,
      hit.hitVolume?.source || '',
      fixed(hit.profile?.range),
      fixed(hit.preContactGap),
      fixed(hit.contactGap),
      hit.correctedAtHit ? 'yes' : 'no',
    ].join(' | ') + ' |');
  }

  if (analysis.issues.length > 0) {
    const combatIssues = analysis.issues.filter((i) => !i.type.startsWith('dialogue_') && !i.type.startsWith('scene_') && !i.type.startsWith('character_') && !i.type.startsWith('idle_'));
    const dialogueIssues = analysis.issues.filter((i) => i.type.startsWith('dialogue_'));
    const storyIssues = analysis.issues.filter((i) => i.type.startsWith('scene_') || i.type.startsWith('character_') || i.type.startsWith('idle_'));

    if (combatIssues.length > 0) {
      lines.push(
        '',
        '## Combat Continuity Issues',
        '',
        '| Severity | Time | Type | Character | Detail |',
        '|---|---:|---|---|---|'
      );
      for (const issue of combatIssues.slice(0, 60)) {
        lines.push([
          `| ${issue.severity}`,
          fixed(issue.time),
          issue.type,
          issue.character || '',
          issue.detail || '',
        ].join(' | ') + ' |');
      }
    }

    if (dialogueIssues.length > 0) {
      lines.push(
        '',
        '## Dialogue Issues',
        '',
        '| Severity | Time | Type | Character | Detail |',
        '|---|---:|---|---|---|'
      );
      for (const issue of dialogueIssues.slice(0, 40)) {
        lines.push([
          `| ${issue.severity}`,
          fixed(issue.time),
          issue.type,
          issue.character || '',
          issue.detail || '',
        ].join(' | ') + ' |');
      }
    }

    if (storyIssues.length > 0) {
      lines.push(
        '',
        '## Story Logic Issues',
        '',
        '| Severity | Time | Type | Character | Detail |',
        '|---|---:|---|---|---|'
      );
      for (const issue of storyIssues.slice(0, 40)) {
        lines.push([
          `| ${issue.severity}`,
          fixed(issue.time),
          issue.type,
          issue.character || '',
          issue.detail || '',
        ].join(' | ') + ' |');
      }
    }
  }
  return lines.join('\n') + '\n';
}

function analyzeContinuity(trace) {
  const issues = [];
  const byChar = new Map();
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      if (!byChar.has(ch.name)) byChar.set(ch.name, []);
      byChar.get(ch.name).push({ ...ch, time: sample.time });
    }
  }

  const metrics = {};
  for (const [name, samples] of byChar) {
    metrics[name] = analyzeCharacterContinuity(name, samples, issues);
  }

  for (const hit of trace.finalHitEvents || []) {
    analyzeHitContinuity(trace, hit, issues);
  }

  analyzeDialogue(trace, issues);
  analyzeStoryLogic(trace, issues);

  const counts = {
    suddenJump: issues.filter((i) => i.type === 'sudden_jump').length,
    fastNonCombatMove: issues.filter((i) => i.type === 'fast_non_combat_move').length,
    lateContactClosure: issues.filter((i) => i.type === 'late_contact_closure').length,
    facingErrorAtHit: issues.filter((i) => i.type === 'facing_error_at_hit').length,
    faceErrorAtHit: issues.filter((i) => i.type === 'face_error_at_hit').length,
    dialogueFaceError: issues.filter((i) => i.type === 'dialogue_face_error').length,
    dialogueTooClose: issues.filter((i) => i.type === 'dialogue_too_close').length,
    dialogueTooFar: issues.filter((i) => i.type === 'dialogue_too_far').length,
    characterEntranceIsolated: issues.filter((i) => i.type === 'character_entrance_isolated').length,
    characterExitTeleport: issues.filter((i) => i.type === 'character_exit_teleport').length,
    sceneTransitionJump: issues.filter((i) => i.type === 'scene_transition_jump').length,
    idleFaceBodyMismatch: issues.filter((i) => i.type === 'idle_face_body_mismatch').length,
  };

  return {
    thresholds: {
      suddenJumpDistancePerFrame: 1.25,
      fastNonCombatSpeed: 10,
      lateContactWindow: 0.1,
      facingErrorRadians: 0.75,
      faceErrorRadians: 0.85,
      dialogueFaceErrorRadians: 0.5,
      dialogueMinDistance: 1.5,
      dialogueMaxDistance: 4.0,
      sceneTransitionJumpDistance: 1.25,
      idleFaceBodyMismatchRadians: 1.0,
    },
    counts,
    metrics,
    hitContinuity: (trace.finalHitEvents || []).map((hit) => summarizeHitContinuity(trace, hit)),
    issues,
  };
}

function analyzeCharacterContinuity(name, samples, issues) {
  let maxSpeed = 0;
  let maxAcceleration = 0;
  let maxStep = 0;
  let previousSpeed = null;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const dt = Math.max(0.0001, cur.time - prev.time);
    const step = horizontalDistance(prev, cur);
    const speed = step / dt;
    const acceleration = previousSpeed === null ? 0 : Math.abs(speed - previousSpeed) / dt;
    maxStep = Math.max(maxStep, step);
    maxSpeed = Math.max(maxSpeed, speed);
    maxAcceleration = Math.max(maxAcceleration, acceleration);

    const activeBody = new Set(cur.activeBody || []);
    const allowsFastMotion = [
      'DashForward', 'Dodge', 'Run',
      'Punch', 'ComboPunch', 'Kick', 'Uppercut', 'SpinKick', 'JumpAttack', 'SpiritSwordSwing',
      'Knockdown', 'HitStagger',
    ]
      .some((anim) => activeBody.has(anim));

    if (step > 1.25) {
      issues.push({
        type: 'sudden_jump',
        severity: 'high',
        time: cur.time,
        character: name,
        detail: `Moved ${fixed(step)} units in one sample`,
        value: step,
        threshold: 1.25,
      });
    } else if (speed > 10 && !allowsFastMotion) {
      issues.push({
        type: 'fast_non_combat_move',
        severity: 'medium',
        time: cur.time,
        character: name,
        detail: `Speed ${fixed(speed)} without dash/run/hit reaction animation`,
        value: speed,
        threshold: 10,
      });
    }

    // Idle face-body mismatch check
    if (!cur.inCombat && !cur.isSpeaking && !cur.isListener && speed < 0.1 && Number.isFinite(cur.headYaw) && Number.isFinite(cur.yaw)) {
      const mismatch = Math.abs(normalizeAngle(cur.headYaw - cur.yaw));
      if (mismatch > 1.0) {
        issues.push({
          type: 'idle_face_body_mismatch',
          severity: 'low',
          time: cur.time,
          character: name,
          detail: `Idle face-body mismatch: ${fixed(mismatch)} rad`,
          value: mismatch,
          threshold: 1.0,
        });
      }
    }

    previousSpeed = speed;
  }

  return {
    samples: samples.length,
    maxStep,
    maxSpeed,
    maxAcceleration,
  };
}

function analyzeHitContinuity(trace, hit, issues) {
  const summary = summarizeHitContinuity(trace, hit);
  if (!summary) return;

  if (hit.profile?.type !== 'projectile' && summary.closeLeadTime !== null && summary.closeLeadTime < 0.1) {
    issues.push({
      type: 'late_contact_closure',
      severity: 'medium',
      time: hit.time,
      character: hit.attacker,
      detail: `${hit.attacker}->${hit.defender} ${hit.anim} entered hit radius only ${fixed(summary.closeLeadTime)}s before hit`,
      value: summary.closeLeadTime,
      threshold: 0.1,
    });
  }

  if (hit.profile?.type !== 'projectile' && summary.facingErrorAtHit !== null && summary.facingErrorAtHit > 0.75) {
    issues.push({
      type: 'facing_error_at_hit',
      severity: 'high',
      time: hit.time,
      character: hit.attacker,
      detail: `${hit.attacker} yaw differs from target direction by ${fixed(summary.facingErrorAtHit)} rad`,
      value: summary.facingErrorAtHit,
      threshold: 0.75,
    });
  }

  if (summary.attackerFaceErrorAtHit !== null && summary.attackerFaceErrorAtHit > 0.85) {
    issues.push({
      type: 'face_error_at_hit',
      severity: 'high',
      time: hit.time,
      character: hit.attacker,
      detail: `${hit.attacker} face differs from ${hit.defender} direction by ${fixed(summary.attackerFaceErrorAtHit)} rad during ${hit.anim}`,
      value: summary.attackerFaceErrorAtHit,
      threshold: 0.85,
    });
  }

  if (summary.defenderFaceErrorAtHit !== null && summary.defenderFaceErrorAtHit > 0.85) {
    issues.push({
      type: 'face_error_at_hit',
      severity: 'medium',
      time: hit.time,
      character: hit.defender,
      detail: `${hit.defender} face differs from ${hit.attacker} direction by ${fixed(summary.defenderFaceErrorAtHit)} rad at incoming ${hit.anim}`,
      value: summary.defenderFaceErrorAtHit,
      threshold: 0.85,
    });
  }
}

function analyzeDialogue(trace, issues) {
  const dialogueEntries = (trace.entries || []).filter((e) => e.dialogue && e.character);
  if (dialogueEntries.length === 0) return;

  for (const entry of dialogueEntries) {
    const windowStart = entry.startTime;
    const windowEnd = entry.endTime;
    const speakerName = entry.character;

    // Collect samples within this dialogue window
    const windowSamples = [];
    for (const sample of trace.samples) {
      if (sample.time < windowStart || sample.time > windowEnd) continue;
      windowSamples.push(sample);
    }

    if (windowSamples.length === 0) continue;

    // Check if this dialogue happens during combat — skip combat banter
    const combatRatio = windowSamples.filter((s) => {
      const speaker = s.characters.find((ch) => ch.name === speakerName);
      return speaker && speaker.inCombat;
    }).length / windowSamples.length;
    if (combatRatio > 0.5) continue;

    // Determine intended listener from script's face= directive
    // Look at entry.positions for speaker's face target
    let intendedListener = null;
    const speakerPos = (entry.positions || []).find((p) => p.name === speakerName || p.options?.name === speakerName);
    if (speakerPos && speakerPos.options && speakerPos.options.face) {
      const faceTarget = speakerPos.options.face;
      // face can be: center, forward, right, left, back, or a character name
      if (faceTarget !== 'center' && faceTarget !== 'forward' && faceTarget !== 'right' && faceTarget !== 'left' && faceTarget !== 'back') {
        intendedListener = faceTarget;
      }
    }

    // Also check if any other character's position has face=speakerName
    for (const pos of entry.positions || []) {
      if (pos.options && pos.options.face === speakerName) {
        // This character is facing the speaker — they are the listener
        if (!intendedListener) intendedListener = pos.name || pos.options.name;
      }
    }

    // If no intended listener found from script, fall back to the character with smallest face error
    if (!intendedListener) {
      let minFaceError = Infinity;
      for (const sample of windowSamples) {
        const speaker = sample.characters.find((ch) => ch.name === speakerName);
        if (!speaker || speaker.inCombat) continue;
        for (const other of sample.characters) {
          if (other.name === speakerName || other.inCombat) continue;
          const err = faceToTargetError(speaker, other);
          if (err !== null && err < minFaceError) {
            minFaceError = err;
            intendedListener = other.name;
          }
        }
      }
    }

    // Aggregate issues per entry: track max errors and distance
    let maxSpeakerFaceError = 0;
    let maxListenerFaceError = 0;
    let worstSpeakerTime = windowStart;
    let worstListenerTime = windowStart;
    let worstListenerName = '';
    let minDist = Infinity;
    let maxDist = 0;
    let distSampleCount = 0;
    let distSum = 0;

    for (const sample of windowSamples) {
      const speaker = sample.characters.find((ch) => ch.name === speakerName);
      if (!speaker || speaker.inCombat) continue;

      // Only check against intended listener, or if none found, all non-combat present characters
      let targets;
      if (intendedListener) {
        targets = sample.characters.filter((ch) => ch.name === intendedListener);
      } else {
        targets = sample.characters.filter((ch) => ch.name !== speakerName && !ch.inCombat);
      }

      for (const listener of targets) {
        // Speaker face error: should speaker be looking at listener?
        const speakerFaceError = faceToTargetError(speaker, listener);
        if (speakerFaceError !== null && speakerFaceError > maxSpeakerFaceError) {
          maxSpeakerFaceError = speakerFaceError;
          worstSpeakerTime = sample.time;
        }

        // Listener face error: should listener be looking at speaker?
        const listenerFaceError = faceToTargetError(listener, speaker);
        if (listenerFaceError !== null && listenerFaceError > maxListenerFaceError) {
          maxListenerFaceError = listenerFaceError;
          worstListenerTime = sample.time;
          worstListenerName = listener.name;
        }

        // Distance
        const dist = horizontalDistance(speaker, listener);
        distSum += dist;
        distSampleCount++;
        if (dist < minDist) minDist = dist;
        if (dist > maxDist) maxDist = dist;
      }
    }

    // Emit one issue per entry for each problem type
    if (maxSpeakerFaceError > 0.5) {
      const targetDesc = intendedListener || 'listener';
      issues.push({
        type: 'dialogue_face_error',
        severity: 'high',
        time: worstSpeakerTime,
        character: speakerName,
        detail: `${speakerName} face error up to ${fixed(maxSpeakerFaceError)} rad while speaking to ${targetDesc} (entry #${entry.index})`,
        value: maxSpeakerFaceError,
        threshold: 0.5,
      });
    }

    if (maxListenerFaceError > 0.5 && worstListenerName) {
      issues.push({
        type: 'dialogue_face_error',
        severity: 'medium',
        time: worstListenerTime,
        character: worstListenerName,
        detail: `${worstListenerName} face error up to ${fixed(maxListenerFaceError)} rad while listening to ${speakerName} (entry #${entry.index})`,
        value: maxListenerFaceError,
        threshold: 0.5,
      });
    }

    if (minDist < 1.5) {
      const targetDesc = intendedListener || 'listener';
      issues.push({
        type: 'dialogue_too_close',
        severity: 'medium',
        time: windowStart,
        character: speakerName,
        detail: `Min distance ${fixed(minDist)}m to ${targetDesc} during entry #${entry.index} (too close, min 1.5m)`,
        value: minDist,
        threshold: 1.5,
      });
    }

    if (maxDist > 4.0) {
      const targetDesc = intendedListener || 'listener';
      issues.push({
        type: 'dialogue_too_far',
        severity: 'medium',
        time: windowStart,
        character: speakerName,
        detail: `Max distance ${fixed(maxDist)}m to ${targetDesc} during entry #${entry.index} (too far, max 4.0m)`,
        value: maxDist,
        threshold: 4.0,
      });
    }
  }
}

function analyzeStoryLogic(trace, issues) {
  // Character entrance/exit checks
  const byChar = new Map();
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      if (!byChar.has(ch.name)) byChar.set(ch.name, []);
      byChar.get(ch.name).push({ ...ch, time: sample.time, scene: sample.scene });
    }
  }

  for (const [name, samples] of byChar) {
    for (let i = 0; i < samples.length; i++) {
      const cur = samples[i];
      const prev = i > 0 ? samples[i - 1] : null;

      // Entrance check: first appearance
      if (i === 0 || (prev && prev.scene !== cur.scene)) {
        // Find nearest other character in same sample
        const sameSample = trace.samples.find((s) => s.time === cur.time);
        if (sameSample) {
          let minDist = Infinity;
          for (const other of sameSample.characters) {
            if (other.name === name) continue;
            const d = horizontalDistance(cur, other);
            if (d < minDist) minDist = d;
          }
          if (minDist > 8) {
            issues.push({
              type: 'character_entrance_isolated',
              severity: 'low',
              time: cur.time,
              character: name,
              detail: `${name} appeared ${fixed(minDist)}m away from nearest character`,
              value: minDist,
              threshold: 8,
            });
          }
        }
      }

      // Exit check: disappearance with sudden move
      if (i > 0 && i < samples.length - 1) {
        const next = samples[i + 1];
        const step = horizontalDistance(cur, next);
        // If next sample is much later, check if there was a teleport before exit
        const timeGap = next.time - cur.time;
        if (timeGap > 0.5 && step > 0.8) {
          issues.push({
            type: 'character_exit_teleport',
            severity: 'medium',
            time: cur.time,
            character: name,
            detail: `${name} moved ${fixed(step)} units before disappearing`,
            value: step,
            threshold: 0.8,
          });
        }
      }
    }
  }

  // Scene transition jump check
  for (const change of trace.sceneChanges || []) {
    const windowStart = change.time - 0.5;
    const windowEnd = change.time + 0.5;
    const beforeSamples = [];
    const afterSamples = [];

    for (const sample of trace.samples) {
      if (sample.time >= windowStart && sample.time < change.time) {
        beforeSamples.push(sample);
      } else if (sample.time >= change.time && sample.time <= windowEnd) {
        afterSamples.push(sample);
      }
    }

    // Find characters present in both before and after
    const beforeChars = new Map();
    for (const sample of beforeSamples) {
      for (const ch of sample.characters) {
        if (!beforeChars.has(ch.name)) beforeChars.set(ch.name, ch);
      }
    }

    for (const sample of afterSamples) {
      for (const ch of sample.characters) {
        const beforeCh = beforeChars.get(ch.name);
        if (beforeCh) {
          const jump = horizontalDistance(beforeCh, ch);
          if (jump > 1.25) {
            issues.push({
              type: 'scene_transition_jump',
              severity: 'high',
              time: change.time,
              character: ch.name,
              detail: `${ch.name} jumped ${fixed(jump)} units during transition to ${change.scene}`,
              value: jump,
              threshold: 1.25,
            });
          }
        }
      }
    }
  }
}

function summarizeHitContinuity(trace, hit) {
  if (!hit.attacker || !hit.defender || !Number.isFinite(hit.time)) return null;
  const range = hit.profile?.range ?? 1;
  const hitRadius = hit.profile?.hitRadius ?? 0.35;
  const eventTime = Number.isFinite(hit.triggerTime) ? hit.triggerTime : hit.time;
  const windowStart = eventTime - 0.6;
  const samples = [];
  for (const sample of trace.samples) {
    if (sample.time < windowStart || sample.time > eventTime + 0.0001) continue;
    const attacker = sample.characters.find((ch) => ch.name === hit.attacker);
    const defender = sample.characters.find((ch) => ch.name === hit.defender);
    if (!attacker || !defender) continue;
    const distance = horizontalDistance(attacker, defender);
    const gap = Math.max(0, distance - range);
    samples.push({ time: sample.time, attacker, defender, distance, gap });
  }

  if (samples.length === 0) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  let firstClose = null;
  for (const sample of samples) {
    if (sample.gap <= hitRadius) {
      firstClose = sample;
      break;
    }
  }

  const closeLeadTime = firstClose ? eventTime - firstClose.time : null;
  const facingErrorAtHit = angleToTargetError(last.attacker, last.defender);
  const attackerFaceErrorAtHit = faceToTargetError(last.attacker, last.defender);
  const defenderFaceErrorAtHit = faceToTargetError(last.defender, last.attacker);
  return {
    index: hit.index,
    time: eventTime,
    scheduledTime: hit.time,
    triggerTime: hit.triggerTime ?? null,
    attacker: hit.attacker,
    defender: hit.defender,
    anim: hit.anim,
    startGap: first.gap,
    finalGap: last.gap,
    hitRadius,
    firstCloseTime: firstClose?.time ?? null,
    closeLeadTime,
    facingErrorAtHit,
    attackerFaceErrorAtHit,
    defenderFaceErrorAtHit,
    attackerHeadYawAtHit: last.attacker.headYaw ?? null,
    defenderHeadYawAtHit: last.defender.headYaw ?? null,
    attackerHeadLocalYawAtHit: last.attacker.headLocalYaw ?? null,
    defenderHeadLocalYawAtHit: last.defender.headLocalYaw ?? null,
  };
}

function toSvg(trace, analysis) {
  const positions = [];
  const byChar = new Map();
  const dialogueSamples = []; // samples with dialogueActive
  for (const sample of trace.samples) {
    for (const ch of sample.characters) {
      positions.push({ x: ch.x, z: ch.z });
      if (!byChar.has(ch.name)) byChar.set(ch.name, []);
      byChar.get(ch.name).push({ x: ch.x, z: ch.z, time: sample.time, headYaw: ch.headYaw, inCombat: ch.inCombat, isSpeaking: ch.isSpeaking, isListener: ch.isListener });
    }
    if (sample.dialogueActive) {
      dialogueSamples.push(sample);
    }
  }
  for (const hit of trace.finalHitEvents || []) {
    if (hit.hitPoint) positions.push({ x: hit.hitPoint[0], z: hit.hitPoint[2] });
    if (hit.hitVolume?.start) positions.push({ x: hit.hitVolume.start[0], z: hit.hitVolume.start[2] });
    if (hit.hitVolume?.end) positions.push({ x: hit.hitVolume.end[0], z: hit.hitVolume.end[2] });
  }

  const pad = 40;
  const mapWidth = 1200;
  const mapHeight = 700;
  const distChartHeight = 220;
  const width = mapWidth;
  const height = mapHeight + distChartHeight;

  const bounds = computeBounds(positions);
  const scale = Math.min(
    (mapWidth - pad * 2) / Math.max(0.001, bounds.maxX - bounds.minX),
    (mapHeight - pad * 2) / Math.max(0.001, bounds.maxZ - bounds.minZ)
  );
  const tx = (x) => pad + (x - bounds.minX) * scale;
  const ty = (z) => mapHeight - pad - (z - bounds.minZ) * scale;
  const palette = ['#00a6d6', '#f26b38', '#65a765', '#aa58b6', '#d6a800', '#444444'];

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#111"/>',
    `<text x="${pad}" y="26" fill="#eee" font-family="monospace" font-size="18">Story trace ${fixed(trace.startTime)}s-${fixed(trace.endTime)}s @ ${trace.fps}fps</text>`,
  ];

  // Dialogue zone overlays on map
  const dialogueEntries = (trace.entries || []).filter((e) => e.dialogue && e.character);
  const dialogueColors = ['#224422', '#222244', '#442222', '#444422'];
  for (let i = 0; i < dialogueEntries.length; i++) {
    const entry = dialogueEntries[i];
    // Find approximate position: use speaker's average position during dialogue
    let avgX = 0, avgZ = 0, count = 0;
    for (const sample of trace.samples) {
      if (sample.time < entry.startTime || sample.time > entry.endTime) continue;
      const speaker = sample.characters.find((ch) => ch.name === entry.character);
      if (speaker) {
        avgX += speaker.x;
        avgZ += speaker.z;
        count++;
      }
    }
    if (count > 0) {
      avgX /= count;
      avgZ /= count;
    }
    const dc = dialogueColors[i % dialogueColors.length];
    const label = `${entry.character}: ${escapeXml(entry.dialogue.slice(0, 20))}`;
    lines.push(`<circle cx="${tx(avgX)}" cy="${ty(avgZ)}" r="35" fill="${dc}" stroke="#66aa66" stroke-width="1" stroke-opacity="0.4" stroke-dasharray="4 3"/>`);
    lines.push(`<text x="${tx(avgX)}" y="${ty(avgZ) - 42}" fill="#88cc88" font-family="monospace" font-size="11" text-anchor="middle">${label}</text>`);
  }

  let colorIdx = 0;
  for (const [name, points] of byChar) {
    const color = palette[colorIdx % palette.length];
    colorIdx++;
    const path = points.map((p) => `${tx(p.x).toFixed(1)},${ty(p.z).toFixed(1)}`).join(' ');
    lines.push(`<polyline points="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="0.9"/>`);
    const first = points[0];
    const last = points[points.length - 1];
    lines.push(`<circle cx="${tx(first.x)}" cy="${ty(first.z)}" r="5" fill="${color}"/>`);
    lines.push(`<rect x="${tx(last.x) - 5}" y="${ty(last.z) - 5}" width="10" height="10" fill="${color}"/>`);
    lines.push(`<text x="${tx(last.x) + 8}" y="${ty(last.z) + 4}" fill="${color}" font-family="monospace" font-size="14">${escapeXml(name)}</text>`);

    // Face direction arrows with color-coded error
    const faceStep = Math.max(1, Math.round((trace.fps || 60) / 4));
    for (let i = 0; i < points.length; i += faceStep) {
      const p = points[i];
      if (!Number.isFinite(p.headYaw)) continue;

      // Determine target for facing error calculation
      let target = null;
      if (p.inCombat) {
        // Find opponent (simplified: nearest other character)
        const sample = trace.samples.find((s) => Math.abs(s.time - p.time) < 0.001);
        if (sample) {
          let nearest = null;
          let minD = Infinity;
          for (const ch of sample.characters) {
            if (ch.name === name) continue;
            const d = Math.sqrt((ch.x - p.x) ** 2 + (ch.z - p.z) ** 2);
            if (d < minD) { minD = d; nearest = ch; }
          }
          target = nearest;
        }
      } else if (p.isSpeaking || p.isListener) {
        // Find dialogue partner
        const sample = trace.samples.find((s) => Math.abs(s.time - p.time) < 0.001);
        if (sample) {
          for (const ch of sample.characters) {
            if (ch.name === name) continue;
            if ((p.isSpeaking && ch.isListener) || (p.isListener && ch.isSpeaking)) {
              target = ch;
              break;
            }
          }
        }
      }

      let arrowColor = color;
      let arrowOpacity = '0.35';
      if (target) {
        const error = faceToTargetError(
          { headYaw: p.headYaw, headX: p.x, headZ: p.z },
          { headX: target.x, headZ: target.z }
        );
        if (error !== null) {
          if (error > 0.5) {
            arrowColor = '#ff4444';
            arrowOpacity = '0.7';
          } else if (error > 0.3) {
            arrowColor = '#ffdd44';
            arrowOpacity = '0.5';
          } else {
            arrowColor = '#44ff44';
            arrowOpacity = '0.4';
          }
        }
      }

      const len = p.inCombat ? 0.35 : 0.25;
      const x2 = p.x + Math.sin(p.headYaw) * len;
      const z2 = p.z + Math.cos(p.headYaw) * len;
      lines.push(`<line x1="${tx(p.x)}" y1="${ty(p.z)}" x2="${tx(x2)}" y2="${ty(z2)}" stroke="${arrowColor}" stroke-width="1.5" stroke-opacity="${arrowOpacity}"/>`);
    }
  }

  for (const hit of trace.finalHitEvents || []) {
    if (hit.hitVolume?.start && hit.hitVolume?.end) {
      const x1 = tx(hit.hitVolume.start[0]);
      const y1 = ty(hit.hitVolume.start[2]);
      const x2 = tx(hit.hitVolume.end[0]);
      const y2 = ty(hit.hitVolume.end[2]);
      const color = hit.profile?.type === 'projectile' ? '#66ccff' : '#ffaa33';
      lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3" stroke-opacity="0.75"/>`);
    }
    if (hit.visualHitVolume?.start && hit.visualHitVolume?.end && hit.visualHitVolume.source !== hit.hitVolume?.source) {
      const x1 = tx(hit.visualHitVolume.start[0]);
      const y1 = ty(hit.visualHitVolume.start[2]);
      const x2 = tx(hit.visualHitVolume.end[0]);
      const y2 = ty(hit.visualHitVolume.end[2]);
      lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#aaddff" stroke-width="2" stroke-dasharray="6 5" stroke-opacity="0.55"/>`);
    }
    if (!hit.hitPoint) continue;
    const x = tx(hit.hitPoint[0]);
    const y = ty(hit.hitPoint[2]);
    const bad = isLargeGap(hit);
    lines.push(`<circle cx="${x}" cy="${y}" r="${bad ? 10 : 7}" fill="${bad ? '#ff3355' : '#ffee55'}" stroke="#fff" stroke-width="1.5"/>`);
    lines.push(`<text x="${x + 12}" y="${y - 8}" fill="${bad ? '#ff99aa' : '#fff2a0'}" font-family="monospace" font-size="13">#${hit.index} ${escapeXml(hit.anim)} gap=${fixed(hit.preContactGap)}</text>`);
  }

  // === Distance Chart (bottom subplot) ===
  const chartTop = mapHeight + 20;
  const chartPad = 40;
  const chartW = mapWidth - chartPad * 2;
  const chartH = distChartHeight - 50;
  const chartLeft = chartPad;
  const chartRight = chartLeft + chartW;
  const chartBottom = chartTop + chartH;

  // Chart background
  lines.push(`<rect x="${chartLeft}" y="${chartTop}" width="${chartW}" height="${chartH}" fill="#1a1a1a" stroke="#333" stroke-width="1"/>`);
  lines.push(`<text x="${chartLeft}" y="${chartTop - 6}" fill="#aaa" font-family="monospace" font-size="12">Character Pair Distances Over Time</text>`);

  // Time axis
  const timeMin = trace.startTime;
  const timeMax = trace.endTime;
  const timeScale = chartW / Math.max(0.001, timeMax - timeMin);
  const timeX = (t) => chartLeft + (t - timeMin) * timeScale;

  // Distance axis (0 to max distance found)
  let maxDist = 6;
  const pairDistances = new Map();
  for (const sample of trace.samples) {
    const chars = sample.characters;
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        const a = chars[i];
        const b = chars[j];
        const d = horizontalDistance(a, b);
        maxDist = Math.max(maxDist, d);
        const key = `${a.name}<->${b.name}`;
        if (!pairDistances.has(key)) pairDistances.set(key, []);
        pairDistances.get(key).push({ time: sample.time, distance: d, dialogueActive: sample.dialogueActive });
      }
    }
  }
  maxDist = Math.min(maxDist, 12); // cap at 12m
  const distScale = chartH / maxDist;
  const distY = (d) => chartBottom - Math.min(d, maxDist) * distScale;

  // Green zone for dialogue distance (1.5 - 4.0m)
  const yMin = distY(4.0);
  const yMax = distY(1.5);
  lines.push(`<rect x="${chartLeft}" y="${yMin}" width="${chartW}" height="${yMax - yMin}" fill="#1a331a" stroke="none"/>`);
  lines.push(`<text x="${chartRight - 5}" y="${yMin + 12}" fill="#66aa66" font-family="monospace" font-size="9" text-anchor="end">dialogue OK (1.5-4.0m)</text>`);

  // Grid lines
  for (let d = 0; d <= maxDist; d += 2) {
    const y = distY(d);
    lines.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="#333" stroke-width="0.5" stroke-dasharray="2 2"/>`);
    lines.push(`<text x="${chartLeft - 4}" y="${y + 3}" fill="#666" font-family="monospace" font-size="9" text-anchor="end">${d}m</text>`);
  }

  // Time ticks
  const timeStep = Math.max(5, Math.round((timeMax - timeMin) / 8));
  for (let t = Math.ceil(timeMin / timeStep) * timeStep; t <= timeMax; t += timeStep) {
    const x = timeX(t);
    lines.push(`<line x1="${x}" y1="${chartBottom}" x2="${x}" y2="${chartBottom + 4}" stroke="#666" stroke-width="1"/>`);
    lines.push(`<text x="${x}" y="${chartBottom + 16}" fill="#666" font-family="monospace" font-size="9" text-anchor="middle">${fixed(t)}s</text>`);
  }

  // Dialogue zone shading on chart
  for (const entry of dialogueEntries) {
    const x1 = timeX(entry.startTime);
    const x2 = timeX(entry.endTime);
    lines.push(`<rect x="${x1}" y="${chartTop}" width="${x2 - x1}" height="${chartH}" fill="#224422" stroke="none" opacity="0.3"/>`);
  }

  // Plot distance curves
  const pairPalette = ['#00a6d6', '#f26b38', '#65a765', '#aa58b6', '#d6a800', '#ff6699', '#44dddd'];
  let pairIdx = 0;
  for (const [key, points] of pairDistances) {
    const color = pairPalette[pairIdx % pairPalette.length];
    pairIdx++;
    const path = points.map((p) => `${timeX(p.time).toFixed(1)},${distY(p.distance).toFixed(1)}`).join(' ');
    lines.push(`<polyline points="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.8"/>`);

    // Label at end
    const last = points[points.length - 1];
    lines.push(`<text x="${timeX(last.time) + 4}" y="${distY(last.distance) + 3}" fill="${color}" font-family="monospace" font-size="9">${escapeXml(key)}</text>`);
  }

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

function isLargeGap(hit) {
  if (hit.profile?.type === 'projectile') return false;
  const allowedGap = hit.profile?.hitRadius ?? 0.35;
  return (hit.preContactGap ?? hit.contactGap ?? 0) > allowedGap;
}

function computeBounds(points) {
  if (points.length === 0) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (Math.abs(maxX - minX) < 1) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (Math.abs(maxZ - minZ) < 1) {
    minZ -= 0.5;
    maxZ += 0.5;
  }
  return { minX, maxX, minZ, maxZ };
}

function horizontalDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function angleToTargetError(attacker, defender) {
  if (!attacker || !defender || !Number.isFinite(attacker.yaw)) return null;
  const dx = defender.x - attacker.x;
  const dz = defender.z - attacker.z;
  if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return 0;
  const targetYaw = Math.atan2(dx, dz);
  return Math.abs(normalizeAngle(attacker.yaw - targetYaw));
}

function faceToTargetError(source, target) {
  const sourceYaw = Number.isFinite(source?.headYaw) ? source.headYaw : source?.yaw;
  if (!source || !target || !Number.isFinite(sourceYaw)) return null;

  const sx = Number.isFinite(source.headX) ? source.headX : source.x;
  const sz = Number.isFinite(source.headZ) ? source.headZ : source.z;
  const tx = Number.isFinite(target.headX) ? target.headX : target.x;
  const tz = Number.isFinite(target.headZ) ? target.headZ : target.z;
  const dx = tx - sx;
  const dz = tz - sz;
  if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return 0;

  const targetYaw = Math.atan2(dx, dz);
  return Math.abs(normalizeAngle(sourceYaw - targetYaw));
}

function normalizeAngle(angle) {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

function fixed(n) {
  return Number.isFinite(n) ? Number(n).toFixed(3) : '';
}

function q(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
