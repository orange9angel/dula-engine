"""General-purpose indoor ambience generators."""

import math

from ..base import (
    HAS_NUMPY,
    SAMPLE_RATE,
    fade_in_out,
    lowpass,
    normalize,
    pink_noise,
    seconds_to_samples,
)

if HAS_NUMPY:
    import numpy as np


def _clamp01(value):
    return max(0.0, min(1.0, float(value)))


def room_tone(duration=10.0, intensity=0.35, sample_rate=SAMPLE_RATE, seed=None):
    """Quiet enclosed-room bed with mains hum, appliance harmonics, and soft air.

    Args:
        intensity: 0..1. Higher values raise the air movement and upper hum
                   harmonics without turning the bed into a foreground sound.
    """
    n = seconds_to_samples(duration, sample_rate)
    if n <= 0:
        return np.zeros(0) if HAS_NUMPY else []

    intensity = _clamp01(intensity)
    noise = lowpass(pink_noise(n, seed), 750 + 650 * intensity, sample_rate)

    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        mains = np.sin(2 * np.pi * 59.7 * t) * 0.12
        appliance = np.sin(
            2 * np.pi * 119.4 * t + 0.35 * np.sin(2 * np.pi * 0.11 * t)
        ) * (0.035 + 0.025 * intensity)
        slow_drift = 0.72 + 0.28 * np.sin(2 * np.pi * 0.035 * t + 0.8)
        air = noise * slow_drift * (0.035 + 0.075 * intensity)
        signal = mains + appliance + air
    else:
        signal = []
        for i in range(n):
            t = i / sample_rate
            mains = math.sin(2 * math.pi * 59.7 * t) * 0.12
            appliance = math.sin(
                2 * math.pi * 119.4 * t
                + 0.35 * math.sin(2 * math.pi * 0.11 * t)
            ) * (0.035 + 0.025 * intensity)
            slow_drift = 0.72 + 0.28 * math.sin(2 * math.pi * 0.035 * t + 0.8)
            air = noise[i] * slow_drift * (0.035 + 0.075 * intensity)
            signal.append(mains + appliance + air)

    signal = normalize(signal, target_peak=0.45)
    return fade_in_out(signal, 0.25, 0.25, sample_rate)


def clock_tick(
    duration=10.0,
    intensity=0.5,
    density=1.0,
    sample_rate=SAMPLE_RATE,
    seed=None,
):
    """Dry repeating wall-clock tick.

    Args:
        intensity: 0..1. Controls brightness and strike strength.
        density: ticks per second; the normal wall-clock value is 1.0.
        seed: accepted for protocol consistency; this generator is deterministic.
    """
    del seed
    n = seconds_to_samples(duration, sample_rate)
    if n <= 0:
        return np.zeros(0) if HAS_NUMPY else []

    intensity = _clamp01(intensity)
    density = max(0.05, float(density))
    interval = 1.0 / density
    tick_duration = min(0.075, max(0.02, duration))
    tick_n = max(1, seconds_to_samples(tick_duration, sample_rate))

    if HAS_NUMPY:
        output = np.zeros(n)
        tick_t = np.arange(tick_n) / sample_rate
    else:
        output = [0.0] * n
        tick_t = [i / sample_rate for i in range(tick_n)]

    tick_index = 0
    tick_time = 0.05
    while tick_time < duration:
        primary = 2450.0 if tick_index % 2 == 0 else 2050.0
        secondary = 3320.0 if tick_index % 2 == 0 else 2870.0
        decay = 52.0 - 16.0 * intensity
        gain = 0.38 + 0.34 * intensity

        if HAS_NUMPY:
            envelope = np.exp(-tick_t * decay)
            click = (
                np.sin(2 * np.pi * primary * tick_t)
                + 0.52 * np.sin(2 * np.pi * secondary * tick_t)
                + 0.18 * np.sin(2 * np.pi * 760 * tick_t)
            ) * envelope * gain
        else:
            click = []
            for t in tick_t:
                envelope = math.exp(-t * decay)
                click.append(
                    (
                        math.sin(2 * math.pi * primary * t)
                        + 0.52 * math.sin(2 * math.pi * secondary * t)
                        + 0.18 * math.sin(2 * math.pi * 760 * t)
                    )
                    * envelope
                    * gain
                )

        start = seconds_to_samples(tick_time, sample_rate)
        end = min(start + tick_n, n)
        length = end - start
        if length > 0:
            if HAS_NUMPY:
                output[start:end] += click[:length]
            else:
                for i in range(length):
                    output[start + i] += click[i]

        tick_index += 1
        tick_time += interval

    return fade_in_out(output, 0.01, 0.02, sample_rate)
