// Watertight solids for every form, used by the intersection study: the
// boolean engine needs closed meshes, and the second form is drawn straight
// from them. Tessellation matches the display meshes in three-cube.tsx so a
// curve computed here lies on the surfaces drawn there.

import * as THREE from "three"
import {
  getParametricShape,
  CUBE_DEFAULT_PARAMS, PYRAMID_DEFAULT_PARAMS, SPHERE_DEFAULT_PARAMS, TUBE_DEFAULT_PARAMS,
  type ShapeId, type ShapeParams,
} from "./shapes"

export interface Solid {
  /** closed, indexed, outward-wound mesh with normals — local space */
  geometry: THREE.BufferGeometry
  /** hard edges that are always drawn (box edges, rims), as segment pairs */
  creases:  number[]
  /** n cross-contour rings, as segment pairs */
  contours: (n: number) => number[]
  /** lowest local-space bound, for seating the ground */
  radius:   number
}

// Sausage spine: a planar cubic bend swept around the Y axis by the coil
// angle — the bend supplies the coil's radius, the coil wraps it into a
// helix. coil = 0 reduces to the flat C/S-curve.
export class SpineCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private len: number, private bendA: number, private bendB: number, private coil: number,
  ) { super() }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const mt = 1 - t
    const bx = 3 * mt * mt * t * this.bendA + 3 * mt * t * t * this.bendB
    const by = this.len * (
      mt * mt * mt * -0.5 + 3 * mt * mt * t * (-1 / 6) + 3 * mt * t * t * (1 / 6) + t * t * t * 0.5
    )
    const phi = 2 * Math.PI * this.coil * t
    return target.set(bx * Math.cos(phi), by, bx * Math.sin(phi))
  }
}

export function defaultParamsFor(id: ShapeId): ShapeParams {
  if (id === "cube")    return CUBE_DEFAULT_PARAMS
  if (id === "pyramid") return PYRAMID_DEFAULT_PARAMS
  if (id === "sphere") return SPHERE_DEFAULT_PARAMS
  if (id === "tube")   return TUBE_DEFAULT_PARAMS
  return getParametricShape(id)?.defaultParams ?? {}
}

const EPS = 1e-3

function finish(pos: number[], nrm: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("normal",   new THREE.Float32BufferAttribute(nrm, 3))
  g.setIndex(idx)
  return g
}

function boundRadius(g: THREE.BufferGeometry): number {
  g.computeBoundingSphere()
  const s = g.boundingSphere!
  return s.center.length() + s.radius
}

function boxSolid(p: ShapeParams): Solid {
  const w = p.width ?? 1.1, h = p.height ?? 1.1, d = p.depth ?? 1.1
  const box = new THREE.BoxGeometry(w, h, d)
  const geometry = finish(
    Array.from(box.attributes.position.array),
    Array.from(box.attributes.normal.array),
    Array.from(box.index!.array),
  )
  const edges = new THREE.EdgesGeometry(box)
  const creases = Array.from(edges.attributes.position.array)
  edges.dispose(); box.dispose()
  return { geometry, creases, contours: () => [], radius: boundRadius(geometry) }
}

// Corners of a faceted form in local space — what it rests on when turned,
// and where its construction lines start
export function facetCorners(id: ShapeId, p: ShapeParams): THREE.Vector3[] {
  const hw = (p.width ?? 1.1) / 2, hh = (p.height ?? 1.1) / 2, hd = (p.depth ?? 1.1) / 2
  const base = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => new THREE.Vector3(sx * hw, -hh, sz * hd))
  if (id === "pyramid") return [...base, new THREE.Vector3(0, hh, 0)]
  return [...base, ...base.map(v => new THREE.Vector3(v.x, hh, v.z))]
}

// Pyramid faces, each with its own vertices so the normals stay flat
export function pyramidGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const c = facetCorners("pyramid", { width: w, height: h, depth: d })
  const apex = c[4], centre = new THREE.Vector3(0, -h / 4, 0)
  const faces = [[c[0], c[2], c[1]], [c[0], c[3], c[2]]]
  for (let i = 0; i < 4; i++) faces.push([c[i], c[(i + 1) % 4], apex])
  const pos: number[] = [], nrm: number[] = [], idx: number[] = []
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3()
  for (const f of faces) {
    n.crossVectors(ab.subVectors(f[1], f[0]), ac.subVectors(f[2], f[0])).normalize()
    mid.copy(f[0]).add(f[1]).add(f[2]).divideScalar(3).sub(centre)
    // wind every face outward
    const tri = n.dot(mid) < 0 ? (n.negate(), [f[0], f[2], f[1]]) : f
    const first = pos.length / 3
    for (const v of tri) { pos.push(v.x, v.y, v.z); nrm.push(n.x, n.y, n.z) }
    idx.push(first, first + 1, first + 2)
  }
  return finish(pos, nrm, idx)
}

