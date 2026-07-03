"""Timeline mixing utilities for procedural audio."""
import math

from .base import HAS_NUMPY, SAMPLE_RATE, seconds_to_samples, write_wav_mono

if HAS_NUMPY:
    import numpy as np


def create_track(duration, sample_rate=SAMPLE_RATE):
    """Return a silent buffer of the given duration."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        return np.zeros(n, dtype=np.float64)
    return [0.0] * n


def overlay(base, clip, start_time, volume=1.0, sample_rate=SAMPLE_RATE):
    """Overlay clip into base at start_time (seconds), scaled by volume."""
    s0 = seconds_to_samples(start_time, sample_rate)
    s1 = min(s0 + len(clip), len(base))
    if s0 >= len(base):
        return
    seg_len = s1 - s0
    if HAS_NUMPY:
        base[s0:s1] += clip[:seg_len] * volume
    else:
        for i in range(seg_len):
            base[s0 + i] += clip[i] * volume


def fade_track(base, fade_in=0.0, fade_out=0.0, sample_rate=SAMPLE_RATE):
    """Apply fade in/out to the entire track."""
    n = len(base)
    fi = seconds_to_samples(fade_in, sample_rate)
    fo = seconds_to_samples(fade_out, sample_rate)
    if HAS_NUMPY:
        env = np.ones(n)
        if fi:
            env[:fi] = np.linspace(0, 1, fi)
        if fo:
            env[-fo:] = np.linspace(1, 0, fo)
        return base * env
    env = [1.0] * n
    for i in range(fi):
        env[i] = i / fi if fi else 1.0
    for i in range(fo):
        env[n - fo + i] = 1.0 - (i / fo if fo else 0.0)
    return [b * e for b, e in zip(base, env)]


def soft_limit(base, threshold=0.95):
    """Apply tanh soft limiter."""
    if HAS_NUMPY:
        return np.tanh(base / threshold) * threshold
    return [math.tanh(v / threshold) * threshold for v in base]


def normalize_track(base, target_peak=0.95):
    """Normalize track to target peak, preserving silence."""
    if HAS_NUMPY:
        peak = np.max(np.abs(base))
        if peak == 0:
            return base
        return base / peak * target_peak
    peak = max((abs(v) for v in base), default=0.0)
    if peak == 0:
        return base
    return [v / peak * target_peak for v in base]


def save_track(filepath, base, sample_rate=SAMPLE_RATE):
    """Normalize lightly and write to mono WAV."""
    limited = soft_limit(base, threshold=0.95)
    normalized = normalize_track(limited, target_peak=0.9)
    write_wav_mono(filepath, normalized, sample_rate)
