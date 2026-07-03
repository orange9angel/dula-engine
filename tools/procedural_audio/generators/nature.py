"""Nature ambience generators."""
import math
import random

from ..base import (
    SAMPLE_RATE,
    HAS_NUMPY,
    fade_in_out,
    highpass,
    lowpass,
    normalize,
    pink_noise,
    seconds_to_samples,
    white_noise,
)

if HAS_NUMPY:
    import numpy as np


def wind(duration=10.0, intensity=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Wind ambience: filtered noise with slow gusts.

    Args:
        intensity: 0..1. Higher = stronger gusts and more high frequency content.
    """
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        noise = pink_noise(n, seed)
        # Lowpass cutoff moves with gusts.
        t = np.arange(n) / sample_rate
        gust = 0.5 + 0.5 * np.sin(2 * np.pi * 0.12 * t) * np.sin(2 * np.pi * 0.03 * t)
        cutoff = 400 + 1200 * intensity * gust
        # Per-sample variable cutoff is expensive; approximate with two layers.
        calm = lowpass(noise, 400, sample_rate) * 0.5
        strong = highpass(lowpass(noise, int(400 + 1200 * intensity), sample_rate), 200, sample_rate) * 0.5
        sig = calm + strong * gust
        sig *= 0.15 + 0.25 * intensity
    else:
        t = [i / sample_rate for i in range(n)]
        noise = pink_noise(n, seed)
        sig = []
        for i in range(n):
            gust = 0.5 + 0.5 * math.sin(2 * math.pi * 0.12 * t[i]) * math.sin(2 * math.pi * 0.03 * t[i])
            v = lowpass([noise[i]], 400, sample_rate)[0] * 0.5
            strong = highpass(lowpass([noise[i]], int(400 + 1200 * intensity), sample_rate), 200, sample_rate)[0] * 0.5
            v += strong * gust
            v *= 0.15 + 0.25 * intensity
            sig.append(v)
    return fade_in_out(normalize(sig, target_peak=0.5 + intensity * 0.2), 0.5, 0.5, sample_rate)


def rain(duration=10.0, intensity=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Rain ambience: broadband noise with subtle modulation."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        noise = white_noise(n, seed)
        # Occasional heavier drops via amplitude modulation.
        mod = 0.7 + 0.3 * np.sin(2 * np.pi * 0.2 * t)
        sig = lowpass(noise, 8000, sample_rate) * mod * (0.1 + 0.25 * intensity)
    else:
        t = [i / sample_rate for i in range(n)]
        noise = white_noise(n, seed)
        sig = []
        for i in range(n):
            mod = 0.7 + 0.3 * math.sin(2 * math.pi * 0.2 * t[i])
            v = lowpass([noise[i]], 8000, sample_rate)[0] * mod * (0.1 + 0.25 * intensity)
            sig.append(v)
    return fade_in_out(normalize(sig, target_peak=0.5), 0.5, 0.5, sample_rate)
