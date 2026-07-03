"""Mechanical / industrial sound effect generators."""
import math
import random

from ..base import (
    SAMPLE_RATE,
    HAS_NUMPY,
    fade_in_out,
    lowpass,
    normalize,
    seconds_to_samples,
    white_noise,
)

if HAS_NUMPY:
    import numpy as np


def transform_mechanical(duration=1.5, sample_rate=SAMPLE_RATE, seed=None):
    """Robot/vehicle transform: sub-bass mechanical rumble with sparse clunks.

    The design principle is "felt, not decorative": no audible servo "woo" sweeps.
    """
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        rumble = lowpass(white_noise(n, seed), 90, sample_rate) * 0.35
        rumble *= np.linspace(0, 1, n) ** 0.5
        # Sparse low thuds.
        thuds = np.zeros(n)
        rng = random.Random(seed)
        for _ in range(rng.randint(2, 4)):
            t0 = rng.uniform(0.1, duration - 0.3)
            thud = lowpass(white_noise(seconds_to_samples(0.15, sample_rate)), 120, sample_rate)
            thud *= np.linspace(1, 0, len(thud))
            s0 = seconds_to_samples(t0, sample_rate)
            s1 = min(s0 + len(thud), n)
            thuds[s0:s1] += thud[: s1 - s0]
        sig = rumble + thuds * 0.6
    else:
        rumble = lowpass(white_noise(n, seed), 90, sample_rate)
        rumble = [v * ((i / n) ** 0.5) * 0.35 for i, v in enumerate(rumble)]
        thuds = [0.0] * n
        rng = random.Random(seed)
        for _ in range(rng.randint(2, 4)):
            t0 = rng.uniform(0.1, duration - 0.3)
            thud = lowpass(white_noise(seconds_to_samples(0.15, sample_rate)), 120, sample_rate)
            thud = [v * (1 - i / len(thud)) for i, v in enumerate(thud)]
            s0 = seconds_to_samples(t0, sample_rate)
            s1 = min(s0 + len(thud), n)
            for i in range(s0, s1):
                thuds[i] += thud[i - s0]
        sig = [r + t * 0.6 for r, t in zip(rumble, thuds)]
    return fade_in_out(normalize(sig, target_peak=0.8), 0.1, 0.3, sample_rate)


def servo(duration=0.3, sample_rate=SAMPLE_RATE):
    """Short servo/mechanical movement. Very subtle."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        freq = 150 + 400 * (t / duration)
        phase = np.cumsum(2 * np.pi * freq / sample_rate)
        sig = np.sin(phase) * 0.15
        sig += lowpass(white_noise(n), 600, sample_rate) * 0.08
        sig *= np.sin(np.pi * t / duration)
    else:
        t = [i / sample_rate for i in range(n)]
        sig = []
        phase = 0.0
        noise = lowpass(white_noise(n), 600, sample_rate)
        for i in range(n):
            freq = 150 + 400 * (t[i] / duration)
            phase += 2 * math.pi * freq / sample_rate
            v = math.sin(phase) * 0.15 + noise[i] * 0.08
            v *= math.sin(math.pi * t[i] / duration)
            sig.append(v)
    return _as_array_or_list(sig)


def metal_stress(duration=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Metal creak / stress sound."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        noise = white_noise(n, seed)
        # Squeaky resonances.
        res1 = np.sin(2 * np.pi * 800 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t))
        res2 = np.sin(2 * np.pi * 1200 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 5 * t))
        sig = lowpass(noise, 1500, sample_rate) * 0.3 + (res1 + res2) * 0.15
        sig *= np.exp(-t / 0.25)
    else:
        t = [i / sample_rate for i in range(n)]
        noise = white_noise(n, seed)
        sig = []
        for i in range(n):
            res1 = math.sin(2 * math.pi * 800 * t[i]) * (0.5 + 0.5 * math.sin(2 * math.pi * 3 * t[i]))
            res2 = math.sin(2 * np.pi * 1200 * t[i]) * (0.5 + 0.5 * math.sin(2 * np.pi * 5 * t[i]))
            v = lowpass([noise[i]], 1500, sample_rate)[0] * 0.3 + (res1 + res2) * 0.15
            v *= math.exp(-t[i] / 0.25)
            sig.append(v)
    return fade_in_out(_as_array_or_list(sig), 0.05, 0.2, sample_rate)


def _as_array_or_list(sig):
    if HAS_NUMPY and not isinstance(sig, np.ndarray):
        return np.array(sig, dtype=np.float64)
    return sig
