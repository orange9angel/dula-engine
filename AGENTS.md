# Dula Engine — 开发规范与上下文

> 本文档供 AI 开发代理阅读。引擎与内容分离：本仓库只包含渲染/音频执行代码，**剧本、配置、素材、输出**全部存放在内容仓库（`dula-story`）的 Episode 目录中。

---

## 1. 项目概述

基于 Web (Three.js) + Puppeteer 离线渲染的动画短片生成器。

**架构原则**：引擎 = 执行算法，内容 = 声明数据。剧情决策不进代码，技术算法不进剧本。

- **输入**：内容仓库中的 Episode 目录（`script.story` + JSON 配置 + 音频素材）
- **输出**：`output.mp4`（1920×1080@30fps，H.264/AAC）

---

## 2. 技术栈与环境

| 工具 | 版本/说明 |
|------|-----------|
| Node.js | v24.14.0 |
| npm | 11.9.0 |
| ffmpeg | 8.0.1-full_build |
| Python | 3.x（edge-tts） |
| Node 依赖 | `puppeteer`, `three` (ES Module, via CDN unpkg@0.160.0) |
| Python 依赖 | `edge-tts` |
| 帧率 | **固定 30 fps** |
| 输出分辨率 | 1920×1080 |

### 关键文件
- `render.html` + `render.js`：浏览器端 Three.js 渲染入口。
- `generate_video.js`：Node 端主渲染管线（Puppeteer → PNG → ffmpeg）。
- `tools/generate_audio.py`：TTS + BGM + SFX 混音，生成 `mixed.wav` + `manifest.json`。
- `tools/verify_shots.js`：逐镜头验证（截图检查，不生成完整视频）。
- `lib/StoryParser.js`：`.story` 剧本解析器（支持命名空间标签）。
- `storyboard/Storyboard.js`：导演核心（场景/角色/动画/运镜/音乐/球事件调度）。

---

## 3. 目录结构（引擎侧）

```
dula-engine/
├── generate_video.js          # 主渲染管线
├── render.html                # 浏览器渲染页面
├── render.js                  # 浏览器端帧循环
├── package.json
├── lib/
│   ├── StoryParser.js         # .story 解析器（命名空间标签路由）
│   ├── CourtDirector.js       # 场地-角色-球-相机协调计算层
│   └── MusicDirector.js       # 配乐调度器（Cue/Duck/HitPoint/Stem）
├── scenes/
│   ├── index.js               # SceneRegistry
│   ├── SceneBase.js           # 场景基类
│   ├── RoomScene.js           # 室内场景
│   └── ParkScene.js           # 公园场景（网球场/球/球拍）
├── characters/
│   ├── index.js               # CharacterRegistry
│   ├── CharacterBase.js       # 角色基类
│   ├── Doraemon.js
│   ├── Nobita.js
│   └── Shizuka.js
├── animations/
│   ├── AnimationBase.js
│   ├── index.js               # AnimationRegistry
│   ├── common/                # 通用动画
│   ├── doraemon/              # 哆啦A梦专属
│   └── nobita/                # 大雄专属
│   └── shizuka/               # 静香专属
├── camera/
│   ├── CameraMoveBase.js
│   ├── index.js               # CameraMoveRegistry
│   └── common/                # 通用运镜
├── storyboard/
│   └── Storyboard.js          # 导演核心
├── voices/
│   └── index.js               # VoiceRegistry（预留）
└── tools/
    ├── generate_audio.py      # 音频管线
    ├── generate_bgm.py        # 程序化 BGM 合成器（备用）
    ├── adjust_srt.py          # 时间轴自动调整（备用）
    ├── verify_shots.js        # 逐镜头验证
    ├── verify.html            # 验证用浏览器入口
    └── verify_render.js       # 验证用渲染逻辑
```

---

## 4. Episode 目录协议（输入约定）

引擎通过 CLI 参数接收一个 Episode 目录路径，期望以下结构：

