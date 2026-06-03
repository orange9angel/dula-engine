import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * SpeakingAnimationInspector — D14 说话角色嘴部动画支持检测
 *
 * 检测范围:
 * - 说话角色是否有 mouth 几何体定义
 * - mouth 几何体类型是否被 CharacterBase.animateMouth() 支持
 * - mouthBaseScaleX/Y/Z 和 mouthBaseRotationX 是否正确设置
 * - 角色在 .story 中有台词，但角色文件中无嘴部定义
 *
 * 原理：
 *   - 只有定义了 this.mouth 且设置了 baseScale/baseRotation 的角色才能做嘴部动画
 *   - CharacterBase.animateMouth() 目前支持 ConeGeometry/SphereGeometry/TubeGeometry
 *   - 新增几何体类型需要在 CharacterBase 中同步添加动画逻辑
 */
export class SpeakingAnimationInspector extends InspectorBase {
  constructor() {
    super('SpeakingAnimationInspector', 'D14');
  }

  inspect(context) {
    this.reset();
    const { entries, episodeDir } = context;

    if (!entries || entries.length === 0) {
      this.addIssue('warning', '剧本无有效条目，无法进行说话动画检测', null, '检查 script.story 格式');
      return;
    }

    // 1. 收集所有说话角色
    const speakingChars = this._collectSpeakingCharacters(entries);
    if (speakingChars.size === 0) {
      this.addIssue('info', '剧本中无角色台词，跳过嘴部动画检测');
      return;
    }
    // Debug: log found speaking characters
    // console.log('[D14] Speaking characters:', Array.from(speakingChars));

    // 2. 扫描角色文件，分析每个角色的嘴部定义
    const charMouthInfo = this._scanCharacterMouths(episodeDir, speakingChars);

    // 3. 对每个说话角色进行检查
    for (const charName of speakingChars) {
      const info = charMouthInfo.get(charName);

      if (!info) {
        // 找不到角色文件
        this.addIssue('warning',
          `说话角色 ${charName} 的角色文件未找到，无法检测嘴部动画支持`,
          null,
          `确保 ${charName}.js 存在于 characters/ 目录或 dula-assets/characters/ 中`,
          'D14-CHAR-FILE-MISSING'
        );
        continue;
      }

      if (!info.hasMouth) {
        this.addIssue('error',
          `角色 ${charName} 在剧本中有台词，但角色文件中未定义 this.mouth，说话时将无任何嘴部动画`,
          null,
          `在 ${charName}.js 的 build() 中添加嘴部几何体（如 ConeGeometry 下颚或 SphereGeometry 椭圆嘴），并赋值给 this.mouth`,
          'D14-NO-MOUTH'
        );
        continue;
      }

      if (info.hasCustomAnimateMouth) {
        continue;
      }

      // 检查几何体类型是否被支持
      // Mesh is also valid — it's often a wrapper for TubeGeometry (smile curve mouths)
      const supportedGeos = ['ConeGeometry', 'SphereGeometry', 'TubeGeometry', 'Mesh'];
      if (!supportedGeos.includes(info.geoType)) {
        this.addIssue('warning',
          `角色 ${charName} 的嘴部使用 ${info.geoType}，但 CharacterBase.animateMouth() 仅支持 ${supportedGeos.join('/')}. 嘴部动画可能异常或无效`,
          null,
          `将嘴部几何体改为 ConeGeometry（下颚开合）、SphereGeometry（椭圆嘴）或 TubeGeometry（微笑曲线），或在 CharacterBase.animateMouth() 中添加 ${info.geoType} 的支持`,
          'D14-UNSUPPORTED-GEO'
        );
      }

      // 检查 baseScale 设置
      if (info.geoType === 'ConeGeometry') {
        if (info.hasBaseRotation === false) {
          this.addIssue('warning',
            `角色 ${charName} 使用 ConeGeometry 作为嘴部（下颚），但未设置 this.mouthBaseRotationX. animateMouth() 无法正确还原闭合姿态`,
            null,
            `添加 this.mouthBaseRotationX = Math.PI（或实际初始 rotation.x），让动画知道"闭合"状态的基准角度`,
            'D14-CONE-NO-BASEROT'
          );
        }
      } else {
        // SphereGeometry / TubeGeometry 需要 baseScale
        if (!info.hasBaseScale) {
          this.addIssue('warning',
            `角色 ${charName} 使用 ${info.geoType} 作为嘴部，但未设置 mouthBaseScaleX/Y/Z. animateMouth() 无法正确还原原始尺寸`,
            null,
            `添加 this.mouthBaseScaleX = this.mouth.scale.x; this.mouthBaseScaleY = this.mouth.scale.y; this.mouthBaseScaleZ = this.mouth.scale.z;`,
            'D14-NO-BASESCALE'
          );
        }
      }

      // 检查 baseScale 值是否合理（防止默认值 1 但实际 scale 不同）
      if (info.hasBaseScale && info.baseScaleY !== null) {
        if (info.baseScaleY === 1 && info.actualScaleY !== null && Math.abs(info.actualScaleY - 1) > 0.1) {
          this.addIssue('info',
            `角色 ${charName} 的 mouthBaseScaleY = 1，但实际 mouth.scale.y ≈ ${info.actualScaleY.toFixed(2)}，两者不一致可能导致动画基准错误`,
            null,
            `将 mouthBaseScaleY 设为与实际 scale.y 相同的值: ${info.actualScaleY.toFixed(2)}`,
            'D14-SCALE-MISMATCH'
          );
        }
      }
    }

    // 4. 检查 CharacterBase.js 中是否有未覆盖的说话角色几何体类型
    this._checkCharacterBaseCoverage(context, charMouthInfo);
  }

