#!/usr/bin/env python3
"""Generate realistic fighting game style sound effects using advanced synthesis."""

import math
import os
import struct
import wave
import random

random.seed(42)

def _write_wav_mono(filepath, samples, sample_rate=48000):
    """Helper to write mono float samples to WAV."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with wave.open(filepath, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for s in samples:
            v = int(s * 32767)
            v = max(-32768, min(32767, v))
            w.writeframes(struct.pack('<h', v))


def generate_punch_hit(filepath, duration=0.18, sample_rate=48000):
    """Realistic punch hit: layered low thud + mid crack + noise burst."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud_freq = 100 * math.exp(-t / 0.04)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.035) * 0.7
        crack = math.sin(2 * math.pi * 2500 * t) * math.exp(-t / 0.008) * 0.4
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.015) * 0.5
        rumble = math.sin(2 * math.pi * 60 * t) * math.exp(-t / 0.06) * 0.3
        
        sample = (thud + crack + noise + rumble) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated punch_hit: {filepath}")


def generate_punch_heavy(filepath, duration=0.22, sample_rate=48000):
    """Heavy punch: deeper thud, more impact."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud_freq = 80 * math.exp(-t / 0.05)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.04) * 0.8
        crack = math.sin(2 * math.pi * 2000 * t) * math.exp(-t / 0.006) * 0.5
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.012) * 0.6
        rumble = math.sin(2 * math.pi * 50 * t) * math.exp(-t / 0.08) * 0.4
        
        sample = (thud + crack + noise + rumble) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated punch_heavy: {filepath}")


def generate_punch_light(filepath, duration=0.12, sample_rate=48000):
    """Light quick punch: snappy, short."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud = math.sin(2 * math.pi * 150 * t) * math.exp(-t / 0.02) * 0.5
        crack = math.sin(2 * math.pi * 3000 * t) * math.exp(-t / 0.005) * 0.3
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.01) * 0.4
        
        sample = (thud + crack + noise) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated punch_light: {filepath}")


def generate_kick_impact(filepath, duration=0.22, sample_rate=48000):
    """Heavy kick impact: deeper than punch, more body."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud_freq = 80 * math.exp(-t / 0.05)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.045) * 0.8
        crunch = math.sin(2 * math.pi * 600 * t) * math.exp(-t / 0.012) * 0.35
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.025) * 0.4
        rumble = math.sin(2 * math.pi * 50 * t) * math.exp(-t / 0.08) * 0.35
        
        sample = (thud + crunch + noise + rumble) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated kick_impact: {filepath}")


def generate_kick_swing(filepath, duration=0.25, sample_rate=48000):
    """Kick swing whoosh: air cutting sound for kicks."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        freq = 2000 * math.exp(-t / 0.08)
        whoosh = math.sin(2 * math.pi * freq * t) * math.exp(-t / 0.1) * 0.5
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.06) * 0.4
        
        sample = (whoosh + noise) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated kick_swing: {filepath}")


def generate_sword_slash(filepath, duration=0.3, sample_rate=48000):
    """Sword slash: fast whoosh + metallic ring + air cut."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        freq = 3000 * math.exp(-t / 0.06)
        phase = 2 * math.pi * freq * t
        whoosh = math.sin(phase) * math.exp(-t / 0.08) * 0.5
        ring = (math.sin(2 * math.pi * 1800 * t) * 0.3 +
                math.sin(2 * math.pi * 2400 * t) * 0.2 +
                math.sin(2 * math.pi * 3200 * t) * 0.15) * math.exp(-t / 0.12) * 0.5
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.05) * 0.3
        thump = math.sin(2 * math.pi * 150 * t) * math.exp(-t / 0.02) * 0.2
        
        sample = (whoosh + ring + noise + thump) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated sword_slash: {filepath}")


def generate_energy_blast(filepath, duration=0.4, sample_rate=48000):
    """Energy blast: charging hum + explosive release + shimmer."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        charge_freq = 200 + 600 * min(1.0, t / 0.08)
        charge = math.sin(2 * math.pi * charge_freq * t) * 0.3
        burst_env = math.exp(-t / 0.06)
        burst = (math.sin(2 * math.pi * 800 * t) * 0.4 +
                 math.sin(2 * math.pi * 1200 * t) * 0.3) * burst_env
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.1) * 0.35
        shimmer = math.sin(2 * math.pi * 30 * t) * 0.15 * math.exp(-t / 0.15)
        
        sample = (charge + burst + noise + shimmer) * 0.75
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated energy_blast: {filepath}")


