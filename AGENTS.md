# Doula 项目开发规范与上下文

> 本文档供 AI 开发代理阅读，记录项目架构、协议、已知问题及开发工作流，确保重启后可无缝继续。

---

## 1. 项目概述

一个基于 Web (Three.js) + Puppeteer 离线渲染的 SRT 驱动型动画短片生成器。输入 SRT 字幕文件，输出带音频的 `output.mp4`。

当前剧情线：**「必中球拍」**（哆啦A梦借给大雄一个百发百中的网球拍，练习时起初很帅，最后球拍失控把大雄拖进池塘）。

---

## 2. 技术栈与环境

| 工具 | 版本/说明 |
|------|-----------|
| Node.js | v24.14.0 |
| npm | 11.9.0 |
| ffmpeg | 8.0.1-full_build |
| Python | 3.x（用于 edge-tts） |
| Node 依赖 | `puppeteer`, `three` (via CDN unpkg@0.160.0) |
| Python 依赖 | `edge-tts` |
| 帧率 | **固定 30 fps** |
| 输出分辨率 | 1920×1080 |

### 关键文件
- `render.html` + `render.js`：浏览器端 Three.js 渲染入口（生产管线）。
- `generate_video.js`：Node 端 Puppeteer 启动本地服务器、逐帧捕获 PNG、调用 ffmpeg 合成。
- `tools/generate_audio.py`：edge-tts 生成 MP3 + ffmpeg `amix` 混音成 `mixed.wav`。
- `tools/verify_shots.js`：逐镜头验证工作流（截图检查，不生成完整视频）。
- `subtitles/script.srt`：唯一剧本来源，驱动所有画面与音频。

---

## 3. 目录结构

```
D:\opensource\movie\doula
├── generate_video.js          # 主渲染管线（Puppeteer → PNG → ffmpeg）
├── render.html                # 浏览器渲染页面
├── render.js                  # 浏览器端帧循环
├── package.json
├── output.mp4                 # 最终输出（旧版可能被覆盖）
├── subtitles/
│   └── script.srt             # 剧本（SRT 协议）
├── lib/
│   ├── SRTParser.js           # SRT 解析器（JS）
│   ├── CourtDirector.js       # 场地-角色-球-相机协调计算层
│   └── MusicDirector.js       # 专业配乐调度器（Cue/Duck/HitPoint/Stem）
├── scenes/
│   ├── index.js               # SceneRegistry
│   ├── SceneBase.js           # 场景基类
│   ├── RoomScene.js           # 室内场景
│   └── ParkScene.js           # 公园场景（含网球网/球/球拍）
├── characters/
│   ├── index.js               # CharacterRegistry
│   ├── CharacterBase.js       # 角色基类（说话、动画、移动）
│   ├── Doraemon.js            # 哆啦A梦模型
│   └── Nobita.js              # 大雄模型
├── animations/
│   ├── AnimationBase.js
│   ├── index.js               # AnimationRegistry
│   ├── common/                # 通用动画（Walk, Jump, WaveHand…）
│   ├── doraemon/
│   └── nobita/
├── camera/
│   ├── CameraMoveBase.js      # 运镜基类
│   ├── index.js               # CameraMoveRegistry
│   └── common/                # 通用运镜（ZoomIn, Pan, Orbit, Shake…）
├── storyboard/
│   └── Storyboard.js          # 导演核心（场景切换、音频调度、球飞行控制）
├── voices/
│   └── index.js               # VoiceRegistry（目前未使用，音频由 Python 生成）
├── tools/
│   ├── generate_audio.py      # TTS + BGM + SFX 混音
│   ├── generate_bgm.py        # 程序化 BGM 合成器
│   ├── adjust_srt.py          # 基于音频时长自动调整 SRT 时间轴（备用）
│   ├── verify_shots.js        # 逐镜头验证脚本
│   ├── verify.html            # 验证用浏览器入口
│   └── verify_render.js       # 验证用渲染逻辑
└── assets/audio/
    ├── *.mp3                  # 逐句 TTS 输出
    ├── sfx/                   # 音效（tennis_hit.wav 等）
    ├── music/                 # 背景音乐（room_theme.wav 等）
    ├── manifest.json          # 音频清单
    └── mixed.wav              # ffmpeg 混音结果
```

