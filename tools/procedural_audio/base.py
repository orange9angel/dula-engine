"""Base utilities for procedural audio generators.

All generators output 48 kHz mono float samples in [-1, 1].
The renderer/mixer is responsible for writing the final WAV.
"""
import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 48000

# Use numpy when available, otherwise fall back to pure Python.
try:
    import numpy as np
    HAS_NUMPY = True
except Exception:  # pragma: no cover
    HAS_NUMPY = False


def write_wav_mono(filepath, samples, sample_rate=SAMPLE_RATE):
    """Write a mono 16-bit WAV file from float samples."""
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    if HAS_NUMPY and isinstance(samples, np.ndarray):
        samples = samples.tolist()
    with wave.open(str(filepath), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for s in samples:
            v = int(max(-1.0, min(1.0, float(s))) * 32767)
            v = max(-32768, min(32767, v))
            w.writeframes(struct.pack("<h", v))


def seconds_to_samples(seconds, sample_rate=SAMPLE_RATE):
    return int(round(seconds * sample_rate))


def make_time_array(duration, sample_rate=SAMPLE_RATE):
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        return np.arange(n, dtype=np.float64) / sample_rate
    return [i / sample_rate for i in range(n)]


def white_noise(n, seed=None):
    """Deterministic white noise if seed is given."""
    rng = random.Random(seed)
    if HAS_NUMPY:
        return np.array([rng.uniform(-1.0, 1.0) for _ in range(n)], dtype=np.float64)
    return [rng.uniform(-1.0, 1.0) for _ in range(n)]


def pink_noise(n, seed=None):
    """Approximate pink noise using Voss-McCartney algorithm."""
    if HAS_NUMPY:
        white = white_noise(n, seed)
        # Simple 1/f approximation via cumulative sum of randomized octaves.
        out = np.zeros(n)
        octaves = 8
        rng = random.Random(seed)
        for _ in range(octaves):
            step = 2 ** rng.randint(6, 10)
            idx = 0
            while idx < n:
                val = rng.uniform(-1.0, 1.0)
                end = min(idx + step, n)
                out[idx:end] += val
                idx = end
        out /= octaves
        # Combine with white noise for natural texture.
        out = out * 0.7 + white * 0.3
        return out / max(np.max(np.abs(out)), 1e-9)
    # Pure Python fallback
    out = [0.0] * n
    octaves = 8
    rng = random.Random(seed)
    for _ in range(octaves):
        step = 2 ** rng.randint(6, 10)
        idx = 0
        while idx < n:
            val = rng.uniform(-1.0, 1.0)
            end = min(idx + step, n)
            for i in range(idx, end):
                out[i] += val
            idx = end
    scale = max(max(abs(v) for v in out), 1e-9)
    white = white_noise(n, seed)
    return [0.7 * (v / scale) + 0.3 * w for v, w in zip(out, white)]


def fade_in_out(data, attack=0.05, release=0.05, sample_rate=SAMPLE_RATE):
    """Apply linear fade in/out envelopes."""
    n = len(data)
    if HAS_NUMPY:
        a = min(int(round(attack * sample_rate)), n)
        r = min(int(round(release * sample_rate)), n)
        env = np.ones(n, dtype=np.float64)
        if a:
            env[:a] = np.linspace(0, 1, a)
        if r:
            env[-r:] = np.linspace(1, 0, r)
        return data * env
    a = min(int(round(attack * sample_rate)), n)
    r = min(int(round(release * sample_rate)), n)
    env = [1.0] * n
    for i in range(a):
        env[i] = i / a if a else 1.0
    for i in range(r):
        env[n - r + i] = 1.0 - (i / r if r else 0.0)
    return [d * e for d, e in zip(data, env)]


def exp_decay_env(data, decay, sample_rate=SAMPLE_RATE):
    """Apply exponential decay envelope (per-sample)."""
    if HAS_NUMPY:
        t = np.arange(len(data)) / sample_rate
        return data * np.exp(-t / decay)
    out = []
    for i, s in enumerate(data):
        t = i / sample_rate
        out.append(s * math.exp(-t / decay))
    return out


def lowpass(data, cutoff, sample_rate=SAMPLE_RATE, order=2):
    """Butterworth lowpass. Falls back to a simple IIR if scipy is missing."""
    if HAS_NUMPY:
        try:
            from scipy import signal
            sos = signal.butter(order, cutoff, btype="low", fs=sample_rate, output="sos")
            return signal.sosfilt(sos, data)
        except Exception:
            pass
    # Simple first-order IIR fallback.
    rc = 1.0 / (2 * math.pi * cutoff)
    dt = 1.0 / sample_rate
    alpha = dt / (rc + dt)
    out = []
    y = 0.0
    for x in data:
        y += alpha * (x - y)
        out.append(y)
    return out


def bandpass(data, low, high, sample_rate=SAMPLE_RATE, order=2):
    """Butterworth bandpass. Falls back to highpass + lowpass if scipy is missing."""
    if HAS_NUMPY:
        try:
            from scipy import signal
            sos = signal.butter(order, [low, high], btype="band", fs=sample_rate, output="sos")
            return signal.sosfilt(sos, data)
        except Exception:
            pass
    # Fallback: highpass then lowpass.
    return lowpass(highpass(data, low, sample_rate), high, sample_rate)


def highpass(data, cutoff, sample_rate=SAMPLE_RATE, order=2):
    """Butterworth highpass. Falls back to a simple IIR if scipy is missing."""
    if HAS_NUMPY:
        try:
            from scipy import signal
            sos = signal.butter(order, cutoff, btype="high", fs=sample_rate, output="sos")
            return signal.sosfilt(sos, data)
        except Exception:
            pass
    # Simple first-order IIR highpass fallback.
    rc = 1.0 / (2 * math.pi * cutoff)
    dt = 1.0 / sample_rate
    alpha = rc / (rc + dt)
    out = []
    y = 0.0
    prev_x = 0.0
    for x in data:
        y = alpha * (y + x - prev_x)
        prev_x = x
        out.append(y)
    return out


def normalize(data, target_peak=0.95):
    """Normalize to target peak."""
    if HAS_NUMPY:
        peak = np.max(np.abs(data))
        if peak == 0:
            return data
        return data / peak * target_peak
    peak = max((abs(v) for v in data), default=0.0)
    if peak == 0:
        return data
    return [v / peak * target_peak for v in data]


def sweep_sine(duration, f0, f1, amplitude=1.0, sample_rate=SAMPLE_RATE):
    """Exponential frequency sweep sine."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        freq = f0 * (f1 / f0) ** (t / duration)
        phase = np.cumsum(2 * np.pi * freq / sample_rate)
        return np.sin(phase) * amplitude
    phase = 0.0
    out = []
    for i in range(n):
        t = i / sample_rate
        f = f0 * (f1 / f0) ** (t / duration)
        phase += 2 * math.pi * f / sample_rate
        out.append(math.sin(phase) * amplitude)
    return out


def sine_tone(duration, freq, amplitude=1.0, sample_rate=SAMPLE_RATE):
    """Pure sine tone."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        return np.sin(2 * np.pi * freq * t) * amplitude
    return [math.sin(2 * math.pi * freq * (i / sample_rate)) * amplitude for i in range(n)]


def sawtooth(duration, freq, amplitude=1.0, sample_rate=SAMPLE_RATE):
    """Band-limited-ish sawtooth."""
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Add harmonics up to Nyquist.
        out = np.zeros(n)
        k = 1
        while k * freq < sample_rate / 2 and k <= 16:
            out += np.sin(2 * np.pi * k * freq * t) / k
            k += 1
        return out * amplitude * 0.7
    out = [0.0] * n
    k = 1
    while k * freq < sample_rate / 2 and k <= 16:
        for i in range(n):
            t = i / sample_rate
            out[i] += math.sin(2 * math.pi * k * freq * t) / k
        k += 1
    return [v * amplitude * 0.7 for v in out]
