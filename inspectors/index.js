/**
 * Dula Quality Inspectors
 *
 * 所有检查器导出，用于闭环质检团队
 */

export { InspectorBase, InspectionContext } from './InspectorBase.js';
export { SceneInspector } from './SceneInspector.js';
export { CharacterInspector } from './CharacterInspector.js';
export { AnimationInspector } from './AnimationInspector.js';
export { CameraInspector } from './CameraInspector.js';
export { AudioInspector } from './AudioInspector.js';
export { NarrativeInspector } from './NarrativeInspector.js';
export { VisualInspector } from './VisualInspector.js';

// Import locally for getAllInspectors to avoid TDZ
import { SceneInspector as _SceneInspector } from './SceneInspector.js';
import { CharacterInspector as _CharacterInspector } from './CharacterInspector.js';
import { AnimationInspector as _AnimationInspector } from './AnimationInspector.js';
import { CameraInspector as _CameraInspector } from './CameraInspector.js';
import { AudioInspector as _AudioInspector } from './AudioInspector.js';
import { NarrativeInspector as _NarrativeInspector } from './NarrativeInspector.js';
import { VisualInspector as _VisualInspector } from './VisualInspector.js';

/**
 * 获取所有 inspector 实例
 * @returns {InspectorBase[]}
 */
export function getAllInspectors() {
  return [
    new _SceneInspector(),
    new _CharacterInspector(),
    new _AnimationInspector(),
    new _CameraInspector(),
    new _AudioInspector(),
    new _NarrativeInspector(),
    new _VisualInspector(),
  ];
}
