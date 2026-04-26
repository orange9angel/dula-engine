/**
 * InspectorBase — 质量检查器基类
 *
 * 子类需实现:
 *   async inspect(storyboard, entries, manifest, context)
 *
 * Issue 分级:
 *   error   → 必须修复，否则渲染失败或质量严重受损
 *   warning → 建议修复，可能影响观感
 *   info    → 提示信息，供参考
 */
export class InspectorBase {
  constructor(name) {
    this.name = name;
    this.issues = [];
  }

  reset() {
    this.issues = [];
  }

  addIssue(severity, message, time = null, fix = null) {
    this.issues.push({ severity, message, time, fix });
  }

  getReport() {
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');
    const infos = this.issues.filter((i) => i.severity === 'info');

    return {
      inspector: this.name,
      summary: {
        total: this.issues.length,
        errors: errors.length,
        warnings: warnings.length,
        infos: infos.length,
      },
      issues: this.issues,
    };
  }
}
