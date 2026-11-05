// Pure geometry builders for strokes. No three.js dependency so they are easy to test.

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
function norm(a: V3): V3 {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Any unit vector perpendicular to t. */
function perpendicular(t: V3): V3 {
  const axis: V3 = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(t, axis));
}

function readPoint(pts: ArrayLike<number>, i: number): V3 {
  return [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
}

/**
 * Ensures a stroke has at least two distinct points so tangents are defined.
 * A single tap becomes a very short segment (rendered as a dot).
 */
function normalizePoints(pts: ArrayLike<number>, radii: ArrayLike<number>) {
  const n = Math.floor(pts.length / 3);
  if (n === 0) return null;
  if (n === 1) {
    const p = readPoint(pts, 0);
    const r = radii[0] ?? 0.01;
    const e = Math.max(r * 0.05, 1e-5);
    return {
      pts: [p, [p[0] + e, p[1], p[2]] as V3],
      radii: [r, r],
    };
  }
  const out: V3[] = [];
  const outR: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = readPoint(pts, i);
    if (out.length && len(sub(p, out[out.length - 1])) < 1e-9) continue;
    out.push(p);
    outR.push(radii[i] ?? radii[radii.length - 1] ?? 0.01);
  }
  if (out.length === 1) return normalizePoints(pts.length >= 3 ? [...out[0]] : [], outR);
  return { pts: out, radii: outR };
}

function tangents(pts: V3[]): V3[] {
  const n = pts.length;
  const t: V3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let d = norm(sub(b, a));
    if (len(d) === 0) d = i > 0 ? t[i - 1] : [1, 0, 0];
    t[i] = d;
  }
  return t;
}

/**
 * Round tube with variable radius along the polyline, using a rotation-minimizing
 * frame (projected parallel transport) so it doesn't twist. Ends are closed with flat caps.
 */
export function buildTube(
  points: ArrayLike<number>,
  radii: ArrayLike<number>,
  radialSegments = 8,
): MeshData | null {
  const norm0 = normalizePoints(points, radii);
  if (!norm0) return null;
  const { pts, radii: rs } = norm0;
  const n = pts.length;
  const R = Math.max(3, radialSegments);
  const t = tangents(pts);

  // Frames
  const normals: V3[] = new Array(n);
  let prev = perpendicular(t[0]);
  for (let i = 0; i < n; i++) {
    // project previous normal onto plane perpendicular to current tangent
    let nn = sub(prev, scale(t[i], dot(prev, t[i])));
    if (len(nn) < 1e-6) nn = perpendicular(t[i]);
    nn = norm(nn);
    normals[i] = nn;
    prev = nn;
  }

  const ringVerts = n * R;
  const vertCount = ringVerts + 2; // + two cap centers
  const positions = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const nn = normals[i];
    const b = cross(t[i], nn);
    const r = rs[i];
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = nn[0] * c + b[0] * s;
      const dy = nn[1] * c + b[1] * s;
      const dz = nn[2] * c + b[2] * s;
      positions[v * 3] = p[0] + dx * r;
      positions[v * 3 + 1] = p[1] + dy * r;
      positions[v * 3 + 2] = p[2] + dz * r;
      nrm[v * 3] = dx;
      nrm[v * 3 + 1] = dy;
      nrm[v * 3 + 2] = dz;
      v++;
    }
  }
  const startCap = v++;
  const endCap = v++;
  positions.set(pts[0], startCap * 3);
  nrm.set(scale(t[0], -1), startCap * 3);
  positions.set(pts[n - 1], endCap * 3);
  nrm.set(t[n - 1], endCap * 3);

  const indices = new Uint32Array((n - 1) * R * 6 + R * 6);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j;
      const b = i * R + ((j + 1) % R);
      const c = (i + 1) * R + j;
      const d = (i + 1) * R + ((j + 1) % R);
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  for (let j = 0; j < R; j++) {
    const a = j;
    const b = (j + 1) % R;
    indices[k++] = startCap;
    indices[k++] = b;
    indices[k++] = a;
    const c = (n - 1) * R + j;
    const d = (n - 1) * R + ((j + 1) % R);
    indices[k++] = endCap;
    indices[k++] = c;
    indices[k++] = d;
  }
  return { positions, normals: nrm, indices };
}

/**
 * Flat ribbon lying in the plane whose normal is `planeNormal` (the drawing plane).
 * Rendered double-sided; width = 2 * radius.
 */
export function buildRibbon(
  points: ArrayLike<number>,
  radii: ArrayLike<number>,
  planeNormal: V3,
): MeshData | null {
  const norm0 = normalizePoints(points, radii);
  if (!norm0) return null;
  const { pts, radii: rs } = norm0;
  const n = pts.length;
  const t = tangents(pts);
  let pn = norm(planeNormal);
  if (len(pn) === 0) pn = [0, 0, 1];

  const positions = new Float32Array(n * 2 * 3);
  const nrm = new Float32Array(n * 2 * 3);
  let prevSide: V3 = perpendicular(t[0]);
  for (let i = 0; i < n; i++) {
    let side = cross(t[i], pn);
    if (len(side) < 1e-6) side = prevSide;
    side = norm(side);
    prevSide = side;
    const faceN = norm(cross(side, t[i]));
    const r = rs[i];
    const p = pts[i];
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? -1 : 1;
      const idx = (i * 2 + s) * 3;
      positions[idx] = p[0] + side[0] * r * sign;
      positions[idx + 1] = p[1] + side[1] * r * sign;
      positions[idx + 2] = p[2] + side[2] * r * sign;
      nrm[idx] = faceN[0];
      nrm[idx + 1] = faceN[1];
      nrm[idx + 2] = faceN[2];
    }
  }
  const indices = new Uint32Array((n - 1) * 6);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices[k++] = a;
    indices[k++] = c;
    indices[k++] = b;
    indices[k++] = b;
    indices[k++] = c;
    indices[k++] = d;
  }
  return { positions, normals: nrm, indices };
}

function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Maps Apple Pencil pressure (0..1) to a radius multiplier. */
export function pressureToScale(pressure: number, pointerType: string): number {
  if (pointerType !== 'pen') return 0.6;
  const p = Math.min(1, Math.max(0, pressure || 0));
  return 0.12 + 0.88 * Math.pow(p, 0.75);
}

/** Mirrors a stroke across the X=0 plane. */
export function mirrorX(points: ArrayLike<number>): number[] {
  const out = Array.from(points);
  for (let i = 0; i < out.length; i += 3) out[i] = -out[i];
  return out;
}
