/**
 * Parser for the `{SFX:Procedural|...}` story tag.
 *
 * This mirrors the Python registry in `tools/procedural_audio/registry.py`.
 * Keeping the protocol explicit on both sides makes it easy for other episodes
 * and tooling to discover which procedural sounds are available.
 */

export const PROCEDURAL_REGISTRY = {
  // Combat
  gunfight: {
    category: 'combat',
    params: ['duration', 'density', 'volume'],
    defaults: { density: 0.5 },
    description: '间歇性能量枪/实弹交火，density 控制每秒枪声密度',
  },
  laser_blast: {
    category: 'combat',
    params: ['duration', 'volume'],
    description: '单发科幻能量枪：下降啁啾 + 噪音爆发',
  },
  explosion: {
    category: 'combat',
    params: ['duration', 'volume'],
    description: '低频爆炸冲击',
  },
  impact_thud: {
    category: 'combat',
    params: ['duration', 'volume'],
    description: '重击/倒地：低频 thud + crunch',
  },

  // Vehicles
  engine_idle: {
    category: 'vehicles',
    params: ['duration', 'volume'],
    description: '车辆/机械怠速低频轰鸣',
  },
  traffic: {
    category: 'vehicles',
    params: ['duration', 'density', 'volume'],
    defaults: { density: 0.3 },
    description: '公路车流持续轰鸣，density 控制车辆密度',
  },

  // Nature
  wind: {
    category: 'nature',
    params: ['duration', 'intensity', 'volume'],
    defaults: { intensity: 0.5 },
    description: '风声，intensity 控制风力和高频比例',
  },
  rain: {
    category: 'nature',
    params: ['duration', 'intensity', 'volume'],
    defaults: { intensity: 0.5 },
    description: '雨声环境',
  },

  // Mechanical
  transform_mechanical: {
    category: 'mechanical',
    params: ['duration', 'volume'],
    description: '机械/机器人变形：次低频震动 + 稀疏撞击',
  },
  servo: {
    category: 'mechanical',
    params: ['duration', 'volume'],
    description: '短促舵机/机械运动（慎用，保持极低音量）',
  },
  metal_stress: {
    category: 'mechanical',
    params: ['duration', 'volume'],
    description: '金属扭曲/吱嘎声',
  },

  // Sci-fi
  vault_hum: {
    category: 'scifi',
    params: ['duration', 'volume'],
    description: '科幻能量室/金库低频谐波嗡鸣',
  },
  energy_hum: {
    category: 'scifi',
    params: ['duration', 'volume'],
    description: '脉冲式能量场嗡鸣',
  },
};

export function listProceduralTypes() {
  return Object.keys(PROCEDURAL_REGISTRY).sort();
}

export function getProceduralInfo(type) {
  return PROCEDURAL_REGISTRY[type] || null;
}

/**
 * Parse a procedural SFX tag body (the content after `Procedural|`).
 * Example: `type=gunfight|start=36|end=40|density=0.6|volume=0.35`
 *
 * @param {string} body
 * @returns {{type: string, start?: number, end?: number, volume?: number, [key: string]: any}|null}
 */
export function parseProceduralSFXTag(body) {
  if (!body) return null;
  const parts = body.split('|').map((s) => s.trim());
  if (parts[0] !== 'Procedural') {
    return null;
  }

  const event = {};
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const key = p.slice(0, eq).trim();
    const raw = p.slice(eq + 1).trim();
    const num = Number(raw);
    event[key] = Number.isNaN(num) ? raw : num;
  }

  if (!event.type) {
    return null;
  }

  // Validate known type.
  if (!PROCEDURAL_REGISTRY[event.type]) {
    console.warn(`[ProceduralAudio] Unknown procedural sound type: ${event.type}`);
  }

  return event;
}