  /**
   * 收集所有有台词的角色
   */
  _collectSpeakingCharacters(entries) {
    const chars = new Set();
    for (const entry of entries) {
      // StoryParser uses 'dialogue' for text content, not 'text'
      const text = entry.text || entry.dialogue || '';
      if (entry.character && text.trim()) {
        chars.add(entry.character);
      }
    }
    return chars;
  }

  /**
   * 扫描角色文件，提取嘴部信息
   */
  _scanCharacterMouths(episodeDir, speakingChars) {
    const result = new Map();

    const searchDirs = [
      path.join(episodeDir, 'characters'),
      path.join(episodeDir, '..', '..', 'dula-assets', 'characters'),
      path.join(episodeDir, '..', '..', '..', 'dula-assets', 'characters'),
      path.join(episodeDir, '..', '..', 'node_modules', 'dula-assets', 'characters'),
      path.join(episodeDir, '..', '..', '..', 'node_modules', 'dula-assets', 'characters'),
    ];

    for (const charName of speakingChars) {
      let charFile = null;
      let foundDir = null;

      for (const dir of searchDirs) {
        const f = path.join(dir, `${charName}.js`);
        if (fs.existsSync(f)) {
          charFile = f;
          foundDir = dir;
          break;
        }
      }

      if (!charFile) {
        result.set(charName, null);
        continue;
      }

      const content = fs.readFileSync(charFile, 'utf-8');
      const info = this._analyzeMouthInContent(content, charName);
      result.set(charName, info);
    }

    return result;
  }