function pyramidSolid(p: ShapeParams): Solid {
  const geometry = pyramidGeometry(p.width ?? 1.3, p.height ?? 1.3, p.depth ?? 1.3)
  const edges = new THREE.EdgesGeometry(geometry)
  const creases = Array.from(edges.attributes.position.array)
  edges.dispose()
  return { geometry, creases, contours: () => [], radius: boundRadius(geometry) }
}

// Surface of revolution about Y from a profile u ∈ [0,1] → (r, y). Ends
// with r ≈ 0 close on a pole; open ends get a flat cap and a rim crease.
function revolveSolid(
  profile: (u: number) => [number, number],
  contourUs: (n: number) => number[],
  USEGS = 64, RSEGS = 64,
): Solid {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = []
  const rows: { r: number; y: number }[] = []
  for (let i = 0; i <= USEGS; i++) {
    const [r, y] = profile(i / USEGS)
    rows.push({ r: Math.max(0, r), y })
  }
  const cs = Array.from({ length: RSEGS }, (_, j) => Math.cos(2 * Math.PI * j / RSEGS))
  const sn = Array.from({ length: RSEGS }, (_, j) => Math.sin(2 * Math.PI * j / RSEGS))

  // first vertex index of each row; pole rows hold a single vertex
  const start: number[] = []
  const isPole = (i: number) => (i === 0 || i === USEGS) && rows[i].r < EPS
  for (let i = 0; i <= USEGS; i++) {
    start.push(pos.length / 3)
    if (isPole(i)) {
      pos.push(0, rows[i].y, 0)
      nrm.push(0, i === 0 ? -1 : 1, 0)
      continue
    }
    const a = rows[Math.max(0, i - 1)], b = rows[Math.min(USEGS, i + 1)]
    let nr = b.y - a.y, ny = -(b.r - a.r)
    const len = Math.hypot(nr, ny) || 1
    nr /= len; ny /= len
    for (let j = 0; j < RSEGS; j++) {
      pos.push(rows[i].r * cs[j], rows[i].y, rows[i].r * sn[j])
      nrm.push(nr * cs[j], ny, nr * sn[j])
    }
  }
  for (let i = 0; i < USEGS; i++) for (let j = 0; j < RSEGS; j++) {
    const j2 = (j + 1) % RSEGS
    if (isPole(i))          idx.push(start[i], start[i + 1] + j, start[i + 1] + j2)
    else if (isPole(i + 1)) idx.push(start[i] + j, start[i + 1], start[i] + j2)
    else {
      const a = start[i] + j, b = start[i] + j2, c = start[i + 1] + j, d = start[i + 1] + j2
      idx.push(a, c, b, b, c, d)
    }
  }

  const creases: number[] = []
  const ring = (r: number, y: number, out: number[]) => {
    for (let j = 0; j < RSEGS; j++) {
      const j2 = (j + 1) % RSEGS
      out.push(r * cs[j], y, r * sn[j], r * cs[j2], y, r * sn[j2])
    }
  }
  const cap = (i: number, up: boolean) => {
    const { r, y } = rows[i]
    if (r < EPS) return
    const c = pos.length / 3
    pos.push(0, y, 0); nrm.push(0, up ? 1 : -1, 0)
    for (let j = 0; j < RSEGS; j++) {
      pos.push(r * cs[j], y, r * sn[j]); nrm.push(0, up ? 1 : -1, 0)
    }
    for (let j = 0; j < RSEGS; j++) {
      const a = c + 1 + j, b = c + 1 + (j + 1) % RSEGS
      if (up) idx.push(c, b, a); else idx.push(c, a, b)
    }
    ring(r, y, creases)
  }
  cap(0, false); cap(USEGS, true)

  const contours = (n: number) => {
    const out: number[] = []
    for (const u of contourUs(n)) {
      const [r, y] = profile(u)
      if (r > EPS) ring(r, y, out)
    }
    return out
  }
  const geometry = finish(pos, nrm, idx)
  return { geometry, creases, contours, radius: boundRadius(geometry) }
}

const evenUs = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) / (n + 1))

