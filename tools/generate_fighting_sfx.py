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
        
        # Layer 1: Deep body thud (80-120Hz decaying sine)
        thud_freq = 100 * math.exp(-t / 0.04)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.035) * 0.7
        
        # Layer 2: Sharp crack/impact (higher freq, fast decay)
        crack = math.sin(2 * math.pi * 2500 * t) * math.exp(-t / 0.008) * 0.4
        
        # Layer 3: White noise burst for texture
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.015) * 0.5
        
        # Layer 4: Sub-bass rumble
        rumble = math.sin(2 * math.pi * 60 * t) * math.exp(-t / 0.06) * 0.3
        
        sample = (thud + crack + noise + rumble) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated punch_hit: {filepath}")


def generate_kick_impact(filepath, duration=0.22, sample_rate=48000):
    """Heavy kick impact: deeper than punch, more body."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        # Layer 1: Very deep thud (60-100Hz)
        thud_freq = 80 * math.exp(-t / 0.05)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.045) * 0.8
        
        # Layer 2: Mid crunch
        crunch = math.sin(2 * math.pi * 600 * t) * math.exp(-t / 0.012) * 0.35
        
        # Layer 3: Noise with longer tail
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.025) * 0.4
        
        # Layer 4: Low rumble
        rumble = math.sin(2 * math.pi * 50 * t) * math.exp(-t / 0.08) * 0.35
        
        sample = (thud + crunch + noise + rumble) * 0.8
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated kick_impact: {filepath}")


def generate_sword_slash(filepath, duration=0.3, sample_rate=48000):
    """Sword slash: fast whoosh + metallic ring + air cut."""
    n = int(sample_rate * duration)
    samples = []
    for i in range(n):
        t = i / sample_rate
        
        # Layer 1: Fast frequency sweep (high to low) for whoosh
        freq = 3000 * math.exp(-t / 0.06)
        phase = 2 * math.pi * freq * t
        whoosh = math.sin(phase) * math.exp(-t / 0.08) * 0.5
        
        # Layer 2: Metallic ring (multiple harmonics)
        ring = (math.sin(2 * math.pi * 1800 * t) * 0.3 +
                math.sin(2 * math.pi * 2400 * t) * 0.2 +
                math.sin(2 * math.pi * 3200 * t) * 0.15) * math.exp(-t / 0.12) * 0.5
        
        # Layer 3: White noise for air cut texture
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.05) * 0.3
        
        # Layer 4: Subtle low-end thump at start
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
        
        # Layer 1: Rising pitch charge
        charge_freq = 200 + 600 * min(1.0, t / 0.08)
        charge = math.sin(2 * math.pi * charge_freq * t) * 0.3
        
        # Layer 2: Explosive burst (decays quickly)
        burst_env = math.exp(-t / 0.06)
        burst = (math.sin(2 * math.pi * 800 * t) * 0.4 +
                 math.sin(2 * math.pi * 1200 * t) * 0.3) * burst_env
        
        # Layer 3: Noise with envelope
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.1) * 0.35
        
        # Layer 4: Shimmer/tremolo effect
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
        
        # Layer 1: Rising then falling freq sweep
        freq = 1200 * (1 - t / duration) + 300
        phase = 2 * math.pi * freq * t
        whoosh = math.sin(phase) * 0.35
        
        # Layer 2: Pink-ish noise with envelope
        # Simple approximation: white noise with slight filtering via envelope
        noise = (random.random() * 2 - 1)
        env = math.exp(-t / 0.08) if t > 0.02 else (t / 0.02)
        noise = noise * env * 0.5
        
        # Layer 3: Subtle low rumble for body
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
        
        # Layer 1: Deep sine thud with pitch drop
        thud_freq = 70 * math.exp(-t / 0.1)
        thud = math.sin(2 * math.pi * thud_freq * t) * math.exp(-t / 0.15) * 0.7
        
        # Layer 2: Noise crunch (shorter)
        crunch = (random.random() * 2 - 1) * math.exp(-t / 0.03) * 0.4
        
        # Layer 3: Longer noise tail for reverb feel
        tail = (random.random() * 2 - 1) * math.exp(-t / 0.2) * 0.15
        
        # Layer 4: Very low sub-bass
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
        
        # Layer 1: Rising sine wave
        base_freq = 150 + 400 * progress
        hum = math.sin(2 * math.pi * base_freq * t) * 0.3
        
        # Layer 2: Second harmonic
        hum2 = math.sin(2 * math.pi * base_freq * 2 * t) * 0.15 * progress
        
        # Layer 3: Crackle/sparkle (increases with progress)
        crackle = (random.random() * 2 - 1) * progress * 0.25
        
        # Layer 4: Low rumble that builds
        rumble = math.sin(2 * math.pi * 80 * t) * progress * 0.2
        
        # Envelope: slow attack, sustain, no sudden cutoff
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
        
        # Layer 1: Metallic ring (multiple frequencies)
        ring = (math.sin(2 * math.pi * 2000 * t) * 0.3 +
                math.sin(2 * math.pi * 2800 * t) * 0.2) * math.exp(-t / 0.04)
        
        # Layer 2: Dull thud
        thud = math.sin(2 * math.pi * 120 * t) * math.exp(-t / 0.05) * 0.5
        
        # Layer 3: Short noise burst
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.015) * 0.3
        
        sample = (ring + thud + noise) * 0.75
        samples.append(sample)
    
    _write_wav_mono(filepath, samples, sample_rate)
    print(f"Generated block_impact: {filepath}")


def main():
    output_dir = r'D:\opensource\movie\dula-story\episodes\yuyuhakusho\assets\audio\sfx'
    
    generate_punch_hit(os.path.join(output_dir, 'punch_hit.wav'))
    generate_kick_impact(os.path.join(output_dir, 'kick_impact.wav'))
    generate_sword_slash(os.path.join(output_dir, 'sword_slash.wav'))
    generate_energy_blast(os.path.join(output_dir, 'energy_blast.wav'))
    generate_dash_whoosh(os.path.join(output_dir, 'dash_whoosh.wav'))
    generate_impact_thud(os.path.join(output_dir, 'impact_thud.wav'))
    generate_energy_charge(os.path.join(output_dir, 'energy_charge.wav'))
    generate_block_impact(os.path.join(output_dir, 'block_impact.wav'))
    
    print("\nAll fighting SFX generated!")


if __name__ == "__main__":
    main()