---

## 4. SRT 协议规范

`subtitles/script.srt` 是唯一数据源，格式在标准 SRT 之上扩展：

```srt
1
00:00:00,000 --> 00:00:04,000
@RoomScene

2
00:00:04,000 --> 00:00:08,500
[Doraemon]{WaveHand} 大雄！又在走廊发呆啦？
```

### 标记说明
- `@SceneName`：场景切换指令（如 `@RoomScene`, `@ParkScene`）。必须独占一行，可视为该时间段内的一个特殊条目。
- `[Character]`：说话角色，用于匹配 TTS 声线、触发嘴型动画、调度音频。
- `{Action}`：身体动画标签，在 TTS 生成前会被 Python 脚本剥离。
- `{Camera:MoveName}`：运镜指令（如 `{Camera:ZoomIn}`）。与身体动画标签互不冲突，可共存于同一句。
  - **参数语法**：`{Camera:ClassName|key=value|key2=1,2,3}`，数组值用逗号分隔。例如 `{Camera:Static|position=6,2.5,2|lookAt=0,1.2,0}`。
- `{Music:Action|key=value}`：配乐提示（Cue）。例如 `{Music:Play|name=park_theme|fadeIn=1.5|baseVolume=0.5|endTime=39.8}`。
  - `name`：BGM 文件名（对应 `assets/audio/music/{name}.wav`）。
  - `fadeIn` / `fadeOut`：淡入淡出时长（秒）。
  - `baseVolume`：基础音量（0~1）。
  - `endTime`：音乐结束时间（可跨多个 SRT 条目持续播放）。
  - `emotion` / `bpm`：情绪标签与速度（供 MusicDirector 智能选曲使用）。

### 通用动作标签（`animations/common/`，所有角色可用）
| 标签 | 动画类 | 效果 |
|------|--------|------|
| `{Walk}` | `Walk` | 走路（腿部摆动） |
| `{Run}` | `Run` | 跑步（身体前倾，幅度更大） |
| `{WaveHand}` | `WaveHand` | 挥手 |
| `{Jump}` | `Jump` | 跳跃 |
| `{StompFoot}` | `StompFoot` | 跺脚 |
| `{SwayBody}` | `SwayBody` | 身体摇摆 |
| `{Nod}` | `Nod` | 点头 |
| `{ShakeHead}` | `ShakeHead` | 摇头（否认/困惑） |
| `{TurnToCamera}` | `TurnToCamera` | 转身面向镜头（由 Storyboard 自动调度） |
| `{SwingRacket}` | `SwingRacket` | 挥拍（拉拍→击球→随挥，0.8s） |
| `{Bow}` | `Bow` | 鞠躬 |
| `{LookAround}` | `LookAround` | 左顾右盼 |
| `{PointForward}` | `PointForward` | 指向前方 |
| `{ScratchHead}` | `ScratchHead` | 挠头（困惑） |
| `{HandsOnHips}` | `HandsOnHips` | 双手叉腰 |
| `{ClapHands}` | `ClapHands` | 拍手 |
| `{Celebrate}` | `Celebrate` | 欢呼（举手弹跳） |
| `{Shrug}` | `Shrug` | 耸肩 |
| `{SurprisedJump}` | `SurprisedJump` | 受惊跳起 |
| `{Tremble}` | `Tremble` | 发抖/哆嗦 |
| `{Think}` | `Think` | 思考（手托下巴） |
| `{SitDown}` | `SitDown` | 坐下 |
| `{CrossArms}` | `CrossArms` | 双臂交叉胸前 |

