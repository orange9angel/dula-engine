#!/usr/bin/env python3
"""
Generate audio files from SRT using edge-tts.
Reads script/script.story and outputs MP3 files to assets/audio/.
Also generates assets/audio/manifest.json and assets/audio/mixed.wav.
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

# Add project root to path for importing lib if needed
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Resolve episode path from CLI argument
EPISODE = sys.argv[1] if len(sys.argv) > 1 else "."
if not os.path.isabs(EPISODE):
    EPISODE = os.path.join(os.getcwd(), EPISODE)

STORY_PATH = os.path.join(EPISODE, "script.story")
OUTPUT_DIR = os.path.join(EPISODE, "assets", "audio")
MANIFEST_PATH = os.path.join(OUTPUT_DIR, "manifest.json")
SFX_DIR = os.path.join(OUTPUT_DIR, "sfx")

VOICE_CONFIG_PATH = os.path.join(EPISODE, "config", "voice_config.json")
CHOREOGRAPHY_PATH = os.path.join(EPISODE, "config", "choreography.json")


def load_voice_config():
    with open(VOICE_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_voice_params(cfg, emotion=None):
    """Resolve TTS parameters with optional emotion override.

    Supports two voice_config.json schemas:
    1. Flat (legacy): { "voice": "...", "rate": "...", ... }
    2. Emotion-aware: { "default": {...}, "excited": {...}, ... }

    Emotion variants inherit from 'default' and override specific fields.
    If emotion is not found, falls back to 'default', then flat config.
    """
    # Legacy flat config
    if "voice" in cfg:
        return cfg

    # Emotion-aware config
    base = cfg.get("default", {})
    if emotion and emotion in cfg:
        variant = cfg[emotion].copy()
        # Inherit missing fields from default
        for key in ("voice", "model", "rate", "pitch", "volume"):
            if key not in variant and key in base:
                variant[key] = base[key]
        return variant
    return base


# Character-specific emotion dictionaries
# Maps character name -> {emotion_name: [trigger_keywords]}
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

    Priority: explicit tags > character-specific > punctuation patterns > general keyword matching
    """
    if not dialogue:
        return None

    text = dialogue.strip()

    # Character-specific emotion detection (highest priority after explicit tags)
    if character and character in CHARACTER_EMOTION_MAP:
        char_map = CHARACTER_EMOTION_MAP[character]
        for emotion, patterns in char_map.items():
            for pattern in patterns:
                if re.search(pattern, text):
                    return emotion

    # Punctuation-based patterns (Chinese and Western)
    # Multiple exclamation marks = excited/panic
    if re.search(r'[!！]{2,}', text):
        # Panic keywords take precedence over excitement
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
        # Only mark as sad if there are sadness keywords or the text is short
        if re.search(r'呜|难过|伤心|失望|可惜|对不起|算了|自由|真好|怀念|想.*了', text) or len(text) < 15:
            return "sad"
        # Otherwise neutral (just pausing/breathing)
        return None

    # Keyword matching (order matters - more specific first)
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

    # Default: calm for statements, slight excitement for single exclamation
    if re.search(r'[！!]', text):
        return "excited"

    return None


def load_tennis_hit_times():
    """Derive SFX timings from choreography ball events; fallback to defaults."""
    try:
        with open(CHOREOGRAPHY_PATH, "r", encoding="utf-8") as f:
            choreo = json.load(f)
        park = choreo.get("parkScene", {})
        ball_events = park.get("ballEvents", [])
        return [ev["startTime"] for ev in ball_events if "startTime" in ev]
    except Exception:
        return [30.0, 32.5]