  /**
   * 分析单个角色文件内容中的嘴部定义
   */
  _analyzeMouthInContent(content, charName) {
    const info = {
      charName,
      hasMouth: false,
      geoType: 'Unknown',
      hasBaseScale: false,
      hasBaseRotation: false,
      hasCustomAnimateMouth: false,
      baseScaleX: null,
      baseScaleY: null,
      baseScaleZ: null,
      actualScaleX: null,
      actualScaleY: null,
      actualScaleZ: null,
    };

    // 检查是否有 mouth 定义
    info.hasCustomAnimateMouth = /animateMouth\s*\(/.test(content);

    // Kagome and other richer characters may provide their own mouth animation.
    // In that case the base CharacterBase geometry whitelist is not authoritative.
    const mouthMatch = content.match(/this\.mouth\s*=\s*(\w+)/);
    if (!mouthMatch) {
      // 也可能直接 new THREE.SomethingGeometry()
      const directMatch = content.match(/this\.mouth\s*=\s*new\s+THREE\.(\w+)/);
      if (!directMatch) {
        return info;
      }
      info.hasMouth = true;
      info.geoType = directMatch[1];
    } else {
      info.hasMouth = true;
      const mouthVar = mouthMatch[1];

      // 找几何体类型
      let geoMatch = content.match(new RegExp(`const\\s+${mouthVar}Geo\\s*=\\s*new\\s+THREE\\.(\\w+)`));
      if (!geoMatch) {
        geoMatch = content.match(new RegExp(`const\\s+${mouthVar}\\s*=\\s*new\\s+THREE\\.(\\w+)`));
      }
      if (!geoMatch) {
        geoMatch = content.match(/this\.mouth\s*=\s*new\s+THREE\.(\w+)/);
      }
      info.geoType = geoMatch ? geoMatch[1] : 'Unknown';
    }

    // 检查 mouthBaseScaleX/Y/Z（支持数值字面量或表达式如 mouth.scale.x）
    const baseScaleXMatch = content.match(/this\.mouthBaseScaleX\s*=\s*([^;]+)/);
    const baseScaleYMatch = content.match(/this\.mouthBaseScaleY\s*=\s*([^;]+)/);
    const baseScaleZMatch = content.match(/this\.mouthBaseScaleZ\s*=\s*([^;]+)/);

    if (baseScaleXMatch || baseScaleYMatch || baseScaleZMatch) {
      info.hasBaseScale = true;
      info.baseScaleX = baseScaleXMatch ? parseFloat(baseScaleXMatch[1]) : null;
      info.baseScaleY = baseScaleYMatch ? parseFloat(baseScaleYMatch[1]) : null;
      info.baseScaleZ = baseScaleZMatch ? parseFloat(baseScaleZMatch[1]) : null;
    }

    // 检查 mouthBaseRotationX
    const baseRotMatch = content.match(/this\.mouthBaseRotationX\s*=\s*([^;]+)/);
    info.hasBaseRotation = !!baseRotMatch;

    // 尝试提取实际的 mouth.scale 值（从 build() 中）
    const scaleMatch = content.match(/this\.mouth\.scale\.set\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
    if (scaleMatch) {
      info.actualScaleX = parseFloat(scaleMatch[1]);
      info.actualScaleY = parseFloat(scaleMatch[2]);
      info.actualScaleZ = parseFloat(scaleMatch[3]);
    } else {
      // 单独赋值的情况
      const sxMatch = content.match(/this\.mouth\.scale\.x\s*=\s*([\d.]+)/);
      const syMatch = content.match(/this\.mouth\.scale\.y\s*=\s*([\d.]+)/);
      const szMatch = content.match(/this\.mouth\.scale\.z\s*=\s*([\d.]+)/);
      if (sxMatch) info.actualScaleX = parseFloat(sxMatch[1]);
      if (syMatch) info.actualScaleY = parseFloat(syMatch[1]);
      if (szMatch) info.actualScaleZ = parseFloat(szMatch[1]);
    }

    return info;
  }

  /**
   * 检查 CharacterBase.js 是否覆盖了所有已使用的嘴部几何体类型
   */
  _checkCharacterBaseCoverage(context, charMouthInfo) {
    const engineDir = path.join(context.episodeDir, '..', '..', 'dula-engine');
    const nodeModulesEngineDir = path.join(context.episodeDir, '..', '..', 'node_modules', 'dula-engine');

    const searchDirs = [
      engineDir,
      nodeModulesEngineDir,
      path.join(context.episodeDir, '..', '..', '..', 'dula-engine'),
    ];

    let charBaseFile = null;
    for (const dir of searchDirs) {
      const f = path.join(dir, 'characters', 'CharacterBase.js');
      if (fs.existsSync(f)) {
        charBaseFile = f;
        break;
      }
    }

    if (!charBaseFile) return;

    const content = fs.readFileSync(charBaseFile, 'utf-8');

    // 收集所有实际使用的几何体类型
    const usedGeos = new Set();
    for (const info of charMouthInfo.values()) {
      if (info && info.hasMouth && info.geoType !== 'Unknown') {
        if (info.hasCustomAnimateMouth) continue;
        usedGeos.add(info.geoType);
      }
    }

    // 检查 CharacterBase 中是否有对应的 case（支持单引号、双引号、=== 比较或注释提及）
    for (const geoType of usedGeos) {
      const hasCase = content.includes(`'${geoType}'`) ||
                      content.includes(`"${geoType}"`) ||
                      content.includes(`=== '${geoType}'`) ||
                      content.includes(`=== "${geoType}"`) ||
                      content.includes(`== '${geoType}'`) ||
                      content.includes(`== "${geoType}"`) ||
                      content.includes(`// ${geoType}`) ||
                      content.includes(`/* ${geoType}`);
      if (!hasCase) {
        this.addIssue('error',
          `CharacterBase.animateMouth() 未处理 ${geoType} 类型的嘴部，但剧本中有角色使用此几何体。嘴部动画将回退到默认行为，可能产生异常变形`,
          null,
          `在 CharacterBase.animateMouth() 的 switch 中添加 case '${geoType}': 并编写对应的动画逻辑`,
          'D14-BASE-MISSING-CASE'
        );
      }
    }
  }
}
