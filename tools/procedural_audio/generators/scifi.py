"""Sci-fi / energy ambience generators."""
import math
import random

from ..base import (
    SAMPLE_RATE,
    HAS_NUMPY,
    fade_in_out,
    lowpass,
    normalize,
    seconds_to_samples,
    sine_tone,
    white_noise,
)

if HAS_NUMPY:
    import numpy as np


def vault_hum(duration=10.0, sample_rate=SAMPLE_RATE, seed=None):
    """Sci-fi vault / power-core hum: low harmonics + shimmer."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        hum = np.sin(2 * np.pi * 60 * t) * 0.25
        hum += np.sin(2 * np.pi * 120 * t) * 0.12
        hum += np.sin(2 * np.pi * 180 * t) * 0.06
        shimmer = np.sin(2 * np.pi * 30 * t) * 0.04
        noise = lowpass(white_noise(n, seed), 300, sample_rate) * 0.08
        sig = hum + shimmer + noise
    else:
        t = [i / sample_rate for i in range(n)]
        sig = []
        noise = lowpass(white_noise(n, seed), 300, sample_rate)
        for i in range(n):
            hum = (
                math.sin(2 * math.pi * 60 * t[i]) * 0.25
                + math.sin(2 * math.pi * 120 * t[i]) * 0.12
                + math.sin(2 * math.pi * 180 * t[i]) * 0.06
            )
            shimmer = math.sin(2 * math.pi * 30 * t[i]) * 0.04
            sig.append(hum + shimmer + noise[i] * 0.08)
    return fade_in_out(normalize(sig, target_peak=0.6), 0.5, 0.5, sample_rate)


def energy_hum(duration=10.0, base_freq=150, sample_rate=SAMPLE_RATE, seed=None):
    """Pulsing energy field / generator hum."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        pulse = np.sin(2 * math.pi * base_freq * t) * 0.25
        pulse += np.sin(2 * math.pi * base_freq * 2 * t) * 0.12
        pulse *= 0.7 + 0.3 * np.sin(2 * math.pi * 6 * t)
        noise = lowpass(white_noise(n, seed), 600, sample_rate) * 0.1
        sig = pulse + noise
    else:
        t = [i / sample_rate for i in range(n)]
        sig = []
        noise = lowpass(white_noise(n, seed), 600, sample_rate)
        for i in range(n):
            pulse = (
                math.sin(2 * math.pi * base_freq * t[i]) * 0.25
                + math.sin(2 * math.pi * base_freq * 2 * t[i]) * 0.12
            )
            pulse *= 0.7 + 0.3 * math.sin(2 * math.pi * 6 * t[i])
            sig.append(pulse + noise[i] * 0.1)
    return fade_in_out(normalize(sig, target_peak=0.5), 0.5, 0.5, sample_rate)
