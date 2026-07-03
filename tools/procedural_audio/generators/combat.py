"""Combat / weapon sound effect generators.

All weapon sounds are designed to feel mechanical and physical rather than
purely electronic: each shot starts with a short trigger/hammer click, carries
a band-limited energy crack, and ends with a metallic or sub-bass tail.
"""
import math
import random

from ..base import (
    SAMPLE_RATE,
    HAS_NUMPY,
    bandpass,
    exp_decay_env,
    fade_in_out,
    highpass,
    lowpass,
    normalize,
    seconds_to_samples,
    sweep_sine,
    white_noise,
    pink_noise,
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


def _click(sample_rate=SAMPLE_RATE):
    """Short mechanical trigger/hammer click."""
    n = seconds_to_samples(0.015, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        return np.random.RandomState(int(t[0] * 1000) if len(t) else 0).uniform(-1, 1, n) * np.exp(-t / 0.003)
    rng = random.Random()
    return [rng.uniform(-1.0, 1.0) * math.exp(-(i / sample_rate) / 0.003) for i in range(n)]


def _metallic_tail(duration=0.18, sample_rate=SAMPLE_RATE, seed=None):
    """Ringing metallic tail from band-passed noise + sparse sine ring."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        noise = bandpass(white_noise(n, seed=seed), 1200, 6000, sample_rate) * 0.35
        ring = np.sin(2 * np.pi * (2200 + rng.uniform(-300, 300)) * t) * np.exp(-t / 0.04) * 0.25
        return (noise + ring) * np.exp(-t / 0.07)
    noise = bandpass(white_noise(n, seed=seed), 1200, 6000, sample_rate)
    ring_freq = 2200 + rng.uniform(-300, 300)
    out = []
    for i in range(n):
        t = i / sample_rate
        v = noise[i] * 0.35 + math.sin(2 * math.pi * ring_freq * t) * math.exp(-t / 0.04) * 0.25
        v *= math.exp(-t / 0.07)
        out.append(v)
    return _as_array(out)


def _sub_tail(duration=0.35, sample_rate=SAMPLE_RATE, seed=None):
    """Sub-bass thump tail for heavy weapons."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    freq = 55 + rng.uniform(-8, 8)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        return np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.09) * 0.6
    return _as_array([math.sin(2 * math.pi * freq * (i / sample_rate)) * math.exp(-(i / sample_rate) / 0.09) * 0.6 for i in range(n)])


def laser_blast(duration=0.22, sample_rate=SAMPLE_RATE, seed=None):
    """Sci-fi energy gunshot with a physical mechanism feel.

    Less chirpy than before: a short trigger click, a distorted mid crack,
    and a small metallic ring-off.
    """
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    click = _click(sample_rate)
    tail = _metallic_tail(duration=max(0.12, duration * 0.6), sample_rate=sample_rate, seed=seed)

    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Softer descending chirp mixed with saturated noise.
        f0, f1 = 1600, 400
        freq = f0 * (f1 / f0) ** (t / duration)
        phase = np.cumsum(2 * np.pi * freq / sample_rate)
        chirp = np.sin(phase) * 0.45
        noise = bandpass(white_noise(n, seed=seed), 600, 4500, sample_rate) * 0.55
        crack = np.tanh(chirp + noise)  # soft saturation
        body = crack * np.exp(-t / 0.045)
        sig = body
    else:
        phase = 0.0
        noise = bandpass(white_noise(n, seed=seed), 600, 4500, sample_rate)
        sig = []
        f0, f1 = 1600, 400
        for i in range(n):
            t = i / sample_rate
            f = f0 * (f1 / f0) ** (t / duration)
            phase += 2 * math.pi * f / sample_rate
            chirp = math.sin(phase) * 0.45
            v = math.tanh(chirp + noise[i] * 0.55) * math.exp(-t / 0.045)
            sig.append(v)
        sig = _as_array(sig)

    _add_at(sig, click, 0)
    _add_at(sig, tail, seconds_to_samples(0.02, sample_rate))
    return fade_in_out(sig, 0.001, 0.05, sample_rate)


def railgun(duration=0.35, sample_rate=SAMPLE_RATE, seed=None):
    """Heavy kinetic railgun: sharp mechanical crack + sub-bass thump + metallic ring."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    click = _click(sample_rate)
    sub = _sub_tail(duration=max(0.25, duration * 0.7), sample_rate=sample_rate, seed=seed)
    tail = _metallic_tail(duration=max(0.15, duration * 0.5), sample_rate=sample_rate, seed=seed)

    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Fast crack with very little pitch sweep.
        f0, f1 = 900, 200
        freq = f0 * (f1 / f0) ** (t / (duration * 0.15))
        phase = np.cumsum(2 * np.pi * freq / sample_rate)
        crack = np.sin(phase) * np.exp(-t / 0.015) * 0.5
        noise = bandpass(white_noise(n, seed=seed), 400, 3500, sample_rate) * np.exp(-t / 0.02) * 0.6
        body = np.tanh(crack + noise)
    else:
        phase = 0.0
        noise = bandpass(white_noise(n, seed=seed), 400, 3500, sample_rate)
        sig = []
        f0, f1 = 900, 200
        for i in range(n):
            t = i / sample_rate
            f = f0 * (f1 / f0) ** (min(t, duration * 0.15) / (duration * 0.15))
            phase += 2 * math.pi * f / sample_rate
            crack = math.sin(phase) * math.exp(-t / 0.015) * 0.5
            v = math.tanh(crack + noise[i] * math.exp(-t / 0.02) * 0.6)
            sig.append(v)
        body = _as_array(sig)

    _add_at(body, click, 0)
    _add_at(body, sub, seconds_to_samples(0.005, sample_rate))
    _add_at(body, tail, seconds_to_samples(0.03, sample_rate))
    return fade_in_out(body, 0.001, 0.08, sample_rate)


def plasma_rifle(duration=0.28, sample_rate=SAMPLE_RATE, seed=None):
    """Plasma rifle: bubbling energy discharge with a solid mechanical body."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    click = _click(sample_rate)
    tail = _metallic_tail(duration=max(0.14, duration * 0.5), sample_rate=sample_rate, seed=seed)

    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Amplitude-modulated noise gives the "bubbling plasma" texture.
        carrier = 280 + rng.uniform(-30, 30)
        am = 0.5 + 0.5 * np.sin(2 * np.pi * 35 * t)
        buzz = np.sin(2 * np.pi * carrier * t) * am * 0.35
        noise = bandpass(white_noise(n, seed=seed), 500, 4000, sample_rate) * 0.5
        body = np.tanh(buzz + noise) * np.exp(-t / 0.055)
    else:
        carrier = 280 + rng.uniform(-30, 30)
        noise = bandpass(white_noise(n, seed=seed), 500, 4000, sample_rate)
        sig = []
        for i in range(n):
            t = i / sample_rate
            am = 0.5 + 0.5 * math.sin(2 * math.pi * 35 * t)
            buzz = math.sin(2 * math.pi * carrier * t) * am * 0.35
            v = math.tanh(buzz + noise[i] * 0.5) * math.exp(-t / 0.055)
            sig.append(v)
        body = _as_array(sig)

    _add_at(body, click, 0)
    _add_at(body, tail, seconds_to_samples(0.02, sample_rate))
    return fade_in_out(body, 0.001, 0.06, sample_rate)


def explosion(duration=0.6, sample_rate=SAMPLE_RATE, seed=None):
    """Punchy explosion: sub-bass push, noise burst, crackle and short debris tail."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Deep sub push.
        sub_freq = 55 + rng.uniform(-5, 5)
        sub = np.sin(2 * np.pi * sub_freq * t) * np.exp(-t / 0.14) * 0.9
        # Main noise cloud, lowpassed for weight.
        noise = lowpass(white_noise(n, seed=seed), 800, sample_rate) * np.exp(-t / 0.1) * 0.75
        # Crackle bursts.
        crackle = bandpass(white_noise(n, seed=seed + 2 if seed else 2), 1200, 6000, sample_rate) * np.exp(-t / 0.04) * 0.5
        # Sparse debris ticks.
        debris = bandpass(white_noise(n, seed=seed + 3 if seed else 3), 4000, 12000, sample_rate) * np.exp(-t / 0.07) * 0.25
        env = np.exp(-t / 0.18)
        sig = (sub + noise + crackle + debris) * env
    else:
        sig = []
        sub_freq = 55 + rng.uniform(-5, 5)
        noise = lowpass(white_noise(n, seed=seed), 800, sample_rate)
        crackle = bandpass(white_noise(n, seed=seed + 2 if seed else 2), 1200, 6000, sample_rate)
        debris = bandpass(white_noise(n, seed=seed + 3 if seed else 3), 4000, 12000, sample_rate)
        for i in range(n):
            t = i / sample_rate
            sub = math.sin(2 * math.pi * sub_freq * t) * math.exp(-t / 0.14) * 0.9
            v = (sub
                 + noise[i] * math.exp(-t / 0.1) * 0.75
                 + crackle[i] * math.exp(-t / 0.04) * 0.5
                 + debris[i] * math.exp(-t / 0.07) * 0.25) * math.exp(-t / 0.18)
            sig.append(v)
    return fade_in_out(_as_array(sig), 0.002, 0.22, sample_rate)


def impact_thud(duration=0.4, sample_rate=SAMPLE_RATE, seed=None):
    """Heavy body/robot impact: low freq thud + crunch + sub."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    t = [i / sample_rate for i in range(n)]
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        thud_freq = 70 * np.exp(-t / 0.1)
        thud = np.sin(2 * np.pi * thud_freq * t) * 0.7
        crunch = bandpass(white_noise(n, seed=seed), 400, 2000, sample_rate) * np.exp(-t / 0.03) * 0.4
        sub = np.sin(2 * np.pi * 40 * t) * np.exp(-t / 0.2) * 0.3
        sig = thud + crunch + sub
    else:
        sig = []
        noise = bandpass(white_noise(n, seed=seed), 400, 2000, sample_rate)
        for i in range(n):
            tf = 70 * math.exp(-t[i] / 0.1)
            thud = math.sin(2 * math.pi * tf * t[i]) * 0.7
            crunch = noise[i] * math.exp(-t[i] / 0.03) * 0.4
            sub = math.sin(2 * math.pi * 40 * t[i]) * math.exp(-t[i] / 0.2) * 0.3
            sig.append(thud + crunch + sub)
    return _as_array(sig)


def cannon_fire(duration=0.35, sample_rate=SAMPLE_RATE, seed=None):
    """Heavy ballistic cannon: mechanical trigger + bore thump + mid crack + metal tail."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    click = _click(sample_rate)
    sub = _sub_tail(duration=max(0.28, duration * 0.7), sample_rate=sample_rate, seed=seed)
    tail = _metallic_tail(duration=max(0.18, duration * 0.5), sample_rate=sample_rate, seed=seed)

    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Fast crack with very little pitch sweep.
        f0, f1 = 650, 120
        freq = f0 * (f1 / f0) ** (t / (duration * 0.18))
        phase = np.cumsum(2 * np.pi * freq / sample_rate)
        crack = np.sin(phase) * np.exp(-t / 0.018) * 0.55
        # Broadband body noise for physical punch.
        noise = bandpass(white_noise(n, seed=seed), 250, 3200, sample_rate) * np.exp(-t / 0.035) * 0.7
        body = np.tanh(crack + noise)
    else:
        phase = 0.0
        noise = bandpass(white_noise(n, seed=seed), 250, 3200, sample_rate)
        sig = []
        f0, f1 = 650, 120
        for i in range(n):
            t = i / sample_rate
            f = f0 * (f1 / f0) ** (min(t, duration * 0.18) / (duration * 0.18))
            phase += 2 * math.pi * f / sample_rate
            crack = math.sin(phase) * math.exp(-t / 0.018) * 0.55
            v = math.tanh(crack + noise[i] * math.exp(-t / 0.035) * 0.7)
            sig.append(v)
        body = _as_array(sig)

    _add_at(body, click, 0)
    _add_at(body, sub, seconds_to_samples(0.004, sample_rate))
    _add_at(body, tail, seconds_to_samples(0.025, sample_rate))
    return fade_in_out(body, 0.001, 0.09, sample_rate)


def bullet_impact(duration=0.22, sample_rate=SAMPLE_RATE, seed=None):
    """Bullet striking metal/concrete: high spark crack + low thud + debris scatter."""
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    if HAS_NUMPY:
        t = np.arange(n) / sample_rate
        # Piercing high crack.
        crack = bandpass(white_noise(n, seed=seed), 2500, 9000, sample_rate) * np.exp(-t / 0.012) * 0.65
        # Low material thud.
        thud_freq = 180 * np.exp(-t / 0.04)
        thud = np.sin(2 * np.pi * thud_freq * t) * np.exp(-t / 0.035) * 0.5
        # Sparkle debris.
        debris = bandpass(white_noise(n, seed=seed + 1 if seed else 1), 6000, 14000, sample_rate) * np.exp(-t / 0.06) * 0.35
        sig = crack + thud + debris
    else:
        noise = bandpass(white_noise(n, seed=seed), 2500, 9000, sample_rate)
        thud_noise = bandpass(white_noise(n, seed=seed + 1 if seed else 1), 6000, 14000, sample_rate)
        sig = []
        for i in range(n):
            t = i / sample_rate
            crack = noise[i] * math.exp(-t / 0.012) * 0.65
            thud_freq = 180 * math.exp(-t / 0.04)
            thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.035) * 0.5
            debris = thud_noise[i] * math.exp(-t / 0.06) * 0.35
            sig.append(crack + thud + debris)
        sig = _as_array(sig)
    return fade_in_out(sig, 0.001, 0.06, sample_rate)


def gunfight(duration=4.0, density=0.5, sample_rate=SAMPLE_RATE, seed=None):
    """Layered intermittent gunfight mixing energy and kinetic weapons.

    Args:
        duration: total length in seconds.
        density: shots per second (approx). Use 0.2-1.5.
    """
    rng = random.Random(seed)
    n = seconds_to_samples(duration, sample_rate)
    base = _zeros(n)

    weapon_choices = [laser_blast, plasma_rifle, railgun, cannon_fire]
    num_shots = max(3, int(duration * density))
    for _ in range(num_shots):
        t = rng.uniform(0.0, max(duration - 0.35, 0.0))
        weapon = rng.choice(weapon_choices)
        shot = weapon(duration=rng.uniform(0.18, 0.35), sample_rate=sample_rate, seed=rng.randint(0, 999999))
        vol = rng.uniform(0.5, 1.0)
        _add_at(base, shot * vol if HAS_NUMPY else [v * vol for v in shot], seconds_to_samples(t, sample_rate))

    # Occasional heavier impacts/explosions and bullet impacts.
    num_heavy = max(1, int(num_shots * 0.35))
    for _ in range(num_heavy):
        t = rng.uniform(0.2, max(duration - 0.4, 0.3))
        heavy = rng.choice([explosion, bullet_impact])
        heavy_dur = 0.3 if heavy is bullet_impact else rng.uniform(0.35, 0.6)
        heavy_clip = heavy(duration=heavy_dur, sample_rate=sample_rate, seed=rng.randint(0, 999999))
        vol = rng.uniform(0.4, 0.8)
        _add_at(base, heavy_clip * vol if HAS_NUMPY else [v * vol for v in heavy_clip], seconds_to_samples(t, sample_rate))

    return normalize(base, target_peak=0.85)