```
episode/                         # 例如 bichong_qiupai/
├── script.story                 # 剧本（唯一时序数据源）
├── config/
│   ├── transitions.json         # 场景过渡出口/入口
│   ├── voice_config.json        # TTS 声线配置
│   └── choreography.json        # 静态编舞配置（备选，可被 .story DSL 覆盖）
├── assets/
│   ├── audio/
│   │   ├── music/               # BGM 素材（*.wav）
│   │   ├── sfx/                 # 音效素材（*.wav）
│   │   ├── manifest.json        # TTS 音频清单（由 generate_audio.py 生成）
│   │   ├── mixed.wav            # 最终混音（由 generate_audio.py 生成）
│   │   └── *.mp3                # 逐句 TTS 输出
│   └── images/                  # 贴图/背景（预留）
├── storyboard/                  # 验证截图输出目录
└── output.mp4                   # 最终视频输出
```

引擎启动 HTTP 服务器时，将 `/episode/` 路由映射到该目录，浏览器端通过 `/episode/script.story`、`/episode/config/*.json`、`/episode/assets/audio/*` 加载内容。

---

## 5. CLI 接口

引擎发布为 npm 包，提供三个全局 CLI 命令：

| 命令 | 说明 | 底层 |
|------|------|------|
| `dula-render <episode>` | 生成完整视频 | `generate_video.js` |
| `dula-verify <episode>` | 逐镜头验证截图 | `tools/verify_shots.js` |
| `dula-audio <episode>` | 生成 TTS + BGM + SFX 混音 | `tools/generate_audio.py`（Python 包装器） |

**使用示例（从 Story 仓库执行）：**

```bash
# Story 仓库已安装引擎依赖后：
npx dula-audio ./episodes/bichong_qiupai
npx dula-verify ./episodes/bichong_qiupai
npx dula-render ./episodes/bichong_qiupai
```

若省略 `<episode>` 参数，默认使用当前工作目录（`.`）。相对路径始终解析为**相对于当前工作目录**（`process.cwd()`），不再与引擎安装位置耦合。

**本地开发链路（无需发布到 npm）：**

```bash
# Engine 侧
npm link

# Story 侧
npm link dula-engine
# 或在 package.json 中声明："dula-engine": "file:../dula-engine"
```

---

## 6. 渲染管线

1. `generate_video.js` 启动本地 HTTP 服务器（端口 8765）。
   - 根目录 = 引擎目录（加载 `render.html`、`render.js` 等）
   - `/episode/*` → 映射到传入的 Episode 目录
2. Puppeteer 打开 `http://localhost:8765/render.html`。
3. `render.js` 加载 `Storyboard`，按 30fps 逐帧调用 `storyboard.update(t)` 和 `storyboard.render()`。
4. 每一帧通过 `renderer.domElement.toDataURL('image/png')` 传回 Node，写入 `storyboard/frames/frame_00001.png`。
5. 渲染完成后，Node 调用 ffmpeg：
   ```bash
   ffmpeg -y -framerate 30 -i "storyboard/frames/frame_%05d.png" -i "assets/audio/mixed.wav" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "output.mp4"
   ```
6. 清理 `storyboard/frames/` 目录。

---

## 7. 音频管线

1. `python tools/generate_audio.py <episode>` 读取 `script.story`。
2. **TTS**：对每句含 `[Character]` 的文本，调用 `edge_tts.Communicate` 生成 `{index:03d}_{Character}.mp3`。
   - 声线配置从 `config/voice_config.json` 加载。
3. **BGM**：读取 `.story` 中的 `{Music:Play|...}` 标签，从 `assets/audio/music/{name}.wav` 加载素材。
   - 若素材缺失则自动跳过 BGM 混音，仅保留 TTS + SFX。
4. **SFX**：合成 `tennis_hit.wav`，在 `choreography.json` 或 `.story` `{Ball:...}` 标签推导的时间点插入。
5. **混音**：Python 样本级混音（Fade In/Out、Sidechain Ducking、Soft Limiter），最终 ffmpeg `amix` 输出 `mixed.wav`。

`manifest.json` 中 `file` 字段为**纯文件名**（如 `002_Doraemon.mp3`），由浏览器端根据 `manifestPath` 拼接完整 URL。

---

## 8. 核心系统

### StoryParser (`lib/StoryParser.js`)
解析 `.story` 时间轴格式，支持命名空间标签：

