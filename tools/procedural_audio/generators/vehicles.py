"""Vehicle / traffic sound effect generators."""
import math
import random

from ..base import (
    SAMPLE_RATE,
    HAS_NUMPY,
    fade_in_out,
    lowpass,
    normalize,
    pink_noise,
    sawtooth,
    seconds_to_samples,
    sine_tone,
    white_noise,
)

if HAS_NUMPY:
    import numpy as np


def engine_idle(duration=5.0, sample_rate=SAMPLE_RATE, seed=None):
    """Low vehicle/engine idle rumble with RPM modulation."""
    n = seconds_to_samples(duration, sample_rate)
    t = [i / sample_rate for i in range(n)]
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        base = sawtooth(duration, 55, 0.25, sample_rate)
        # Modulated layer
        mod = 45 + 5 * np.sin(2 * np.pi * 0.25 * t)
        phase = np.cumsum(2 * np.pi * mod / sample_rate)
        layer = np.sin(phase) * 0.2
        noise = lowpass(white_noise(n, seed), 180, sample_rate) * 0.25
        out = base + layer + noise
        out *= 0.9 + 0.1 * np.sin(2 * np.pi * 0.4 * t)
    else:
        base = sawtooth(duration, 55, 0.25, sample_rate)
        layer = []
        phase = 0.0
        for i in range(n):
            mod = 45 + 5 * math.sin(2 * math.pi * 0.25 * t[i])
            phase += 2 * math.pi * mod / sample_rate
            layer.append(math.sin(phase) * 0.2)
        noise = lowpass(white_noise(n, seed), 180, sample_rate)
        out = []
        for i in range(n):
            v = base[i] + layer[i] + noise[i] * 0.25
            v *= 0.9 + 0.1 * math.sin(2 * math.pi * 0.4 * t[i])
            out.append(v)
    return fade_in_out(lowpass(out, 250, sample_rate), 0.2, 0.2, sample_rate)


def traffic(duration=10.0, density=0.3, sample_rate=SAMPLE_RATE, seed=None):
    """Urban traffic rumble: layered engine drones with Doppler-like pass-bys.

    Args:
        density: number of vehicles passing per second (approx).
    """
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)

    if HAS_NUMPY:
        base = np.zeros(n)
        t = np.arange(n) / sample_rate
    else:
        base = [0.0] * n
        t = [i / sample_rate for i in range(n)]

    num_vehicles = max(4, int(duration * density))
    for _ in range(num_vehicles):
        start = rng.uniform(0.0, duration)
        length = rng.uniform(2.0, 5.0)
        end = min(start + length, duration)
        # Base drone
        drone = engine_idle(length, sample_rate, seed=rng.randint(0, 1_000_000))
        freq = rng.uniform(40, 80)
        # Replace drone base with a simpler low sawtooth to avoid layering too many idles.
        drone_n = seconds_to_samples(length, sample_rate)
        if HAS_NUMPY:
            tt = np.arange(drone_n) / sample_rate
            drone_sig = sawtooth(length, freq, 0.35, sample_rate) + lowpass(white_noise(drone_n), 200, sample_rate) * 0.2
            # Doppler envelope
            env = np.sin(np.pi * tt / length) ** 0.5
            drone_sig *= env * rng.uniform(0.15, 0.35)
        else:
            tt = [i / sample_rate for i in range(drone_n)]
            drone_sig = sawtooth(length, freq, 0.35, sample_rate)
            noise = lowpass(white_noise(drone_n), 200, sample_rate)
            drone_sig = [d + noise[i] * 0.2 for i, d in enumerate(drone_sig)]
            env = [math.sin(math.pi * tt[i] / length) ** 0.5 for i in range(drone_n)]
            drone_sig = [d * env[i] * rng.uniform(0.15, 0.35) for i, d in enumerate(drone_sig)]

        s0 = seconds_to_samples(start, sample_rate)
        s1 = min(s0 + len(drone_sig), n)
        seg_len = s1 - s0
        if HAS_NUMPY:
            base[s0:s1] += drone_sig[:seg_len]
        else:
            for i in range(seg_len):
                base[s0 + i] += drone_sig[i]

    # Constant distant road hum
    hum = lowpass(pink_noise(n, seed), 150, sample_rate) * 0.15 if HAS_NUMPY else [v * 0.15 for v in lowpass(pink_noise(n, seed), 150, sample_rate)]
    if HAS_NUMPY:
        base += hum
    else:
        base = [b + h for b, h in zip(base, hum)]

    return fade_in_out(normalize(base, target_peak=0.7), 0.3, 0.3, sample_rate)
