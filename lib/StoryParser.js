/**
 * StoryScript parser for .story files.
 *
 * A time-based animation cue format derived from SRT syntax,
 * extended with namespaces for scenes, characters, animations,
 * camera moves, music cues, ball events, props, positions, SFX, etc.
 *
 * Supported tags:
 *   @SceneName
 *   [CharacterName] Dialogue text
 *   {ActionName} body animation
 *   {Camera:MoveName|key=value} camera movement with optional params
 *   {Music:Action|key=value} music cue with optional params
 *   {Ball:Action|key=value} ball event (serve, return, fly-to, etc.)
 *   {Prop:Action|key=value} prop attach / detach / show / hide
 *   {Position:Place|key=value} character placement
 *   {SFX:Play|key=value} sound effect trigger
 *   {Transition:Name|key=value} visual transition effect
 *   {Event:Action|key=value} generic story event
 *   {Hitstop|duration=...|shake=...} hitstop freeze + screen shake
 */
export class StoryParser {
  static parse(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const entries = [];
    let i = 0;

    while (i < lines.length) {
      // Skip empty lines
      if (lines[i].trim() === '') {
        i++;
        continue;
      }

      // Read index line
      const index = parseInt(lines[i].trim(), 10);
      i++;
      if (i >= lines.length) break;

      // Read time line: 00:00:01,000 --> 00:00:03,500
      const timeLine = lines[i].trim();
      i++;
      const timeMatch = timeLine.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/
      );
      if (!timeMatch) continue;

      const startTime =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000;
      const endTime =
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000;

      // Read text lines until empty line
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }

      const content = textLines.join('\n');
      entries.push({
        index,
        startTime,
        endTime,
        content,
        scene: this.extractScene(content),
        character: this.extractCharacter(content),
        animationCues: this.extractAnimationCues(content),
        animations: this.extractAnimations(content),
        cameraMove: this.extractCameraMove(content),
        musicCue: this.extractMusicCue(content),
        ballEvents: this.extractBallEvents(content),
        propOps: this.extractPropOps(content),
        positions: this.extractPositions(content),
        sfxEvents: this.extractSFXEvents(content),
        transition: this.extractTransition(content),
        dunkEvents: this.extractDunkEvents(content),
        storyEvents: this.extractStoryEvents(content),
        voiceEmotion: this.extractVoiceEmotion(content),
        hitstop: this.extractHitstop(content),
        combat: this.extractCombat(content),
        combatAll: this.extractCombatAll(content),
        sceneDirector: this.extractSceneDirector(content),
        dialogue: this.extractDialogue(content),
      });
    }

    return entries;
  }

  static extractScene(text) {
    const match = text.match(/^@(\w+)/m);
    return match ? match[1] : null;
  }

  static extractCharacter(text) {
    const bracketMatch = text.match(/\[(\w+)\]/);
    if (bracketMatch) return bracketMatch[1];

    const braceSpeakerMatch = text.match(/(?:^|\n)\{([A-Z][a-zA-Z0-9]*)\}\s+([^{}\n]+)/);
    return braceSpeakerMatch ? braceSpeakerMatch[1] : null;
  }

  static extractAnimations(text) {
    return this.extractAnimationCues(text).map((cue) => cue.name);
  }

  static extractAnimationCues(text) {
    const cues = [];
    const addCue = (cue) => {
      if (!cue?.name) return;
      if (!cues.some((existing) => existing.name === cue.name && existing.character === cue.character)) {
        cues.push(cue);
      }
    };

    // Match {Animation:ActionName|duration=...}
    for (const cue of this._extractNamespacedTag(text, 'Animation')) {
      addCue(cue);
    }

    const targetedRanges = [];
    const targetedMatches = text.matchAll(/\{([A-Z][a-zA-Z0-9]*)\}\{([A-Z][a-zA-Z0-9]*)(?:\|([^{}]*))?\}/g);
    for (const m of targetedMatches) {
      const cue = this._parseTagParams(`${m[2]}${m[3] ? `|${m[3]}` : ''}`);
      cue.character = m[1];
      addCue(cue);
      targetedRanges.push([m.index, m.index + m[0].length]);
    }

    const speakerTagRanges = [];
    const speakerTagMatches = text.matchAll(/(?:^|\n)\{([A-Z][a-zA-Z0-9]*)\}\s+([^{}\n]+)/g);
    for (const m of speakerTagMatches) {
      const tagStart = m.index + (m[0][0] === '\n' ? 1 : 0);
      const tagEnd = tagStart + m[1].length + 2;
      speakerTagRanges.push([tagStart, tagEnd]);
    }

    const isInsideNonAnimationTag = (index) =>
      targetedRanges.some(([start, end]) => index >= start && index < end) ||
      speakerTagRanges.some(([start, end]) => index >= start && index < end);

    // Also match bare capitalized tags like {WaveHand} and {LeftRightPunchCombo|duration=...}
    const bareMatches = text.matchAll(/\{([A-Z][a-zA-Z0-9]*)(?:\|([^{}]*))?\}/g);
    const namespaces = ['Camera', 'Music', 'Ball', 'Prop', 'Position', 'SFX', 'Transition', 'Event', 'Dunk', 'Hitstop', 'Voice'];
    for (const m of bareMatches) {
      if (isInsideNonAnimationTag(m.index)) continue;
      const name = m[1];
      if (!namespaces.includes(name)) {
        addCue(this._parseTagParams(`${name}${m[2] ? `|${m[2]}` : ''}`));
      }
    }
    return cues;
  }

  static _extractNamespacedTag(text, namespace) {
    // 使用 [^{}]* 避免误匹配嵌套花括号，修复平衡检查误报
    const regex = new RegExp(`\\{${namespace}:([^{}]*)\\}`, 'g');
    const matches = Array.from(text.matchAll(regex));
    return matches.map((m) => this._parseTagParams(m[1]));
  }

  static _parseTagParams(inner) {
    const parts = inner.split('|').map((s) => s.trim());
    const name = parts[0];
    const options = {};

    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx === -1) continue;
      const key = parts[i].slice(0, eqIdx).trim();
      const valStr = parts[i].slice(eqIdx + 1).trim();

      if (valStr.includes(',')) {
        options[key] = valStr.split(',').map((s) => {
          const n = Number(s.trim());
          return isNaN(n) ? s.trim() : n;
        });
      } else {
        const n = Number(valStr);
        options[key] = isNaN(n) ? valStr : n;
      }
    }

    return { name, options };
  }

  static extractCameraMove(text) {
    const tags = this._extractNamespacedTag(text, 'Camera');
    return tags.length > 0 ? tags[0] : null;
  }

  static extractMusicCue(text) {
    const tags = this._extractNamespacedTag(text, 'Music');
    return tags.length > 0 ? tags[0] : null;
  }

  static extractBallEvents(text) {
    return this._extractNamespacedTag(text, 'Ball');
  }

  static extractPropOps(text) {
    return this._extractNamespacedTag(text, 'Prop');
  }

  static extractPositions(text) {
    return this._extractNamespacedTag(text, 'Position');
  }

  static extractSFXEvents(text) {
    return this._extractNamespacedTag(text, 'SFX');
  }

  static extractTransition(text) {
    const tags = this._extractNamespacedTag(text, 'Transition');
    return tags.length > 0 ? tags[0] : null;
  }

  static extractStoryEvents(text) {
    return this._extractNamespacedTag(text, 'Event');
  }

  static extractDunkEvents(text) {
    return this._extractNamespacedTag(text, 'Dunk');
  }

  static extractHitstop(text) {
    const tags = this._extractNamespacedTag(text, 'Hitstop');
    if (tags.length > 0) return tags[0];

    const legacyMatch = text.match(/\{Hitstop\|([^{}]*)\}/);
    return legacyMatch ? this._parseTagParams(`Trigger|${legacyMatch[1]}`) : null;
  }

  static extractCombat(text) {
    const tags = this._extractNamespacedTag(text, 'Combat');
    return tags.length > 0 ? tags[0] : null;
  }

  /**
   * 提取所有 Combat 子标签（支持同一条目多个 Combat 标签）
   */
  static extractCombatAll(text) {
    return this._extractNamespacedTag(text, 'Combat');
  }

  static extractSceneDirector(text) {
    return this._extractNamespacedTag(text, 'SceneDirector');
  }

  static extractVoiceEmotion(text) {
    const match = text.match(/\{Voice:([^}]+)\}/);
    return match ? match[1].trim() : null;
  }

  static extractDialogue(text) {
    return text
      .replace(/^@\w+\s*/m, '')
      .replace(/\[\w+\]\s*/, '')
      .replace(/\{Animation:[^}]+\}\s*/g, '')
      .replace(/\{(?!Camera:)[A-Z][a-zA-Z0-9]*(?:\|[^}]*)?\}\s*/g, '')
      .replace(/\{Camera:[^}]+\}\s*/, '')
      .replace(/\{Music:[^}]+\}\s*/, '')
      .replace(/\{Voice:[^}]+\}\s*/, '')
      .replace(/\{Ball:[^}]+\}\s*/g, '')
      .replace(/\{Prop:[^}]+\}\s*/g, '')
      .replace(/\{Position:[^}]+\}\s*/g, '')
      .replace(/\{SFX:[^}]+\}\s*/g, '')
      .replace(/\{Transition:[^}]+\}\s*/g, '')
      .replace(/\{Event:[^}]+\}\s*/g, '')
      .replace(/\{Hitstop:[^}]+\}\s*/g, '')
      .replace(/\{Hitstop\|[^}]+\}\s*/g, '')
      .replace(/\{Combat:[^}]+\}\s*/g, '')
      .replace(/\{SceneDirector:[^}]+\}\s*/g, '')
      .trim();
  }
}
