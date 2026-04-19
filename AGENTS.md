# Dula Engine — 开发规范与上下文

> 本文档供 AI 开发代理阅读。本仓库是三层架构的**纯净框架层**：只包含基类、Registry、渲染/音频执行代码。具体资产（角色/动画/场景/运镜/配音）在 [`dula-assets`](https://github.com/orange9angel/dula-assets)，内容（剧本/配置/素材/输出）在 [`dula-story`](https://github.com/orange9angel/dula-story)。

---

## 1. 项目概述

基于 Web (Three.js) + Puppeteer 离线渲染的动画短片生成器。

**架构原则**：引擎 = 执行算法与基类，资产 = 可复用实现，内容 = 声明数据。

```
dula-engine  ← 本仓库（框架：基类 + Registry + CLI + 渲染管线）
   ↑ 注册
dula-assets  ← 官方资产库（角色/动画/场景/运镜/配音/CourtDirector）
   ↑ 消费
dula-story   ← 内容仓库（剧本/配置/素材/输出）
```

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
├── index.js                   # 统一公共入口（导出所有 Registry + 基类 + Storyboard）
├── generate_video.js          # 主渲染管线
├── render.html                # 浏览器渲染页面
├── render.js                  # 浏览器端帧循环
├── package.json
├── lib/
│   ├── StoryParser.js         # .story 解析器（命名空间标签路由）
│   ├── CourtDirector.js       # ⚠️ 临时保留，待迁移到 dula-assets 后移除
│   ├── MusicDirector.js       # 配乐调度器（Cue/Duck/HitPoint/Stem）
│   └── MathUtils.js           # 通用数学工具
├── scenes/
│   ├── index.js               # SceneRegistry（空 + registerScene）
│   └── SceneBase.js           # 场景基类
├── characters/
│   ├── index.js               # CharacterRegistry（空 + registerCharacter）
│   └── CharacterBase.js       # 角色基类
├── animations/
│   ├── AnimationBase.js
│   └── index.js               # AnimationRegistry（空 + registerAnimation）
├── camera/
│   ├── CameraMoveBase.js
│   └── index.js               # CameraMoveRegistry（空 + registerCameraMove）
├── storyboard/
│   └── Storyboard.js          # 导演核心
├── voices/
│   ├── index.js               # VoiceRegistry（空 + registerVoice）
│   └── VoiceBase.js           # 配音基类
└── tools/
    ├── generate_audio.py      # 音频管线
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

引擎音频系统采用 **3-stage ffmpeg 混音**，支持 TTS、BGM、SFX 三层自动混合。

### Stage 1 — TTS（对白）
`python tools/generate_audio.py <episode>` 读取 `script.story`，对每句含 `[Character]` 的文本调用 `edge_tts.Communicate` 生成 `{index:03d}_{Character}.mp3`。
- 声线配置从 `config/voice_config.json` 加载。
- `manifest.json` 中 `file` 字段为**纯文件名**（如 `002_Doraemon.mp3`），由浏览器端拼接完整 URL。

### Stage 2 — BGM（配乐）
`python tools/generate_bgm.py <episode>` 生成 BGM：
1. **优先使用手动素材**：扫描 `materials/bgm/` 目录，若存在 `.mp3`/`.wav`/`.ogg` 文件，ffmpeg 转换为 48kHz mono WAV，输出到 `assets/audio/music/`。
2. **Procedural 回退**：若手动素材缺失，使用 ADSR 包络 + 多轨叠加 + Delay 效果自动合成：
   - `room_theme` — C major, 60 BPM
   - `park_theme` — G major, 100 BPM, 8-bar AABA
   - `chaos_theme` — Diminished, 130 BPM, 8-bar
   - `tension_theme` — A minor, 120 BPM, 4-bar
   - `wonder_theme` — F major, 90 BPM, 4-bar + bell lead
3. `--force` 标志可强制重新生成（覆盖已有文件）。

### Stage 3 — SFX（音效）
`generate_audio.py` 从 `.story` 的 `{Event:...}`、`{Camera:...}`、`{Prop:...}` 标签自动提取剧情事件，调度对应 SFX：

| 事件标签 | 匹配的 SFX |
|----------|-----------|
| `{Prop:TakeCopter}` | `takecopter_spin` |
| `{Event:Move\|y>2}` / `{Camera:WhipPan}` | `whoosh_fast` |
| `{Event:Move\|y<0}` / 负 Y 位移 | `fall_whistle` |
| `{Camera:Shake}` | `impact_thud` |

- **手动素材优先**：扫描 `materials/sfx/` 和 `assets/audio/sfx/` 中的 `.wav` 文件，通过模糊匹配（`whoosh_fast` 优先于 `whoosh`）找到最佳匹配。
- **Procedural 回退**：若手动素材缺失，使用 Python `wave` 模块生成：
  - `wind_strong` / `wind_gentle` — 粉红噪声 + 滤波
  - `fall_whistle` — 频率下扫正弦波
  - `impact_thud` — 低频衰减脉冲
  - `whoosh_fast` — 白噪声爆发
  - `takecopter_spin` — 正弦波叠加模拟旋转声

### Stage 4 — 最终混音
3-stage ffmpeg 混音（解决 Windows 命令行过长问题）：
1. 预混所有对白 → `_temp_dialogue.wav`
2. 预混所有 SFX → `_temp_sfx.wav`
3. 最终混合：Dialogue + BGM + SFX，各自独立音量控制
   - BGM 默认 `-20dB`，SFX 默认 `-12dB`
   - 支持 Sidechain Ducking（对白时自动压低 BGM）

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
| `{SFX:Action\|key=value}` | 音效触发（手动指定 SFX 文件名） |
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
公园场景，包含：草地、树木、长椅、喷泉、路灯、网球场（带完整白线）、网球网、网球、球拍。
- `attachRacketToCharacter(character, color)`：将球拍附加到角色右手。
- `setBallTrajectory(startTime, endTime, startPos, endPos, arcHeight)`：抛物线球飞行。
- `getCourtGeometry()`：返回场地几何常量，供 `CourtDirector` 使用。

### SkyScene (`scenes/SkyScene.js`)
天空/高空场景，用于飞行戏份。包含：蓝天白云背景、远景城市轮廓。
- `setCloudSpeed(speed)`：调整云层移动速度。
- `setTimeOfDay(hour)`：调整光照色调（0-24）。

---

## 10. 动画与运镜

动画和运镜均通过 Registry 模式注册，以类名作为 key。

### 通用动画 (`animations/common/`)
`Walk`, `Run`, `WaveHand`, `Jump`, `StompFoot`, `SwayBody`, `Nod`, `ShakeHead`, `TurnToCamera`, `SwingRacket`, `Bow`, `LookAround`, `PointForward`, `ScratchHead`, `HandsOnHips`, `ClapHands`, `Celebrate`, `Shrug`, `SurprisedJump`, `Tremble`, `Think`, `SitDown`, `CrossArms`, `FlailArms`, `LookUp`, `ReachOut`

### 哆啦A梦专属 (`animations/doraemon/`)
`PullOutRacket`, `TakeOutFromPocket`, `Spin`, `PanicSpin`, `NoseBlink`, `Float`, `WaddleWalk`, `ReachHand`

### 大雄专属 (`animations/nobita/`)
`Cry`, `LazyStretch`, `Grovel`, `StudyDespair`, `TriumphPose`, `RunAway`, `CrashLand`, `FallPanic`, `FlyPose`

### 静香专属 (`animations/shizuka/`)
`Curtsy`, `Giggle`, `PlayViolin`, `Scold`, `Blush`, `Baking`, `LookUpSky`, `WaveUp`

### 运镜 (`camera/common/`)
`Static`, `ZoomIn`, `ZoomOut`, `Pan`, `Orbit`, `Shake`, `FollowCharacter`, `LowAngle`, `CloseUp`, `OverShoulder`, `TwoShot`, `TrackingCloseUp`, `WhipPan`, `ReactionShot`

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
| 单体项目拆分 | ✅ 已修复 | 拆分为 `dula-engine` + `dula-assets` + `dula-story` 三层架构。 |
| 浏览器音频 404 | ✅ 已修复 | manifest `file` 改为纯文件名，由浏览器拼接完整 URL。 |
| P0 语法扩展 | ✅ 已落地 | `{Ball:Serve|...}`、`{Prop:...}`、`{Position:...}`、`{Event:...}` 已支持。 |
| TTS 朗读标签 | ✅ 已修复 | `generate_audio.py` 漏过滤 `{Ball:...}`/`{Prop:...}`/`{Position:...}`/`{Event:...}`，导致 TTS 读出英文参数。v0.1.6 已修复。 |
| BGM 素材缺失 | ✅ 已修复 | `generate_bgm.py` 支持 procedural ADSR 合成回退，无需手动素材即可出片。 |
| SFX 自动调度 | ✅ 已落地 | `generate_audio.py` 从 story events 自动提取并调度 SFX。 |
| 对话自然度 | ⚠️ 可优化 | 「必中球拍」梗的对话仍不够自然（属于内容层问题）。 |
| 球拍可见性 | ⚠️ 可优化 | 哆啦A梦身体较圆，球拍有时被遮挡。 |
| 相机距离过近 | ⚠️ 可优化 | `CloseUp`/`TrackingCloseUp` 在某些机位距离过近（如 shot 02、07）。 |
| 追踪遮挡 | ⚠️ 可优化 | `TrackingCloseUp` 在 ParkScene 中可能落入树木后方（如 shot 38）。 |
| 低角度遮挡 | ⚠️ 可优化 | 低机位时路灯/喷泉可能阻挡画面（如 shot 45）。 |
| 角色扁平感 | ⚠️ 可优化 | Low-poly 角色在正上/正下方视角呈现"十字"形状（如 shot 25）。 |

---

## 13. 版本管理与发布

### 发版流程（Engine 侧）

```bash
cd dula-engine

# 1. 确保 working directory clean
git add -A && git commit -m "feat: ..."

# 2. 打版本号（自动修改 package.json + package-lock.json + git tag）
npm version patch       # patch: 0.1.2 -> 0.1.3
# npm version minor     # minor: 0.1.3 -> 0.2.0
# npm version major     # major: 0.2.0 -> 1.0.0

# 3. 生成 release tarball
npm pack                # -> dula-engine-0.1.3.tgz

# 4. 推送代码和 tag
git push origin main --tags

# 5. 创建 GitHub Release 并上传 tarball（需要 gh CLI）
gh release create v0.1.3 \
  --title "dula-engine v0.1.3" \
  --notes "Release notes..." \
  dula-engine-0.1.3.tgz
```

**前置条件**：
- 已安装 [GitHub CLI](https://cli.github.com/) (`gh`)
- 已执行 `gh auth login` 登录 GitHub
- Git remote 指向 `orange9angel/dula-engine`

### Story 侧升级引擎版本

```bash
cd dula-story
# 方式 A：直接安装指定 Release URL
npm install https://github.com/orange9angel/dula-engine/releases/download/v0.1.3/dula-engine-0.1.3.tgz

# 方式 B：修改 package.json 后 install
# "dependencies": { "dula-engine": "https://github.com/.../dula-engine-0.1.7.tgz" }
npm install
```

## 14. 开发工作流

### 修改剧本（Story 侧）
1. 编辑 `script.story`。
2. 运行 `npx dula-audio .`（或 `npm run audio`）重新生成音频与 manifest。
3. 运行 `npx dula-verify .`（或 `npm run verify`）逐镜头验证画面。
4. 确认无误后，运行 `npx dula-render .`（或 `npm run render`）生成最终视频。

### 修改引擎代码（Engine 侧）
1. 下载/clone engine 源码修改 → 测试通过。
2. 在 Story 仓库临时切换为 `file:` 链接进行联调：
   ```bash
   cd dula-story
   npm install ../dula-engine   # 临时切换本地开发模式
   npm run verify
   ```
3. 满意后按「发版流程」打版本号、生成 tarball、上传 GitHub Release。
4. Story 切回 Release URL 安装新版本。

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
