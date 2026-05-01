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

    // Check for camera pointing at back of character's head
    this._checkBackOfHead(entries, storyText);
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

  /**
   * Check if camera is pointing at the back of character's head.
   *
   * Geometric approach: compute the angle between character's facing direction
   * and the vector from character to camera. If angle > 90°, camera is behind.
   *
   * This is a static analysis — we compute camera position from the camera move
   * parameters and character position/face from Position tags.
   */
  _checkBackOfHead(entries, storyText) {
    // Build a scene state tracker: for each entry, track the current active scene
    // and character positions that have been set up to that point.
    const sceneStates = this._buildSceneStates(entries);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Support both StoryParser format (cameraMove) and inspect-team format (camera)
      let moveName, params;
      if (entry.cameraMove && typeof entry.cameraMove === 'object') {
        moveName = entry.cameraMove.name;
        params = entry.cameraMove.options || {};
      } else if (entry.camera && typeof entry.camera === 'string') {
        moveName = entry.camera;
        // Parse camera params from the raw text for inspect-team format
        params = this._extractCameraParamsFromEntry(entry);
      } else {
        continue;
      }

      if (!entry.character) continue;

      // Get the current scene state at this entry's time
      const stateAtEntry = sceneStates[i];
      if (!stateAtEntry || !stateAtEntry.scene) continue;

      // Get the speaking character's position and facing direction
      const charState = this._getCharacterStateFromScene(stateAtEntry, entry.character);
      if (!charState) continue;

      // Compute camera position based on camera move type
      const camPos = this._computeCameraPosition(moveName, params, charState, stateAtEntry);
      if (!camPos) continue;

      // Compute vector from character to camera
      const toCamera = { x: camPos.x - charState.x, z: camPos.z - charState.z };
      const toCameraLen = Math.sqrt(toCamera.x * toCamera.x + toCamera.z * toCamera.z);
      if (toCameraLen < 0.001) continue;

      // Normalize
      toCamera.x /= toCameraLen;
      toCamera.z /= toCameraLen;

      // Character facing direction (already normalized in _getCharacterStateFromScene)
      const faceDir = charState.faceDir;

      // Dot product: positive = camera in front of character (angle < 90°)
      //              negative = camera behind character (angle > 90°)
      const dot = faceDir.x * toCamera.x + faceDir.z * toCamera.z;

      if (dot < -0.1) {
        // Camera is clearly behind the character (> 95°)
        this.addIssue('warning',
          `条目 ${entry.index}: ${moveName} 运镜下相机位于角色 ${entry.character} 身后（夹角约 ${Math.acos(Math.abs(dot)) * 180 / Math.PI | 0}°），观众将看到后脑勺而非面部表情`,
          entry.startTime,
          this._suggestFixForBackOfHead(moveName, params, entry.character),
          'BUG-CAM-BACK-OF-HEAD'
        );
      } else if (dot < 0.2) {
        // Camera is at side/back (80°-95°), might catch profile or partial back
        this.addIssue('info',
          `条目 ${entry.index}: ${moveName} 运镜下相机位于角色 ${entry.character} 侧后方（夹角约 ${Math.acos(Math.abs(dot)) * 180 / Math.PI | 0}°），可能以侧面/后脑勺为主`,
          entry.startTime,
          this._suggestFixForBackOfHead(moveName, params, entry.character),
          'BUG-CAM-SIDE-BACK'
        );
      }
    }
  }

  /**
   * Extract camera parameters from entry raw text for inspect-team format.
   */
  _extractCameraParamsFromEntry(entry) {
    const params = {};
    const rawText = entry.rawText || '';
    const camMatch = rawText.match(/\{Camera:([^}]+)\}/);
    if (!camMatch) return params;

    const inner = camMatch[1];
    const parts = inner.split('|').map((s) => s.trim());
    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx === -1) {
        params[parts[i]] = true;
        continue;
      }
      const key = parts[i].slice(0, eqIdx).trim();
      const val = parts[i].slice(eqIdx + 1).trim();
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

  /**
   * Build scene state tracker for each entry index.
   * Returns array where each element is { scene, positions: { charName: {x, z, face} } }
   * representing the active scene and character positions at that point in time.
   */
  _buildSceneStates(entries) {
    const states = [];
    let currentScene = null;
    let currentPositions = {}; // charName -> {x, z, face}

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // If this entry has a scene switch, update current scene
      // Only clear positions when the scene actually changes (not on every entry that has scene field)
      if (entry.scene && entry.scene !== currentScene) {
        currentScene = entry.scene;
        // New scene: clear positions (they will be set by Position tags in this or later entries)
        currentPositions = {};
      }

      // If this entry has Position tags, update character positions
      // Support both StoryParser format (positions) and inspect-team format (positionOps)
      const posList = entry.positions || entry.positionOps;
      if (posList && posList.length > 0) {
        for (const pos of posList) {
          const charName = pos.name || pos.character;
          if (charName) {
            const options = pos.options || {};
            currentPositions[charName] = {
              x: options.x ?? 0,
              z: options.z ?? 0,
              y: options.y ?? 0,
              face: options.face ?? 'forward',
            };
          }
        }
      }

      states.push({
        scene: currentScene,
        positions: { ...currentPositions },
      });
    }

    return states;
  }

  /**
   * Get character's position and facing direction from scene state.
   * Returns { x, z, faceDir: {x, z} } or null.
   */
  _getCharacterStateFromScene(sceneState, characterName) {
    const pos = sceneState.positions[characterName];
    if (!pos) return null;

    const x = pos.x;
    const z = pos.z;
    const face = pos.face;

    let faceDir;
    if (face === 'forward') {
      faceDir = { x: 0, z: 1 };
    } else if (face === 'center') {
      faceDir = { x: -x, z: -z };
      const len = Math.sqrt(faceDir.x * faceDir.x + faceDir.z * faceDir.z);
      if (len > 0.001) {
        faceDir.x /= len;
        faceDir.z /= len;
      } else {
        faceDir = { x: 0, z: 1 };
      }
    } else if (face === 'back') {
      faceDir = { x: 0, z: -1 };
    } else if (face === 'left') {
      faceDir = { x: -1, z: 0 };
    } else if (face === 'right') {
      faceDir = { x: 1, z: 0 };
    } else if (face && typeof face === 'string') {
      // face=AnotherCharacter — compute direction toward that character
      const targetPos = sceneState.positions[face];
      if (targetPos) {
        faceDir = { x: targetPos.x - x, z: targetPos.z - z };
        const len = Math.sqrt(faceDir.x * faceDir.x + faceDir.z * faceDir.z);
        if (len > 0.001) {
          faceDir.x /= len;
          faceDir.z /= len;
        } else {
          faceDir = { x: 0, z: 1 };
        }
      } else {
        faceDir = { x: 0, z: 1 };
      }
    } else {
      // Default: face forward (+Z)
      faceDir = { x: 0, z: 1 };
    }

    return { x, z, faceDir };
  }

  /**
   * Compute camera position based on camera move type and parameters.
   * Simplified geometric model matching the runtime camera implementations.
   */
  _computeCameraPosition(moveName, params, charState, sceneState) {
    const cx = charState.x;
    const cz = charState.z;

    switch (moveName) {
      case 'CloseUp':
      case 'TrackingCloseUp': {
        // Runtime CloseUp places camera at: lookAtPos + camDir * distance
        // where camDir is computed from character's actual facing direction (mesh.quaternion)
        // Camera is IN FRONT of the character to see the face.
        const distance = params.distance ?? 1.8;
        const sideAngleDeg = params.sideAngle ?? 0;
        const sideAngle = sideAngleDeg * Math.PI / 180;

        // Character facing direction (where the face points)
        const fx = charState.faceDir.x;
        const fz = charState.faceDir.z;

        // Side vector (perpendicular to facing, pointing right)
        // cross(forward, up) where up=(0,1,0)
        const sx = -fz;
        const sz = fx;

        // camDir = forward * cos(sideAngle) + side * sin(sideAngle)
        const camDirX = fx * Math.cos(sideAngle) + sx * Math.sin(sideAngle);
        const camDirZ = fz * Math.cos(sideAngle) + sz * Math.sin(sideAngle);

        // Camera is in front of character (along camDir)
        return {
          x: cx + camDirX * distance,
          z: cz + camDirZ * distance,
        };
      }

      case 'OverShoulder': {
        // Camera is behind 'shooter', looking at 'target'
        const shooter = params.shooter;
        const target = params.target ?? params.subject;
        const distance = params.distance ?? 2.5;

        if (!shooter) return null;

        const shooterState = this._getCharacterStateFromScene(sceneState, shooter);
        if (!shooterState) return null;

        // If shooter is the speaking character, camera is behind them
        // If target is the speaking character, camera is in front of them (good)
        if (target) {
          const targetState = this._getCharacterStateFromScene(sceneState, target);
          if (targetState) {
            // Direction from shooter to target
            const dx = targetState.x - shooterState.x;
            const dz = targetState.z - shooterState.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.001) {
              // Camera is behind shooter, looking toward target
              return {
                x: shooterState.x - (dx / len) * distance,
                z: shooterState.z - (dz / len) * distance,
              };
            }
          }
        }

        // Fallback: camera behind shooter
        return {
          x: shooterState.x - shooterState.faceDir.x * distance,
          z: shooterState.z - shooterState.faceDir.z * distance,
        };
      }

      case 'FollowCharacter': {
        const offset = params.offset;
        if (Array.isArray(offset) && offset.length >= 3) {
          // offset is relative to character's local space
          // offset[0]=right, offset[1]=up, offset[2]=forward
          const right = offset[0];
          const up = offset[1]; // not used for XZ
          const forward = offset[2];

          const fx = charState.faceDir.x;
          const fz = charState.faceDir.z;
          const sx = fz;
          const sz = -fx;

          return {
            x: cx + fx * forward + sx * right,
            z: cz + fz * forward + sz * right,
          };
        }
        return null;
      }

      case 'TwoShot': {
        // Camera is perpendicular to the line between two characters
        // We need to determine which character is speaking and where camera is
        const left = params.left;
        const right = params.right;
        const characterA = params.characterA ?? left;
        const characterB = params.characterB ?? right;
        const distance = params.distance ?? 5.0;

        if (!characterA || !characterB) return null;

        const stateA = this._getCharacterStateFromScene(sceneState, characterA);
        const stateB = this._getCharacterStateFromScene(sceneState, characterB);
        if (!stateA || !stateB) return null;

        const midX = (stateA.x + stateB.x) / 2;
        const midZ = (stateA.z + stateB.z) / 2;
        const lineX = stateB.x - stateA.x;
        const lineZ = stateB.z - stateA.z;

        // Perpendicular direction
        const perpX = -lineZ;
        const perpZ = lineX;
        const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
        if (perpLen < 0.001) return null;

        return {
          x: midX + (perpX / perpLen) * distance,
          z: midZ + (perpZ / perpLen) * distance,
        };
      }

      case 'Static': {
        const position = params.position;
        if (Array.isArray(position) && position.length >= 3) {
          return { x: position[0], z: position[2] };
        }
        return null;
      }

      case 'ZoomIn':
      case 'ZoomOut': {
        // ZoomIn/ZoomOut are dolly zooms: camera moves toward/away from targetPos.
        // targetPos is what the camera LOOKS AT, not where the camera is.
        // The actual camera position depends on the starting position (unknown at static analysis time).
        // Since we can't determine the camera direction without knowing the start position,
        // skip back-of-head detection for ZoomIn/ZoomOut with targetPos.
        if (params.targetPos && Array.isArray(params.targetPos)) {
          return null; // Cannot reliably determine camera position
        }
        // If targeting a character directly (no targetPos), compute like CloseUp
        if (params.characterName) {
          const targetState = this._getCharacterStateFromScene(sceneState, params.characterName);
          if (targetState) {
            const distance = params.distance ?? 3;
            return {
              x: targetState.x + targetState.faceDir.x * distance,
              z: targetState.z + targetState.faceDir.z * distance,
            };
          }
        }
        return null;
      }

      case 'Orbit': {
        // Orbit around center point — camera moves along an arc.
        // If the orbit covers > 180°, the camera will see the character from multiple angles
        // including the front, so we only flag if the orbit range is small (< 180°).
        const center = params.center;
        const startAngle = params.startAngle ?? 0;
        const endAngle = params.endAngle ?? Math.PI / 2;
        const orbitRange = Math.abs(endAngle - startAngle);

        // If orbit covers more than 180°, camera will see front at some point — skip
        if (orbitRange >= Math.PI - 0.1) {
          return null;
        }

        if (Array.isArray(center) && center.length >= 3) {
          const radius = params.radius ?? 5;
          // Camera at startAngle position
          return {
            x: center[0] + Math.cos(startAngle) * radius,
            z: center[2] + Math.sin(startAngle) * radius,
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Generate a fix suggestion based on camera type.
   */
  _suggestFixForBackOfHead(moveName, params, characterName) {
    switch (moveName) {
      case 'CloseUp':
      case 'TrackingCloseUp': {
        const sideAngle = params.sideAngle ?? 0;
        if (Math.abs(sideAngle) < 15) {
          return `添加 sideAngle=30（或 -30）让相机从侧面拍摄 ${characterName}，确保面部可见`;
        }
        return `sideAngle=${sideAngle} 仍可能拍到后脑勺，尝试 sideAngle=45 或改用 TwoShot`;
      }
      case 'OverShoulder': {
        const shooter = params.shooter;
        const target = params.target ?? params.subject;
        if (shooter === characterName) {
          return `OverShoulder 中 shooter=${shooter} 是说话角色，将 shooter 改为 ${target || '另一个角色'}，让相机从 ${characterName} 正面拍摄`;
        }
        return `检查 shooter=${shooter} 和 target=${target} 的位置关系，确保相机在 ${characterName} 正面`;
      }
      case 'FollowCharacter': {
        const offset = params.offset;
        if (Array.isArray(offset)) {
          return `FollowCharacter offset=[${offset.join(',')}] 中 Z=${offset[2]} 为正值（角色身后），改为负值如 [${offset[0]},${offset[1]},${-Math.abs(offset[2])}]`;
        }
        return `调整 FollowCharacter offset，确保相机在角色前方（offset Z 为负值）`;
      }
      case 'TwoShot': {
        return `TwoShot 中相机位于两角色侧面，${characterName} 可能侧对镜头。如需要面部特写，单独加一条 CloseUp|characterName=${characterName}|sideAngle=30`;
      }
      default:
        return `检查 {Position:${characterName}|face=...} 方向，确保角色面朝相机；或调整 ${moveName} 参数`;
    }
  }
}
