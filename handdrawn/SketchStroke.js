/**
 * SketchStroke — Grease-Pencil-style strokes for Three.js.
 *
 * A stroke is a variable-width tube built along a Catmull-Rom curve through
 * the given points. Width varies per-sample (pressure + taper at the ends)
 * and interior points get a small positional "hand jitter" so the line never
 * looks machine-perfect. Deterministic per `seed` — offline rendering needs
 * frame N to be reproducible.
 *
 * Material is unlit (MeshBasicMaterial) on purpose: ink does not shade.
 */
import * as THREE from 'three';

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toV3(p) {
  return p && p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
}

function smoothstep(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Create a hand-drawn stroke mesh.
 *
 * @param {Array<THREE.Vector3|number[]>} points — control points (world/local space is caller's choice)
 * @param {object} opts
 * @param {number} opts.width — base stroke width (diameter) in world units
 * @param {number} opts.color — ink color
 * @param {number} opts.jitter — positional jitter of interior points, fraction of width (0 = perfect line)
 * @param {number} opts.widthJitter — pressure variation along the stroke (0..1)
 * @param {number} opts.taper — 0..1, how sharply the ends taper (fraction of length that fades)
 * @param {boolean} opts.closed — close the loop
 * @param {number} opts.seed — deterministic seed
 * @param {number} opts.radialSegments — tube radial resolution (5 is plenty for ink)
 */
export function createStroke(points, opts = {}) {
  const {
    width = 0.01,
    color = 0x1a1a1a,
    jitter = 0.5,
    widthJitter = 0.35,
    taper = 0.35,
    closed = false,
    seed = 1,
    radialSegments = 5,
  } = opts;

  const rand = mulberry32(seed);
  const pts = points.map(toV3);

  // Hand jitter on interior control points (never on the ends — anchors stay put)
  for (let i = 1; i < pts.length - 1; i++) {
    pts[i].x += (rand() - 0.5) * width * jitter * 2;
    pts[i].y += (rand() - 0.5) * width * jitter * 2;
    pts[i].z += (rand() - 0.5) * width * jitter * 2;
  }

  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const divisions = Math.max(8, pts.length * 4);
  const frames = curve.computeFrenetFrames(divisions, closed);

  const ringVerts = radialSegments + 1;
  const positions = new Float32Array((divisions + 1) * ringVerts * 3);
  const normals = new Float32Array((divisions + 1) * ringVerts * 3);
  const indices = [];

  const center = new THREE.Vector3();
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    curve.getPointAt(t, center);

    // Pressure profile: random walk-ish noise + taper fade at both ends
    const pressure = 1 + (rand() - 0.5) * widthJitter;
    const endFade = closed ? 1 : smoothstep(Math.min(t, 1 - t) / Math.max(1e-4, taper * 0.5));
    const r = Math.max(1e-5, width * 0.5 * pressure * endFade);

    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(a);
      const cos = -Math.cos(a);
      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;
      const k = (i * ringVerts + j) * 3;
      positions[k] = center.x + r * nx;
      positions[k + 1] = center.y + r * ny;
      positions[k + 2] = center.z + r * nz;
      normals[k] = nx; normals[k + 1] = ny; normals[k + 2] = nz;
    }
  }

  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  mesh.userData.stroke = true;      // marker so sketchify/boil can recognise strokes
  mesh.frustumCulled = false;       // boil displaces vertices; skip stale-bounds culling
  return mesh;
}

/** Straight-ish stroke between two points (with hand wobble). */
export function strokeLine(a, b, opts = {}) {
  const A = toV3(a);
  const B = toV3(b);
  return createStroke(
    [A, A.clone().lerp(B, 0.33), A.clone().lerp(B, 0.67), B],
    opts
  );
}

/** Closed circle stroke in the XY plane (rotate the returned mesh as needed). */
export function strokeCircle(radius, opts = {}) {
  const { segments = 20, ...rest } = opts;
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius, 0]);
  }
  return createStroke(pts, { ...rest, closed: true });
}

/** Arc stroke (ellipse section) in the XY plane. Angles in radians. */
export function strokeArc(rx, ry, startAngle, endAngle, opts = {}) {
  const { segments = 16, ...rest } = opts;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / segments;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry, 0]);
  }
  return createStroke(pts, rest);
}

/**
 * Canvas-generated pencil hatch texture (for hand-shaded fills).
 * Use as material.map with RepeatWrapping; darker = more line layers.
 */
export function createHatchTexture(opts = {}) {
  const {
    size = 256,
    spacing = 18,        // px between lines
    angle = -Math.PI / 6,
    color = '#2a2a33',
    layers = 1,          // 1 = /, 2 = / + \, 3 adds horizontal
    seed = 3,
  } = opts;
  const rand = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  const angles = [angle, angle + Math.PI / 2, 0].slice(0, layers);
  for (const a of angles) {
    for (let d = -size; d < size * 2; d += spacing) {
      // each line is a few jittered segments — never a perfect straight line
      ctx.beginPath();
      ctx.lineWidth = 1 + rand() * 1.2;
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = d * Math.cos(a + Math.PI / 2) + (t * size * 1.5 - size * 0.25) * Math.cos(a) + (rand() - 0.5) * 2.5;
        const y = d * Math.sin(a + Math.PI / 2) + (t * size * 1.5 - size * 0.25) * Math.sin(a) + (rand() - 0.5) * 2.5;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
