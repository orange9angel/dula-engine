"""Procedural audio protocol registry.

This file is the single source of truth for which procedural sound types are
available, their parameters, and which generator function implements them.
It is intentionally simple so that both Python and JavaScript parsers can
mirror it easily.
"""
from . import generators


REGISTRY = {
    # Combat
    "gunfight": {
        "category": "combat",
        "params": ["duration", "density", "volume"],
        "defaults": {"density": 0.5},
        "description": "间歇性能量枪/实弹交火，density 控制每秒枪声密度",
        "generator": generators.gunfight,
    },
    "laser_blast": {
        "category": "combat",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "单发能量步枪：机械扳机 + 中频裂响 + 金属尾音",
        "generator": generators.laser_blast,
    },
    "plasma_rifle": {
        "category": "combat",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "等离子步枪：沸腾能量放电 + 机械机身",
        "generator": generators.plasma_rifle,
    },
    "railgun": {
        "category": "combat",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "重型电磁轨道炮：尖锐机械爆裂 + 次低音尾震",
        "generator": generators.railgun,
    },
    "explosion": {
        "category": "combat",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "低频爆炸冲击",
        "generator": generators.explosion,
    },
    "impact_thud": {
        "category": "combat",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "重击/倒地：低频 thud + crunch",
        "generator": generators.impact_thud,
    },

    # Vehicles
    "engine_idle": {
        "category": "vehicles",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "车辆/机械怠速低频轰鸣",
        "generator": generators.engine_idle,
    },
    "traffic": {
        "category": "vehicles",
        "params": ["duration", "density", "volume"],
        "defaults": {"density": 0.3},
        "description": "公路车流持续轰鸣，density 控制车辆密度",
        "generator": generators.traffic,
    },

    # Nature
    "wind": {
        "category": "nature",
        "params": ["duration", "intensity", "volume"],
        "defaults": {"intensity": 0.5},
        "description": "风声，intensity 控制风力和高频比例",
        "generator": generators.wind,
    },
    "rain": {
        "category": "nature",
        "params": ["duration", "intensity", "volume"],
        "defaults": {"intensity": 0.5},
        "description": "雨声环境",
        "generator": generators.rain,
    },

    # Mechanical
    "transform_mechanical": {
        "category": "mechanical",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "机械/机器人变形：次低频震动 + 稀疏撞击",
        "generator": generators.transform_mechanical,
    },
    "servo": {
        "category": "mechanical",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "短促舵机/机械运动（慎用，保持极低音量）",
        "generator": generators.servo,
    },
    "metal_stress": {
        "category": "mechanical",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "金属扭曲/吱嘎声",
        "generator": generators.metal_stress,
    },

    # Sci-fi
    "vault_hum": {
        "category": "scifi",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "科幻能量室/金库低频谐波嗡鸣",
        "generator": generators.vault_hum,
    },
    "energy_hum": {
        "category": "scifi",
        "params": ["duration", "volume"],
        "defaults": {},
        "description": "脉冲式能量场嗡鸣",
        "generator": generators.energy_hum,
    },
}


def list_types():
    """Return sorted list of available procedural sound types."""
    return sorted(REGISTRY.keys())


def get_info(sound_type):
    return REGISTRY.get(sound_type)


def generate(sound_type, **kwargs):
    """Generate a procedural sound by type name.

    Kwargs are passed to the generator after applying defaults. Common keys:
      - duration (default 2.0 for spot effects if not provided by caller)
      - volume, density, intensity, etc.
    """
    info = REGISTRY.get(sound_type)
    if not info:
        raise ValueError(f"Unknown procedural sound type: {sound_type}. "
                         f"Available: {', '.join(list_types())}")
    params = dict(info.get("defaults", {}))
    params.update(kwargs)
    # Remove non-generator keys; 'volume' is handled by the mixer.
    params.pop("volume", None)
    return info["generator"](**params)
