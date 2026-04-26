#!/usr/bin/env python3
"""
Generate audio files from SRT using ElevenLabs TTS API.

Features:
- High-quality, emotionally expressive TTS voices
- Voice cloning support via custom voice_id
- Automatic fallback to edge-tts on API failure / quota exceeded
- Compatible with existing voice_config.json (adds "elevenlabs" field)

Usage:
    1. Get a free API key from https://elevenlabs.io/
    2. Set environment variable: $env:ELEVENLABS_API_KEY="your-key"
    3. Run: python tools/generate_audio_elevenlabs.py ./episodes/<episode>

Free tier: 10,000 characters/month (~3,300 Chinese characters)
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

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# Default ElevenLabs voice presets for common characters
# NOTE: Free tier can only use certain voices via API.
# Tested free-compatible voice: Sarah (EXAVITQu4vr4xnSDxMaL)
# For paid plans, replace with better voices like Charlotte, Brian, Alice, Josh.
ELEVENLABS_VOICE_PRESETS = {
    "Doraemon": {
        "voice_id": "EXAVITQu4vr4xnSDxMaL",   # Sarah — bright female (free-compatible)
        "stability": 0.35,
        "similarity_boost": 0.75,
        "style": 0.4,
        "speed": 1.15,
    },
    "Nobita": {
        "voice_id": "EXAVITQu4vr4xnSDxMaL",   # Sarah (free-compatible)
        "stability": 0.45,
        "similarity_boost": 0.70,
        "style": 0.3,
        "speed": 1.0,
    },
    "Shizuka": {
        "voice_id": "EXAVITQu4vr4xnSDxMaL",   # Sarah (free-compatible)
        "stability": 0.40,
        "similarity_boost": 0.80,
        "style": 0.35,
        "speed": 1.0,
    },
    "RockLee": {
        "voice_id": "EXAVITQu4vr4xnSDxMaL",   # Sarah (free-compatible)
        "stability": 0.30,
        "similarity_boost": 0.65,
        "style": 0.6,
        "speed": 1.2,
    },
}

# Fallback edge-tts config (used when ElevenLabs is unavailable)
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
    "RockLee": {
        "voice": "zh-CN-YunxiNeural",
        "rate": "+15%",
        "pitch": "+15Hz",
        "volume": "+15%",
    },
}


def load_voice_config():
    with open(VOICE_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


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
        dialogue = re.sub(r"^@\w+\s*", "", content)
        dialogue = re.sub(r"\[\w+\]\s*", "", dialogue)
        dialogue = re.sub(r"\{Camera:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Music:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{[A-Za-z]\w*:[^}]+\}\s*", "", dialogue)
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

        entries.append({
            "index": index,
            "startTime": start,
            "endTime": end,
            "character": character,
            "dialogue": dialogue,
        })
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


def generate_with_elevenlabs(text, voice_id, output_path, settings=None):
    """Call ElevenLabs API. Returns True on success, False on failure."""
    if not ELEVENLABS_API_KEY:
        return False

    try:
        from elevenlabs import ElevenLabs

        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

        # Default settings
        default_settings = {
            "stability": 0.40,
            "similarity_boost": 0.75,
            "style": 0.35,
            "speed": 1.0,
            "use_speaker_boost": True,
        }
        if settings:
            default_settings.update(settings)

        audio = client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
            voice_settings=default_settings,
        )

        # The SDK returns a generator for streaming; collect bytes
        audio_bytes = b"".join(audio)

        with open(output_path, "wb") as f:
            f.write(audio_bytes)
        return True

    except Exception as e:
        error_msg = str(e).lower()
        if "quota" in error_msg or "limit" in error_msg or "429" in error_msg:
            print(f"  ElevenLabs quota exceeded: {e}")
        elif "unauthorized" in error_msg or "401" in error_msg:
            print(f"  ElevenLabs API key invalid: {e}")
        else:
            print(f"  ElevenLabs API error: {e}")
        return False


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
        noise = ((i * 9301 + 49297) % 233280) / 233280.0 * 2 - 1
        gust = 0.6 + 0.4 * math.sin(2 * math.pi * 0.3 * t) * math.sin(2 * math.pi * 0.07 * t)
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
        freq = 200 + 1000 * math.exp(-t / 0.35)
        phase = 2 * math.pi * freq * t
        vibrato = math.sin(2 * math.pi * 8 * t) * 15
        sample = math.sin(phase + vibrato) * 0.4
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
        thud_freq = 80 * math.exp(-t / 0.08)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.12) * 0.6
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
        env = math.exp(-t / 0.08) if t > 0.02 else (t / 0.02)
        sample = noise * env * 0.35
        samples.append(sample)
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated SFX: {filepath}")


def generate_takecopter_spin(filepath, duration=2.0, sample_rate=48000):
    """Take-copter spinning: pulsing motor whir with Doppler-like modulation."""
    n = int(sample_rate * duration)
    samples = []
    base_freq = 180
    for i in range(n):
        t = i / sample_rate
        spin_up = min(1.0, t / 0.5)
        freq = base_freq * (1 + 0.5 * spin_up)
        pulse = 1.0 if (math.sin(2 * math.pi * freq * t) > 0) else -1.0
        whine = math.sin(2 * math.pi * freq * 3.5 * t) * 0.3
        wobble = 0.7 + 0.3 * math.sin(2 * math.pi * 12 * t)
        sample = (pulse * 0.5 + whine) * wobble * 0.25
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
    """Map story events to SFX files based on trigger hints and heuristics."""
    scheduled = []
    if not manual_sfx:
        return scheduled

    def find_sfx(*keywords):
        candidates = []
        for kw in keywords:
            for name, path in manual_sfx.items():
                if kw.lower() in name.lower():
                    candidates.append((len(name), name, path))
        if candidates:
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
            y_match = re.search(r"y=([-\d.]+)", body)
            if y_match:
                y_val = float(y_match.group(1))
                if y_val < 0:
                    sfx_file = find_sfx("fall", "whistle")
                    if sfx_file:
                        scheduled.append({"file": sfx_file, "startTime": t})
                elif y_val > 2:
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
            whoosh_file = find_sfx("whoosh", "swoosh")
            if whoosh_file:
                scheduled.append({"file": whoosh_file, "startTime": t + run_up})
            dunk_file = find_sfx("dunk_slam", "dunk", "slam")
            if dunk_file:
                scheduled.append({"file": dunk_file, "startTime": slam_time})

        elif etype == "SFX":
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
    Mix multiple BGM cues into a single bus with:
    - Fade In/Out (sine curve)
    - Sidechain Ducking (dialogue ducking with Attack/Release)
    """
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
            filters.append(f"[{i}:a]adelay={delay_ms}|{delay_ms}[d{i}]")

        amix_inputs = "".join(f"[d{i}]" for i in range(len(entries)))
        amix = f"{amix_inputs}amix=inputs={len(entries)}:duration=longest[dialogue]"
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
            filters.append(f"[{i}:a]adelay={delay_ms}|{delay_ms},volume={n_sfx}[s{i}]")

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

    if dialogue_path:
        final_inputs.append(f'-i "{dialogue_path}"')
        final_filters.append(f"[{stream_idx}:a]volume=1.0[dialogue{stream_idx}]")
        stream_idx += 1

    if bgm_path:
        final_inputs.append(f'-i "{bgm_path}"')
        final_filters.append(f"[{stream_idx}:a]volume=1.0[bgm{stream_idx}]")
        stream_idx += 1

    if sfx_path:
        final_inputs.append(f'-i "{sfx_path}"')
        final_filters.append(f"[{stream_idx}:a]volume=3.0[sfx{stream_idx}]")
        stream_idx += 1

    if stream_idx == 0:
        return

    amix_inputs = ""
    for i in range(stream_idx):
        label = "dialogue" if i == 0 and dialogue_path else ("bgm" if i == (1 if dialogue_path else 0) and bgm_path else "sfx")
        amix_inputs += f"[{label}{i}]"

    amix = f"{amix_inputs}amix=inputs={stream_idx}:duration=longest:normalize=0[outa]"
    filter_complex = ";".join(final_filters + [amix])

    cmd = f'ffmpeg -y {" ".join(final_inputs)} -filter_complex "{filter_complex}" -map "[outa]" -acodec pcm_s16le -ar 48000 "{mixed_path}"'
    print("Mixing final audio into mixed.wav...")
    subprocess.run(cmd, shell=True, check=True)
    print(f"Mixed audio written to: {mixed_path}")


