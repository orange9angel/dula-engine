import { InspectorBase } from './InspectorBase.js';
import fs from 'fs';
import path from 'path';

/**
 * MouthGeometryInspector — D13 嘴部几何体与动画兼容性检测
 *
 * 检测范围:
 * - 角色 mouth 是否为 null（无嘴部，无法做说话动画）
 * - 角色 mouth 几何体类型是否支持 scale 动画（TubeGeometry/ConeGeometry/SphereGeometry 等）
 * - mouthBaseScaleX/Y/Z 是否被正确设置
 * - CharacterBase.animateMouth() 的 scale 幅度是否会导致几何体变形/跑出
 *
 * 原理：不同几何体对 scale 的响应不同：
 *   - TubeGeometry: scale.y 会拉伸整条曲线，可能导致嘴唇"滑出"脸部
 *   - ConeGeometry: scale.y 会改变长度，适合下颚开合
 *   - SphereGeometry: scale 会整体变形，不太适合嘴型动画
 */
export class MouthGeometryInspector extends InspectorBase {
  constructor() {
    super('MouthGeometryInspector', 'D13');
  }

  inspect(context) {
    this.reset();
    const { episodeDir } = context;

    // 扫描角色文件，分析 mouth 几何体类型
    // 优先搜索源码目录（最新），再搜索 node_modules（可能过时）
    const searchDirs = [
      path.join(episodeDir, '..', '..', 'dula-assets', 'characters'),
      path.join(episodeDir, '..', '..', '..', 'dula-assets', 'characters'),
      path.join(episodeDir, '..', '..', 'node_modules', 'dula-assets', 'characters'),
      path.join(episodeDir, '..', '..', '..', 'node_modules', 'dula-assets', 'characters'),
    ];

    let charsDir = null;
    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        charsDir = dir;
        break;
      }
    }

    const charFiles = [];
    if (charsDir) {
      const files = fs.readdirSync(charsDir).filter((f) => f.endsWith('.js'));
      for (const f of files) {
        charFiles.push(path.join(charsDir, f));
      }
    }

    for (const charFile of charFiles) {
      this._analyzeCharacterFile(charFile);
    }

    // 也检查 CharacterBase.js 中的 animateMouth 实现
    this._checkAnimateMouthImplementation(context);
  }

  _analyzeCharacterFile(charFile) {
    const content = fs.readFileSync(charFile, 'utf-8');
    const charName = path.basename(charFile, '.js');

    // 检查是否有 mouth 定义
    const mouthMatch = content.match(/this\.mouth\s*=\s*(\w+)/);
    if (!mouthMatch) {
      this.addIssue('warning',
        `角色 ${charName} 未定义 this.mouth，说话时将无嘴部动画`,
        null,
        `在 build() 中定义 this.mouth = <嘴部几何体>，并设置 this.mouthBaseScaleX/Y/Z`,
        'BUG-MOUTH-MISSING'
      );
      return;
    }

    const mouthVar = mouthMatch[1];

    // 检查 mouth 几何体类型
    // 变量名可能是 "jaw" -> 找 "const jawGeo = new THREE.ConeGeometry" 或 "const jaw = new THREE.ConeGeometry"
    let geoMatch = content.match(new RegExp(`const\\s+${mouthVar}Geo\\s*=\\s*new\\s+THREE\\.(\\w+)`));
    if (!geoMatch) {
      geoMatch = content.match(new RegExp(`const\\s+${mouthVar}\\s*=\\s*new\\s+THREE\\.(\\w+)`));
    }
    // 也可能 mouth 直接赋值为 new THREE.SomethingGeometry()
    if (!geoMatch) {
      geoMatch = content.match(/this\.mouth\s*=\s*new\s+THREE\.(\w+)/);
    }
    const geoType = geoMatch ? geoMatch[1] : 'Unknown';

    // 检查 mouthBaseScale 是否设置
    const hasBaseScale = content.includes('this.mouthBaseScaleX') ||
                         content.includes('this.mouthBaseScaleY') ||
                         content.includes('this.mouthBaseScaleZ');

    if (!hasBaseScale) {
      this.addIssue('warning',
        `角色 ${charName} 的 mouth (${geoType}) 未设置 mouthBaseScaleX/Y/Z，animateMouth() 可能无法正确还原`,
        null,
        `添加 this.mouthBaseScaleX = 1; this.mouthBaseScaleY = 1; this.mouthBaseScaleZ = 1;`,
        'BUG-MOUTH-BASESCALE-MISSING'
      );
    }

    // 根据几何体类型给出建议
    switch (geoType) {
      case 'TubeGeometry': {
        // TubeGeometry scale 会整体变形，需要特别注意
        this.addIssue('info',
          `角色 ${charName} 使用 TubeGeometry 作为嘴部。TubeGeometry 的 scale.y 会拉伸整条曲线，可能导致嘴唇"滑出"脸部位置`,
          null,
          `建议: 1) 缩小 animateMouth() 中的 Y 轴缩放幅度（≤1.2x）; 2) 不要缩放 X/Z 轴; 3) 或改用 ShapeGeometry + ExtrudeGeometry 只做局部变形`,
          'BUG-MOUTH-TUBE-DEFORM'
        );
        break;
      }
      case 'ConeGeometry': {
        // ConeGeometry 适合做下颚开合
        this.addIssue('info',
          `角色 ${charName} 使用 ConeGeometry 作为嘴部。适合下颚开合动画，但需注意 rotation 方向`,
          null,
          `确保 ConeGeometry 的尖端朝内/朝下，scale.y 控制开合幅度建议 ≤1.3x`,
          'BUG-MOUTH-CONE-OK'
        );
        break;
      }
      case 'SphereGeometry':
      case 'BoxGeometry': {
        this.addIssue('warning',
          `角色 ${charName} 使用 ${geoType} 作为嘴部。该几何体整体缩放会产生不自然的"膨胀"效果，不像嘴型开合`,
          null,
          `建议改用 ConeGeometry（下颚）或 ShapeGeometry（自定义嘴型）`,
          'BUG-MOUTH-GEOMETRY-POOR'
        );
        break;
      }
      case 'ShapeGeometry':
      case 'ExtrudeGeometry': {
        this.addIssue('info',
          `角色 ${charName} 使用 ${geoType} 作为嘴部。适合嘴型动画，但需确保顶点数足够`,
          null,
          `ShapeGeometry 可以通过变形实现自然嘴型，建议配合 morph targets 使用`,
          'BUG-MOUTH-SHAPE-OK'
        );
        break;
      }
    }
  }

  _checkAnimateMouthImplementation(context) {
    // 检查 CharacterBase.js 中的 animateMouth 缩放参数
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

    if (!charBaseFile) {
      this.addIssue('warning',
        '无法找到 CharacterBase.js，跳过 animateMouth 实现检查',
        null,
        null,
        'BUG-MOUTH-NO-BASE'
      );
      return;
    }

    const content = fs.readFileSync(charBaseFile, 'utf-8');

    // 检查 Y 轴缩放幅度
    const yScaleMatch = content.match(/mouthBaseScaleY\s*\*\s*\(\s*[^)]+\*\s*([\d.]+)\s*\*\s*factor\s*\)/) ||
                        content.match(/\(\s*[^)]+\*\s*([\d.]+)\s*\*\s*factor\s*\)/);
    const yScaleMatch2 = content.match(/1\.0\s*\+\s*([\d.]+)\s*\*\s*factor/);

    const yAmplitude = yScaleMatch ? parseFloat(yScaleMatch[1]) : (yScaleMatch2 ? parseFloat(yScaleMatch2[1]) : null);

    if (yAmplitude !== null) {
      if (yAmplitude > 1.5) {
        this.addIssue('error',
          `CharacterBase.animateMouth() Y 轴缩放幅度过大 (${yAmplitude}x)，TubeGeometry 类型的嘴部将严重变形甚至"跑出"脸部`,
          null,
          `将 Y 轴缩放幅度降低到 ≤1.2x（建议 1.0 + 0.15*factor = 1.15x）`,
          'BUG-MOUTH-SCALE-EXTREME'
        );
      } else if (yAmplitude > 0.5) {
        this.addIssue('warning',
          `CharacterBase.animateMouth() Y 轴缩放幅度为 ${yAmplitude}x，TubeGeometry 嘴部可能出现可见变形`,
          null,
          `建议将 Y 轴缩放幅度降低到 ≤0.2x（1.0 + 0.2*factor）`,
          'BUG-MOUTH-SCALE-HIGH'
        );
      }
    }

    // 检查 X/Z 轴缩放
    const xzScaleMatch = content.match(/mouthBaseScaleX\s*\*\s*\(\s*1\.0\s*\+\s*([\d.]+)\s*\*\s*factor\s*\)/);
    if (xzScaleMatch) {
      const xzAmplitude = parseFloat(xzScaleMatch[1]);
      if (xzAmplitude > 0.1) {
        this.addIssue('warning',
          `CharacterBase.animateMouth() X/Z 轴缩放幅度为 ${xzAmplitude}x，TubeGeometry 嘴部会横向膨胀，可能导致"嘴唇掉落"`,
          null,
          `建议取消 X/Z 轴缩放（保持 this.mouth.scale.x = this.mouthBaseScaleX）`,
          'BUG-MOUTH-XZ-SCALE'
        );
      }
    }
  }
}
