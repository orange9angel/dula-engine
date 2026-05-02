#!/usr/bin/env python3
"""
Generate audio files from SRT using Alibaba Cloud DashScope Sambert API.
This script provides high-quality Chinese TTS voices compared to edge-tts,
at the cost of requiring a DashScope API key.

Usage:
    1. Get a free API key from https://dashscope.console.aliyun.com/
    2. Set environment variable: $env:DASHSCOPE_API_KEY="your-key"
    3. Run: python tools/generate_audio_dashscope.py <episode-dir>

If the API key is missing or the API call fails, the script falls back to
edge-tts automatically.

Recommended Sambert presets for this project:
    - Doraemon : sambert-zhimao-v1   (知猫 — 活泼女声，模拟原版女配音员的高亢风格)
    - Nobita   : sambert-zhishuo-v1  (知硕 — 年轻男声，懦弱少年感)
    - Shizuka  : sambert-zhixia-v1   (知夏 — 温柔女声)
"""

import asyncio
import json
import math
import os
import re
import struct
import subprocess
import sys
import wave

try:
    import dashscope
    from dashscope.audio.tts import SpeechSynthesizer
except ImportError:
    dashscope = None
    SpeechSynthesizer = None

# Add project root to path for importing lib if needed
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Resolve episode path from CLI argument
EPISODE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "content", "episodes", "bichong_qiupai")
if not os.path.isabs(EPISODE):
    # Relative to current working directory (where npm script is run)
    EPISODE = os.path.join(os.getcwd(), EPISODE)
EPISODE = os.path.normpath(EPISODE)

STORY_PATH = os.path.join(EPISODE, "script.story")
OUTPUT_DIR = os.path.join(EPISODE, "assets", "audio")
MANIFEST_PATH = os.path.join(OUTPUT_DIR, "manifest.json")
SFX_DIR = os.path.join(OUTPUT_DIR, "sfx")

# Tennis hit SFX timing (seconds) — synced with Storyboard ball events
TENNIS_HIT_TIMES = [30.0, 32.5]

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
if DASHSCOPE_API_KEY and dashscope:
    dashscope.api_key = DASHSCOPE_API_KEY

# Load voice config from episode's voice_config.json if present
VOICE_CONFIG_PATH = os.path.join(EPISODE, "config", "voice_config.json")
VOICE_MAP = {}


def resolve_voice_params(cfg, emotion=None):
    """Resolve TTS parameters with optional emotion override.

    Supports two voice_config.json schemas:
    1. Flat (legacy): { "voice": "...", "rate": "...", ... }
    2. Emotion-aware: { "default": {...}, "excited": {...}, ... }

    Emotion variants inherit from 'default' and override specific fields.
    If emotion is not found, falls back to 'default', then flat config.
    """
    if "voice" in cfg or "model" in cfg:
        return cfg
    base = cfg.get("default", {})
    if emotion and emotion in cfg:
        variant = cfg[emotion].copy()
        for key in ("voice", "model", "rate", "pitch", "volume"):
            if key not in variant and key in base:
                variant[key] = base[key]
        return variant
    return base


if os.path.exists(VOICE_CONFIG_PATH):
    with open(VOICE_CONFIG_PATH, "r", encoding="utf-8") as f:
        voice_cfg = json.load(f)
    for char, cfg in voice_cfg.items():
        if isinstance(cfg, dict):
            # Handle both flat and emotion-aware configs
            base = resolve_voice_params(cfg)
            if "model" in base or "voice" in base:
                VOICE_MAP[char] = base
            else:
                # Default to a Sambert model if not specified
                VOICE_MAP[char] = {"model": "sambert-zhimao-v1"}
        else:
            VOICE_MAP[char] = {"model": str(cfg)}