async def generate(force_tts=False):
    if not ELEVENLABS_API_KEY:
        print("[WARNING] ELEVENLABS_API_KEY not set. Will use edge-tts fallback.")
        print("To use ElevenLabs, get a free API key from https://elevenlabs.io/")
        print("Then set: $env:ELEVENLABS_API_KEY='your-key'")
    else:
        print("Using ElevenLabs API for TTS generation.")
        print("(Free tier: 10,000 characters/month)")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(STORY_PATH, "r", encoding="utf-8") as f:
        story_text = f.read()

    entries, music_cues, story_events = parse_story(story_text)
    voice_config = load_voice_config()
    tennis_hit_times = load_tennis_hit_times()
    manifest = {"entries": []}

    # Track total characters used for quota monitoring
    total_chars = 0

    use_elevenlabs = bool(ELEVENLABS_API_KEY)

    for entry in entries:
        char = entry["character"]
        dialogue = entry["dialogue"]
        if not char or not dialogue:
            continue

        filename = f"{entry['index']:03d}_{char}.mp3"
        filepath = os.path.join(OUTPUT_DIR, filename)

        if os.path.exists(filepath) and not force_tts:
            audio_duration = get_mp3_duration(filepath)
            print(f"Skipped (exists): {filename} ({audio_duration:.2f}s)")
        else:
            # Try ElevenLabs first
            generated = False
            if use_elevenlabs:
                # Check voice_config for ElevenLabs settings
                cfg = voice_config.get(char, {})
                el_cfg = cfg.get("elevenlabs")

                if el_cfg:
                    voice_id = el_cfg.get("voice_id")
                    settings = {
                        "stability": el_cfg.get("stability", 0.40),
                        "similarity_boost": el_cfg.get("similarity_boost", 0.75),
                        "style": el_cfg.get("style", 0.35),
                        "speed": el_cfg.get("speed", 1.0),
                        "use_speaker_boost": el_cfg.get("use_speaker_boost", True),
                    }
                else:
                    # Use preset
                    preset = ELEVENLABS_VOICE_PRESETS.get(char)
                    if preset:
                        voice_id = preset["voice_id"]
                        settings = {
                            "stability": preset["stability"],
                            "similarity_boost": preset["similarity_boost"],
                            "style": preset["style"],
                            "speed": preset["speed"],
                            "use_speaker_boost": True,
                        }
                    else:
                        print(f"Warning: no ElevenLabs preset for {char}, falling back to edge-tts.")
                        voice_id = None
                        settings = None

                if voice_id:
                    char_count = len(dialogue)
                    total_chars += char_count
                    print(f"Generating {filename} via ElevenLabs (voice={voice_id}, chars={char_count}, total_used={total_chars})...")
                    generated = generate_with_elevenlabs(dialogue, voice_id, filepath, settings)
                    if not generated:
                        print(f"  ElevenLabs failed, falling back to edge-tts...")
                        use_elevenlabs = False

            # Fallback to edge-tts
            if not generated:
                cfg = voice_config.get(char)
                if not cfg:
                    # Try fallback map
                    cfg = EDGE_VOICE_MAP.get(char)
                if not cfg:
                    print(f"Warning: no voice config for {char}, skipping.")
                    continue

                try:
                    import edge_tts
                except ImportError:
                    print("Please install edge-tts: pip install edge-tts")
                    sys.exit(1)

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

    print(f"\nTotal characters used this run: {total_chars}")
    if ELEVENLABS_API_KEY:
        print(f"ElevenLabs free tier: 10,000 chars/month")
        print(f"Estimated remaining (if starting from 0): {max(0, 10000 - total_chars)}")

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

    # Build SFX event list
    sfx_events = []
    if scheduled_sfx:
        sfx_events.extend(scheduled_sfx)

    if tennis_hit_times:
        tennis_hit_path = os.path.join(SFX_DIR, "tennis_hit.wav")
        generate_tennis_hit_sfx(tennis_hit_path)
        for t in tennis_hit_times:
            sfx_events.append({"file": tennis_hit_path, "startTime": t})

    mix_audio(manifest, bgm_path, sfx_events if sfx_events else None)


if __name__ == "__main__":
    force_tts = "--force" in sys.argv
    asyncio.run(generate(force_tts=force_tts))