### 哆啦A梦专属动作（`animations/doraemon/`）
| 标签 | 动画类 | 效果 |
|------|--------|------|
| `{PullOutRacket}` | `PullOutRacket` | 从百宝袋掏出球拍 |
| `{TakeOutFromPocket}` | `TakeOutFromPocket` | 从百宝袋掏东西（通用版） |
| `{Spin}` | `Spin` | 原地开心转圈（经典） |
| `{PanicSpin}` | `PanicSpin` | 惊慌转圈（手乱挥） |
| `{NoseBlink}` | `NoseBlink` | 鼻子闪烁（害羞） |
| `{Float}` | `Float` | 竹蜻蜓式悬浮飞行 |
| `{WaddleWalk}` | `WaddleWalk` | 摇摇摆摆走路 |

### 大雄专属动作（`animations/nobita/`）
| 标签 | 动画类 | 效果 |
|------|--------|------|
| `{Cry}` | `Cry` | 哭泣擦眼泪 |
| `{LazyStretch}` | `LazyStretch` | 伸懒腰 |
| `{Grovel}` | `Grovel` | 跪地求饶 |
| `{StudyDespair}` | `StudyDespair` | 学习绝望（抱头） |
| `{TriumphPose}` | `TriumphPose` | 得意V字姿势 |
| `{RunAway}` | `RunAway` | 抱头鼠窜 |

### 小静专属动作（`animations/shizuka/`）
| 标签 | 动画类 | 效果 |
|------|--------|------|
| `{Curtsy}` | `Curtsy` | 行屈膝礼 |
| `{Giggle}` | `Giggle` | 捂嘴笑 |
| `{PlayViolin}` | `PlayViolin` | 拉小提琴 |
| `{Scold}` | `Scold` | 叉腰训斥 |
| `{Blush}` | `Blush` | 害羞低头 |
| `{Baking}` | `Baking` | 做饼干（搅拌动作） |

### 运镜标签清单（已注册在 `camera/common/`）
| 标签 | 运镜类 | 效果 |
|------|--------|------|
| `{Camera:Static}` | `Static` | 固定机位（可指定 `position=6,2.5,2`, `lookAt=0,1.2,0`） |
| `{Camera:ZoomIn}` | `ZoomIn` | 推镜（`targetPos=0,1.5,0`, `distance=3.5`） |
| `{Camera:ZoomOut}` | `ZoomOut` | 拉镜（`targetPos=0,1.5,0`, `distance=10`） |
| `{Camera:Pan}` | `Pan` | 平移（`offset=2,0,0`, `lookAt=0,1.5,0`） |
| `{Camera:Orbit}` | `Orbit` | 环绕（`center=0,1.5,0`, `radius=8`, `startAngle=0`, `endAngle=90`, `height=3`） |
| `{Camera:Shake}` | `Shake` | 震动（`intensity=0.25`, `duration=0.6`） |
| `{Camera:FollowCharacter}` | `FollowCharacter` | 跟随角色（`characterName=Nobita`, `offset=0,3,6`, `lookAtOffset=0,1.5,0`） |
| `{Camera:LowAngle}` | `LowAngle` | 低角度仰拍（`targetPos=0,1.5,0`, `distance=4`） |

**注意**：时间轴必须给足音频播放时长。Edge-tts 中文语速约 1 秒 4~5 字，短句也应留 ≥2.5s。重叠会导致 `amix` 后听感混乱。

---

## 5. 渲染管线

1. `generate_video.js` 启动本地 HTTP 服务器（端口 8765）。
2. Puppeteer 打开 `http://localhost:8765/render.html`。
3. `render.js` 加载 `Storyboard`，按 30fps 逐帧调用 `storyboard.update(t)` 和 `storyboard.render()`。
4. 每一帧通过 `renderer.domElement.toDataURL('image/png')` 传回 Node，写入 `storyboard/frames/frame_00001.png`。
5. 渲染完成后，Node 调用 ffmpeg：
   ```bash
   ffmpeg -y -framerate 30 -i "storyboard/frames/frame_%05d.png" -i "assets/audio/mixed.wav" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "output.mp4"
   ```
