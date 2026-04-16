export class VoiceBase {
  constructor(config) {
    this.name = config.name;
    this.voice = config.voice || 'zh-CN-XiaoxiaoNeural';
    this.rate = config.rate || '+0%';
    this.pitch = config.pitch || '+0Hz';
    this.volume = config.volume || '+0%';
  }

  toEdgeTTSArgs(text, outputPath) {
    return [
      'edge-tts',
      '--voice', this.voice,
      '--rate', this.rate,
      '--pitch', this.pitch,
      '--volume', this.volume,
      '--text', text,
      '--write-media', outputPath,
    ];
  }

  toJSON() {
    return {
      name: this.name,
      voice: this.voice,
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume,
    };
  }
}
