import { InspectorBase } from './InspectorBase.js';

/**
 * CameraInspector — D4 运镜检查
 *
 * 检查范围:
 * - 相机参数名合法性（如 target vs characterName）
 * - 距离合理性（CloseUp 安全距离）
 * - Orbit 角度完整性
 * - targetPos 指向虚空检测
 * - 双人场景单人跟踪检测
 * - 相机参数值范围
 */
export class CameraInspector extends InspectorBase {
  constructor() {
    super('CameraInspector', 'D4');
  }

  inspect(context) {
    this.reset();
    const { entries, storyText } = context;

    // Extract all camera tags from story text
    const cameraTags = this._extractCameraTags(storyText);

    for (const tag of cameraTags) {
      this._checkCameraTag(tag, entries);
    }

    // Check multi-character scenes with single-character tracking
    this._checkMultiCharacterTracking(entries);
  }

  _extractCameraTags(storyText) {
    const tags = [];
    const lines = storyText.split('\n');
    const regex = /\{Camera:([^|]+)\|([^}]+)\}/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m;
      while ((m = regex.exec(line)) !== null) {
        const moveName = m[1].trim();
        const params = this._parseParams(m[2]);
        tags.push({ moveName, params, line: lineIdx + 1, raw: m[0] });
      }
    }
    return tags;
  }

  _parseParams(paramStr) {
    const params = {};
    const pairs = paramStr.split('|');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) {
        params[pair.trim()] = true;
        continue;
      }
      const key = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      // Try parse as number or array
      if (val.includes(',')) {
        params[key] = val.split(',').map((v) => {
          const n = parseFloat(v.trim());
          return isNaN(n) ? v.trim() : n;
        });
      } else {
        const n = parseFloat(val);
        params[key] = isNaN(n) ? val : n;
      }
    }
    return params;
  }

  _checkCameraTag(tag, entries) {
    const { moveName, params, line } = tag;

    // Parameter name validation
    const paramSchemas = {
      Static: { required: [], optional: ['position', 'lookAt'] },
      ZoomIn: { required: [], optional: ['characterName', 'targetPos', 'distance', 'duration'] },
      ZoomOut: { required: [], optional: ['targetPos', 'distance', 'duration'] },
      Pan: { required: [], optional: ['offset', 'lookAt', 'duration'] },
      Orbit: { required: [], optional: ['center', 'distance', 'radius', 'height', 'startAngle', 'endAngle', 'duration'] },
      Shake: { required: [], optional: ['intensity', 'duration'] },
      FollowCharacter: { required: ['characterName'], optional: ['offset', 'lookAtOffset', 'distance'] },
      LowAngle: { required: [], optional: ['targetPos', 'targetCharacter', 'distance', 'height'] },
      CloseUp: { required: [], optional: ['characterName', 'targetPos', 'distance', 'sideAngle'] },
      OverShoulder: { required: [], optional: ['subject', 'over', 'shooter', 'target', 'distance'] },
      TwoShot: { required: [], optional: ['characterA', 'characterB', 'left', 'right', 'distance'] },
      TrackingCloseUp: { required: ['characterName'], optional: ['distance', 'sideAngle'] },
      WhipPan: { required: [], optional: ['fromTarget', 'toTarget', 'duration'] },
      ReactionShot: { required: ['characterName'], optional: [] },
    };

    const schema = paramSchemas[moveName];
    if (!schema) {
      this.addIssue('warning', `未知运镜类型 "${moveName}"`, null, `使用已知运镜: ${Object.keys(paramSchemas).join(', ')}`);
      return;
    }

    // Check for wrong parameter names
    const knownParams = [...schema.required, ...schema.optional];
    for (const key of Object.keys(params)) {
      if (key === true) continue; // boolean flag
      if (!knownParams.includes(key)) {
        // Special case: ZoomIn uses characterName not target
        if (moveName === 'ZoomIn' && key === 'target') {
          this.addIssue('warning', `运镜 ${moveName} 参数名错误: "target" 应为 "characterName"`, null, '将 target=Xxx 改为 characterName=Xxx', 'BUG-5');
        } else {
          this.addIssue('info', `运镜 ${moveName} 有未知参数 "${key}"`, null, `已知参数: ${knownParams.join(', ')}`);
        }
      }
    }

    // Check required params
    for (const req of schema.required) {
      if (!(req in params)) {
        this.addIssue('warning', `运镜 ${moveName} 缺少必要参数 "${req}"`, null, `添加 ${req}=...`);
      }
    }

    // Distance checks for CloseUp / ZoomIn / TrackingCloseUp
    if ((moveName === 'CloseUp' || moveName === 'ZoomIn' || moveName === 'TrackingCloseUp') && 'distance' in params) {
      const dist = typeof params.distance === 'number' ? params.distance : parseFloat(params.distance);
      if (!isNaN(dist) && dist < 1.5) {
        this.addIssue('warning', `${moveName} 距离过近 (${dist}m)，可能导致相机穿模`, null, '建议 distance ≥ 1.5m', 'BUG-4');
      }
    }

    // Orbit angle completeness
    if (moveName === 'Orbit' && 'endAngle' in params) {
      const endAngle = typeof params.endAngle === 'number' ? params.endAngle : parseFloat(params.endAngle);
      if (!isNaN(endAngle) && endAngle < 6.0) {
        this.addIssue('warning', `Orbit 运镜不完整 (endAngle=${endAngle} ≈ ${(endAngle * 180 / Math.PI).toFixed(0)}°)，建议完整 360°`, null, '将 endAngle 设为 6.283 (2π)', 'BUG-5');
      }
    }

    // targetPos pointing to void
    if ('targetPos' in params) {
      const tp = params.targetPos;
      if (Array.isArray(tp)) {
        const [x, y, z] = tp;
        // Check if targetPos is far from any reasonable character position
        if (Math.abs(x) > 50 || Math.abs(y) > 50 || Math.abs(z) > 50) {
          this.addIssue('error', `相机目标位置 (${x},${y},${z}) 远离场景范围，可能指向虚空`, null, '使用 targetCharacter 或设置合理的 targetPos', 'BUG-9');
        }
      }
    }

    // LowAngle should target a character, not arbitrary coordinates
    if (moveName === 'LowAngle' && 'targetPos' in params && !('targetCharacter' in params)) {
      const tp = params.targetPos;
      if (Array.isArray(tp)) {
        const [x, y, z] = tp;
        // Check if this looks like a character position (near origin)
        const distFromOrigin = Math.sqrt(x*x + y*y + z*z);
        if (distFromOrigin > 10) {
          this.addIssue('warning', `LowAngle 使用固定坐标而非 targetCharacter，目标 (${x},${y},${z}) 可能不在角色位置`, null, '改用 targetCharacter=角色名', 'BUG-3');
        }
      }
    }
  }

  _checkMultiCharacterTracking(entries) {
    // Group entries by time window to find scenes with multiple characters
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.character) continue;

      // Find other characters in the same time window (±2s)
      const nearbyChars = new Set();
      for (let j = 0; j < entries.length; j++) {
        if (i === j) continue;
        const other = entries[j];
        if (!other.character) continue;
        const timeDiff = Math.abs((other.startTime || 0) - (entry.startTime || 0));
        if (timeDiff < 2.0 && other.scene === entry.scene) {
          nearbyChars.add(other.character);
        }
      }

      if (nearbyChars.size > 0) {
        // Check if camera is single-character tracking
        const storyText = entries.map((e) => e.rawText || '').join('\n');
        // This is a simplified check - we'd need raw text per entry
        // For now, check if the entry has FollowCharacter or TrackingCloseUp
        // and no TwoShot
        const hasSingleTracking = entry.camera && /FollowCharacter|TrackingCloseUp/.test(entry.camera);
        const hasTwoShot = entry.camera && /TwoShot/.test(entry.camera);

        if (hasSingleTracking && !hasTwoShot) {
          this.addIssue('info', `条目中有 ${nearbyChars.size + 1} 个角色，但相机只跟踪 ${entry.character}，其他角色可能出画`, entry.startTime, '考虑使用 TwoShot 或交替跟踪', 'BUG-7');
        }
      }
    }
  }
}
