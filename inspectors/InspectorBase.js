/**
 * InspectorBase — 质量检查器基类
 *
 * 子类需实现:
 *   inspect(context) -> void
 *
 * Issue 分级:
 *   error   → 必须修复，否则渲染失败或质量严重受损
 *   warning → 建议修复，可能影响观感
 *   info    → 提示信息，供参考
 *
 * 严重级别定义（与团队 Sprint 规范一致）:
 *   P0 → 阻塞性，无法运行/核心功能缺失
 *   P1 → 严重影响体验/质量
 *   P2 → 体验瑕疵/代码异味
 *   P3 → 建议/优化点
 */
export class InspectorBase {
  constructor(name, dimension = null) {
    this.name = name;
    this.dimension = dimension; // e.g., 'D1', 'D2', ..., 'D7'
    this.issues = [];
  }

  reset() {
    this.issues = [];
  }

  /**
   * Add an issue with severity mapping to P-level
   * @param {string} severity - 'error' | 'warning' | 'info'
   * @param {string} message
   * @param {number|null} time - timestamp in seconds
   * @param {string|null} fix - suggested fix
   * @param {string} code - bug code like 'BUG-1', 'P0-1'
   */
  addIssue(severity, message, time = null, fix = null, code = null) {
    const pLevel = this._severityToPLevel(severity);
    this.issues.push({ severity, pLevel, message, time, fix, code, inspector: this.name, dimension: this.dimension });
  }

  _severityToPLevel(severity) {
    switch (severity) {
      case 'error': return 'P0';
      case 'warning': return 'P1';
      case 'info': return 'P2';
      default: return 'P3';
    }
  }

  getReport() {
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');
    const infos = this.issues.filter((i) => i.severity === 'info');

    return {
      inspector: this.name,
      dimension: this.dimension,
      summary: {
        total: this.issues.length,
        errors: errors.length,
        warnings: warnings.length,
        infos: infos.length,
      },
      issues: this.issues,
    };
  }

  /**
   * Main inspection entry point. Subclasses must override.
   * @param {InspectionContext} context
   */
  inspect(context) {
    throw new Error(`Inspector ${this.name} must implement inspect(context)`);
  }
}

/**
 * InspectionContext — 共享的检查上下文
 * 包含解析后的剧本、配置、文件路径等
 */
export class InspectionContext {
  constructor(episodeDir, entries, storyText, storyPath) {
    this.episodeDir = episodeDir;
    this.entries = entries;
    this.storyText = storyText;
    this.storyPath = storyPath;
    this.audioDir = path.join(episodeDir, 'assets', 'audio');
    this.outputDir = path.join(episodeDir, 'output');
    this.configDir = path.join(episodeDir, 'config');
    this.storyboardDir = path.join(episodeDir, 'storyboard');

    // Cached data
    this._bootstrapText = null;
    this._transitions = null;
    this._voiceConfig = null;
    this._choreography = null;
    this._manifest = null;
    this._registeredChars = null;
    this._registeredScenes = null;
    this._registeredAnims = null;
  }

  get bootstrapPath() {
    return path.join(this.episodeDir, 'bootstrap.js');
  }

  get bootstrapText() {
    if (!this._bootstrapText && fs.existsSync(this.bootstrapPath)) {
      this._bootstrapText = fs.readFileSync(this.bootstrapPath, 'utf-8');
    }
    return this._bootstrapText || '';
  }

  get transitions() {
    if (!this._transitions) {
      const p = path.join(this.configDir, 'transitions.json');
      this._transitions = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    }
    return this._transitions;
  }

  get voiceConfig() {
    if (!this._voiceConfig) {
      const p = path.join(this.configDir, 'voice_config.json');
      this._voiceConfig = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    }
    return this._voiceConfig;
  }

  get choreography() {
    if (!this._choreography) {
      const p = path.join(this.configDir, 'choreography.json');
      this._choreography = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    }
    return this._choreography;
  }

  get manifest() {
    if (!this._manifest) {
      const p = path.join(this.audioDir, 'manifest.json');
      this._manifest = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
    }
    return this._manifest;
  }

  get registeredChars() {
    if (!this._registeredChars) {
      this._registeredChars = this._extractRegistry('Character');
    }
    return this._registeredChars;
  }

  get registeredScenes() {
    if (!this._registeredScenes) {
      this._registeredScenes = this._extractRegistry('Scene');
    }
    return this._registeredScenes;
  }

  get registeredAnims() {
    if (!this._registeredAnims) {
      this._registeredAnims = this._extractRegistry('Animation');
    }
    return this._registeredAnims;
  }

  _extractRegistry(type) {
    const set = new Set();
    // Check bootstrap.js for registerAll() call (imports from dula-assets)
    if (this.bootstrapText.includes('registerAll')) {
      // dula-assets registers all official assets
      // We can't statically know them all, so we check against known lists
      // and also scan for explicit register calls
    }
    // Extract explicit register calls
    const regex = new RegExp(`register${type}\\(['"\`]([^'"\`]+)['"\`]`, 'g');
    let m;
    while ((m = regex.exec(this.bootstrapText)) !== null) {
      set.add(m[1]);
    }
    return set;
  }

  get totalDuration() {
    if (this.entries.length === 0) return 0;
    return Math.max(...this.entries.map((e) => e.endTime || e.startTime));
  }
}

import path from 'path';
import fs from 'fs';
