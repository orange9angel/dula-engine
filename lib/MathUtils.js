/**
 * Pure math utilities for animation and movement.
 * No dependency on any specific character, scene, or IP.
 */

/**
 * Ease-in-out quadratic interpolation.
 * @param {number} t - Time in [0, 1]
 * @returns {number} Eased value in [0, 1]
 */
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Linear interpolation between two values.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor in [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Smoothstep interpolation.
 */
export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Parabolic arc height at time t.
 * @param {number} t - Time in [0, 1]
 * @param {number} arcHeight - Peak height
 * @returns {number} Y offset
 */
export function parabolicHeight(t, arcHeight) {
  return Math.sin(t * Math.PI) * arcHeight;
}
