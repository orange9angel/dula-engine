"""Procedural audio generators by category."""
from .combat import gunfight, laser_blast, plasma_rifle, railgun, cannon_fire, bullet_impact, explosion, impact_thud
from .vehicles import engine_idle, traffic
from .nature import wind, rain
from .mechanical import transform_mechanical, servo, metal_stress
from .scifi import vault_hum, energy_hum

__all__ = [
    "gunfight",
    "laser_blast",
    "plasma_rifle",
    "railgun",
    "cannon_fire",
    "bullet_impact",
    "explosion",
    "impact_thud",
    "engine_idle",
    "traffic",
    "wind",
    "rain",
    "transform_mechanical",
    "servo",
    "metal_stress",
    "vault_hum",
    "energy_hum",
]