| 标签 | 说明 |
|------|------|
| `@SceneName` | 场景切换 |
| `[Character]` | 说话角色 |
| `{Action}` | 身体动画（通用/角色专属） |
| `{Camera:MoveName\|key=value}` | 运镜指令 |
| `{Music:Action\|key=value}` | 配乐提示 |
| `{Ball:Action\|key=value}` | 球事件（Serve/Return/FlyTo…） |
| `{Prop:Action\|key=value}` | 道具操作（Racket attach/detach…） |
| `{Position:Character\|key=value}` | 角色站位（spot 或坐标） |
| `{Event:Action\|key=value}` | 通用剧情事件（Move/Animate…） |
| `{SFX:Action\|key=value}` | 音效触发 |

参数语法：`{Namespace:Action|key=value|key2=1,2,3}`，数组值用逗号分隔。

### Storyboard (`storyboard/Storyboard.js`)
导演中枢：`load()` → `update(t)` → `render()`。

- `load(storyPath, manifestPath)`：解析剧本、加载配置、初始化场景与角色、预计算球事件。
- **配置加载优先级**：`.story` DSL 标签 > `config/choreography.json` > 硬编码默认值。
- `switchScene(name)`：场景切换 + 角色迁移 + ParkScene 特殊编排（站位/道具/球事件）。
- `update(t)`：场景切换检测、角色 speaking 状态、ParkScene 球飞行、角色动画、运镜执行。

### CourtDirector (`lib/CourtDirector.js`)
语义化球场编排：
- `placePlayer(name, spot)` → 自动计算坐标
- `computeBallFlight(from, to, {arcHeight, speed})` → 轨迹
- `computeSwingTime(flight, startTime, swingDuration)` → 挥拍时机
- `computeCamera(type, focus, {distance, height})` → 机位

---

## 9. 场景系统

### RoomScene (`scenes/RoomScene.js`)
室内默认场景。

### ParkScene (`scenes/ParkScene.js`)
公园网球场场景，包含：草地、树木、长椅、网球场（带完整白线）、网球网、网球、球拍。
- `attachRacketToCharacter(character, color)`：将球拍附加到角色右手。
- `setBallTrajectory(startTime, endTime, startPos, endPos, arcHeight)`：抛物线球飞行。
- `getCourtGeometry()`：返回场地几何常量，供 `CourtDirector` 使用。

---

## 10. 动画与运镜

动画和运镜均通过 Registry 模式注册，以类名作为 key。

### 通用动画 (`animations/common/`)
`Walk`, `Run`, `WaveHand`, `Jump`, `StompFoot`, `SwayBody`, `Nod`, `ShakeHead`, `TurnToCamera`, `SwingRacket`, `Bow`, `LookAround`, `PointForward`, `ScratchHead`, `HandsOnHips`, `ClapHands`, `Celebrate`, `Shrug`, `SurprisedJump`, `Tremble`, `Think`, `SitDown`, `CrossArms`

### 哆啦A梦专属 (`animations/doraemon/`)
`PullOutRacket`, `TakeOutFromPocket`, `Spin`, `PanicSpin`, `NoseBlink`, `Float`, `WaddleWalk`

### 大雄专属 (`animations/nobita/`)
`Cry`, `LazyStretch`, `Grovel`, `StudyDespair`, `TriumphPose`, `RunAway`

### 静香专属 (`animations/shizuka/`)
`Curtsy`, `Giggle`, `PlayViolin`, `Scold`, `Blush`, `Baking`

### 运镜 (`camera/common/`)
`Static`, `ZoomIn`, `ZoomOut`, `Pan`, `Orbit`, `Shake`, `FollowCharacter`, `LowAngle`

---

## 11. 逐镜头验证工作流

```bash
node tools/verify_shots.js <episode-dir>
```

1. 启动本地服务器（端口 8766），加载 `tools/verify.html`。
2. 对 `.story` 中每个条目，seek 到中点时间，截图保存为 `storyboard/check_shot_XX.jpg`。
3. 默认保留截图供人工检查，运行结束后可手动清理。

---

## 12. 已知问题与历史修复