// Tube: the sausage skin plus a hemispherical cap on each end, built on the
// same ring count so the seams close exactly.
function tubeSolid(p: ShapeParams): Solid {
  const radius = p.radius ?? 0.2, taper = p.taper ?? 0.35, length = p.length ?? 2.2
  const TSEGS = 96, RSEGS = 48, CAP = 8
  const rAt  = (u: number) => radius * (1 - taper * (2 * u - 1) * (2 * u - 1))
  const path = new SpineCurve(length, p.bendA ?? 0.7, p.bendB ?? 0.7, p.coil ?? 0)
  const frames = path.computeFrenetFrames(TSEGS, false)

  const pos: number[] = [], nrm: number[] = [], idx: number[] = []
  const ringVerts = (
    C: THREE.Vector3, N: THREE.Vector3, B: THREE.Vector3, T: THREE.Vector3,
    r: number, along: number, nAlong: number, nRad: number,
  ) => {
    const first = pos.length / 3
    for (let j = 0; j < RSEGS; j++) {
      const a = 2 * Math.PI * j / RSEGS
      const dx = Math.cos(a) * N.x + Math.sin(a) * B.x
      const dy = Math.cos(a) * N.y + Math.sin(a) * B.y
      const dz = Math.cos(a) * N.z + Math.sin(a) * B.z
      pos.push(C.x + r * dx + along * T.x, C.y + r * dy + along * T.y, C.z + r * dz + along * T.z)
      nrm.push(nRad * dx + nAlong * T.x, nRad * dy + nAlong * T.y, nRad * dz + nAlong * T.z)
    }
    return first
  }
  const pole = (C: THREE.Vector3, T: THREE.Vector3, r: number, sign: number) => {
    pos.push(C.x + sign * r * T.x, C.y + sign * r * T.y, C.z + sign * r * T.z)
    nrm.push(sign * T.x, sign * T.y, sign * T.z)
    return pos.length / 3 - 1
  }

  // ordered ring list from the start pole to the end pole
  const rings: number[] = []
  const pts = Array.from({ length: TSEGS + 1 }, (_, i) => path.getPointAt(i / TSEGS))
  const r0 = rAt(0), r1 = rAt(1)
  const startPole = pole(pts[0], frames.tangents[0], r0, -1)
  for (let k = CAP - 1; k >= 1; k--) {
    const th = (k / CAP) * Math.PI / 2
    rings.push(ringVerts(pts[0], frames.normals[0], frames.binormals[0], frames.tangents[0],
      r0 * Math.cos(th), -r0 * Math.sin(th), -Math.sin(th), Math.cos(th)))
  }
  const bodyRings: number[] = []
  for (let i = 0; i <= TSEGS; i++) {
    const first = ringVerts(pts[i], frames.normals[i], frames.binormals[i], frames.tangents[i],
      rAt(i / TSEGS), 0, 0, 1)
    rings.push(first); bodyRings.push(first)
  }
  for (let k = 1; k <= CAP - 1; k++) {
    const th = (k / CAP) * Math.PI / 2
    rings.push(ringVerts(pts[TSEGS], frames.normals[TSEGS], frames.binormals[TSEGS], frames.tangents[TSEGS],
      r1 * Math.cos(th), r1 * Math.sin(th), Math.sin(th), Math.cos(th)))
  }
  const endPole = pole(pts[TSEGS], frames.tangents[TSEGS], r1, 1)

  for (let j = 0; j < RSEGS; j++) {
    const j2 = (j + 1) % RSEGS
    idx.push(startPole, rings[0] + j2, rings[0] + j)
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i] + j, b = rings[i] + j2, c = rings[i + 1] + j, d = rings[i + 1] + j2
      idx.push(a, b, c, b, d, c)
    }
    const last = rings[rings.length - 1]
    idx.push(last + j, last + j2, endPole)
  }

  const ringSegs = (first: number, out: number[]) => {
    for (let j = 0; j < RSEGS; j++) {
      const a = (first + j) * 3, b = (first + (j + 1) % RSEGS) * 3
      out.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2])
    }
  }
  const creases: number[] = []
  ringSegs(bodyRings[0], creases); ringSegs(bodyRings[TSEGS], creases)
  const contours = (n: number) => {
    const out: number[] = []
    for (const u of evenUs(n)) ringSegs(bodyRings[Math.round(u * TSEGS)], out)
    return out
  }
  const geometry = finish(pos, nrm, idx)
  return { geometry, creases, contours, radius: boundRadius(geometry) }
}

export function buildSolid(id: ShapeId, params: ShapeParams): Solid {
  const p = { ...defaultParamsFor(id), ...params }
  if (id === "cube") return boxSolid(p)
  if (id === "pyramid") return pyramidSolid(p)
  if (id === "tube") return tubeSolid(p)
  if (id === "sphere") {
    const R = p.radius
    return revolveSolid(
      u => [R * Math.sin(Math.PI * u), -R * Math.cos(Math.PI * u)],
      // rings at even heights, matching the sphere's own contour layer
      n => evenUs(n).map(t => Math.acos(1 - 2 * t) / Math.PI),
    )
  }
  const def = getParametricShape(id)!
  return revolveSolid(u => { const [r, y] = def.surface(u, 0, p); return [r, y] }, evenUs)
}