6. 清理 `storyboard/frames/` 目录。

### 临时文件清理策略
- 生产帧：`generate_video.js` 在合成后删除 `storyboard/frames/`。
- 验证截图：`verify_shots.js` 运行后自动删除 `storyboard/check_shot_*.jpg`（可临时保留若干张用于人工检查）。
- **用户明确要求**：`check_*.jpg` 和 `frame_*.jpg` 在检查后立即删除，不可残留。

---

## 6. 音频管线

1. `python tools/generate_audio.py` 读取 `subtitles/script.srt`。
2. **TTS 生成**：对每句含 `[Character]` 的文本，调用 `edge_tts.Communicate` 生成 `{index:03d}_{Character}.mp3`。
   - Doraemon：`zh-CN-XiaoxiaoNeural`，rate `+10%`，pitch `+10Hz`
   - Nobita：`zh-CN-YunxiNeural`，rate `-5%`，pitch `-5Hz`
   - Shizuka：`zh-CN-XiaoyiNeural`，rate `+0%`，pitch `+5Hz`
3. **BGM 素材**：不再使用程序化合成（音质有限）。用户需将下载的高质量音乐素材（WAV 格式）放入 `assets/audio/music/`。
   - 命名：`room_theme.wav`（室内）、`park_theme.wav`（公园）、`chaos_theme.wav`（失控）。
   - 来源推荐：Pixabay Music（免费商用免署名）、Fesliyan Studios Cartoon 分类、Free Music Archive。
4. **BGM 混音（Python 样本级）**：`generate_audio.py` 读取 BGM cue 定义，在样本级别应用：
   - **Fade In/Out**：正弦缓动曲线。
   - **Sidechain Ducking**：对话期间自动压低 BGM（Attack=0.12s, Release=0.35s, Depth=0.32），合并重叠避让区间。
   - **Soft Limiter**：`tanh` 软限幅防止数字削波。
   若素材缺失则自动跳过 BGM 混音，仅保留 TTS + SFX。
5. **SFX 生成**：合成 `tennis_hit.wav`（高频扫频 + 噪声），在指定时间点插入。
6. **最终混音**：ffmpeg `amix` 将 TTS + BGM + SFX 按 `adelay` 对齐混合，输出 `mixed.wav`（48kHz 16bit PCM）。

### 音频重叠根因与修复
- **根因**：旧版 SRT 给每句的时间槽（slot）远短于 edge-tts 实际音频时长。例如 3.0s 的 slot 对应 5.3s 的音频，导致后一句提前开始，`amix` 后两段音频叠加。
- **修复**：手动重写 SRT，按每字约 0.28s + 0.5s 缓冲重新分配时间轴，总时长延长至约 112s，确保所有音频无重叠。

---

## 6.5 配乐系统（MusicDirector）

### 核心概念（对应影视配乐工业标准）
| 概念 | 说明 |
|------|------|
| **Cue / Cue Sheet** | 每段音乐的入出点、情绪标签、BPM。 |
| **Hit Point** | 音乐重拍与画面动作的对齐点（`alignHitPoint`）。 |
| **Duck / Sidechain** | 对话期间自动避让，带 Attack/Release 包络。 |
| **Crossfade** | 场景切换时的音乐过渡（Fade In/Out 叠加）。 |
| **Stem** | 分轨概念（Pad/Bass/Percussion/Melody），可动态混合。 |
| **Master Bus** | 总线音量与最终限幅。 |

### MusicDirector API (`lib/MusicDirector.js`)
```js
const md = new MusicDirector();
md.addCue(new MusicCue({ name: 'park_theme', file: '...', startTime: 19.7, endTime: 39.8, fadeIn: 1.5, baseVolume: 0.5, emotion: 'upbeat', bpm: 110 }));
md.autoDuckFromDialogues(srtEntries, depth=0.32, attack=0.12, release=0.35);
const vol = md.computeCueVolume(cue, t); // t ∈ 全局时间
const plan = md.exportMixPlan(); // 导出给 Python 混音器
```

