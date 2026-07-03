"""Render a procedural SFX bed from protocol events.

Protocol event shape (matches `{SFX:Procedural|...}` story tag):
    {
        "type": "gunfight",
        "start": 36.0,
        "end": 40.0,
        "volume": 0.35,
        "density": 0.6,
        ... other generator params
    }
"""
from .base import SAMPLE_RATE
from .mixer import create_track, fade_track, overlay, save_track
from .registry import generate


def render(events, total_duration, output_path=None, sample_rate=SAMPLE_RATE):
    """Render a full procedural SFX bed.

    Args:
        events: list of dicts with keys: type, start, end, volume, and optional
                generator params (density, intensity, etc.).
        total_duration: total bed length in seconds.
        output_path: optional path to write WAV.
        sample_rate: output sample rate.

    Returns:
        The mixed sample buffer (numpy array or list).
    """
    track = create_track(total_duration, sample_rate)

    for ev in sorted(events, key=lambda e: e.get("start", 0.0)):
        sound_type = ev.get("type") or ev.get("name")
        if not sound_type:
            continue
        start = ev.get("start", 0.0)
        end = ev.get("end")
        duration = (end - start) if end is not None and end > start else ev.get("duration", 2.0)
        volume = ev.get("volume", 1.0)

        # Pass generator params, excluding timeline controls.
        gen_kwargs = {k: v for k, v in ev.items()
                      if k not in ("type", "name", "start", "end", "duration", "volume")}
        gen_kwargs["duration"] = duration

        try:
            clip = generate(sound_type, **gen_kwargs)
        except ValueError as e:
            print(f"[ProceduralAudio] {e}")
            continue

        overlay(track, clip, start, volume=volume, sample_rate=sample_rate)

    track = fade_track(track, fade_in=0.1, fade_out=0.1, sample_rate=sample_rate)

    if output_path:
        save_track(output_path, track, sample_rate)
    return track
