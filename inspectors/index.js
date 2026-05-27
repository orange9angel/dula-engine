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
export { StoryQualityInspector } from './StoryQualityInspector.js';
export { EffectInspector } from './EffectInspector.js';
export { AudioBalanceInspector } from './AudioBalanceInspector.js';
export { LipSyncInspector } from './LipSyncInspector.js';
export { CameraSubjectInspector } from './CameraSubjectInspector.js';
export { TransitionInspector } from './TransitionInspector.js';
export { MusicFitInspector } from './MusicFitInspector.js';
export { MouthGeometryInspector } from './MouthGeometryInspector.js';
export { SpeakingAnimationInspector } from './SpeakingAnimationInspector.js';
export { NarrativeLogicInspector } from './NarrativeLogicInspector.js';
export { AnimationCompatibilityInspector } from './AnimationCompatibilityInspector.js';
export { CombatTraceInspector } from './CombatTraceInspector.js';
export { TimelineTraceInspector } from './TimelineTraceInspector.js';
export { StoryTrajectoryInspector } from './StoryTrajectoryInspector.js';
export { ActionMatrixInspector } from './ActionMatrixInspector.js';

// Import locally for getAllInspectors to avoid TDZ
import { SceneInspector as _SceneInspector } from './SceneInspector.js';
import { CharacterInspector as _CharacterInspector } from './CharacterInspector.js';
import { AnimationInspector as _AnimationInspector } from './AnimationInspector.js';
import { CameraInspector as _CameraInspector } from './CameraInspector.js';
import { AudioInspector as _AudioInspector } from './AudioInspector.js';
import { NarrativeInspector as _NarrativeInspector } from './NarrativeInspector.js';
import { VisualInspector as _VisualInspector } from './VisualInspector.js';
import { StoryQualityInspector as _StoryQualityInspector } from './StoryQualityInspector.js';
import { EffectInspector as _EffectInspector } from './EffectInspector.js';
import { AudioBalanceInspector as _AudioBalanceInspector } from './AudioBalanceInspector.js';
import { LipSyncInspector as _LipSyncInspector } from './LipSyncInspector.js';
import { CameraSubjectInspector as _CameraSubjectInspector } from './CameraSubjectInspector.js';
import { TransitionInspector as _TransitionInspector } from './TransitionInspector.js';
import { MusicFitInspector as _MusicFitInspector } from './MusicFitInspector.js';
import { MouthGeometryInspector as _MouthGeometryInspector } from './MouthGeometryInspector.js';
import { SpeakingAnimationInspector as _SpeakingAnimationInspector } from './SpeakingAnimationInspector.js';
import { NarrativeLogicInspector as _NarrativeLogicInspector } from './NarrativeLogicInspector.js';
import { AnimationCompatibilityInspector as _AnimationCompatibilityInspector } from './AnimationCompatibilityInspector.js';
import { CombatTraceInspector as _CombatTraceInspector } from './CombatTraceInspector.js';
import { TimelineTraceInspector as _TimelineTraceInspector } from './TimelineTraceInspector.js';
import { StoryTrajectoryInspector as _StoryTrajectoryInspector } from './StoryTrajectoryInspector.js';
import { ActionMatrixInspector as _ActionMatrixInspector } from './ActionMatrixInspector.js';

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
    new _StoryQualityInspector(),
    new _EffectInspector(),
    new _AudioBalanceInspector(),
    new _LipSyncInspector(),
    new _CameraSubjectInspector(),
    new _TransitionInspector(),
    new _MusicFitInspector(),
    new _MouthGeometryInspector(),
    new _SpeakingAnimationInspector(),
    new _NarrativeLogicInspector(),
    new _AnimationCompatibilityInspector(),
    new _CombatTraceInspector(),
    new _TimelineTraceInspector(),
    new _StoryTrajectoryInspector(),
    new _ActionMatrixInspector(),
  ];
}