# Default Sambert preset mapping — feel free to change these via env vars
DEFAULT_VOICE_MAP = {
    "Doraemon": {
        "model": os.environ.get("VOICE_DORAEMON", "sambert-zhimao-v1"),   # 知猫 — 活泼女声
    },
    "Nobita": {
        "model": os.environ.get("VOICE_NOBITA", "sambert-zhishuo-v1"),   # 知硕 — 年轻男声
    },
    "Shizuka": {
        "model": os.environ.get("VOICE_SHIZUKA", "sambert-zhimao-v1"),   # 知猫 — 活泼女声（zhixia 暂不可用）
    },
}
for char, cfg in DEFAULT_VOICE_MAP.items():
    if char not in VOICE_MAP:
        VOICE_MAP[char] = cfg

# Fallback edge-tts config (used when DashScope is unavailable)
EDGE_VOICE_MAP = {
    "Doraemon": {
        "voice": "zh-CN-XiaoxiaoNeural",
        "rate": "+20%",
        "pitch": "+20Hz",
        "volume": "+10%",
    },
    "Nobita": {
        "voice": "zh-CN-YunxiaNeural",
        "rate": "+0%",
        "pitch": "-10Hz",
        "volume": "+0%",
    },
    "Shizuka": {
        "voice": "zh-CN-XiaoyiNeural",
        "rate": "+0%",
        "pitch": "+5Hz",
        "volume": "+0%",
    },
    "Xiaoyue": {
        "voice": "zh-CN-XiaoxiaoNeural",
        "rate": "+5%",
        "pitch": "+5Hz",
        "volume": "+20%",
    },
    "Xingzai": {
        "voice": "zh-CN-YunxiNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
        "volume": "+20%",
    },
}


def parse_srt(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    entries = []
    music_cues = []
    i = 0
    while i < len(lines):
        if lines[i].strip() == "":
            i += 1
            continue
        index = int(lines[i].strip())
        i += 1
        if i >= len(lines):
            break
        time_line = lines[i].strip()
        i += 1
        m = re.match(
            r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})",
            time_line,
        )
        if not m:
            continue
        start = (
            int(m.group(1)) * 3600
            + int(m.group(2)) * 60
            + int(m.group(3))
            + int(m.group(4)) / 1000
        )
        end = (
            int(m.group(5)) * 3600
            + int(m.group(6)) * 60
            + int(m.group(7))
            + int(m.group(8)) / 1000
        )
        text_lines = []
        while i < len(lines) and lines[i].strip() != "":
            text_lines.append(lines[i].strip())
            i += 1
        content = "\n".join(text_lines)
        char_match = re.search(r"\[(\w+)\]", content)
        character = char_match.group(1) if char_match else None
        # Extract emotion tag {Voice:excited} or {Voice:calm}
        voice_emotion = None
        voice_match = re.search(r"\{Voice:([^}]+)\}", content)
        if voice_match:
            voice_emotion = voice_match.group(1).strip()

        dialogue = re.sub(r"^@\w+\s*", "", content)
        dialogue = re.sub(r"\[\w+\]\s*", "", dialogue)
        dialogue = re.sub(r"\{Camera:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Music:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Voice:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{[A-Za-z]\w*:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{(?!Camera:)\w+\}\s*", "", dialogue).strip()

        music_match = re.search(r"\{Music:([^}]+)\}", content)
        if music_match:
            parts = [p.strip() for p in music_match.group(1).split("|")]
            action = parts[0]
            options = {}
            for p in parts[1:]:
                if "=" in p:
                    k, v = p.split("=", 1)
                    try:
                        options[k.strip()] = float(v.strip())
                    except ValueError:
                        options[k.strip()] = v.strip()
            music_cues.append({
                "index": index,
                "startTime": start,
                "endTime": end,
                "action": action,
                "options": options,
            })

        entries.append({
            "index": index,
            "startTime": start,
            "endTime": end,
            "character": character,
            "dialogue": dialogue,
            "emotion": voice_emotion,
        })
    return entries, music_cues


