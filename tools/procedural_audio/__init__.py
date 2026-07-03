"""Procedural audio generator for Dula engine.

Usage:
    from tools.procedural_audio import render
    events = [
        {"type": "engine_idle", "start": 0, "end": 35, "volume": 0.12},
        {"type": "gunfight", "start": 36, "end": 40, "volume": 0.35, "density": 0.6},
    ]
    render(events, total_duration=140, output_path="sfx_bed.wav")
"""
from .registry import generate, get_info, list_types
from .renderer import render

__all__ = ["render", "generate", "get_info", "list_types"]