### BGM 素材规范 (`assets/audio/music/`)
| 文件名 | 场景 | 建议风格 | 推荐搜索词 |
|--------|------|----------|-----------|
| `room_theme.wav` | 室内借球拍 (0~19s) | 轻松、日常 | `calm piano`, `happy acoustic` |
| `park_theme.wav` | 公园对打 (19~39s) | 轻快、运动 | `upbeat funk`, `energetic pop` |
| `chaos_theme.wav` | 失控飞走 (39~68s) | 滑稽、紧张 | `comedy chase`, `cartoon funny` |

**推荐来源**：
- **Pixabay Music**（首选）：https://pixabay.com/music/ — 免费商用，无需署名。
- **Fesliyan Studios Cartoon**：https://www.fesliyanstudios.com/royalty-free-music/downloads-c/cartoon-music/86
- **Free Music Archive**：https://freemusicarchive.org/

---

## 7. 角色系统

### CharacterBase (`characters/CharacterBase.js`)
核心能力：
- `speak(startTime, duration)`：触发嘴型动画 + 头部微动。
- `playAnimation(AnimClass, startTime, duration)`：播放显式身体动画。
- `moveTo(targetPos, startTime, duration)`：直线插值移动（easeInOutQuad）。
- `teleport(pos, time)`：瞬间重置位置（用于场景切换）。

#### 关键已知 Bug 已修复
**移动卡顿/stall Bug**：
- **旧代码**：`update()` 中每帧读取 `this.mesh.position` 作为 move 起点，导致 progress 计算错误，产生指数减速。
- **修复**：在 `moveTo` 中将 `startPos` 初始化为 `null`，在 `update` 中第一次进入该 move 的时间区间时 snapshot 当前位置：
  ```js
  if (move.startPos === undefined) {
    move.startPos = { x: this.mesh.position.x, z: this.mesh.position.z };
  }
  ```

### Doraemon (`characters/Doraemon.js`)
- 全身程序化生成（蓝头、白脸、红鼻、铃铛、口袋、胶囊手臂）。
- 手臂通过 `addArm()` 创建，保存到 `this.rightArm` / `this.leftArm`。
- **新增**：`this.rightArmLength` 在 `build()` 中被记录，供外部附加道具使用。

### Nobita (`characters/Nobita.js`)
- 同理，黄衣蓝裤、眼镜、胶囊手臂。
- 同样记录 `this.rightArmLength`。

---

## 8. 动画系统

### AnimationBase (`animations/AnimationBase.js`)
```js
export class AnimationBase {
  constructor(name, duration) { ... }
  update(t, character) { } // t ∈ [0, 1]
}
```

### 注册方式
所有动画类导出到 `animations/index.js` 的 `AnimationRegistry`，以类名作为 key。

### 当前可用动画
位于 `animations/common/`：
- `Walk.js`：腿部/手臂周期性摆动，同时身体轻微上下起伏。
- `WaveHand.js`：挥动一只手臂。
- `Jump.js`：Y 轴抛物线跳跃。
- `StompFoot.js`：跺脚震动。
- `SwayBody.js`：身体左右摇摆。
- `Nod.js`：点头。
- `TurnToCamera.js`：平滑旋转至面朝 +Z（镜头方向）。

---

## 8.5 运镜系统

### CameraMoveBase (`camera/CameraMoveBase.js`)
```js
export class CameraMoveBase {
  constructor(options = {}) { ... }
  start(camera, context) { }   // snapshot 初始状态
  update(t, camera, context) { } // t ∈ [0, 1]
  end(camera, context) { }     // 收尾
}
```