def get_mp3_duration(mp3_path):
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', mp3_path],
        capture_output=True, text=True
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def generate_with_dashscope(text, model, output_path=None):
    """Call DashScope Sambert API. Returns True on success, False on failure."""
    if not DASHSCOPE_API_KEY or SpeechSynthesizer is None:
        return False

    try:
        result = SpeechSynthesizer.call(
            model=model,
            text=text,
            sample_rate=48000,
        )
        if result.get_audio_data():
            if output_path:
                with open(output_path, "wb") as f:
                    f.write(result.get_audio_data())
                # Fix broken WAV header from DashScope (nFrames is set to 0x7FFFFFFF)
                _fix_wav_header(output_path)
            return True
        else:
            print(f"  DashScope API returned empty audio")
            return False
    except Exception as e:
        print(f"  DashScope request failed: {e}")
        return False


def _fix_wav_header(wav_path):
    """Re-encode WAV to fix incorrect header from DashScope API."""
    temp_path = wav_path + ".fixed.wav"
    cmd = f'ffmpeg -y -i "{wav_path}" -acodec pcm_s16le -ar 48000 -ac 1 "{temp_path}"'
    try:
        subprocess.run(cmd, shell=True, check=True, capture_output=True)
        os.replace(temp_path, wav_path)
    except subprocess.CalledProcessError:
        # If ffmpeg fails, remove temp file and keep original
        if os.path.exists(temp_path):
            os.remove(temp_path)


async def generate_with_edgetts(text, voice, rate, pitch, volume, output_path):
    """Fallback to edge-tts."""
    import edge_tts
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
    )
    await communicate.save(output_path)


