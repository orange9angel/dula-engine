/**
 * CombatActionComponent — 可复用的战斗动作组件注册表。
 *
 * 一个组件就是一段预先编排好的招式序列（与 CombatDirector 的 combo 同构），
 * 可以在 .story 中通过 {Combat:Action|name=...|attacker=...|defender=...} 一键调用。
 *
 * 每个 move 可选配 `sfx`、`fx`、`weapon` 字段：
 * - `sfx` 支持 string / object / array，用于声明动作关联音效；
 * - `fx` 支持 array，用于声明动作关联光效（如枪口焰、激光束、命中火花）。
 * - `weapon` 支持 string / object，用于声明武器显示/隐藏（如拔枪、射击、收枪）。
 * 不传则只播放动作，不触发音效/光效/武器。
 */

export const CombatActionRegistry = {};

/**
 * 把 sfx 输入归一化成事件对象数组。
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

/**
 * 把 weapon 输入归一化成对象。
 * 支持的输入：
 *   - string: 'plasmaRifle'  -> { show: 'plasmaRifle', attach: 'rightHand', hide: true }
 *   - object: { show: 'plasmaRifle', attach: 'rightHand', hide: true, hideAfter: 0.2 }
 *   - null/undefined: null
 */
export function normalizeWeapon(weapon) {
  if (!weapon) return null;
  if (typeof weapon === 'string') {
    return { show: weapon, attach: 'rightHand', hide: true, hideAfter: 0 };
  }
  return {
    show: weapon.show || null,
    attach: weapon.attach || 'rightHand',
    hide: weapon.hide !== false,
    hideAfter: weapon.hideAfter || 0,
  };
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
      weapon: normalizeWeapon(m.weapon),
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

function normalizeSFXOverride(sfx) {
  if (sfx === undefined) return undefined;
  if (sfx === null) return null;
  return normalizeSFX(sfx);
}

export function expandCombatAction(name, overrides = {}) {
  const comp = getCombatAction(name);
  if (!comp) return null;
  return comp.moves.map((m) => ({
    ...m,
    hitstop: overrides.hitstop !== undefined ? overrides.hitstop : m.hitstop,
    shake: overrides.shake !== undefined ? overrides.shake : m.shake,
    sfx: overrides.sfx !== undefined ? normalizeSFXOverride(overrides.sfx) : m.sfx,
    fx: overrides.fx !== undefined ? normalizeFX(overrides.fx) : m.fx,
    weapon: overrides.weapon !== undefined ? normalizeWeapon(overrides.weapon) : m.weapon,
    reaction: overrides.reaction !== undefined ? overrides.reaction : m.reaction,
    camera: overrides.camera !== undefined ? overrides.camera : m.camera,
  }));
}