### 注册方式
所有运镜类导出到 `camera/index.js` 的 `CameraMoveRegistry`，以类名作为 key。

### 当前可用运镜
位于 `camera/common/`：
- `Static.js`：固定机位，可显式设置 position / lookAt（支持数组 `position=6,2.5,2`）。
- `ZoomIn.js` / `ZoomOut.js`：向/远离目标推/拉镜（easeInOutQuad）。
- `Pan.js`：摄像机横向平移，保持 lookAt 不变。
- `Orbit.js`：环绕目标点旋转（可配置半径、起止角度、高度）。
- `Shake.js`：随机位置震动，带时间衰减，结束时复位。
- `FollowCharacter.js`：持续跟随某角色（默认跟随 Nobita）。
- `LowAngle.js`：低角度仰拍，适合表现「英雄时刻」。

### Storyboard 集成
`Storyboard.load()` 会自动解析 SRT 中的 `{Camera:ClassName|key=value}` 标签，提取参数后调用 `playCameraMove(MoveClass, startTime, duration, options)` 入队。`Storyboard.update(t)` 在每帧场景更新后执行运镜，通过 `cameraContext` 传入 `renderer/scene/characters/currentScene` 供运镜类访问。

### 网球挥拍自动调度
`Storyboard.switchScene('ParkScene')` 内通过 `CourtDirector` 自动编排对打：
- 计算球轨迹 → 自动推导挥拍时机（receiver 在球到达前 30% 开始挥拍）。
- 不再硬编码挥拍时间，角色位置一变，轨迹和挥拍全部自动对齐。

---

## 9. 场景系统

### SceneBase (`scenes/SceneBase.js`)
- `build()`：添加 Ambient + Directional 灯光。
- `addCharacter(character)` / `removeCharacter(character)`
- `update(time, delta)`：遍历 `this.characters` 调用 `character.update()`。

### RoomScene (`scenes/RoomScene.js`)
室内场景，目前为项目默认启动场景。

### ParkScene (`scenes/ParkScene.js`)
公园场景，包含：
- 蓝天背景、草地、树木、云朵。
- **独立网球场**：12×24 单位的蓝色场地，带白色边界线、中线、发球线、单打/双打边线。
- **长椅**：两张，分别位于网球场左右两侧的草地观众席，面向场地。
- **网球网** (`this.net`)：位于场地正中央（Z=0），两根柱子 + 白色半透明网 + 网格线。
- **网球** (`this.tennisBall`)：黄色小球，可受 `ballTrajectory` 驱动飞行。
- **球拍** (`createRacket(color)`)：手柄 + 圆环拍框 + 十字网线。
- `attachRacketToCharacter(character, color)`：将球拍附加到角色右手（local 坐标）。
  - 默认旋转 `racket.rotation.set(Math.PI / 6, 0, Math.PI / 2)`，让拍面朝前更易见。
- `setBallTrajectory(startTime, endTime, startPos, endPos, arcHeight)`：控制网球沿抛物线飞行。
- `update(time, delta)`：先 `super.update()` 更新角色，再按 `ballTrajectory` 插值球的位置（easeInOutQuad + 正弦弧高）。
- `getCourtGeometry()`：返回场地几何常量（`width/length/baselineZ/serviceLineZ/singlesWidth/doublesWidth/groundY`），供 `CourtDirector` 使用。

---

## 10. Storyboard 导演系统

`storyboard/Storyboard.js` 是整个动画的「导演」。

### 核心流程
1. `load(srtPath, manifestPath)`：
   - 解析 SRT → `this.entries`。
   - 解码音频 → `this.audioBuffers`。
   - 初始化首场景，实例化所有提及角色。
   - `arrangeCharacters()`：按人数排位置（2 人时左右 -1.5 / +1.5）。
   - 自动调度 `{Action}` 动画。
   - 自动调度 `{Camera:MoveName}` 运镜（入队到 `this.cameraMoves`）。
   - **自动调度场景过渡动作**：
     - 切换前：角色 `Walk` 至 `SCENE_EXITS[prevScene]`。
     - 切换瞬间：`teleport` 到 `SCENE_ENTRANCES[nextScene]`。
     - 切换后：角色 `Walk` 入场，随后 `TurnToCamera`。

