/**
 * BoilSystem — the "boiling line" of hand-drawn animation.
 *
 * Real hand-drawn animation is redrawn every frame (or every 2 frames,
 * "on twos"), so lines shimmer slightly instead of staying locked. BoilSystem
 * reproduces this by re-jittering registered meshes' vertices at a fixed
 * redraw rate (default 12 fps), deterministic per redraw tick — frame N
 * always renders identically, which offline rendering requires.
 *
 * Usage:
 *   BoilSystem.add(character.mesh, { amplitude: 0.004, fps: 12 });
 *   // in character/scene update():
 *   BoilSystem.update(time);
 */
import { mulberry32 } from './SketchStroke.js';

const registry = new Set();

export const BoilSystem = {
  /**
   * Register every sketch line / stroke under root for boiling.
   * Meshes not flagged as sketch lines are ignored (register them explicitly
   * via addMesh if you want a base mesh to boil too).
   */
  add(root, opts = {}) {
    const { amplitude = 0.004, fps = 12 } = opts;
    root.traverse((o) => {
      if (o.isMesh && (o.userData.sketchLine || o.userData.stroke)) {
        this.addMesh(o, { amplitude, fps });
      }
    });
  },

  /** Register a single mesh. */
  addMesh(mesh, opts = {}) {
    const { amplitude = 0.004, fps = 12 } = opts;
    const posAttr = mesh.geometry.attributes.position;
    if (!posAttr) return;
    registry.add({
      mesh,
      amplitude,
      fps,
      lastTick: -1,
      base: posAttr.array.slice(),
    });
  },

  remove(root) {
    root.traverse((o) => {
      for (const e of registry) {
        if (e.mesh === o) registry.delete(e);
      }
    });
  },

  clear() {
    registry.clear();
  },

  /**
   * Advance the boil. Call once per rendered frame with the storyboard time.
   * Idempotent within the same redraw tick — safe to call from multiple
   * characters' update() methods.
   */
  update(time) {
    for (const e of registry) {
      const tick = Math.floor(time * e.fps);
      if (tick === e.lastTick) continue;
      e.lastTick = tick;

      const rand = mulberry32(tick * 7919 + 17);
      const posAttr = e.mesh.geometry.attributes.position;
      const arr = posAttr.array;
      const base = e.base;
      const amp = e.amplitude;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = base[i] + (rand() - 0.5) * 2 * amp;
      }
      posAttr.needsUpdate = true;
    }
  },
};
