/**
 * CombatActionComponent — 可复用的战斗动作组件注册表。
 *
 * 一个组件就是一段预先编排好的招式序列（与 CombatDirector 的 combo 同构），
 * 可以在 .story 中通过 {Combat:Action|name=...|attacker=...|defender=...} 一键调用。
 *
 * 每个 move 可选配 `sfx` 和 `fx` 字段：
 * - `sfx` 支持 string / object / array，用于声明动作关联音效；
 * - `fx` 支持 array，用于声明动作关联光效（如枪口焰、激光束、命中火花）。
 * 不传则只播放动作，不触发音效/光效。
 */

export const CombatActionRegistry = {};

/**
 * 把 sfx 输入归一化成事件对象数组。
 * 支持的输入：
 *   - string: 'laser_blast'  -> [{ name: 'laser_blast', trigger: 'hitFrame' }]
 *   - object: { name: 'laser_blast', volume: 0.9, trigger: 'start' }
 *   - array:  上述两种的混合
 *   - null/undefined: []
 *
 * 默认 trigger 为 'hitFrame'，保持旧行为兼容。
 */
function normalizeSFX(sfx) {
  if (!sfx) return [];
  const list = Array.isArray(sfx) ? sfx : [sfx];
  return list.map((item) => {
    if (typeof item === 'string') {
      return { name: item, trigger: 'hitFrame', volume: 1.0, offset: 0 };
    }
    if (typeof item === 'object' && item.name) {
      return {
        name: item.name,
        trigger: item.trigger || 'hitFrame',
        volume: item.volume !== undefined ? item.volume : 1.0,
        offset: item.offset || 0,
        pitch: item.pitch || 1.0,
      };
    }
    return null;
  }).filter(Boolean);
}

/**
 * 把 fx 输入归一化成事件对象数组。
 * fx 必须是数组，元素为 { type, ...params }。
 */
function normalizeFX(fx) {
  if (!fx) return [];
  const list = Array.isArray(fx) ? fx : [fx];
  return list
    .filter((item) => item && typeof item === 'object' && item.type)
    .map((item) => ({
      type: item.type,
      trigger: item.trigger || 'hitFrame',
      attach: item.attach || null,
      color: item.color !== undefined ? item.color : null,
      duration: item.duration !== undefined ? item.duration : null,
      offset: item.offset || 0,
    }));
}

export function registerCombatAction(name, spec) {
  if (!name || !spec || !Array.isArray(spec.moves)) {
    console.warn('[CombatActionRegistry] Invalid registration:', name, spec);
    return;
  }
  CombatActionRegistry[name] = {
    name,
    moves: spec.moves.map((m) => ({
      anim: m.anim,
      hitFrame: m.hitFrame !== undefined ? m.hitFrame : null,
      sfx: normalizeSFX(m.sfx),
      fx: normalizeFX(m.fx),
      reaction: m.reaction || null,
      hitstop: m.hitstop !== undefined ? m.hitstop : null,
      shake: m.shake !== undefined ? m.shake : null,
      camera: m.camera || null,
    })),
  };
}

export function getCombatAction(name) {
  return CombatActionRegistry[name] || null;
}

export function unregisterCombatAction(name) {
  delete CombatActionRegistry[name];
}

export function listCombatActions() {
  return Object.keys(CombatActionRegistry);
}

/**
 * 将 sfx override 归一化。
 * 支持 string / object / array，最终返回数组或 null（表示不覆盖）。
 */
function normalizeSFXOverride(sfx) {
  if (sfx === undefined) return undefined;
  if (sfx === null) return null;
  return normalizeSFX(sfx);
}

/**
 * 将组件定义转成 CombatDirector 能直接消费的 moves 数组。
 * @param {string} name
 * @param {Object} overrides - 可覆盖单个字段，例如 { hitstop: 0.03, sfx: 'my_hit' }
 */
export function expandCombatAction(name, overrides = {}) {
  const comp = getCombatAction(name);
  if (!comp) return null;
  return comp.moves.map((m) => ({
    ...m,
    hitstop: overrides.hitstop !== undefined ? overrides.hitstop : m.hitstop,
    shake: overrides.shake !== undefined ? overrides.shake : m.shake,
    sfx: overrides.sfx !== undefined ? normalizeSFXOverride(overrides.sfx) : m.sfx,
    fx: overrides.fx !== undefined ? normalizeFX(overrides.fx) : m.fx,
    reaction: overrides.reaction !== undefined ? overrides.reaction : m.reaction,
    camera: overrides.camera !== undefined ? overrides.camera : m.camera,
  }));
}