2. `update(t)`：
   - 检测并执行场景切换。
   - 更新角色 speaking 状态（触发动嘴）。
   - **公园场景网球飞行编排**：若当前是 `ParkScene`，遍历 `this.ballEvents`（在 `switchScene` 时由 `CourtDirector` 预计算）：
     - 每个事件含 `startTime` + `flight`（`startPos/endPos/arcHeight/duration`）。
     - 当前时间命中事件区间时，调用 `setBallTrajectory()` 驱动球飞行。
     - 事件间隙：球停在最近一个已完成事件的 `endPos`；首个事件前球停在 Doraemon 附近。
     - 支持三种事件类型：`player`（角色→角色）、`toPos`（角色→固定坐标）、`posToPos`（固定→固定）。
   - 调用 `this.currentScene.update(t, 0.016)` 推进角色动画与球位。
   - 执行 `this.cameraMoves` 队列中的运镜（在场景更新之后，渲染之前）。

3. `render()`：调用 `renderer.render(scene, camera)`。

### 场景切换硬编码常量
```js
const SCENE_EXITS = {
  RoomScene: { x: -4, z: 2 },
};
const SCENE_ENTRANCES = {
  ParkScene: { x: -2, z: 3 },
};
```

---

## 11. 逐镜头验证工作流

为避免直接跑完整 `generate_video.js` 后才发现问题，已建立验证脚本：

```bash
node tools/verify_shots.js
```

### 行为
1. 启动本地服务器（端口 8766），加载 `tools/verify.html`。
2. 对 SRT 中每个条目，seek 到该条目的中点时间，截图保存为 `storyboard/check_shot_XX.jpg`。
3. 默认运行结束后删除所有临时截图（可临时修改脚本保留特定镜头人工检查）。

### 验证脚本中的路径补丁
`verify.html` 位于 `/tools/`，基地址不同，因此 `verify_render.js` 做了两处处理：
- SRT / manifest 路径使用 `../subtitles/script.srt` 和 `../assets/audio/manifest.json`。
- 通过覆盖 `window.fetch` 拦截 `assets/audio/` 开头的请求，在前面补 `../`，确保 MP3 能正确加载。

---

## 12. 已知问题与历史修复

| 问题 | 状态 | 说明 |
|------|------|------|
| 音频重叠 | ✅ 已修复 | 重写 SRT 时间轴，给足每句时长。 |
| 移动卡顿 Bug | ✅ 已修复 | `moveTo` 首次 update 时 snapshot `startPos`。 |
| 公园缺球拍/球 | ✅ 已修复 | `ParkScene` 新增 net、ball、racket 及飞行轨迹。 |
| 临时截图残留 | ✅ 已修复 | `verify_shots.js` 自动清理；之前 PowerShell `del` 失败已改为 `Remove-Item`。 |
| SRT 自动调整脚本 | 🔄 备用 | `tools/adjust_srt.py` 可根据现有 MP3 时长自动拉伸时间轴，但未启用。 |
| 对话自然度 | ⚠️ 待优化 | 用户反馈「必中球拍」梗的对话仍不够自然、缺乏真正的哆啦A梦式幽默。 |
| 球拍可见性 | ⚠️ 可优化 | 哆啦A梦身体较圆，红色球拍有时被身体遮挡，已稍微前倾，仍可在未来调整手臂 pose。 |
| 硬编码坐标耦合 | ✅ 已修复 | 引入 `CourtDirector` 计算层，角色站位、球轨迹、挥拍时机全部通过场地几何自动计算，不再四处硬编码。 |

---

## 13. 开发工作流（标准操作顺序）

