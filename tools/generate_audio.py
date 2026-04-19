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
            }
        )
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

    # Add BGM track
    bgm_idx = None
    if bgm_path:
        inputs.append(f'-i "{bgm_path}"')
        filters.append(f"[{stream_idx}:a]adelay=0|0[bgm{stream_idx}]")
        bgm_idx = stream_idx
        stream_idx += 1

    # Add SFX tracks
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

    amix = f"{amix_inputs}amix=inputs={total_streams}:duration=longest[outa]"
    filter_complex = ";".join(filters + [amix])

    mixed_path = os.path.join(OUTPUT_DIR, "mixed.wav")
    cmd = f'ffmpeg -y {" ".join(inputs)} -filter_complex "{filter_complex}" -map "[outa]" -acodec pcm_s16le -ar 48000 "{mixed_path}"'
    print("Mixing audio into mixed.wav...")
    subprocess.run(cmd, shell=True, check=True)
    print(f"Mixed audio written to: {mixed_path}")


async def generate():
    try:
        import edge_tts
    except ImportError:
        print("Please install edge-tts: pip install edge-tts")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(STORY_PATH, "r", encoding="utf-8") as f:
        story_text = f.read()

    entries, music_cues = parse_story(story_text)
    voice_config = load_voice_config()
    tennis_hit_times = load_tennis_hit_times()
    manifest = {
        "entries": [],
    }

    for entry in entries:
        char = entry["character"]
        dialogue = entry["dialogue"]
        if not char or not dialogue:
            continue
        cfg = voice_config.get(char)
        if not cfg:
            print(f"Warning: no voice config for {char}, skipping.")
            continue

        filename = f"{entry['index']:03d}_{char}.mp3"
        filepath = os.path.join(OUTPUT_DIR, filename)

        communicate = edge_tts.Communicate(
            text=dialogue,
            voice=cfg["voice"],
            rate=cfg["rate"],
            pitch=cfg["pitch"],
            volume=cfg["volume"],
        )
        await communicate.save(filepath)
        audio_duration = get_mp3_duration(filepath)
        print(f"Generated: {filename} ({audio_duration:.2f}s)")

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

    # Generate tennis hit SFX and add to mix
    sfx_events = []
    tennis_hit_path = os.path.join(SFX_DIR, "tennis_hit.wav")
    generate_tennis_hit_sfx(tennis_hit_path)
    for t in tennis_hit_times:
        sfx_events.append({"file": tennis_hit_path, "startTime": t})

    mix_audio(manifest, bgm_path, sfx_events)


if __name__ == "__main__":
    asyncio.run(generate())