def generate_dash_whoosh(filepath, duration=0.25, sample_rate=48000):
    """Dash whoosh: fast air movement with Doppler-like sweep."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        freq = 1200 * (1 - t / duration) + 300
        phase = 2 * math.pi * freq * t
        whoosh = math.sin(phase) * 0.35
        noise = (random.random() * 2 - 1)
        env = math.exp(-t / 0.08) if t > 0.02 else (t / 0.02)
        noise = noise * env * 0.5
        rumble = math.sin(2 * math.pi * 100 * t) * env * 0.2
        
        sample = (whoosh + noise + rumble) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated dash_whoosh: {filepath}")


def generate_impact_thud(filepath, duration=0.45, sample_rate=48000):
    """Heavy body impact: low freq thud + noise + subtle reverb tail."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud_freq = 70 * math.exp(-t / 0.1)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.15) * 0.7
        crunch = (random.random() * 2 - 1) * math.exp(-t / 0.03) * 0.4
        tail = (random.random() * 2 - 1) * math.exp(-t / 0.2) * 0.15
        sub = math.sin(2 * math.pi * 40 * t) * math.exp(-t / 0.2) * 0.3
        
        sample = (thud + crunch + tail + sub) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated impact_thud: {filepath}")


def generate_energy_charge(filepath, duration=1.5, sample_rate=48000):
    """Energy charging: rising hum with crackles and buildup."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        progress = t / duration
        
        base_freq = 150 + 400 * progress
        hum = math.sin(2 * math.pi * base_freq * t) * 0.3
        hum2 = math.sin(2 * math.pi * base_freq * 2 * t) * 0.15 * progress
        crackle = (random.random() * 2 - 1) * progress * 0.25
        rumble = math.sin(2 * math.pi * 80 * t) * progress * 0.2
        env = min(1.0, t / 0.3)
        
        sample = (hum + hum2 + crackle + rumble) * env * 0.6
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated energy_charge: {filepath}")


def generate_block_impact(filepath, duration=0.2, sample_rate=48000):
    """Block/parry impact: metallic clink + dull thud."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        ring = (math.sin(2 * math.pi * 2000 * t) * 0.3 +
                math.sin(2 * math.pi * 2800 * t) * 0.2) * math.exp(-t / 0.04)
        thud = math.sin(2 * math.pi * 120 * t) * math.exp(-t / 0.05) * 0.5
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.015) * 0.3
        
        sample = (ring + thud + noise) * 0.75
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated block_impact: {filepath}")


def generate_spin_kick(filepath, duration=0.35, sample_rate=48000):
    """Spin kick whoosh: rotating air cut sound."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        freq = 1500 + 1000 * math.sin(t * 15)
        whoosh = math.sin(2 * math.pi * freq * t) * math.exp(-t / 0.12) * 0.4
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.08) * 0.35
        
        sample = (whoosh + noise) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated spin_kick: {filepath}")


def generate_roll_ground(filepath, duration=0.5, sample_rate=48000):
    """Rolling on ground: soft thuds and scrapes."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud = math.sin(2 * math.pi * 80 * t) * math.exp(-t / 0.08) * 0.3
        scrape = (random.random() * 2 - 1) * math.exp(-t / 0.15) * 0.2
        rumble = math.sin(2 * math.pi * 60 * t) * math.exp(-t / 0.2) * 0.25
        
        sample = (thud + scrape + rumble) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated roll_ground: {filepath}")


