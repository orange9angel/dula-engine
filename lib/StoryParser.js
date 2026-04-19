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
 *   {Event:Action|key=value} generic story event
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
        animations: this.extractAnimations(content),
        cameraMove: this.extractCameraMove(content),
        musicCue: this.extractMusicCue(content),
        ballEvents: this.extractBallEvents(content),
        propOps: this.extractPropOps(content),
        positions: this.extractPositions(content),
        sfxEvents: this.extractSFXEvents(content),
        storyEvents: this.extractStoryEvents(content),
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
    const match = text.match(/\[(\w+)\]/);
    return match ? match[1] : null;
  }

  static extractAnimations(text) {
    // Match all {Action} but NOT namespaced tags (Camera:, Music:, Ball:, etc.)
    const matches = text.matchAll(/\{(?!Camera:|Music:|Ball:|Prop:|Position:|SFX:|Event:)(\w+)\}/g);
    return Array.from(matches).map((m) => m[1]);
  }

  static _extractNamespacedTag(text, namespace) {
    const regex = new RegExp(`\\{${namespace}:([^}]+)\\}`, 'g');
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

  static extractStoryEvents(text) {
    return this._extractNamespacedTag(text, 'Event');
  }

  static extractDialogue(text) {
    return text
      .replace(/^@\w+\s*/m, '')
      .replace(/\[\w+\]\s*/, '')
      .replace(/\{(?!Camera:)\w+\}\s*/g, '')
      .replace(/\{Camera:[^}]+\}\s*/, '')
      .replace(/\{Music:[^}]+\}\s*/, '')
      .replace(/\{Ball:[^}]+\}\s*/g, '')
      .replace(/\{Prop:[^}]+\}\s*/g, '')
      .replace(/\{Position:[^}]+\}\s*/g, '')
      .replace(/\{SFX:[^}]+\}\s*/g, '')
      .replace(/\{Event:[^}]+\}\s*/g, '')
      .trim();
  }
}
