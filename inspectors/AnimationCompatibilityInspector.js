import { InspectorBase } from './InspectorBase.js';

/**
 * AnimationCompatibilityInspector — 动画兼容性检查器
 * Checks whether characters in a story are compatible with their assigned animations.
 * Flags mismatches like "Doraemon cannot use Punch" or "Yokai missing legs for Kick".
 */
export class AnimationCompatibilityInspector extends InspectorBase {
  constructor() {
    super('AnimationCompatibility');
  }

  inspect(storyboard) {
    const issues = [];
    const { entries, characters } = storyboard;

    if (!entries || !characters) {
      return [{ level: 'warn', message: 'Storyboard missing entries or characters' }];
    }

    for (const entry of entries) {
      if (!entry.animations || entry.animations.length === 0) continue;
      if (!entry.character) continue;

      const char = characters[entry.character];
      if (!char) {
        issues.push({
          level: 'warn',
          message: `Character "${entry.character}" not found in scene`,
          entry,
        });
        continue;
      }

      for (const animName of entry.animations) {
        const AnimClass = storyboard.animationRegistry?.[animName];
        if (!AnimClass) {
          // Unknown animation — let other inspectors handle this
          continue;
        }

        // Instantiate to check tags
        let anim;
        try {
          anim = new AnimClass();
        } catch (e) {
          issues.push({
            level: 'error',
            message: `Failed to instantiate animation "${animName}": ${e.message}`,
            entry,
          });
          continue;
        }

        // Run compatibility check
        if (typeof anim.checkCompatibility === 'function') {
          const result = anim.checkCompatibility(char);
          if (!result.compatible) {
            issues.push({
              level: 'warn',
              message: `[${entry.character}] cannot use {${animName}}: ${result.reason}`,
              entry,
              character: entry.character,
              animation: animName,
              reason: result.reason,
            });
          }
        }

        // Additional archetype check
        if (anim.tags && char.archetypes) {
          const notSuits = anim.tags.notSuits || [];
          for (const tag of notSuits) {
            if (char.archetypes.includes(tag)) {
              issues.push({
                level: 'warn',
                message: `[${entry.character}] archetype "${tag}" is not suited for {${animName}}`,
                entry,
                character: entry.character,
                animation: animName,
                archetype: tag,
              });
            }
          }
        }
      }
    }

    return issues;
  }
}
