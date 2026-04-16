/**
 * Simple SRT parser.
 * Supports metadata tags like:
 *   @SceneName
 *   [CharacterName] Dialogue text
 */
export class SRTParser {
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
        animation: this.extractAnimation(content),
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

  static extractAnimation(text) {
    const match = text.match(/\{(\w+)\}/);
    return match ? match[1] : null;
  }

  static extractDialogue(text) {
    return text
      .replace(/^@\w+\s*/m, '')
      .replace(/\[\w+\]\s*/, '')
      .replace(/\{\w+\}\s*/, '')
      .trim();
  }
}