def generate_tennis_hit_sfx(filepath):
    sample_rate = 48000
    duration = 0.12
    num_samples = int(sample_rate * duration)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with wave.open(filepath, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for i in range(num_samples):
            t = i / sample_rate
            freq = 700 * math.exp(-t / 0.02)
            phase = 2 * math.pi * freq * t
            sine = math.sin(phase)
            noise = ((i * 9301 + 49297) % 233280) / 233280.0 * 2 - 1
            envelope = math.exp(-t / 0.02)
            sample = (sine * 0.6 + noise * 0.4) * envelope * 0.45
            sample_int = int(sample * 32767)
            sample_int = max(-32768, min(32767, sample_int))
            w.writeframes(struct.pack('<h', sample_int))
    print(f"Generated SFX: {filepath}")


def check_bgm_files(cues):
    # Check episode's materials/bgm/ first, then assets/audio/music/
    search_dirs = [
        os.path.join(EPISODE, "materials", "bgm"),
        os.path.join(EPISODE, "assets", "audio", "music"),
    ]
    missing = []
    for cue in cues:
        found = False
        for music_dir in search_dirs:
            file_path = os.path.join(music_dir, f"{cue['name']}.wav")
            if os.path.exists(file_path):
                found = True
                break
        if not found:
            missing.append(cue['name'])
    if missing:
        print(f"\n[WARNING] Missing BGM files: {missing}")
        print("Please download high-quality music tracks and place them in:")
        print(f"  {os.path.join(EPISODE, 'materials', 'bgm')}\n")
    return len(missing) == 0


def mix_bgm_track(cues, entries, duration, sample_rate=48000):
    n = int(duration * sample_rate)
    track = [0.0] * n

    duck_events = []
    for entry in entries:
        if entry.get("character") and entry.get("dialogue"):
            padding = 0.25
            duck_events.append({
                "startTime": max(0, entry["startTime"] - padding),
                "endTime": entry["endTime"] + padding,
                "depth": 0.55,
                "attack": 0.12,
                "release": 0.35,
            })
    if duck_events:
        duck_events.sort(key=lambda x: x["startTime"])
        merged = [duck_events[0]]
        for d in duck_events[1:]:
            last = merged[-1]
            if d["startTime"] <= last["endTime"] + 0.05:
                last["endTime"] = max(last["endTime"], d["endTime"])
                last["depth"] = min(last["depth"], d["depth"])
            else:
                merged.append(d)
        duck_events = merged

    for cue in cues:
        # Look for BGM in episode's materials/bgm/ first, then episode's assets/audio/music/
        file_path = os.path.join(EPISODE, "materials", "bgm", f"{cue['name']}.wav")
        if not os.path.exists(file_path):
            file_path = os.path.join(EPISODE, "assets", "audio", "music", f"{cue['name']}.wav")
        if not os.path.exists(file_path):
            # Fallback to legacy dula-assets location
            file_path = os.path.join(ROOT, "assets", "audio", "music", f"{cue['name']}.wav")
        if not os.path.exists(file_path):
            print(f"Warning: BGM file not found: {file_path}")
            continue

        with wave.open(file_path, 'r') as w:
            cue_sr = w.getframerate()
            cue_nch = w.getnchannels()
            cue_width = w.getsampwidth()
            cue_frames = w.getnframes()
            cue_data = w.readframes(cue_frames)

        fmt = '<h' if cue_nch == 1 else '<hh'
        frame_size = cue_width * cue_nch
        samples = []
        for i in range(0, len(cue_data), frame_size):
            val = struct.unpack(fmt, cue_data[i:i+frame_size])[0] / 32768.0
            samples.append(val)

        if cue_sr != sample_rate:
            ratio = cue_sr / sample_rate
            resampled = []
            idx = 0.0
            while int(idx) < len(samples):
                resampled.append(samples[int(idx)])
                idx += ratio
            samples = resampled

        start_sample = int(cue["startTime"] * sample_rate)
        end_time = cue.get("endTime", cue["startTime"] + len(samples) / sample_rate)
        fade_in = cue.get("fadeIn", 1.0)
        fade_out = cue.get("fadeOut", 1.0)
        base_vol = cue.get("baseVolume", 0.5)

        for i, s in enumerate(samples):
            idx = start_sample + i
            if idx >= n:
                break

            t = idx / sample_rate
            if t < cue["startTime"] or t > end_time:
                continue

            vol = base_vol
            if t < cue["startTime"] + fade_in and fade_in > 0:
                p = (t - cue["startTime"]) / fade_in
                vol *= math.sin(p * math.pi / 2)
            if t > end_time - fade_out and fade_out > 0:
                p = (end_time - t) / fade_out
                vol *= math.sin(p * math.pi / 2)

            for duck in duck_events:
                if t >= duck["startTime"] and t < duck["endTime"]:
                    if t < duck["startTime"] + duck["attack"] and duck["attack"] > 0:
                        p = (t - duck["startTime"]) / duck["attack"]
                        factor = 1.0 - (1.0 - duck["depth"]) * math.sin(p * math.pi / 2)
                    elif t > duck["endTime"] - duck["release"] and duck["release"] > 0:
                        p = (duck["endTime"] - t) / duck["release"]
                        factor = 1.0 - (1.0 - duck["depth"]) * math.sin(p * math.pi / 2)
                    else:
                        factor = duck["depth"]
                    vol *= factor
                    break

            track[idx] += s * vol

    for i in range(len(track)):
        track[i] = math.tanh(track[i] * 1.2) / 1.2

    bgm_path = os.path.join(OUTPUT_DIR, "_temp_bgm.wav")
    with wave.open(bgm_path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for s in track:
            v = int(s * 0.85 * 32767)
            v = max(-32768, min(32767, v))
            w.writeframes(struct.pack('<h', v))
    print(f"BGM track mixed: {bgm_path} ({duration:.2f}s)")
    return bgm_path


def mix_audio(manifest, bgm_path=None, sfx_events=None):
    entries = manifest["entries"]
    if not entries:
        cmd = f'ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=stereo -t 1 -acodec pcm_s16le "{os.path.join(OUTPUT_DIR, "mixed.wav")}"'
        subprocess.run(cmd, shell=True, check=True)
        return

    inputs = []
    filters = []
    stream_idx = 0
    for entry in entries:
        file_path = os.path.join(OUTPUT_DIR, entry["file"])
        inputs.append(f'-i "{file_path}"')
        delay_ms = int(round(entry["startTime"] * 1000))
        filters.append(f"[{stream_idx}:a]adelay={delay_ms}|{delay_ms}[ad{stream_idx}]")
        stream_idx += 1

    bgm_idx = None
    if bgm_path:
        inputs.append(f'-i "{bgm_path}"')
        filters.append(f"[{stream_idx}:a]adelay=0|0[bgm{stream_idx}]")
        bgm_idx = stream_idx
        stream_idx += 1

    if sfx_events:
        for sfx in sfx_events:
            inputs.append(f'-i "{sfx["file"]}"')
            delay_ms = int(round(sfx["startTime"] * 1000))
            filters.append(f"[{stream_idx}:a]adelay={delay_ms}|{delay_ms}[sfx{stream_idx}]")
            stream_idx += 1

    total_streams = stream_idx
    amix_inputs = "".join(f"[ad{i}]" for i in range(len(entries)))
    if bgm_path and bgm_idx is not None:
        amix_inputs += f"[bgm{bgm_idx}]"
    if sfx_events:
        sfx_start = len(entries) + (1 if bgm_path else 0)
        for idx in range(sfx_start, total_streams):
            amix_inputs += f"[sfx{idx}]"

    amix = f"{amix_inputs}amix=inputs={total_streams}:duration=longest:normalize=0[outa]"
    filter_complex = ";".join(filters + [amix])

    mixed_path = os.path.join(OUTPUT_DIR, "mixed.wav")
    cmd = f'ffmpeg -y {" ".join(inputs)} -filter_complex "{filter_complex}" -map "[outa]" -acodec pcm_s16le -ar 48000 "{mixed_path}"'
    print("Mixing audio into mixed.wav...")
    subprocess.run(cmd, shell=True, check=True)
    print(f"Mixed audio written to: {mixed_path}")


# Character-specific emotion dictionaries
CHARACTER_EMOTION_MAP = {
    "Doraemon": {
        "exasperated": ["真是的", "每次.*都", "又.*乱来", "真是.*麻烦", "拿你.*办法"],
        "proud": ["看我的", "没问题", "交给我", "放心.*吧", "简单"],
        "teasing": ["嘿嘿", "嘻嘻", "开玩笑", "骗你的", "吓唬.*你"],
    },
    "Nobita": {
        "defiant": ["才.*不会", "才.*没有", "才.*不是", "我.*学乖了", "这次.*真的"],
        "whiny": ["可是.*嘛", "但是.*啊", "为什么.*我", "不公平", "好.*辛苦"],
        "daydreaming": ["好想.*啊", "如果能.*就好了", "要是.*该多好", "真希望"],
        "triumphant": ["哼哼", "怎么样", "厉害吧", "我.*做到了", "成功.*了"],
    },
    "Shizuka": {
        "gentle": ["小心.*哦", "要注意", "慢慢来", "没关系.*的", "加油.*哦", "要小心.*"],
        "curious": ["为什么.*呢", "怎么.*回事", "那是什么", "好奇怪", "真的吗", "怎么.*天上", "怎么.*飞"],
        "concerned": ["没事吧", "没事吗", "还好吗", "要不要.*医务", "看起来.*累", "不要太.*了", "去医务室"],
    },
}


def infer_emotion(dialogue, character=None):
    """Infer emotion from dialogue text using punctuation, keywords, and character-specific patterns.

    Returns one of: excited, panic, scared, happy, worried, calm, angry, sad,
    exasperated, proud, teasing, defiant, whiny, daydreaming, triumphant,
    gentle, curious, concerned
    or None if no strong emotion detected.
    """
    if not dialogue:
        return None

    text = dialogue.strip()

    # Character-specific emotion detection
    if character and character in CHARACTER_EMOTION_MAP:
        char_map = CHARACTER_EMOTION_MAP[character]
        for emotion, patterns in char_map.items():
            for pattern in patterns:
                if re.search(pattern, text):
                    return emotion

    # Multiple exclamation marks = excited/panic
    if re.search(r'[!！]{2,}', text):
        if re.search(r'救命|救我|完蛋|死了|怎么办|不要.*啊|停.*下来', text):
            return "panic"
        return "excited"

    # Single exclamation with distress/pain = panic (prioritize over scared)
    if re.search(r'[！!]', text) and re.search(r'救命|救我|完蛋|死了|怎么办|不要.*啊|停.*下来|掉下来|好痛|好怕', text):
        return "panic"

    # Multiple question marks = confused/worried
    if re.search(r'[?？]{2,}', text):
        return "worried"

    # Ellipsis-heavy = scared/weak/sad (but only if there are emotional cues)
    if text.count('…') >= 3 or text.count('..') >= 3:
        if re.search(r'痛|怕|晕|软|可怕|不敢', text):
            return "scared"
        if re.search(r'呜|难过|伤心|失望|可惜|对不起|算了|自由|真好|怀念|想.*了', text) or len(text) < 15:
            return "sad"
        return None

    # Keyword matching
    panic_keywords = r'救命|救我|完蛋|死了|怎么办|不要.*啊|停.*下来|掉下来|小心'
    scared_keywords = r'好痛|好怕|好晕|腿软|可怕|不敢|好可怕|好危险|会死'
    excited_keywords = r'太棒了|真的吗|超厉害|好厉害|太厉害了|好想|太好了|超.*的|最.*了'
    happy_keywords = r'哈哈|嘻嘻|嘿嘿|真好|开心|高兴|喜欢|谢谢|拜拜'
    worried_keywords = r'没事吧|小心|要不要|没事吗|还好吗|注意|危险|不好了'
    angry_keywords = r'笨蛋|可恶|讨厌|烦人|气死|混蛋|乱来|每次.*都'
    sad_keywords = r'呜呜|好难过|伤心|失望|可惜|对不起|算了'

    if re.search(panic_keywords, text):
        return "panic"
    if re.search(scared_keywords, text):
        return "scared"
    if re.search(excited_keywords, text):
        return "excited"
    if re.search(happy_keywords, text):
        return "happy"
    if re.search(worried_keywords, text):
        return "worried"
    if re.search(angry_keywords, text):
        return "angry"
    if re.search(sad_keywords, text):
        return "sad"

    if re.search(r'[！!]', text):
        return "excited"

    return None


async def generate():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(STORY_PATH, "r", encoding="utf-8") as f:
        srt_text = f.read()

    entries, music_cues = parse_srt(srt_text)
    manifest = {"entries": []}

    use_dashscope = bool(DASHSCOPE_API_KEY)
    if use_dashscope:
        print("Using DashScope Sambert API for TTS generation.")
        print("(Set DASHSCOPE_API_KEY env var to use this; otherwise falls back to edge-tts)")
    else:
        print("DASHSCOPE_API_KEY not set. Falling back to edge-tts.")
        try:
            import edge_tts
        except ImportError:
            print("Please install edge-tts: pip install edge-tts")
            sys.exit(1)

    for entry in entries:
        char = entry["character"]
        dialogue = entry["dialogue"]
        emotion = entry.get("emotion")

        # Auto-infer emotion if not explicitly tagged
        inferred = None
        if not emotion:
            inferred = infer_emotion(dialogue, character=char)
            if inferred:
                emotion = inferred

        if not char or not dialogue:
            continue

        # Sambert outputs WAV, edge-tts outputs MP3
        ext = "wav" if use_dashscope else "mp3"
        filename = f"{entry['index']:03d}_{char}.{ext}"
        filepath = os.path.join(OUTPUT_DIR, filename)

        if use_dashscope:
            cfg = VOICE_MAP.get(char)
            if not cfg:
                print(f"Warning: no voice config for {char}, skipping.")
                continue
            # Resolve emotion-aware parameters
            params = resolve_voice_params(cfg, emotion)
            # If voice_config has 'voice' but no 'model', use edge-tts directly
            if "voice" in params and "model" not in params:
                print(f"Generating {filename} via edge-tts (voice={params['voice']})...")
                try:
                    import edge_tts
                except ImportError:
                    print("Please install edge-tts: pip install edge-tts")
                    sys.exit(1)
                filename = f"{entry['index']:03d}_{char}.mp3"
                filepath = os.path.join(OUTPUT_DIR, filename)
                await generate_with_edgetts(
                    dialogue, params["voice"], params.get("rate", "+0%"),
                    params.get("pitch", "+0Hz"), params.get("volume", "+0%"), filepath
                )
            else:
                model = params.get("model", "sambert-zhimao-v1")
                emotion_label = ""
                if emotion:
                    source = "tag" if entry.get("emotion") else "auto"
                    emotion_label = f" [{emotion}:{source}]"
                print(f"Generating{emotion_label} {filename} via DashScope (model={model})...")
                result = generate_with_dashscope(
                    dialogue,
                    model,
                    output_path=filepath,
                )
                if not result:
                    print(f"  DashScope failed for {filename}, falling back to edge-tts for this line...")
                    try:
                        import edge_tts
                    except ImportError:
                        print("Please install edge-tts: pip install edge-tts")
                        sys.exit(1)
                    # Fallback to mp3
                    filename = f"{entry['index']:03d}_{char}.mp3"
                    filepath = os.path.join(OUTPUT_DIR, filename)
                    cfg = EDGE_VOICE_MAP.get(char)
                    if cfg:
                        await generate_with_edgetts(
                            dialogue, cfg["voice"], cfg.get("rate", "+0%"),
                            cfg.get("pitch", "+0Hz"), cfg.get("volume", "+0%"), filepath
                        )
                    else:
                        continue
        else:
            cfg = EDGE_VOICE_MAP.get(char)
            if not cfg:
                print(f"Warning: no voice config for {char}, skipping.")
                continue
            await generate_with_edgetts(
                dialogue, cfg["voice"], cfg.get("rate", "+0%"),
                cfg.get("pitch", "+0Hz"), cfg.get("volume", "+0%"), filepath
            )

        audio_duration = get_mp3_duration(filepath)
        print(f"Generated: {filename} ({audio_duration:.2f}s)")

        manifest["entries"].append({
            "index": entry["index"],
            "startTime": entry["startTime"],
            "endTime": entry["endTime"],
            "character": char,
            "dialogue": dialogue,
            "file": filename,
            "audioDuration": audio_duration,
        })

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest written to: {MANIFEST_PATH}")

    bgm_path = None
    if music_cues:
        max_time = max(e["endTime"] for e in entries) if entries else 70.0
        cues = []
        for cue in music_cues:
            opts = cue["options"]
            cues.append({
                "name": opts.get("name", "theme"),
                "startTime": cue["startTime"],
                "endTime": opts.get("endTime", max_time),
                "fadeIn": opts.get("fadeIn", 1.0),
                "fadeOut": opts.get("fadeOut", 1.0),
                "baseVolume": opts.get("baseVolume", 0.5),
            })
        if check_bgm_files(cues):
            bgm_path = mix_bgm_track(cues, entries, max_time + 1.0)
        else:
            print("Skipping BGM mix — files missing.")

    sfx_events = []
    tennis_hit_path = os.path.join(SFX_DIR, "tennis_hit.wav")
    generate_tennis_hit_sfx(tennis_hit_path)
    for t in TENNIS_HIT_TIMES:
        sfx_events.append({"file": tennis_hit_path, "startTime": t})

    mix_audio(manifest, bgm_path, sfx_events)


if __name__ == "__main__":
    asyncio.run(generate())