### 修改剧本/时间轴
1. 编辑 `subtitles/script.srt`。
2. 运行 `python tools/generate_audio.py` 重新生成音频与 manifest。
3. 运行 `node tools/verify_shots.js` 逐镜头验证画面。
4. 确认无误后，运行 `node generate_video.js` 生成最终视频。

### 修改场景/角色/动画
1. 修改对应 JS 文件。
2. 直接运行 `node tools/verify_shots.js` 查看关键帧。
3. 满意后再跑完整视频。

---

## 14. 待办事项（下次继续）

按优先级排列：

1. **BGM 质量提升**：当前程序化 BGM 为合成器演示级，建议替换为真实作曲或高质量 Loop 素材。
2. **Phase 2：SRT 语义化扩展**（可选）：让 SRT 支持 `{Ball:Serve|to=Nobita}`、`{Camera:RallySide|focus=Doraemon}` 等语义标签，彻底摆脱手写坐标。
3. **对话自然度再打磨**：若用户对剧情或幽默感仍不满意，需再次重写 SRT。建议方向：
   - 减少翻译腔，增加口语化短句。
   - 哆啦A梦的吐槽更犀利/无奈一点。
   - 结局的笑点更突出（如大雄落水后哆啦A梦的补刀）。
4. **可选增强**：
   - 给球拍添加「挥拍」动画（让手臂在击球瞬间抬起）。
   - 给球增加旋转效果或拖尾。
   - 添加更多场景（如池塘边缘的 visual 暗示）。

---

## 15. 关键代码片段备忘

### CharacterBase 移动修复核心
```js
moveTo(targetPos, startTime, duration) {
  this.moves.push({
    targetPos,
    startPos: undefined, // 关键：延迟到第一次 update 再 snapshot
    startTime,
    endTime: startTime + duration,
  });
}

// update() 中
if (time >= move.startTime && time < move.endTime) {
  if (move.startPos === undefined) {
    move.startPos = { x: this.mesh.position.x, z: this.mesh.position.z };
  }
  // ... easeInOutQuad 插值
}
```

### ParkScene 球拍附加
```js
attachRacketToCharacter(character, color = 0xff3333) {
  if (!character.rightArm || !character.rightArmLength) return null;
  const racket = this.createRacket(color);
  racket.position.set(0, -character.rightArmLength, 0);
  character.rightArm.add(racket);
  return racket;
}
```

### Storyboard 公园球飞行编排
`switchScene('ParkScene')` 内调用 `this._setupParkBallEvents()`，通过 `CourtDirector` 预计算：
```js
// 语义化站位
cd.placePlayer('Doraemon', 'northBaseline');
cd.placePlayer('Nobita', 'southBaseline');

// 自动计算球轨迹 + 挥拍时机
const flight = cd.computeBallFlight('Doraemon', 'Nobita', { arcHeight: 1.5 });
const swingTime = cd.computeSwingTime(flight, startTime, 0.6);
```

### CourtDirector 核心 API (`lib/CourtDirector.js`)
```js
const cd = new CourtDirector(courtGeometry);

// 语义化站位
cd.placePlayer('Doraemon', 'northBaseline', { xOffset: 0, useDoubles: false });

// 球轨迹（自动查角色位置）
const flight = cd.computeBallFlight('Doraemon', 'Nobita', { speed: 8, arcHeight: 1.5 });
// => { startPos, endPos, arcHeight, duration, distance }

// 飞向固定坐标（失控球）
const flight2 = cd.computeBallFlightToPos('Doraemon', {x:4, y:1, z:-4}, { arcHeight: 1.2 });

// 相机机位（语义化）
const cam = cd.computeCamera('rallySide', 'Doraemon', { distance: 14, height: 4 });
// => { position: THREE.Vector3, lookAt: THREE.Vector3 }

// 挥拍时机（球到达前 30% swingDuration）
const swingTime = cd.computeSwingTime(flight, 55.0, 0.6);
```

---

**最后更新**：2026-04-18
