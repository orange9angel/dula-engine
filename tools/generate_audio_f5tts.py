#!/usr/bin/env python3
"""
F5-TTS provider wrapper for dula-audio.

Usage:
  python generate_audio_f5tts.py <episode-dir> [--device cpu|cuda]

Pipeline:
  1. Locate the f5-tts-voice skill script.
  2. Run generate_f5_voice.py to produce character-cloned MP3s.
  3. Run the standard generate_audio.py mixer to add SFX/BGM and produce mixed.wav.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Resolve this script's directory (dula-engine/tools)
TOOLS_DIR = Path(__file__).resolve().parent
ENGINE_DIR = TOOLS_DIR.parent


def find_f5_skill_script(start_dir: Path) -> Path | None:
    """Search upward from start_dir for the f5-tts-voice skill script."""
    candidate_names = [
        "docs/skills/f5-tts-voice/scripts/generate_f5_voice.py",
        ".agents/skills/f5-tts-voice/scripts/generate_f5_voice.py",
        "agents/skills/f5-tts-voice/scripts/generate_f5_voice.py",
    ]
    cur = start_dir.resolve()
    # Also allow the skill to live next to the engine root (project-level .agents)
    roots = [cur]
    if ENGINE_DIR.parent.exists():
        roots.append(ENGINE_DIR.parent)

    for root in roots:
        for name in candidate_names:
            p = root / name
            if p.is_file():
                return p

    # Walk upward from start_dir
    for parent in [cur, *cur.parents]:
        for name in candidate_names:
            p = parent / name
            if p.is_file():
                return p

    return None


def run_f5_voice(
    episode: Path,
    skill_script: Path,
    device: str | None,
    use_sox: bool | None,
    ref_strategy: str | None,
    ref_duration: float | None,
    character: str | None,
    force: bool = False,
) -> None:
    """Call the f5-tts-voice skill to generate cloned dialogue MP3s."""
    cmd = [
        sys.executable,
        str(skill_script),
        str(episode),
    ]
    if device:
        cmd.extend(["--device", device])
    if use_sox is True:
        cmd.append("--use-sox")
    elif use_sox is False:
        cmd.append("--no-sox")
    if ref_strategy:
        cmd.extend(["--ref-strategy", ref_strategy])
    if ref_duration is not None:
        cmd.extend(["--ref-duration", str(ref_duration)])
    if character:
        cmd.extend(["--character", character])
    if force:
        cmd.append("--force")

    print("[f5-tts-provider] Running F5-TTS voice cloning...")
    print(f"[f5-tts-provider] {' '.join(cmd)}")
    subprocess.run(cmd, check=True, stdout=sys.stdout.buffer, stderr=sys.stderr.buffer)


def run_mixer(episode: Path) -> None:
    """Run the standard dula audio mixer (SFX + BGM + final mix)."""
    mixer_script = TOOLS_DIR / "generate_audio.py"
    cmd = [sys.executable, str(mixer_script), str(episode)]
    print("[f5-tts-provider] Running standard audio mixer...")
    print(f"[f5-tts-provider] {' '.join(cmd)}")
    subprocess.run(cmd, check=True, stdout=sys.stdout.buffer, stderr=sys.stderr.buffer)


def main() -> None:
    parser = argparse.ArgumentParser(description="F5-TTS dula-audio provider")
    parser.add_argument("episode", help="Path to episode directory")
    parser.add_argument("--device", default=None, help="Device for F5-TTS (cuda/cpu)")
    parser.add_argument(
        "--use-sox",
        action="store_true",
        default=None,
        dest="use_sox",
        help="Use sox for personality effects",
    )
    parser.add_argument(
        "--no-sox",
        action="store_false",
        default=None,
        dest="use_sox",
        help="Force ffmpeg for personality effects",
    )
    parser.add_argument("--ref-strategy", default=None, help="Reference selection strategy")
    parser.add_argument("--ref-duration", type=float, default=None, help="Reference duration in seconds")
    parser.add_argument("--character", "-c", default=None, help="Only process this character")
    parser.add_argument("--force", action="store_true", help="Regenerate cached F5 base and cloned dialogue")
    args = parser.parse_args()

    episode = Path(args.episode).resolve()
    if not episode.is_dir():
        print(f"[f5-tts-provider] Error: episode directory not found: {episode}", file=sys.stderr)
        sys.exit(1)

    skill_script = find_f5_skill_script(episode)
    if not skill_script:
        print(
            "[f5-tts-provider] Error: could not find f5-tts-voice skill script. "
            "Expected path like <project>/docs/skills/f5-tts-voice/scripts/generate_f5_voice.py",
            file=sys.stderr,
        )
        sys.exit(1)

    run_f5_voice(
        episode,
        skill_script,
        device=args.device,
        use_sox=args.use_sox,
        ref_strategy=args.ref_strategy,
        ref_duration=args.ref_duration,
        character=args.character,
        force=args.force,
    )
    # Deliberately do not forward --force here: the standard mixer must reuse
    # the freshly installed F5 MP3 files instead of overwriting them with edge-tts.
    run_mixer(episode)
    print("[f5-tts-provider] Done.")


if __name__ == "__main__":
    main()
