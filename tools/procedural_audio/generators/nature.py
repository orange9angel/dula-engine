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
    sweep_sine,
    white_noise,
)

if HAS_NUMPY:
    import numpy as np


def wind(duration=10.0, intensity=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Wind ambience: filtered noise with gusts.

    Args:
        intensity: 0..1. Higher = stronger gusts and more high frequency content.
    """
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        noise = pink_noise(n, seed)
        # Faster, more turbulent gusts so it reads as wind rather than ocean waves.
        t = np.arange(n) / sample_rate
        gust = 0.5 + 0.5 * np.sin(2 * np.pi * 0.35 * t) * np.sin(2 * np.pi * 0.08 * t)
        # Higher base cutoff + broader spectrum for a breezy/rustling quality.
        calm = lowpass(noise, 600, sample_rate) * 0.35
        strong = highpass(lowpass(noise, int(600 + 1800 * intensity), sample_rate), 300, sample_rate) * 0.65
        # Add a little high-frequency turbulence.
        turbulence = highpass(noise, 2000, sample_rate) * 0.08 * intensity
        sig = calm + strong * gust + turbulence
        sig *= 0.12 + 0.22 * intensity
    else:
        t = [i / sample_rate for i in range(n)]
        noise = pink_noise(n, seed)
        sig = []
        for i in range(n):
            gust = 0.5 + 0.5 * math.sin(2 * math.pi * 0.35 * t[i]) * math.sin(2 * math.pi * 0.08 * t[i])
            v = lowpass([noise[i]], 600, sample_rate)[0] * 0.35
            strong = highpass(lowpass([noise[i]], int(600 + 1800 * intensity), sample_rate), 300, sample_rate)[0] * 0.65
            turbulence = highpass([noise[i]], 2000, sample_rate)[0] * 0.08 * intensity
            v += strong * gust + turbulence
            v *= 0.12 + 0.22 * intensity
            sig.append(v)
    return fade_in_out(normalize(sig, target_peak=0.5 + intensity * 0.2), 0.5, 0.5, sample_rate)


def rain(duration=10.0, intensity=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Rain ambience: broadband noise with subtle modulation."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        noise = white_noise(n, seed)
        # Occasional heavier drops via amplitude modulation.
        mod = 0.7 + 0.3 * np.sin(2 * math.pi * 0.2 * t)
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


def birds(duration=10.0, intensity=0.5, density=0.3, sample_rate=SAMPLE_RATE, seed=None):
    """Park birds ambience: sparse chirps + subtle leaf rustle.

    Args:
        intensity: 0..1. Higher = louder/more frequent chirps.
        density: average chirps per second.
    """
    n = seconds_to_samples(duration, sample_rate)
    rng = random.Random(seed)

    # Gusty leaf/rustle layer: not a constant hiss, but intermittent swells
    # like wind moving through bushes. Use pink noise bandpassed to the
    # leaf-rustle range and shaped by a slow, irregular gust envelope.
    rustle_seed = f"{seed}_rustle" if seed is not None else None
    noise = pink_noise(n, rustle_seed)
    rustle = highpass(lowpass(noise, 3500, sample_rate), 600, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Slow gusts (0.12 Hz ~ 8s swell) mixed with quicker shimmers (0.9 Hz).
        gust = (
            0.25
            + 0.55 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.12 * t))
            + 0.20 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.90 * t + 1.7))
        )
        sig = rustle * gust * 0.035 * intensity
    else:
        sig = []
        for i in range(n):
            t = i / sample_rate
            gust = (
                0.25
                + 0.55 * (0.5 + 0.5 * math.sin(2 * math.pi * 0.12 * t))
                + 0.20 * (0.5 + 0.5 * math.sin(2 * math.pi * 0.90 * t + 1.7))
            )
            sig.append(rustle[i] * gust * 0.035 * intensity)

    avg_interval = 1.0 / max(density, 0.01)
    t = 0.0
    while t < duration:
        # Poisson-ish spacing.
        t += rng.expovariate(1.0 / avg_interval)
        if t >= duration:
            break

        chirp_dur = rng.uniform(0.04, 0.12)
        f0 = rng.uniform(2800, 4500)
        f1 = f0 * rng.uniform(1.3, 2.0)
        amp = rng.uniform(0.04, 0.12) * (0.5 + 0.5 * intensity)

        chirp = sweep_sine(chirp_dur, f0, f1, amplitude=amp, sample_rate=sample_rate)
        chirp = fade_in_out(chirp, 0.01, 0.02, sample_rate)

        start_sample = int(round(t * sample_rate))
        end_sample = min(start_sample + len(chirp), n)
        chirp_len = end_sample - start_sample

        if chirp_len <= 0:
            continue

        if HAS_NUMPY:
            sig[start_sample:end_sample] += chirp[:chirp_len]
        else:
            for i in range(chirp_len):
                sig[start_sample + i] += chirp[i]

    return fade_in_out(normalize(sig, target_peak=0.2 + intensity * 0.15), 0.5, 0.5, sample_rate)
