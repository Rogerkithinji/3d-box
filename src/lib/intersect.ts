// Intersection study: where two solids meet (the seam), the volume they
// share, and the view-dependent outline of any smooth closed mesh.

import * as THREE from "three"
import { MeshBVH, type ExtendedTriangle } from "three-mesh-bvh"
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg"
import type { ShapeId, ShapeParams } from "./shapes"

export type IntersectMode = "both" | "overlap"

export interface IntersectPose {
  x: number; y: number; z: number      // offset from form A's centre
  rx: number; ry: number; rz: number   // degrees, same YXZ order as the cube
  size: number                         // uniform scale
}

/** A form pushed into form A's space: form B, C, D… */
export interface ExtraForm {
  shapeId: ShapeId
  params:  ShapeParams
  pose:    IntersectPose
  /** which ink it is drawn in — kept when the forms around it come and go */
  ink?:    number
  /** a cutter carves its volume out of every solid form it touches */
  cut?:    boolean
}

export interface IntersectSpec {
  forms: ExtraForm[]
  mode:  IntersectMode
  /** one form shown alone (0 = A), with the marks the others leave on it */
  solo:  number | null
  /** form A is a cutter */
  cutA?: boolean
}

export type Relation = "crossing" | "apart" | "a-in-b" | "b-in-a"

export interface Meeting {
  seam:     number[]                       // segment pairs along the intersection
  overlap:  THREE.BufferGeometry | null    // the shared volume
  relation: Relation
  insideA:  (p: THREE.Vector3) => boolean
  insideB:  (p: THREE.Vector3) => boolean
}

const IDENTITY = new THREE.Matrix4()

function bvhOf(geo: THREE.BufferGeometry): MeshBVH {
  return (geo as THREE.BufferGeometry & { boundsTree: MeshBVH }).boundsTree
}

// Point-in-solid by ray parity. The direction is deliberately skew so a ray
// never runs along a mesh edge.
function insideTest(bvh: MeshBVH): (p: THREE.Vector3) => boolean {
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.5377, 0.7071, 0.4594).normalize())
  return p => {
    ray.origin.copy(p)
    return bvh.raycast(ray, THREE.DoubleSide).length % 2 === 1
  }
}

/** Point-in-solid test for a closed mesh. */
export function insideOf(geo: THREE.BufferGeometry): (p: THREE.Vector3) => boolean {
  return insideTest((geo as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree ?? new MeshBVH(geo))
}

// the boolean library still passes an option its BVH dependency has
// renamed; the warning would otherwise repeat on every slider tick
function brush(geo: THREE.BufferGeometry): Brush {
  const b = new Brush(geo)
  const warn = console.warn
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith("BVH:")) warn(...args) }
  try { b.prepareGeometry() } finally { console.warn = warn }
  return b
}

/**
 * A solid with the cutters' volumes taken out of it. All geometries share
 * one space. Returns null when no cutter reaches it, so the caller can go
 * on drawing the whole form; an empty geometry means it was cut away.
 */
export function carve(target: THREE.BufferGeometry, cutters: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  target.computeBoundingBox()
  const reach = cutters.filter(c => {
    c.computeBoundingBox()
    return c.boundingBox!.intersectsBox(target.boundingBox!)
  })
  if (reach.length === 0) return null
  const ev = new Evaluator()
  ev.attributes = ["position", "normal"]
  ev.useGroups = false
  let result = brush(target)
  for (const c of reach) result = ev.evaluate(result, brush(c), SUBTRACTION)
  return result.geometry
}