def generate_stomp(filepath, duration=0.2, sample_rate=48000):
    """Foot stomp: sharp impact on ground."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud = math.sin(2 * math.pi * 120 * t) * math.exp(-t / 0.03) * 0.7
        crack = math.sin(2 * math.pi * 800 * t) * math.exp(-t / 0.01) * 0.3
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.02) * 0.4
        
        sample = (thud + crack + noise) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated stomp: {filepath}")


def generate_grunt(filepath, duration=0.3, sample_rate=48000):
    """Fighter grunt/exertion: low vocalization-like sound."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        freq = 180 + 80 * math.sin(t * 8)
        voice = math.sin(2 * math.pi * freq * t) * math.exp(-t / 0.15) * 0.5
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.1) * 0.15
        
        sample = (voice + noise) * 0.6
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated grunt: {filepath}")


def generate_whoosh_fast(filepath, duration=0.2, sample_rate=48000):
    """Fast whoosh for quick movements."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        freq = 2500 * math.exp(-t / 0.04)
        whoosh = math.sin(2 * math.pi * freq * t) * math.exp(-t / 0.06) * 0.5
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.04) * 0.4
        
        sample = (whoosh + noise) * 0.7
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated whoosh_fast: {filepath}")


def generate_body_fall(filepath, duration=0.4, sample_rate=48000):
    """Body falling to ground: heavy thud."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        thud = math.sin(2 * math.pi * 60 * t) * math.exp(-t / 0.08) * 0.8
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.05) * 0.3
        rumble = math.sin(2 * math.pi * 40 * t) * math.exp(-t / 0.15) * 0.4
        
        sample = (thud + noise + rumble) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated body_fall: {filepath}")


def generate_guard_hop(filepath, duration=0.15, sample_rate=48000):
    """Quick guard hop: light foot shuffle."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        tap = math.sin(2 * math.pi * 200 * t) * math.exp(-t / 0.02) * 0.4
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.015) * 0.2
        
        sample = (tap + noise) * 0.6
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated guard_hop: {filepath}")


def main():
    output_dir = r'D:\opensource\movie\dula-story\episodes\yusuke_motion_demo\assets\audio\sfx'
    
    generate_punch_hit(os.path.join(output_dir, 'punch_hit.wav'))
    generate_punch_heavy(os.path.join(output_dir, 'punch_heavy.wav'))
    generate_punch_light(os.path.join(output_dir, 'punch_light.wav'))
    generate_kick_impact(os.path.join(output_dir, 'kick_impact.wav'))
    generate_kick_swing(os.path.join(output_dir, 'kick_swing.wav'))
    generate_sword_slash(os.path.join(output_dir, 'sword_slash.wav'))
    generate_energy_blast(os.path.join(output_dir, 'energy_blast.wav'))
    generate_dash_whoosh(os.path.join(output_dir, 'dash_whoosh.wav'))
    generate_impact_thud(os.path.join(output_dir, 'impact_thud.wav'))
    generate_energy_charge(os.path.join(output_dir, 'energy_charge.wav'))
    generate_block_impact(os.path.join(output_dir, 'block_impact.wav'))
    generate_spin_kick(os.path.join(output_dir, 'spin_kick.wav'))
    generate_roll_ground(os.path.join(output_dir, 'roll_ground.wav'))
    generate_stomp(os.path.join(output_dir, 'stomp.wav'))
    generate_grunt(os.path.join(output_dir, 'grunt.wav'))
    generate_whoosh_fast(os.path.join(output_dir, 'whoosh_fast.wav'))
    generate_body_fall(os.path.join(output_dir, 'body_fall.wav'))
    generate_guard_hop(os.path.join(output_dir, 'guard_hop.wav'))
    
    print("\nAll fighting SFX generated!")


if __name__ == "__main__":
    main()
