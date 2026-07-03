#!/usr/bin/env python3
"""Quick validation that every procedural sound type renders a valid WAV."""
import os
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent.parent))

from tools.procedural_audio import list_types, render
from tools.procedural_audio.registry import REGISTRY

OUT_DIR = ROOT / "_test_output"
OUT_DIR.mkdir(exist_ok=True)


def check_wav(path, expected_min_duration=0.05):
    with wave.open(str(path), "r") as w:
        ch = w.getnchannels()
        sw = w.getsampwidth()
        sr = w.getframerate()
        n = w.getnframes()
        dur = n / sr
        assert ch == 1, f"{path}: expected mono, got {ch}"
        assert sw == 2, f"{path}: expected 16-bit, got {sw}"
        assert sr == 48000, f"{path}: expected 48kHz, got {sr}"
        assert dur >= expected_min_duration, f"{path}: duration {dur}s too short"
        print(f"  OK: {path.name} ({dur:.2f}s)")


def main():
    print("Testing individual spot generators...")
    for name in list_types():
        info = REGISTRY[name]
        duration = 0.5 if info["category"] == "combat" else 2.0
        out = OUT_DIR / f"{name}.wav"
        render([{"type": name, "start": 0, "end": duration, "volume": 0.8}],
               total_duration=duration + 0.5,
               output_path=str(out))
        check_wav(out)

    print("\nTesting full scene bed...")
    bed_path = OUT_DIR / "scene_bed.wav"
    events = [
        {"type": "engine_idle", "start": 0, "end": 5, "volume": 0.12},
        {"type": "traffic", "start": 0, "end": 5, "volume": 0.08},
        {"type": "gunfight", "start": 5, "end": 8, "volume": 0.3, "density": 0.6},
        {"type": "wind", "start": 8, "end": 13, "volume": 0.18, "intensity": 0.4},
        {"type": "vault_hum", "start": 13, "end": 18, "volume": 0.12},
    ]
    render(events, total_duration=20, output_path=str(bed_path))
    check_wav(bed_path, expected_min_duration=18)

    print("\nAll procedural audio tests passed.")


if __name__ == "__main__":
    main()