| 问题 | 状态 | 说明 |
|------|------|------|
| 音频重叠 | ✅ 已修复 | 重写时间轴，给足每句时长。 |
| 移动卡顿 Bug | ✅ 已修复 | `moveTo` 首次 update 时 snapshot `startPos`。 |
| 公园缺球拍/球 | ✅ 已修复 | `ParkScene` 新增 net、ball、racket。 |
| 硬编码坐标耦合 | ✅ 已修复 | 引入 `CourtDirector`，角色/球/相机全部语义化计算。 |
| 单体项目拆分 | ✅ 已修复 | 拆分为 `dula-engine` + `dula-story` 双仓库。 |
| 浏览器音频 404 | ✅ 已修复 | manifest `file` 改为纯文件名，由浏览器拼接完整 URL。 |
| P0 语法扩展 | ✅ 已落地 | `{Ball:Serve|...}`、`{Prop:...}`、`{Position:...}`、`{Event:...}` 已支持。 |
| BGM 素材缺失 | ⚠️ 待补充 | `assets/audio/music/` 为空，需放入 WAV 素材。不影响出片（自动跳过）。 |
| 对话自然度 | ⚠️ 待优化 | 用户反馈「必中球拍」梗的对话仍不够自然。 |
| 球拍可见性 | ⚠️ 可优化 | 哆啦A梦身体较圆，球拍有时被遮挡。 |

---

## 13. 版本管理与发布

### 发版流程（Engine 侧）

```bash
cd dula-engine
# 1. 确保 working directory clean
git add -A && git commit -m "feat: ..."

# 2. 打版本号（自动修改 package.json + package-lock.json + git tag）
npm version patch       # patch: 0.1.0 -> 0.1.1
# npm version minor     # minor: 0.1.1 -> 0.2.0
# npm version major     # major: 0.2.0 -> 1.0.0

# 3. 生成 release tarball
npm pack                # -> dula-engine-0.1.1.tgz

# 4. 上传到 GitHub Release Assets
# 5. 推送 tag
git push origin main --tags
```

### Story 侧升级引擎版本

```bash
cd dula-story
# 方式 A：通过 GitHub Release URL
npm install https://github.com/orange9angel/dula-engine/releases/download/v0.1.1/dula-engine-0.1.1.tgz

# 方式 B：修改 package.json 后 install
# "dependencies": { "dula-engine": "https://github.com/.../dula-engine-0.1.1.tgz" }
```

## 14. 开发工作流

### 修改剧本（Story 侧）
1. 编辑 `script.story`。
2. 运行 `npx dula-audio .`（或 `npm run audio`）重新生成音频与 manifest。
3. 运行 `npx dula-verify .`（或 `npm run verify`）逐镜头验证画面。
4. 确认无误后，运行 `npx dula-render .`（或 `npm run render`）生成最终视频。

### 修改引擎代码（Engine 侧）
1. 下载/clone engine 源码修改 → 测试通过。
2. 在 Story 仓库（使用 `file:` 或 tarball 安装）运行 `npx dula-verify <episode>` 查看关键帧。
3. 满意后按「发版流程」打版本号、生成 tarball、上传 Release。
4. Story 更新版本号安装新版本。

---

## 14. 关键代码片段备忘

### CharacterBase 移动修复
```js
moveTo(targetPos, startTime, duration) {
  this.moves.push({
    targetPos,
    startPos: undefined, // 延迟到第一次 update 再 snapshot
    startTime,
    endTime: startTime + duration,
  });
}
// update() 中
if (move.startPos === undefined) {
  move.startPos = { x: this.mesh.position.x, z: this.mesh.position.z };
}
```

### Storyboard 从 .story DSL 提取编舞
```js
// load() 中遍历 entries
for (const entry of this.entries) {
  if (entry.positions) { /* 构建 storyPlacements */ }
  if (entry.propOps) { /* 构建 storyProps */ }
  if (entry.ballEvents) { /* 构建 storyBallEvents，startTime = entry.startTime */ }
  if (entry.storyEvents) { /* 构建 storyEvents */ }
}
// switchScene / _setupParkBallEvents 中优先使用 story 数据
const placements = this.storyPlacements.length > 0 ? this.storyPlacements : (parkChoreo?.placements ?? []);
```

### CourtDirector 核心 API
```js
const cd = new CourtDirector(courtGeometry);
cd.placePlayer('Doraemon', 'northBaseline', { face: 'Nobita' });
const flight = cd.computeBallFlight('Doraemon', 'Nobita', { speed: 8, arcHeight: 1.5 });
const swingTime = cd.computeSwingTime(flight, startTime, 0.6);
```

---

**最后更新**：2026-04-19