/** Both geometries must share one space (bake their transforms in first). */
export function meet(geoA: THREE.BufferGeometry, geoB: THREE.BufferGeometry, wantOverlap: boolean): Meeting {
  const a = brush(geoA), b = brush(geoB)
  const bvhA = bvhOf(geoA), bvhB = bvhOf(geoB)

  const seam: number[] = []
  const line = new THREE.Line3()
  bvhA.bvhcast(bvhB, IDENTITY, {
    intersectsTriangles(t1: ExtendedTriangle, t2: ExtendedTriangle) {
      if (t1.intersectsTriangle(t2, line) && line.distanceSq() > 1e-12) {
        seam.push(line.start.x, line.start.y, line.start.z, line.end.x, line.end.y, line.end.z)
      }
      return false
    },
  })

  const insideA = insideTest(bvhA), insideB = insideTest(bvhB)
  let relation: Relation = "crossing"
  if (seam.length === 0) {
    const v = new THREE.Vector3()
    if (insideB(v.fromBufferAttribute(geoA.attributes.position, 0))) relation = "a-in-b"
    else if (insideA(v.fromBufferAttribute(geoB.attributes.position, 0))) relation = "b-in-a"
    else relation = "apart"
  }

  let overlap: THREE.BufferGeometry | null = null
  if (wantOverlap && relation === "crossing") {
    const ev = new Evaluator()
    ev.attributes = ["position", "normal"]
    ev.useGroups = false
    overlap = ev.evaluate(a, b, INTERSECTION).geometry
    if (overlap.attributes.position.count === 0) { overlap.dispose(); overlap = null }
  } else if (wantOverlap && relation === "a-in-b") overlap = geoA.clone()
  else if (wantOverlap && relation === "b-in-a") overlap = geoB.clone()

  return { seam, overlap, relation, insideA, insideB }
}

/** Keep the pieces of a segment list that fall inside (or outside) a solid. */
export function clipSegments(
  segs: number[], inside: (p: THREE.Vector3) => boolean, keepInside: boolean, maxLen = 0.03,
): number[] {
  const out: number[] = []
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3()
  for (let i = 0; i < segs.length; i += 6) {
    a.set(segs[i], segs[i + 1], segs[i + 2]); b.set(segs[i + 3], segs[i + 4], segs[i + 5])
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / maxLen))
    for (let k = 0; k < n; k++) {
      p.lerpVectors(a, b, (k + 0.5) / n)
      if (inside(p) !== keepInside) continue
      const s = k / n, e = (k + 1) / n
      out.push(
        a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, a.z + (b.z - a.z) * s,
        a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e,
      )
    }
  }
  return out
}

/**
 * Outline of a smooth mesh from an eye point in the mesh's own space: the
 * curve where the surface turns edge-on, found as the zero crossing of
 * n·(eye − p) inside each triangle. Writes segment pairs into `out` and
 * returns how many segments it wrote.
 */
export function silhouetteInto(geo: THREE.BufferGeometry, eye: THREE.Vector3, out: Float32Array): number {
  const pos = geo.attributes.position.array as Float32Array
  const nrm = geo.attributes.normal.array as Float32Array
  const index = geo.index ? geo.index.array : null
  const triCount = (index ? index.length : pos.length / 3) / 3
  let n = 0
  const g = [0, 0, 0], v = [0, 0, 0]
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = (index ? index[t * 3 + k] : t * 3 + k) * 3
      v[k] = i
      g[k] = nrm[i] * (eye.x - pos[i]) + nrm[i + 1] * (eye.y - pos[i + 1]) + nrm[i + 2] * (eye.z - pos[i + 2])
    }
    const s0 = g[0] > 0, s1 = g[1] > 0, s2 = g[2] > 0
    if (s0 === s1 && s1 === s2) continue
    if ((n + 1) * 6 > out.length) break
    let w = n * 6
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3
      if ((g[k] > 0) === (g[k2] > 0)) continue
      const f = g[k] / (g[k] - g[k2]), i = v[k], j = v[k2]
      out[w++] = pos[i]     + (pos[j]     - pos[i])     * f
      out[w++] = pos[i + 1] + (pos[j + 1] - pos[i + 1]) * f
      out[w++] = pos[i + 2] + (pos[j + 2] - pos[i + 2]) * f
    }
    n++
  }
  return n
}
