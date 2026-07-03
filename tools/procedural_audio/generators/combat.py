"""Combat / weapon sound effect generators."""
import math
import random

from ..base import (
    SAMPLE_RATE,
    HAS_NUMPY,
    bandpass,
    exp_decay_env,
    fade_in_out,
    lowpass,
    normalize,
    seconds_to_samples,
    sweep_sine,
    white_noise,
)

if HAS_NUMPY:
    import numpy as np


def _as_array(data):
    if HAS_NUMPY and not isinstance(data, np.ndarray):
        return np.array(data, dtype=np.float64)
    return data


def _zeros(n):
    if HAS_NUMPY:
        return np.zeros(n, dtype=np.float64)
    return [0.0] * n


def _add_at(base, clip, offset_samples):
    """Overlay clip into base at sample offset."""
    if HAS_NUMPY:
        end = min(offset_samples + len(clip), len(base))
        seg_len = end - offset_samples
        if seg_len > 0:
            base[offset_samples:end] += clip[:seg_len]
        return
    end = min(offset_samples + len(clip), len(base))
    for i in range(offset_samples, end):
        base[i] += clip[i - offset_samples]


def laser_blast(duration=0.22, sample_rate=SAMPLE_RATE):
    """Sci-fi energy gunshot: descending chirp + burst."""
    n = seconds_to_samples(duration, sample_rate)
    t = [i / sample_rate for i in range(n)]
    f0, f1 = 2200, 250
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        freq = f0 * (f1 / f0) ** (t / duration)
        phase = np.cumsum(2 * np.pi * freq / sample_rate)
        chirp = np.sin(phase)
        noise = bandpass(white_noise(n), 800, 5000, sample_rate) * 0.4
        sig = chirp * 0.7 + noise
        sig *= np.exp(-t / 0.06)
    else:
        phase = 0.0
        sig = []
        noise = bandpass(white_noise(n), 800, 5000, sample_rate)
        for i in range(n):
            f = f0 * (f1 / f0) ** (t[i] / duration)
            phase += 2 * math.pi * f / sample_rate
            v = math.sin(phase) * 0.7 + noise[i] * 0.4
            v *= math.exp(-t[i] / 0.06)
            sig.append(v)
    return fade_in_out(_as_array(sig), 0.005, 0.05, sample_rate)


def explosion(duration=0.5, sample_rate=SAMPLE_RATE):
    """Low thud + noise burst with short tail."""
    n = seconds_to_samples(duration, sample_rate)
    t = [i / sample_rate for i in range(n)]
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        thud_freq = 80 * np.exp(-t / 0.08)
        thud = np.sin(2 * np.pi * thud_freq * t) * 0.8
        noise = lowpass(white_noise(n), 600, sample_rate) * 0.6
        env = np.exp(-t / 0.12)
        sig = (thud + noise) * env
    else:
        sig = []
        noise = lowpass(white_noise(n), 600, sample_rate)
        for i in range(n):
            tf = 80 * math.exp(-t[i] / 0.08)
            thud = math.sin(2 * math.pi * tf * t[i]) * 0.8
            v = (thud + noise[i] * 0.6) * math.exp(-t[i] / 0.12)
            sig.append(v)
    return fade_in_out(_as_array(sig), 0.005, 0.2, sample_rate)


def impact_thud(duration=0.4, sample_rate=SAMPLE_RATE):
    """Heavy body/robot impact: low freq thud + crunch + sub."""
    n = seconds_to_samples(duration, sample_rate)
    t = [i / sample_rate for i in range(n)]
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        thud_freq = 70 * np.exp(-t / 0.1)
        thud = np.sin(2 * np.pi * thud_freq * t) * 0.7
        crunch = bandpass(white_noise(n), 400, 2000, sample_rate) * np.exp(-t / 0.03) * 0.4
        sub = np.sin(2 * np.pi * 40 * t) * np.exp(-t / 0.2) * 0.3
        sig = thud + crunch + sub
    else:
        sig = []
        noise = bandpass(white_noise(n), 400, 2000, sample_rate)
        for i in range(n):
            tf = 70 * math.exp(-t[i] / 0.1)
            thud = math.sin(2 * math.pi * tf * t[i]) * 0.7
            crunch = noise[i] * math.exp(-t[i] / 0.03) * 0.4
            sub = math.sin(2 * math.pi * 40 * t[i]) * math.exp(-t[i] / 0.2) * 0.3
            sig.append(thud + crunch + sub)
    return _as_array(sig)


def gunfight(duration=4.0, density=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Layered intermittent gunfight: laser blasts, explosions, impacts.

    Args:
        duration: total length in seconds.
        density: shots per second (approx). Use 0.2-1.5.
    """
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    base = _zeros(n)

    num_shots = max(3, int(duration * density))
    for _ in range(num_shots):
        t = rng.uniform(0.0, max(duration - 0.25, 0.0))
        shot = laser_blast(duration=rng.uniform(0.15, 0.28), sample_rate=sample_rate)
        # Vary pitch by resampling-ish: just scale volume and add slight pitch bend already in laser_blast.
        vol = rng.uniform(0.5, 1.0)
        _add_at(base, shot * vol if HAS_NUMPY else [v * vol for v in shot], seconds_to_samples(t, sample_rate))

    # Occasional heavier impacts/explosions.
    num_heavy = max(1, int(num_shots * 0.25))
    for _ in range(num_heavy):
        t = rng.uniform(0.2, max(duration - 0.4, 0.3))
        heavy = explosion(duration=rng.uniform(0.3, 0.6), sample_rate=sample_rate)
        vol = rng.uniform(0.3, 0.7)
        _add_at(base, heavy * vol if HAS_NUMPY else [v * vol for v in heavy], seconds_to_samples(t, sample_rate))

    return normalize(base, target_peak=0.85)
