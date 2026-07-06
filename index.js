/**
 * Dula Engine - Public API
 */

// Core systems
export { Storyboard } from './storyboard/Storyboard.js';
export { StoryParser } from './lib/StoryParser.js';
export { MusicDirector, MusicCue } from './lib/MusicDirector.js';

// Math utilities
export * as MathUtils from './lib/MathUtils.js';

// Character system
export { CharacterBase, CharacterRegistry, registerCharacter } from './characters/index.js';

// Animation system
export { AnimationBase, AnimationRegistry, registerAnimation } from './animations/index.js';
export { PoseMatrix, ActionMatrixController, ActionPhase, PoseType, getPoseType, getDefaultPhase } from './animations/index.js';

// Scene system
export { SceneBase, SceneRegistry, registerScene } from './scenes/index.js';

// Camera system
export { CameraMoveBase, CameraMoveRegistry, registerCameraMove } from './camera/index.js';
export { CameraCollisionGuard } from './camera/CameraCollisionGuard.js';

// Voice system
export { VoiceBase, VoiceRegistry, registerVoice } from './voices/index.js';

// Director registry (for CourtDirector and other domain directors)
export { DirectorRegistry, registerDirector } from './lib/DirectorRegistry.js';

// Combat action component registry
export {
  CombatActionRegistry,
  registerCombatAction,
  getCombatAction,
  expandCombatAction,
  listCombatActions,
} from './lib/CombatActionRegistry.js';

// Projectile system
export { ProjectileBase } from './lib/ProjectileBase.js';
export { ProjectileSystem } from './lib/ProjectileSystem.js';

// Transition system
export { TransitionBase, TransitionRegistry, registerTransition } from './transitions/index.js';

// Post-processing system
export { PostProcessBase, PostProcessRegistry, registerPostProcess } from './postprocessing/index.js';

// Constraint system
export { JointConstraintSystem } from './constraints/JointConstraintSystem.js';
export { BodyCollisionGuard } from './constraints/BodyCollisionGuard.js';
export { VelocitySmoother } from './constraints/VelocitySmoother.js';
export { selectLimitPreset, clampAngle, clampJointRotation, HUMANOID_STANDARD, HUMANOID_ATHLETIC, ALIEN_FLEXIBLE } from './constraints/JointLimits.js';

// Reusable light effect components
export { GlowEffect, AuraEffect } from './effects/index.js';
