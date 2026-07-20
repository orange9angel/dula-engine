/**
 * sketchify — give a procedural character/prop a hand-drawn ink treatment.
 *
 * Two complementary techniques, both deterministic (seeded) and frame-stable:
 *
 * 1. Silhouette hull ("hull"): an inverted-hull outline — a copy of the mesh
 *    pushed out along its normals, rendered BackSide in ink color. Unlike the
 *    clean CG version, each vertex gets a seeded width jitter so the outline
 *    wobbles like a redrawn pencil line. Works on smooth geometry (spheres,
 *    capsules) where EdgesGeometry finds nothing.
 *
 * 2. Detail strokes ("edges"): hard edges (EdgesGeometry over threshold) are
 *    redrawn as variable-width sketch strokes with midpoint overshoot — the
 *    "drawn twice, slightly wrong" look.
 *
 * Everything is parented under the source meshes, so outlines follow
 * animation, scale, and visibility automatically. Set `mesh.userData.noSketch = true`
 * on parts that must stay clean (pupils, eyelids, catchlights, hidden cavities).
 */
import * as THREE from 'three';
import { createStroke, mulberry32 } from './SketchStroke.js';

function createHull(mesh, width, color, seed) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return null;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const norm = geo.attributes.normal;

  const rand = mulberry32(seed);
  const p = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Per-vertex width jitter — the outline is never a uniform CG shell
    const j = 1 + (rand() - 0.5) * 0.9;
    p[i * 3] = pos.getX(i) + norm.getX(i) * width * j;
    p[i * 3 + 1] = pos.getY(i) + norm.getY(i) * width * j;
    p[i * 3 + 2] = pos.getZ(i) + norm.getZ(i) * width * j;
  }

  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  hullGeo.setAttribute('normal', new THREE.BufferAttribute(norm.array.slice(), 3));
  if (geo.index) hullGeo.setIndex(geo.index.clone());

  const hull = new THREE.Mesh(
    hullGeo,
    new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
  );
  hull.userData.sketchLine = true;
  hull.frustumCulled = false;
  return hull;
}

function createEdgeStrokes(mesh, { threshold, width, color, seed }) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, threshold);
  const pos = edges.attributes.position;
  if (!pos || pos.count < 2) return null;

  const rand = mulberry32(seed);
  const group = new THREE.Group();
  for (let i = 0; i < pos.count; i += 2) {
    const a = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const b = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    if (a.distanceTo(b) < width * 2) continue; // skip degenerate slivers

    // Midpoint overshoot — the line is "drawn", not computed
    const mid = a.clone().lerp(b, 0.5);
    mid.x += (rand() - 0.5) * width * 3;
    mid.y += (rand() - 0.5) * width * 3;
    mid.z += (rand() - 0.5) * width * 3;

    const stroke = createStroke([a, mid, b], {
      width: width * (0.5 + rand() * 0.4),
      color,
      seed: seed * 31 + i,
      widthJitter: 0.5,
      taper: 0.25,
    });
    stroke.userData.sketchLine = true;
    group.add(stroke);
  }
  edges.dispose();
  return group.children.length > 0 ? group : null;
}

/**
 * Apply ink treatment to every mesh under root.
 *
 * @param {THREE.Object3D} root — usually `character.mesh`
 * @param {object} opts
 * @param {number} opts.color — ink color (default near-black with a warm tint)
 * @param {number} opts.width — outline width in local units of each mesh
 * @param {number} opts.threshold — edge-detection angle in degrees for detail strokes
 * @param {boolean} opts.hull — draw silhouette hulls
 * @param {boolean} opts.edges — draw hard-edge detail strokes
 * @param {number} opts.minRadius — skip meshes smaller than this (catchlights etc.)
 * @param {number} opts.seed — deterministic seed
 * @param {function} opts.filter — (mesh) => boolean, extra inclusion test
 * @returns {{strokes: THREE.Object3D[]}}
 */
export function sketchify(root, opts = {}) {
  const {
    color = 0x25222a,
    width = 0.014,
    threshold = 40,
    hull = true,
    edges = true,
    minRadius = 0.02,
    seed = 7,
    filter = null,
  } = opts;

  const strokes = [];
  let s = seed;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.stroke || obj.userData.sketchLine || obj.userData.noSketch) return;
    if (filter && !filter(obj)) return;

    obj.geometry.computeBoundingSphere?.();
    const radius = obj.geometry.boundingSphere ? obj.geometry.boundingSphere.radius : 1;
    if (radius < minRadius) return;

    // Outline width adapts to part size — ink never swallows small features
    const widthEff = Math.min(width, radius * 0.3);

    if (hull) {
      const h = createHull(obj, widthEff, color, s++);
      if (h) { obj.add(h); strokes.push(h); }
    }
    if (edges) {
      const e = createEdgeStrokes(obj, { threshold, width: widthEff, color, seed: s++ });
      if (e) { obj.add(e); strokes.push(e); }
    }
  });

  return { strokes };
}
