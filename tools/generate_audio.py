#!/usr/bin/env python3
"""
Generate audio files from SRT using edge-tts.
Reads subtitles/script.srt and outputs MP3 files to assets/audio/.
Also generates assets/audio/manifest.json and assets/audio/mixed.wav.
"""

import asyncio
import json
import os
import re
import subprocess
import sys

# Add project root to path for importing lib if needed
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRT_PATH = os.path.join(ROOT, "subtitles", "script.srt")
OUTPUT_DIR = os.path.join(ROOT, "assets", "audio")
MANIFEST_PATH = os.path.join(OUTPUT_DIR, "manifest.json")

# Voice configuration map (keep in sync with voices/*.js)
VOICE_MAP = {
    "Doraemon": {
        "voice": "zh-CN-XiaoxiaoNeural",
        "rate": "+10%",
        "pitch": "+10Hz",
        "volume": "+10%",
    },
    "Nobita": {
        "voice": "zh-CN-YunxiNeural",
        "rate": "-5%",
        "pitch": "-5Hz",
        "volume": "+0%",
    },
}


def parse_srt(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    entries = []
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
        dialogue = re.sub(r"\{\w+\}\s*", "", dialogue).strip()
        entries.append(
            {
                "index": index,
                "startTime": start,
                "endTime": end,
                "character": character,
                "dialogue": dialogue,
            }
        )
    return entries


def mix_audio(manifest):
    entries = manifest["entries"]
    if not entries:
        cmd = f'ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=stereo -t 1 -acodec pcm_s16le "{os.path.join(OUTPUT_DIR, "mixed.wav")}"'
        subprocess.run(cmd, shell=True, check=True)
        return

    inputs = []
    filters = []
    for i, entry in enumerate(entries):
        file_path = os.path.join(ROOT, entry["file"])
        inputs.append(f'-i "{file_path}"')
        delay_ms = int(round(entry["startTime"] * 1000))
        filters.append(f"[{i}:a]adelay={delay_ms}|{delay_ms}[ad{i}]")

    amix_inputs = "".join(f"[ad{i}]" for i in range(len(entries)))
    amix = f"{amix_inputs}amix=inputs={len(entries)}:duration=longest[outa]"
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

    with open(SRT_PATH, "r", encoding="utf-8") as f:
        srt_text = f.read()

    entries = parse_srt(srt_text)
    manifest = {
        "entries": [],
    }

    for entry in entries:
        char = entry["character"]
        dialogue = entry["dialogue"]
        if not char or not dialogue:
            continue
        cfg = VOICE_MAP.get(char)
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
        print(f"Generated: {filename}")

        manifest["entries"].append(
            {
                "index": entry["index"],
                "startTime": entry["startTime"],
                "endTime": entry["endTime"],
                "character": char,
                "dialogue": dialogue,
                "file": f"assets/audio/{filename}",
            }
        )

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest written to: {MANIFEST_PATH}")

    mix_audio(manifest)


if __name__ == "__main__":
    asyncio.run(generate())