def parse_story(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    entries = []
    music_cues = []
    story_events = []
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
        dialogue = re.sub(r"\{Hitstop\|[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{(?!Camera:)\w+\}\s*", "", dialogue).strip()

        # Parse all event tags from content
        event_tags = re.findall(r"\{(\w+):([^}]+)\}", content)
        for tag_name, tag_body in event_tags:
            story_events.append({
                "index": index,
                "startTime": start,
                "endTime": end,
                "type": tag_name,
                "body": tag_body,
            })

        # Parse music cue
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

        entries.append(
            {
                "index": index,
                "startTime": start,
                "endTime": end,
                "character": character,
                "dialogue": dialogue,
                "emotion": voice_emotion,
            }
        )
    return entries, music_cues, story_events


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


def generate_punch_hit_sfx(filepath, duration=0.15, sample_rate=48000):
    """Punch impact: low thud + sharp crack."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Low thud
        thud = math.sin(2 * math.pi * 120 * t) * math.exp(-t / 0.03) * 0.5
        # Sharp crack (higher freq)
        crack = math.sin(2 * math.pi * 800 * t) * math.exp(-t / 0.01) * 0.3
        # Noise burst
        noise = ((i * 1103515245 + 12345) % 2147483647) / 2147483647.0 * 2 - 1
        noise = noise * math.exp(-t / 0.02) * 0.2
        sample = (thud + crack + noise) * 0.6
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_kick_impact_sfx(filepath, duration=0.18, sample_rate=48000):
    """Kick impact: deeper thud than punch."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Deep thud
        thud = math.sin(2 * math.pi * 80 * t) * math.exp(-t / 0.04) * 0.6
        # Mid crunch
        crunch = math.sin(2 * math.pi * 400 * t) * math.exp(-t / 0.015) * 0.25
        # Noise
        noise = ((i * 1103515245 + 12345) % 2147483647) / 2147483647.0 * 2 - 1
        noise = noise * math.exp(-t / 0.025) * 0.15
        sample = (thud + crunch + noise) * 0.6
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_sword_slash_sfx(filepath, duration=0.25, sample_rate=48000):
    """Sword slash: fast whoosh + metallic ring."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Fast frequency sweep (high to low)
        freq = 2000 * math.exp(-t / 0.08)
        phase = 2 * math.pi * freq * t
        whoosh = math.sin(phase) * math.exp(-t / 0.06) * 0.4
        # Metallic ring
        ring = math.sin(2 * math.pi * 1200 * t) * math.exp(-t / 0.1) * 0.2
        # Noise burst
        noise = ((i * 16807 + 0) % 2147483647) / 2147483647.0 * 2 - 1
        noise = noise * math.exp(-t / 0.04) * 0.15
        sample = (whoosh + ring + noise) * 0.5
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_energy_blast_sfx(filepath, duration=0.3, sample_rate=48000):
    """Energy blast: charging hum + explosive release."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Charging hum (rising)
        hum_freq = 200 + 400 * min(1.0, t / 0.1)
        hum = math.sin(2 * math.pi * hum_freq * t) * 0.3
        # Explosive burst at start
        burst = math.sin(2 * math.pi * 600 * t) * math.exp(-t / 0.05) * 0.5
        # Noise
        noise = ((i * 1103515245 + 12345) % 2147483647) / 2147483647.0 * 2 - 1
        noise = noise * math.exp(-t / 0.08) * 0.2
        sample = (hum + burst + noise) * 0.5
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_dash_whoosh_sfx(filepath, duration=0.2, sample_rate=48000):
    """Dash whoosh: fast air movement."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Rising then falling freq sweep
        freq = 800 * (1 - t / duration) + 200
        phase = 2 * math.pi * freq * t
        whoosh = math.sin(phase) * 0.3
        # Noise with envelope
        noise = ((i * 16807 + 0) % 2147483647) / 2147483647.0 * 2 - 1
        env = math.exp(-t / 0.08) if t > 0.02 else (t / 0.02)
        noise = noise * env * 0.35
        sample = (whoosh + noise) * 0.5
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_tennis_hit_sfx(filepath):
    """Generate a short 'pop' tennis hit sound effect."""
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
            # Frequency sweep from high to low for a 'thwack'
            freq = 700 * math.exp(-t / 0.02)
            phase = 2 * math.pi * freq * t
            sine = math.sin(phase)
            # Deterministic pseudo-noise
            noise = ((i * 9301 + 49297) % 233280) / 233280.0 * 2 - 1
            envelope = math.exp(-t / 0.02)
            sample = (sine * 0.6 + noise * 0.4) * envelope * 0.45
            sample_int = int(sample * 32767)
            sample_int = max(-32768, min(32767, sample_int))
            w.writeframes(struct.pack('<h', sample_int))
    print(f"Generated SFX: {filepath}")


def _write_wav_mono(filepath, samples, sample_rate=48000):
    """Helper to write mono float samples to WAV."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with wave.open(filepath, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for s in samples:
            v = int(s * 32767)
            v = max(-32768, min(32767, v))
            w.writeframes(struct.pack('<h', v))


def generate_wind_strong(filepath, duration=4.0, sample_rate=48000):
    """Strong howling wind using filtered noise + low-frequency rumble."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Pseudo-random noise
        noise = ((i * 9301 + 49297) % 233280) / 233280.0 * 2 - 1
        # Slow amplitude modulation for gusts
        gust = 0.6 + 0.4 * math.sin(2 * math.pi * 0.3 * t) * math.sin(2 * math.pi * 0.07 * t)
        # Low rumble
        rumble = math.sin(2 * math.pi * 45 * t) * 0.3
        sample = (noise * 0.5 + rumble) * gust * 0.25
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_wind_gentle(filepath, duration=4.0, sample_rate=48000):
    """Gentle breeze: softer filtered noise."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        noise = ((i * 16807 + 0) % 2147483647) / 2147483647.0 * 2 - 1
        gust = 0.5 + 0.5 * math.sin(2 * math.pi * 0.15 * t)
        sample = noise * gust * 0.12
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_fall_whistle(filepath, duration=1.5, sample_rate=48000):
    """Cartoon falling whistle: fast frequency drop."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Frequency drops from 1200Hz to 200Hz exponentially
        freq = 200 + 1000 * math.exp(-t / 0.35)
        phase = 2 * math.pi * freq * t
        # Slight vibrato
        vibrato = math.sin(2 * math.pi * 8 * t) * 15
        sample = math.sin(phase + vibrato) * 0.4
        # Fade in quickly then fade out
        env = min(1.0, t / 0.05) * math.exp(-t / 0.8)
        samples.append(sample * env)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_impact_thud(filepath, duration=0.4, sample_rate=48000):
    """Heavy body impact: low freq thud + noise burst."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        # Low sine thud
        thud_freq = 80 * math.exp(-t / 0.08)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.12) * 0.6
        # Noise crunch
        noise = ((i * 1103515245 + 12345) % 2147483647) / 2147483647.0 * 2 - 1
        crunch = noise * math.exp(-t / 0.03) * 0.3
        sample = (thud + crunch) * 0.5
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_whoosh_fast(filepath, duration=0.5, sample_rate=48000):
    """Fast air whoosh: noise burst with rising-then-falling filter sweep."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        noise = ((i * 16807 + 0) % 2147483647) / 2147483647.0 * 2 - 1
        # Envelope: quick attack, quick decay
        env = math.exp(-t / 0.08) if t > 0.02 else (t / 0.02)
        sample = noise * env * 0.35
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_takecopter_spin(filepath, duration=2.0, sample_rate=48000):
    """Take-copter spinning: pulsing motor whir with Doppler-like modulation."""
    n = int(sample_rate * duration)
    samples = []
    base_freq = 180  # Base motor hum
    for i in range(n):
        t = i / sample_rate
        # Rising pitch simulates spinning up
        spin_up = min(1.0, t / 0.5)
        freq = base_freq * (1 + 0.5 * spin_up)
        # Pulse wave (rotor blades)
        pulse = 1.0 if (math.sin(2 * math.pi * freq * t) > 0) else -1.0
        # Higher harmonic for mechanical whine
        whine = math.sin(2 * math.pi * freq * 3.5 * t) * 0.3
        # Slow amplitude wobble
        wobble = 0.7 + 0.3 * math.sin(2 * math.pi * 12 * t)
        sample = (pulse * 0.5 + whine) * wobble * 0.25
        # Overall envelope
        env = min(1.0, t / 0.1) * (1.0 if t < duration - 0.3 else (duration - t) / 0.3)
        samples.append(sample * env)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def discover_manual_sfx():
    """Scan materials/sfx/, materials/audio/, and assets/audio/sfx/ for sound effects."""
    sfx_dirs = [
        os.path.join(EPISODE, "materials", "sfx"),
        os.path.join(EPISODE, "materials", "audio"),
        os.path.join(EPISODE, "assets", "audio", "sfx"),
    ]
    found = {}
    for d in sfx_dirs:
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.lower().endswith(('.wav', '.mp3', '.ogg', '.flac')):
                name = os.path.splitext(f)[0]
                if name not in found:
                    found[name] = os.path.join(d, f)
    return found


def schedule_sfx_from_events(story_events, manual_sfx):
    """Map story events to SFX files based on trigger hints and heuristics.

    Skips auto-mapping for entries that already have an explicit {SFX:Play|name=...} tag.
    """
    scheduled = []
    if not manual_sfx:
        return scheduled

    # Collect times that already have explicit SFX tags
    explicit_sfx_times = set()
    for ev in story_events:
        if ev["type"] == "SFX":
            explicit_sfx_times.add(ev["startTime"])

    # Helper: find best matching SFX by keyword (prefer longer/more specific names)
    def find_sfx(*keywords):
        names_by_lower = {name.lower(): path for name, path in manual_sfx.items()}
        for kw in keywords:
            exact = names_by_lower.get(kw.lower())
            if exact:
                return exact

        candidates = []
        for kw in keywords:
            for name, path in manual_sfx.items():
                if kw.lower() in name.lower():
                    candidates.append((len(name), name, path))
        if candidates:
            # Prefer longer name = more specific match
            candidates.sort(reverse=True)
            return candidates[0][2]
        return None

    for ev in story_events:
        etype = ev["type"]
        body = ev["body"]
        t = ev["startTime"]
        sfx_file = None

        if etype == "Prop" and "TakeCopter" in body:
            sfx_file = find_sfx("takecopter", "propeller", "spin", "helicopter")
            if sfx_file:
                scheduled.append({"file": sfx_file, "startTime": t})

        elif etype == "Event" and "Move" in body:
            # Check for vertical movement
            y_match = re.search(r"y=([-\d.]+)", body)
            if y_match:
                y_val = float(y_match.group(1))
                if y_val < 0:
                    # Falling
                    sfx_file = find_sfx("fall", "whistle")
                    if sfx_file:
                        scheduled.append({"file": sfx_file, "startTime": t})
                elif y_val > 2:
                    # Fast ascent
                    sfx_file = find_sfx("whoosh", "swoosh", "fast")
                    if sfx_file:
                        scheduled.append({"file": sfx_file, "startTime": t})

        elif etype == "Camera":
            if "Shake" in body:
                sfx_file = find_sfx("impact", "thud", "crash")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "WhipPan" in body:
                sfx_file = find_sfx("whoosh", "swoosh")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})

        elif etype == "Dunk":
            # Parse dunk parameters and estimate slam time using physics
            jh_match = re.search(r"jumpHeight=([\d.]+)", body)
            ht_match = re.search(r"hangTime=([\d.]+)", body)
            ru_match = re.search(r"runUpDistance=([\d.]+)", body)
            jump_h = float(jh_match.group(1)) if jh_match else 3.5
            hang_t = float(ht_match.group(1)) if ht_match else 0.5
            run_d = float(ru_match.group(1)) if ru_match else 4.0
            g = 9.8
            run_up = max(1.0, run_d / 4.0)
            v0 = (2 * g * jump_h) ** 0.5
            ascent = v0 / g
            peak = run_up + ascent
            hang_end = peak + hang_t
            fall_dist = max(0.01, jump_h - 3.05)
            descent = (2 * fall_dist / g) ** 0.5
            slam_time = t + hang_end + descent
            # Schedule whoosh at takeoff and dunk_slam at rim contact
            whoosh_file = find_sfx("whoosh", "swoosh")
            if whoosh_file:
                scheduled.append({"file": whoosh_file, "startTime": t + run_up})
            dunk_file = find_sfx("dunk_slam", "dunk", "slam")
            if dunk_file:
                scheduled.append({"file": dunk_file, "startTime": slam_time})

        elif etype == "Scene":
            # Scene transitions can trigger ambient changes
            pass  # Ambient is handled separately if needed

        elif etype == "Animation":
            # Skip auto-mapping if this time already has an explicit SFX tag
            if t in explicit_sfx_times:
                continue
            # Map fighting animations to SFX
            if "Punch" in body or "ComboPunch" in body or "Hook" in body:
                sfx_file = find_sfx("punch_hit", "punch", "hit")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "ArcadeSpinKick" in body:
                sfx_file = find_sfx("spin_kick_impact", "kick_impact", "kick")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "Kick" in body or "SpinKick" in body:
                sfx_file = find_sfx("kick_impact", "kick")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "BoxerGuardHop" in body:
                sfx_file = find_sfx("guard_hop", "dash_whoosh", "whoosh")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "SpiritSwordSwing" in body:
                sfx_file = find_sfx("sword_slash", "slash", "sword")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "SpiritGunFire" in body:
                sfx_file = find_sfx("energy_blast", "blast", "energy")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "DashForward" in body or "JumpAttack" in body:
                sfx_file = find_sfx("dash_whoosh", "whoosh", "dash")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})
            elif "HitStagger" in body or "Knockdown" in body:
                sfx_file = find_sfx("impact_thud", "impact", "thud")
                if sfx_file:
                    scheduled.append({"file": sfx_file, "startTime": t})

        elif etype == "SFX":
            # Parse SFX body: Play|name=xxx|offset=1.5
            sfx_name = None
            offset = 0.0
            if "|" in body:
                parts = body.split("|")
                if parts[0] == "Play" and len(parts) > 1:
                    for p in parts[1:]:
                        if "=" in p:
                            k, v = p.split("=", 1)
                            k = k.strip()
                            v = v.strip()
                            if k == "name":
                                sfx_name = v
                            elif k == "offset":
                                try:
                                    offset = float(v)
                                except ValueError:
                                    pass
            if not sfx_name:
                sfx_name = body
            sfx_file = find_sfx(sfx_name)
            if sfx_file:
                scheduled.append({"file": sfx_file, "startTime": t + offset})

    return scheduled


def check_bgm_files(cues):
    """Check that referenced BGM files exist; warn if missing."""
    music_dir = os.path.join(OUTPUT_DIR, "music")
    missing = []
    for cue in cues:
        if "file" in cue:
            # Direct file path from voice_config
            if not os.path.exists(cue["file"]):
                missing.append(cue["file"])
        else:
            file_path = os.path.join(music_dir, f"{cue['name']}.wav")
            if not os.path.exists(file_path):
                missing.append(cue['name'])
    if missing:
        print(f"\n[WARNING] Missing BGM files: {missing}")
        print("Please download high-quality music tracks and place them in:")
        print(f"  {music_dir}")
        print(f"See {EPISODE}/assets/audio/music/README.md for sourcing guide.\n")
    return len(missing) == 0


def mix_bgm_track(cues, entries, duration, sample_rate=48000):
    """
    将多个 BGM cue 混合成一条总线，自动应用：
    - Fade In/Out（正弦曲线）
    - Sidechain Ducking（对话避让，带 Attack/Release）
    """
    n = int(duration * sample_rate)
    track = [0.0] * n

    # Build duck events from dialogue entries
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
    # Merge overlapping duck events
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
        if "file" in cue:
            file_path = cue["file"]
        else:
            file_path = os.path.join(EPISODE, "assets", "audio", "music", f"{cue['name']}.wav")
        if not os.path.exists(file_path):
            print(f"Warning: BGM file not found: {file_path}")
            continue

        with wave.open(file_path, 'r') as w:
            cue_sr = w.getframerate()
            cue_nch = w.getnchannels()
            cue_width = w.getsampwidth()
            cue_frames = w.getnframes()
            cue_data = w.readframes(cue_frames)

        # Decode samples (assume 16-bit)
        fmt = '<h' if cue_nch == 1 else '<hh'
        frame_size = cue_width * cue_nch
        samples = []
        for i in range(0, len(cue_data), frame_size):
            val = struct.unpack(fmt, cue_data[i:i+frame_size])[0] / 32768.0
            samples.append(val)

        # Resample if needed (naive nearest-neighbor for simplicity)
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
            # Fade In (sine ease)
            if t < cue["startTime"] + fade_in and fade_in > 0:
                p = (t - cue["startTime"]) / fade_in
                vol *= math.sin(p * math.pi / 2)
            # Fade Out (sine ease)
            if t > end_time - fade_out and fade_out > 0:
                p = (end_time - t) / fade_out
                vol *= math.sin(p * math.pi / 2)

            # Ducking
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

    # Soft limiter
    for i in range(len(track)):
        track[i] = math.tanh(track[i] * 1.2) / 1.2

    # Save temp BGM track
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
    mixed_path = os.path.join(OUTPUT_DIR, "mixed.wav")

    if not entries and not bgm_path and not sfx_events:
        cmd = f'ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=stereo -t 1 -acodec pcm_s16le "{mixed_path}"'
        subprocess.run(cmd, shell=True, check=True)
        return

    # Stage 1: Mix all dialogue entries into a single temp track
    dialogue_path = os.path.join(OUTPUT_DIR, "_temp_dialogue.wav")
    if entries:
        inputs = []
        filters = []
        for i, entry in enumerate(entries):
            file_path = os.path.join(OUTPUT_DIR, entry["file"])
            inputs.append(f'-i "{file_path}"')
            delay_ms = int(round(entry["startTime"] * 1000))
            filters.append(f"[{i}:a]atrim=start=0.2,adelay={delay_ms}|{delay_ms}[d{i}]")

        amix_inputs = "".join(f"[d{i}]" for i in range(len(entries)))
        n_entries = len(entries)
        amix = f"{amix_inputs}amix=inputs={n_entries}:duration=longest:normalize=0[dialogue]"
        filter_complex = ";".join(filters + [amix])

        cmd = f'ffmpeg -y {" ".join(inputs)} -filter_complex "{filter_complex}" -map "[dialogue]" -acodec pcm_s16le -ar 48000 "{dialogue_path}"'
        print("Mixing dialogue track...")
        subprocess.run(cmd, shell=True, check=True)
    else:
        dialogue_path = None

    # Stage 2: Mix all SFX into a single temp track
    sfx_path = os.path.join(OUTPUT_DIR, "_temp_sfx.wav")
    if sfx_events:
        inputs = []
        filters = []
        n_sfx = len(sfx_events)
        for i, sfx in enumerate(sfx_events):
            inputs.append(f'-i "{sfx["file"]}"')
            delay_ms = int(round(sfx["startTime"] * 1000))
            # Pre-scale each SFX to compensate for amix normalize
            vol = sfx.get("volume", 1.0)
            filters.append(f"[{i}:a]adelay={delay_ms}|{delay_ms},volume={vol}[s{i}]")

        amix_inputs = "".join(f"[s{i}]" for i in range(n_sfx))
        amix = f"{amix_inputs}amix=inputs={n_sfx}:duration=longest:normalize=0[sfxout]"
        filter_complex = ";".join(filters + [amix])

        cmd = f'ffmpeg -y {" ".join(inputs)} -filter_complex "{filter_complex}" -map "[sfxout]" -acodec pcm_s16le -ar 48000 "{sfx_path}"'
        print("Mixing SFX track...")
        subprocess.run(cmd, shell=True, check=True)
    else:
        sfx_path = None

    # Stage 3: Final mix of dialogue + BGM + SFX
    final_inputs = []
    final_filters = []
    stream_idx = 0

    # Load optional audio mix config
    audio_mix_path = os.path.join(EPISODE, "config", "audio_mix.json")
    mix_cfg = {}
    if os.path.exists(audio_mix_path):
        with open(audio_mix_path, "r", encoding="utf-8") as f:
            mix_cfg = json.load(f)

    dialogue_vol = mix_cfg.get("dialogueVolume", 2.5)
    bgm_vol = mix_cfg.get("bgmVolume", 1.0)
    sfx_vol = mix_cfg.get("sfxVolume", 1.0)
    use_ducking = mix_cfg.get("useDucking", False)
    duck_depth = mix_cfg.get("duckDepth", 0.3)

    if dialogue_path:
        final_inputs.append(f'-i "{dialogue_path}"')
        final_filters.append(f"[{stream_idx}:a]volume={dialogue_vol}[dialogue{stream_idx}]")
        stream_idx += 1

    if bgm_path:
        final_inputs.append(f'-i "{bgm_path}"')
        if use_ducking and dialogue_path:
            # Sidechain ducking: BGM is reduced when dialogue is present
            # sidechaincompress needs 2 inputs: [main][sidechain]
            final_filters.append(f"[{stream_idx}:a][0:a]sidechaincompress=threshold=0.02:ratio=4:attack=50:release=300:level_in=1.0:mix={duck_depth}[bgm{stream_idx}]")
        else:
            final_filters.append(f"[{stream_idx}:a]volume={bgm_vol}[bgm{stream_idx}]")
        stream_idx += 1

    if sfx_path:
        final_inputs.append(f'-i "{sfx_path}"')
        final_filters.append(f"[{stream_idx}:a]volume={sfx_vol}[sfx{stream_idx}]")
        stream_idx += 1

    if stream_idx == 0:
        return

    amix_inputs = ""
    for i in range(stream_idx):
        label = "dialogue" if i == 0 and dialogue_path else ("bgm" if i == (1 if dialogue_path else 0) and bgm_path else "sfx")
        amix_inputs += f"[{label}{i}]"

    amix = f"{amix_inputs}amix=inputs={stream_idx}:duration=longest:normalize=0[outa];[outa]alimiter=level_in=1.0:level_out=1.0:limit=0.95,volume=0.89[limited]"
    filter_complex = ";".join(final_filters + [amix])

    cmd = f'ffmpeg -y {" ".join(final_inputs)} -filter_complex "{filter_complex}" -map "[limited]" -acodec pcm_s16le -ar 48000 "{mixed_path}"'
    print("Mixing final audio into mixed.wav...")
    subprocess.run(cmd, shell=True, check=True)
    print(f"Mixed audio written to: {mixed_path}")


async def generate(force_tts=False):
    try:
        import edge_tts
    except ImportError:
        print("Please install edge-tts: pip install edge-tts")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(STORY_PATH, "r", encoding="utf-8") as f:
        story_text = f.read()

    entries, music_cues, story_events = parse_story(story_text)
    voice_config = load_voice_config()
    tennis_hit_times = load_tennis_hit_times()
    manifest = {
        "entries": [],
    }

    # Collect SFX and BGM events from voice_config and story tags
    sfx_events = []
    bgm_cues = []

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
        cfg = voice_config.get(char)
        if not cfg:
            print(f"Warning: no voice config for {char}, skipping.")
            continue

        # Handle SFX type config (pre-recorded sound effects like roars)
        if cfg.get("type") == "sfx":
            sfx_file = cfg.get("file")
            if sfx_file:
                full_path = os.path.join(EPISODE, sfx_file)
                if os.path.exists(full_path):
                    sfx_events.append({
                        "file": full_path,
                        "startTime": entry["startTime"],
                        "volume": cfg.get("volume", 1.0),
                    })
                    print(f"Scheduled SFX: {char} @ {entry['startTime']:.2f}s -> {sfx_file}")
                else:
                    print(f"Warning: SFX file not found: {full_path}")
            continue

        # Handle BGM type config
        if cfg.get("type") == "bgm":
            bgm_file = cfg.get("file")
            if bgm_file:
                full_path = os.path.join(EPISODE, bgm_file)
                if os.path.exists(full_path):
                    bgm_cues.append({
                        "name": char,
                        "file": full_path,
                        "startTime": entry["startTime"],
                        "endTime": entry["endTime"],
                        "volume": cfg.get("volume", 0.6),
                        "loop": cfg.get("loop", True),
                    })
                    print(f"Scheduled BGM: {char} @ {entry['startTime']:.2f}s -> {bgm_file}")
                else:
                    print(f"Warning: BGM file not found: {full_path}")
            continue

        # Resolve emotion-aware parameters
        params = resolve_voice_params(cfg, emotion)
        if not params.get("voice") and not params.get("model"):
            print(f"Warning: no voice resolved for {char} (emotion={emotion}), skipping.")
            continue

        # Edge-tts requires a voice parameter; fallback if only model is set
        voice = params.get("voice")
        if not voice:
            # Map common DashScope models to edge-tts voices
            model = params.get("model", "")
            if "zhimao" in model:
                voice = "zh-CN-YunxiNeural"
            elif "zhishuo" in model:
                voice = "zh-CN-YunxiaNeural"
            else:
                voice = "zh-CN-XiaoxiaoNeural"
            print(f"  Info: using edge-tts fallback voice {voice} for {char} (model={model})")

        filename = f"{entry['index']:03d}_{char}.mp3"
        filepath = os.path.join(OUTPUT_DIR, filename)

        if os.path.exists(filepath) and not force_tts:
            audio_duration = get_mp3_duration(filepath)
            print(f"Skipped (exists): {filename} ({audio_duration:.2f}s)")
        else:
            emotion_label = ""
            if emotion:
                source = "tag" if entry.get("emotion") else "auto"
                emotion_label = f" [{emotion}:{source}]"
            communicate = edge_tts.Communicate(
                text=dialogue,
                voice=voice,
                rate=params.get("rate", "+0%"),
                pitch=params.get("pitch", "+0Hz"),
                volume=params.get("volume", "+0%"),
            )
            await communicate.save(filepath)
            audio_duration = get_mp3_duration(filepath)
            print(f"Generated:{emotion_label} {filename} ({audio_duration:.2f}s)")

        manifest["entries"].append(
            {
                "index": entry["index"],
                "startTime": entry["startTime"],
                "endTime": entry["endTime"],
                "character": char,
                "dialogue": dialogue,
                "file": filename,
                "audioDuration": audio_duration,
            }
        )

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest written to: {MANIFEST_PATH}")

    # Discover manual SFX / ambient files
    manual_sfx = discover_manual_sfx()
    if manual_sfx:
        print(f"\n[Manual SFX] Found {len(manual_sfx)} file(s):")
        for name, path in manual_sfx.items():
            print(f"  - {name}: {path}")

    # Generate procedural SFX for missing ones
    procedural_sfx_dir = os.path.join(EPISODE, "assets", "audio", "sfx")
    os.makedirs(procedural_sfx_dir, exist_ok=True)

    needed_procedural = {
        "wind_strong": (generate_wind_strong, 4.0),
        "wind_gentle": (generate_wind_gentle, 4.0),
        "fall_whistle": (generate_fall_whistle, 1.5),
        "impact_thud": (generate_impact_thud, 0.4),
        "whoosh_fast": (generate_whoosh_fast, 0.5),
        "takecopter_spin": (generate_takecopter_spin, 2.0),
        "punch_hit": (generate_punch_hit_sfx, 0.15),
        "kick_impact": (generate_kick_impact_sfx, 0.18),
        "sword_slash": (generate_sword_slash_sfx, 0.25),
        "energy_blast": (generate_energy_blast_sfx, 0.3),
        "dash_whoosh": (generate_dash_whoosh_sfx, 0.2),
    }
    for name, (generator, duration) in needed_procedural.items():
        if name not in manual_sfx:
            path = os.path.join(procedural_sfx_dir, f"{name}.wav")
            generator(path, duration)
            manual_sfx[name] = path

    # Schedule SFX from story events
    scheduled_sfx = schedule_sfx_from_events(story_events, manual_sfx)
    if scheduled_sfx:
        print(f"\n[Auto-SFX] Scheduled {len(scheduled_sfx)} event(s):")
        for s in scheduled_sfx:
            print(f"  - {os.path.basename(s['file'])} @ {s['startTime']:.2f}s")

    # Check BGM files and mix if available
    bgm_path = None
    all_bgm_cues = music_cues + bgm_cues
    if all_bgm_cues:
        max_time = max(e["endTime"] for e in entries) if entries else 70.0
        cues = []
        for cue in all_bgm_cues:
            if isinstance(cue, dict) and "file" in cue:
                # From voice_config BGM type
                cues.append({
                    "name": cue["name"],
                    "file": cue["file"],
                    "startTime": cue["startTime"],
                    "endTime": cue.get("endTime", max_time),
                    "fadeIn": cue.get("fadeIn", 2.0),
                    "fadeOut": cue.get("fadeOut", 2.0),
                    "baseVolume": cue.get("volume", 0.6),
                })
            else:
                # From story Music tags
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

    # Build SFX event list: manual scheduled + procedural fallback + voice_config SFX
    all_sfx_events = list(sfx_events)

    # Add auto-scheduled manual SFX
    if scheduled_sfx:
        all_sfx_events.extend(scheduled_sfx)

    # Add procedural tennis hit (only if tennis-related choreography exists)
    if tennis_hit_times:
        tennis_hit_path = os.path.join(SFX_DIR, "tennis_hit.wav")
        generate_tennis_hit_sfx(tennis_hit_path)
        for t in tennis_hit_times:
            all_sfx_events.append({"file": tennis_hit_path, "startTime": t})

    mix_audio(manifest, bgm_path, all_sfx_events if all_sfx_events else None)


if __name__ == "__main__":
    force_tts = "--force" in sys.argv
    asyncio.run(generate(force_tts=force_tts))
