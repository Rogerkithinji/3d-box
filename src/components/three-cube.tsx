"use client"

import { useCallback, useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { ALL_SHAPE_IDS, SHAPE_FULL_LABELS, getParametricShape, isFaceted, type ShapeId, type ShapeParams } from "@/lib/shapes"
import { lightDirection, valueAt } from "@/lib/light"
import { SpineCurve, buildSolid, facetCorners, pyramidGeometry } from "@/lib/solids"
import { carve, clipSegments, insideOf, meet, silhouetteInto, type IntersectSpec } from "@/lib/intersect"

interface Props {
  shapeId:          ShapeId
  shapeParams:      ShapeParams
  uRings:           number
  verticalPosition: number
  rotationDeg:      { x: number; y: number; z: number }
  activeAxis:       "x" | "y" | "z" | null
  showAxes:         boolean
  showGuides:       boolean
  showContours:     boolean
  resetCount:       number
  zoomAction:       { dir: number; n: number }
  focalLength:      number
  showGround:       boolean
  showTopView:      boolean
  showDegrees:      boolean
  wrapContours:     boolean
  showCone:         boolean
  dark:             boolean
  copies:           number
  spacing:          number
  turntable:        boolean
  ortho:            boolean
  drill:            DrillPhase
  facingTint:       boolean
  lightOn:          boolean
  lightAz:          number
  lightEl:          number
  shading:          boolean
  lightSteps:       number
  shadowSteps:      number
  showShadow:       boolean
  intersect:        IntersectSpec | null
  seamXray:         boolean
  onPick?:          (target: PickTarget) => void
  /** the camera position, reported whenever the view comes to rest */
  onEye?:           (pos: [number, number, number]) => void
  /** move the camera to a stored viewpoint whenever n changes */
  cameraSet?:       { pos: [number, number, number]; n: number }
  /** the selected form carries the on-canvas handles */
  selected?:        number | null
  tool?:            TransformTool
  /** a handle is being dragged: skip the seam solve until it lets go */
  interacting?:     boolean
  onTransform?:     (target: number, t: FormTransform, phase: "start" | "move" | "end") => void
}

export type TransformTool = "move" | "rotate" | "scale"
/** A form's placement as the handles see it: world position, YXZ degrees, uniform scale. */
export interface FormTransform {
  pos:   [number, number, number]
  rot:   [number, number, number]
  scale: number
}

export type DrillPhase = "off" | "guess" | "reveal"
/** What a click on the canvas landed on: a form, or empty paper. */
/** a form by its place on the plate: 0 is form A, 1 form B, … */
export type PickTarget = number | null

const INK       = "#5B5BD6"
const INK_THREE = new THREE.Color(INK)
const RED       = "#C4553B"      // sanguine — perspective apparatus (horizon, VPs, guides)
const RED_FAINT = "rgba(196,85,59,0.16)"
const ORANGE       = "#C4651C"   // interactive accent (deep) — the axis being rotated right now
const ORANGE_THREE = new THREE.Color(ORANGE)

// Day plate / night plate palettes for everything the CSS variables can't
// reach: the WebGL scene and the 2D overlay canvas.
const PLATE_PALETTES = {
  light: {
    ink: "#5B5BD6", red: "#C4553B", redFaint: "rgba(196,85,59,0.16)", orange: "#C4651C",
    wash: "rgba(255,255,255,0.6)", washTitle: "rgba(255,255,255,0.55)",
    coneWash: "rgba(196,85,59,0.035)", capTint: "#c8d5ff",
    gridInk: "#7d7dd6", gridPaper: "#eef0f7", shadowRGB: "70, 70, 140", shadowA: 0.30,
    paper: "#eef0f7", dot: "#c0c4dc", vignette: "rgba(255,255,255,0.5)",
    cast: "#d6d9e8",
    // one ink per extra form, B → H
    forms: ["#1b8576", "#a8701d", "#6b8a1a", "#8a3f9e", "#2a7bb5", "#5f6b78", "#9c5a3c"],
    seam: "#cf2a6c", seamTone: "#f59bbd",
  },
  dark: {
    ink: "#8f8fe8", red: "#e08063", redFaint: "rgba(224,128,99,0.18)", orange: "#f0954f",
    wash: "rgba(21,22,31,0.72)", washTitle: "rgba(21,22,31,0.66)",
    coneWash: "rgba(224,128,99,0.05)", capTint: "#2c3161",
    gridInk: "#585ba8", gridPaper: "#15161f", shadowRGB: "0, 0, 0", shadowA: 0.45,
    paper: "#15161f", dot: "#2e3048", vignette: "rgba(70,74,110,0.25)",
    cast: "#0b0c13",
    forms: ["#52c7b2", "#e5b15e", "#a9c95a", "#c58ae0", "#6fb7ea", "#a3afbd", "#d49a7a"],
    seam: "#ff5c93", seamTone: "#ff8fb4",
  },
}

const GRID_EXT = 6.4, GRID_STEP = 0.4, GRID_SUB = 8
// Convex outline of a point set (monotone chain), counter-clockwise
function convexHull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = [], upper: [number, number][] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function buildGroundGrid(pal: { gridInk: string; gridPaper: string }) {
  const gridInk   = new THREE.Color(pal.gridInk)
  const gridPaper = new THREE.Color(pal.gridPaper)
  const pos: number[] = []
  const col: number[] = []
  const pushVert = (x: number, z: number, main: boolean) => {
    pos.push(x, 0, z)
    const t = Math.min(1, Math.hypot(x, z) / (GRID_EXT * 1.05))
    const c = gridPaper.clone().lerp(gridInk, (1 - t * t) * (main ? 0.55 : 0.3))
    col.push(c.r, c.g, c.b)
  }
  for (let i = -GRID_EXT / GRID_STEP; i <= GRID_EXT / GRID_STEP; i++) {
    const k = i * GRID_STEP
    const main = i === 0
    for (let s = 0; s < GRID_SUB; s++) {
      const a = -GRID_EXT + (2 * GRID_EXT * s) / GRID_SUB
      const b = -GRID_EXT + (2 * GRID_EXT * (s + 1)) / GRID_SUB
      pushVert(a, k, main); pushVert(b, k, main)   // line parallel to X
      pushVert(k, a, main); pushVert(k, b, main)   // line parallel to Z
    }
  }
  return { pos, col }
}
const HALF      = 0.55
// Default 3/4 view — the cube opens with both faces vanishing to their VPs
const HOME_CAM: [number, number, number] = [2.3, 1.15, 4.3]
// RESET VIEW target — face to face with the form, at eye level
const FACE_CAM: [number, number, number] = [0, 0, 5]
// Focal lengths are full-frame 35mm equivalents: fov = 2·atan(12 / f)
const SENSOR_HALF   = 12
const BASE_FOCAL_MM = 30   // the lens the zoom clamps are calibrated for
const BASE_MIN_DIST = 1.2
const BASE_MAX_DIST = 10

export function ThreeCube({
  shapeId, shapeParams, uRings,
  verticalPosition, rotationDeg, activeAxis, showAxes, showGuides, showContours, resetCount, zoomAction, focalLength, showGround, showTopView, showDegrees, wrapContours, showCone, dark, copies, spacing, turntable, ortho, drill, facingTint,
  lightOn, lightAz, lightEl, shading, lightSteps, shadowSteps, showShadow,
  intersect, seamXray, onPick, onEye, cameraSet,
  selected = null, tool = "move", interacting = false, onTransform,
}: Props) {
  const wrapRef    = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const threeRef = useRef<{
    renderer:           THREE.WebGLRenderer
    scene:              THREE.Scene
    camera:             THREE.PerspectiveCamera
    controls:           OrbitControls
    cubeGroup:          THREE.Group
    shapeGroup:         THREE.Group
    // plan-view outline of a round form A, as turned — local x-z
    footprint:          [number, number][]
    tubeRings:          { mat: LineMaterial; center: THREE.Vector3; outward: THREE.Vector3; isEnd: boolean }[]
    tubeBalls:          { geo: LineSegmentsGeometry; center: THREE.Vector3; radius: number }[]
    groundGroup:         THREE.Group
    shadowMesh:          THREE.Mesh
    gridGeo:             THREE.BufferGeometry
    fatMats:             LineMaterial[]
    copyGroups:          THREE.Group[]
    copyShadows:         THREE.Mesh[]
    // sunlight: shaded surfaces, the value ramp, and planar cast shadows
    dirLight:            THREE.DirectionalLight
    toonMat:             THREE.MeshToonMaterial
    gradientTex:         THREE.DataTexture
    castGroup:           THREE.Group
    castMat:             THREE.MeshBasicMaterial
    casters:             { geo: THREE.BufferGeometry; world: THREE.Matrix4 }[]
    groundY:             number
    // intersection study: the second form, the seam, the shared volume
    ixGroup:             THREE.Group
    toonMatIx:           THREE.MeshToonMaterial
    ixMats:              THREE.Material[]
    // outlines recomputed every frame from the eye, in each mesh's own space
    ixSil:               { line: LineSegmentsGeometry; src: THREE.BufferGeometry; space: THREE.Object3D }[]
    ix:                  { label: string; note: string | null } | null
    // on-canvas handles: they drive a proxy, and the proxy drives the props
    gizmo:               TransformControls
    proxy:               THREE.Object3D
    gizmoTarget:         number | null
  } | null>(null)

  // Latest prop values for the animation loop to read each frame
  const liveRef = useRef({ verticalPosition, rotationDeg, activeAxis, showAxes, shapeId, shapeParams, showGuides, showTopView, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill, facingTint, lightOn, lightAz, lightEl, showShadow })
  useEffect(() => { liveRef.current = { verticalPosition, rotationDeg, activeAxis, showAxes, shapeId, shapeParams, showGuides, showTopView, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill, facingTint, lightOn, lightAz, lightEl, showShadow } })

  const onPickRef = useRef(onPick)
  const onEyeRef  = useRef(onEye)
  const onTransformRef = useRef(onTransform)
  useEffect(() => { onPickRef.current = onPick; onEyeRef.current = onEye; onTransformRef.current = onTransform })
  const reportEye = useCallback(() => {
    const p = threeRef.current?.camera.position
    if (p) onEyeRef.current?.([p.x, p.y, p.z])
  }, [])

  // ── 2D overlay ────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (vertPos: number, guides: boolean, axes: boolean, sid: ShapeId, hw: number, hh: number, hd: number,
     rotDeg: { x: number; y: number; z: number }, liveAxis: "x" | "y" | "z" | null,
     topView: boolean, sp: ShapeParams,
     degrees: boolean, contours: boolean, ringsN: number, cone: boolean, dk: boolean,
     nCopies: number, gap: number, orthoOn: boolean, drillPhase: DrillPhase,
     sunOn: boolean, sunAz: number, sunEl: number) => {
      const overlay = overlayRef.current
      const three   = threeRef.current
      if (!overlay || !three) return

      const { camera } = three
      // Theme palette shadows the module colour constants for this draw
      const pal = PLATE_PALETTES[dk ? "dark" : "light"]
      const INK = pal.ink, RED = pal.red, RED_FAINT = pal.redFaint, ORANGE = pal.orange
      const W   = overlay.clientWidth
      const H   = overlay.clientHeight
      const dpr = window.devicePixelRatio || 1
      overlay.width  = W * dpr
      overlay.height = H * dpr
      const ctx = overlay.getContext("2d")!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // Drill mode: while guessing, strip the plate down to horizon + VPs +
      // the starting edge; on reveal, force the construction lines on.
      const inGuess  = drillPhase === "guess"
      const guidesOn = drillPhase === "reveal" ? true : guides && !inGuess

      // Project a world point to 2D screen using the live camera matrices
      const toScreen = (wx: number, wy: number, wz: number): [number, number] => {
        const v = new THREE.Vector3(wx, wy, wz).project(camera)
        return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]
      }

      // Horizon y: shifts when camera tilts up/down
      // tan(pitch) = forward.y / horizontal_length; positive pitch = looking up → horizon below center
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      const vFOV    = camera.fov * Math.PI / 180
      const hLen    = Math.sqrt(forward.x * forward.x + forward.z * forward.z)
      const tanPitch = hLen > 0.001 ? forward.y / hLen : (forward.y > 0 ? 1e6 : -1e6)
      const hy = H / 2 + (tanPitch / Math.tan(vFOV / 2)) * (H / 2)

      // VPs: project each of the form's three edge-direction families to its
      // point at infinity through the live camera. Spinning slides the
      // horizontal VPs along the horizon; tilting or rolling the form (or the
      // camera) pulls VPs off the horizon and wakes the third one. An edge
      // family parallel to the picture plane has no VP at all.
      const f_y  = H / 2 / Math.tan(vFOV / 2)
      const D2R  = Math.PI / 180
      // "YXZ": tilt pivots on the cube's own (spun) X axis and roll on its own
      // Z axis, so each rotation field turns around the axis line drawn on the form
      const eul  = new THREE.Euler(rotDeg.x * D2R, rotDeg.y * D2R, rotDeg.z * D2R, "YXZ")
      const invQ = camera.quaternion.clone().invert()
      const familyVP = (lx: number, ly: number, lz: number): [number, number] | null => {
        const d = new THREE.Vector3(lx, ly, lz).applyEuler(eul).applyQuaternion(invQ)
        if (d.z > 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z } // point away from camera
        if (d.z > -0.05) return null // within ~3° of the picture plane — treat as parallel, no VP
        return [W / 2 + (d.x / -d.z) * f_y, H / 2 - (d.y / -d.z) * f_y]
      }
      const famX = familyVP(1, 0, 0)
      const famZ = familyVP(0, 0, 1)
      const famY = familyVP(0, 1, 0)
      const xKey = famX ? famX[0] : Infinity
      const zKey = famZ ? famZ[0] : Infinity
      // With only one horizontal family vanishing (face-on view), that VP is
      // the classic centre vanishing point of one-point perspective
      const oneHoriz = (famX === null) !== (famZ === null)
      const vps: { pt: [number, number] | null; label: string }[] = [
        { pt: famX, label: oneHoriz ? "VP_C" : xKey <= zKey ? "VP_L" : "VP_R" },
        { pt: famZ, label: oneHoriz ? "VP_C" : xKey <= zKey ? "VP_R" : "VP_L" },
        { pt: famY, label: "VP_3" },
      ]

      // ── eye level & the form's horizon ───────────────────────────
      // Eye level is a camera fact and never moves with the form. The
      // HORIZON drawn for the form is the vanishing line of its own ground
      // plane (local x-z): it passes through VP_L and VP_R, so it swings
      // away from eye level as the form tilts or rolls.
      // Line equation from the plane normal in camera space:
      //   n.x·(x − W/2) − n.y·(y − H/2) = f_y·n.z
      const nUp = new THREE.Vector3(0, 1, 0).applyEuler(eul).applyQuaternion(invQ)
      const yAt = (x: number): number | null =>
        Math.abs(nUp.y) > 1e-6 ? H / 2 + (nUp.x * (x - W / 2) - f_y * nUp.z) / nUp.y : null
      const y0 = yAt(0), yW = yAt(W)
      const horizonTilted =
        (y0 === null || yW === null || Math.abs(y0 - hy) > 2.5 || Math.abs(yW - hy) > 2.5)

      // eye level — fades back a little when the form horizon departs from it
      ctx.strokeStyle = RED; ctx.lineWidth = 1; ctx.globalAlpha = horizonTilted ? 0.3 : 0.55
      ctx.setLineDash([6, 6])
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1
      if (hy > 14 && hy < H - 22) {
        ctx.fillStyle = RED; ctx.font = "11px monospace"; ctx.globalAlpha = horizonTilted ? 0.5 : 0.8
        // right-aligned: the forms panel floats over the left of the plate
        ctx.fillText("EYE LEVEL", W - 36 - ctx.measureText("EYE LEVEL").width, hy + 16)
        ctx.globalAlpha = 1
      }

      // form horizon — only drawn once it separates from eye level
      if (horizonTilted) {
        const pts: [number, number][] = []
        if (Math.abs(nUp.y) >= Math.abs(nUp.x)) {
          for (const x of [-40, W + 40]) {
            const y = yAt(x)
            if (y !== null) pts.push([x, y])
          }
        } else if (Math.abs(nUp.x) > 1e-6) {
          for (const y of [-40, H + 40]) {
            pts.push([W / 2 + (f_y * nUp.z + nUp.y * (y - H / 2)) / nUp.x, y])
          }
        }
        if (pts.length === 2) {
          ctx.strokeStyle = RED; ctx.lineWidth = 1.25; ctx.globalAlpha = 0.7
          ctx.setLineDash([12, 5])
          ctx.beginPath()
          ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1])
          ctx.stroke()
          ctx.setLineDash([]); ctx.globalAlpha = 1
          const ly = yAt(120)
          if (ly !== null && ly > 26 && ly < H - 26) {
            ctx.fillStyle = RED; ctx.font = "11px monospace"; ctx.globalAlpha = 0.85
            ctx.fillText("HORIZON", 120, ly - 8)
            ctx.globalAlpha = 1
          }
        }
      }

      // ── cone of vision (60°) ─────────────────────────────────────
      // The circle where a 60° cone around your gaze meets the picture
      // plane. Inside it, drawings look natural; outside, perspective
      // visibly distorts. Centred on the centre of vision (CV), which
      // sits on your optical axis — not necessarily on the horizon.
      if (cone && !inGuess) {
        const covR = f_y * Math.tan(Math.PI / 6)
        const ccx = W / 2, ccy = H / 2
        if (covR < Math.hypot(W / 2, H / 2)) {
          // whisper wash over the distortion zone
          ctx.save()
          ctx.fillStyle = pal.coneWash
          ctx.beginPath()
          ctx.rect(0, 0, W, H)
          ctx.arc(ccx, ccy, covR, 0, Math.PI * 2)
          ctx.fill("evenodd")
          ctx.restore()
          ctx.strokeStyle = RED; ctx.globalAlpha = 0.45; ctx.lineWidth = 1
          ctx.setLineDash([9, 6])
          ctx.beginPath(); ctx.arc(ccx, ccy, covR, 0, Math.PI * 2); ctx.stroke()
          ctx.setLineDash([])
          const ly = ccy - covR
          if (ly > 26 && ly < H - 26) {
            ctx.font = "11px monospace"; ctx.fillStyle = RED; ctx.globalAlpha = 0.75
            const t = "CONE OF VISION · 60°"
            ctx.fillText(t, ccx - ctx.measureText(t).width / 2, ly + 16)
          }
          ctx.globalAlpha = 1
        }
        // centre of vision cross
        ctx.strokeStyle = RED; ctx.globalAlpha = 0.6; ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(ccx - 5, ccy); ctx.lineTo(ccx + 5, ccy)
        ctx.moveTo(ccx, ccy - 5); ctx.lineTo(ccx, ccy + 5)
        ctx.stroke()
        ctx.font = "10px monospace"; ctx.fillStyle = RED
        ctx.fillText("CV", ccx - 24, ccy + 13)
        ctx.globalAlpha = 1
      }

      // ── VP markers ───────────────────────────────────────────────
      const drawVP = (pt: [number, number] | null, label: string) => {
        if (!pt) return
        const [vx, vy] = pt
        ctx.font = "11px monospace"
        if (vx > 0 && vx < W && vy > 0 && vy < H) {
          ctx.strokeStyle = RED; ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(vx - 7, vy); ctx.lineTo(vx + 7, vy)
          ctx.moveTo(vx, vy - 7); ctx.lineTo(vx, vy + 7)
          ctx.stroke()
          ctx.fillStyle = RED
          const tw = ctx.measureText(label).width
          ctx.fillText(label, vx > W / 2 ? vx + 10 : vx - 10 - tw, vy - 9)
        } else {
          // off-canvas: park an arrow label where the ray from the horizon
          // centre toward the VP leaves the canvas
          const ox = W / 2, oy = hy
          const dx = vx - ox, dy = vy - oy
          const tx = dx > 0 ? (W - 20 - ox) / dx : dx < 0 ? (20 - ox) / dx : Infinity
          const ty = dy > 0 ? (H - 20 - oy) / dy : dy < 0 ? (20 - oy) / dy : Infinity
          const t  = Math.min(tx, ty)
          if (!isFinite(t) || t <= 0) return
          const ex = ox + dx * t, ey = oy + dy * t
          const arrow = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "→" : "←") : (dy > 0 ? "↓" : "↑")
          const txt = arrow === "←" ? `← ${label}` : arrow === "→" ? `${label} →` : `${label} ${arrow}`
          const tw  = ctx.measureText(txt).width
          ctx.fillStyle = RED; ctx.globalAlpha = 0.7
          ctx.fillText(txt,
            Math.max(14, Math.min(W - 14 - tw, ex - tw / 2)),
            Math.max(22, Math.min(H - 10, ey - 8)))
          ctx.globalAlpha = 1
        }
      }
      vps.forEach(v => drawVP(v.pt, v.label))

      // ── sun glyph: where the light comes from ────────────────────
      if (sunOn && !inGuess) {
        const [lx, ly, lz] = lightDirection(sunAz, sunEl)
        const sunW = new THREE.Vector3(lx * 5.5, vertPos + ly * 5.5, lz * 5.5)
        if (sunW.clone().sub(camera.position).dot(forward) > 0) {
          const [sx, sy] = toScreen(sunW.x, sunW.y, sunW.z)
          if (sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30) {
            ctx.strokeStyle = RED; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9
            ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, Math.PI * 2); ctx.stroke()
            ctx.beginPath()
            for (let i = 0; i < 8; i++) {
              const a = i * Math.PI / 4
              ctx.moveTo(sx + Math.cos(a) * 9.5, sy + Math.sin(a) * 9.5)
              ctx.lineTo(sx + Math.cos(a) * 13, sy + Math.sin(a) * 13)
            }
            ctx.stroke()
            ctx.font = "11px monospace"; ctx.fillStyle = RED
            ctx.fillText("LIGHT", sx - 18, sy + 27)
            ctx.globalAlpha = 1
          } else {
            drawVP([sx, sy], "LIGHT")
          }
        }
      }

      // ── construction lines (faceted forms only) ──────────────────
      if (guidesOn && isFaceted(sid)) {
        const screenCorners = facetCorners(sid, sp).map(c => {
          const p = c.applyEuler(eul)
          return toScreen(p.x, p.y + vertPos, p.z)
        })
        ctx.strokeStyle = RED_FAINT; ctx.lineWidth = 0.75; ctx.setLineDash([3, 7])
        screenCorners.forEach(([sx, sy]) => {
          vps.forEach(v => {
            if (!v.pt) return
            const dx = v.pt[0] - sx, dy = v.pt[1] - sy
            const len = Math.hypot(dx, dy) || 1
            const L = Math.min(len, 3000)
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.lineTo(sx + dx / len * L, sy + dy / len * L)
            ctx.stroke()
          })
        })
        ctx.setLineDash([])
      }

      // ── axis letters at the form-axis tips (faceted forms only) ──
      // The axis being turned lights up in red;
      // with SHOW AXES off, only that active axis appears while rotating.
      if (isFaceted(sid) && !inGuess && (axes || liveAxis)) {
        const tips: ["x" | "y" | "z", number, number, number][] = [
          ["x", hw + 0.52, 0, 0],
          ["y", 0, hh + 0.52, 0],
          ["z", 0, 0, hd + 0.52],
        ]
        tips.forEach(([axis, tx, ty, tz]) => {
          const active = axis === liveAxis
          if (!axes && !active) return
          const p = new THREE.Vector3(tx, ty, tz).applyEuler(eul)
          const [sx, sy] = toScreen(p.x, p.y + vertPos, p.z)
          ctx.font = active ? "bold 12px monospace" : "11px monospace"
          ctx.fillStyle = active ? ORANGE : INK
          ctx.globalAlpha = active ? 1 : 0.75
          ctx.fillText(axis.toUpperCase(), sx - 3.5, sy + 4)
        })
        ctx.globalAlpha = 1
      }

      // ── ellipse degree readout (surfaces of revolution) ──────────
      // The "degree" of each ring is the angle between your sight line
      // and the ring's plane: 0° at eye level (a straight line), opening
      // wider the farther the ring sits above or below it.
      if (degrees && !inGuess && !isFaceted(sid) && sid !== "tube") {
        const rings: { y: number; r: number }[] = []
        if (sid === "cylinder") {
          const radius = sp.radius ?? 0.5, height = sp.height ?? 1.5
          rings.push({ y: height / 2, r: radius }, { y: -height / 2, r: radius })
          if (contours) for (let i = 1; i <= ringsN; i++)
            rings.push({ y: -height / 2 + height * i / (ringsN + 1), r: radius })
        } else if (sid === "sphere") {
          const radius = sp.radius ?? 0.8
          if (contours) for (let i = 1; i <= ringsN; i++) {
            const y = -radius + 2 * radius * i / (ringsN + 1)
            rings.push({ y, r: Math.sqrt(Math.max(0, radius * radius - y * y)) })
          }
        } else {
          const def = getParametricShape(sid)
          if (def) {
            const uu: number[] = [0, 1]
            if (contours) for (let i = 1; i <= ringsN; i++) uu.push(i / (ringsN + 1))
            uu.forEach(u => {
              const [x, y] = def.surface(u, 0, sp)
              if (x > 0.05) rings.push({ y, r: x })
            })
          }
        }
        // camera-right horizontal direction — labels sit at each ring's right edge
        // A ring's degree is the angle between the sight line and the
        // ring's plane; on a turned form that plane turns with it
        const axis = new THREE.Vector3(0, 1, 0).applyEuler(eul)
        const dh  = Math.hypot(camera.position.x, camera.position.z) || 1e-4
        const side = new THREE.Vector3(camera.position.z / dh, 0, -camera.position.x / dh)
        side.addScaledVector(axis, -side.dot(axis))
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0).applyEuler(eul)
        side.normalize()
        const labels = rings.map(({ y, r }) => {
          const c = axis.clone().multiplyScalar(y)
          c.y += vertPos
          const v = c.clone().sub(camera.position).normalize()
          const deg = Math.round(Math.asin(Math.min(1, Math.abs(v.dot(axis)))) * 180 / Math.PI)
          const [lx, ly] = toScreen(c.x + side.x * r, c.y + side.y * r, c.z + side.z * r)
          return { lx, ly, deg }
        }).sort((a, b) => a.ly - b.ly)
        ctx.font = "10px monospace"; ctx.fillStyle = RED; ctx.globalAlpha = 0.85
        let prevY = -1e9
        labels.forEach(l => {
          if (l.ly - prevY < 13) return
          prevY = l.ly
          ctx.fillText(`${l.deg}°`, l.lx + 9, l.ly + 3.5)
        })
        ctx.globalAlpha = 1
      }

      // ── top view inset: the textbook VP construction, live ───────
      // Seen from above, oriented view-up: the station point (SP, your
      // eye) sits below the form; the picture plane (PP) runs through
      // the form perpendicular to your gaze; rays from SP parallel to
      // the form's edges pierce the PP exactly at the vanishing points.
      if (topView && !inGuess) {
        const IW = 190, IH = 190
        const ix0 = 24, iy0 = H - 24 - IH
        ctx.fillStyle = pal.wash
        ctx.fillRect(ix0, iy0, IW, IH)
        ctx.strokeStyle = INK; ctx.globalAlpha = 0.55; ctx.lineWidth = 1
        ctx.strokeRect(ix0 + 0.5, iy0 + 0.5, IW, IH)
        ctx.globalAlpha = 1

        const camX = camera.position.x, camZ = camera.position.z
        const d  = Math.hypot(camX, camZ) || 1e-4
        const fw = { x: -camX / d, z: -camZ / d }   // SP → form (view forward)
        const rt = { x: -fw.z,     z: fw.x }        // view right
        const s  = Math.min(34, 100 / d)            // SP stays a fixed step below the form
        const ox = ix0 + IW / 2
        const oy = iy0 + IH * 0.38
        const P = (wx: number, wz: number): [number, number] => [
          ox + (wx * rt.x + wz * rt.z) * s,
          oy - (wx * fw.x + wz * fw.z) * s,
        ]
        const [spx, spy] = P(camX, camZ)

        ctx.save()
        ctx.beginPath(); ctx.rect(ix0, iy0, IW, IH); ctx.clip()

        // picture plane — horizontal through the form in view-up orientation
        ctx.strokeStyle = RED; ctx.globalAlpha = 0.6; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(ix0, oy); ctx.lineTo(ix0 + IW, oy); ctx.stroke()

        // field of view wedge for the current lens
        const hHalf = Math.atan(Math.tan(vFOV / 2) * camera.aspect)
        ctx.globalAlpha = 0.45
        for (const a of [-hHalf, hHalf]) {
          const dx = fw.x * Math.cos(a) - fw.z * Math.sin(a)
          const dz = fw.x * Math.sin(a) + fw.z * Math.cos(a)
          const [ex, ey] = P(camX + dx * (d + 9), camZ + dz * (d + 9))
          ctx.beginPath(); ctx.moveTo(spx, spy); ctx.lineTo(ex, ey); ctx.stroke()
        }

        // fixed 60° cone of vision for comparison against the lens wedge
        if (cone) {
          ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.4
          for (const a of [-Math.PI / 6, Math.PI / 6]) {
            const dx = fw.x * Math.cos(a) - fw.z * Math.sin(a)
            const dz = fw.x * Math.sin(a) + fw.z * Math.cos(a)
            const [ex, ey] = P(camX + dx * (d + 9), camZ + dz * (d + 9))
            ctx.beginPath(); ctx.moveTo(spx, spy); ctx.lineTo(ex, ey); ctx.stroke()
          }
          ctx.setLineDash([]); ctx.globalAlpha = 0.45
        }

        // rays parallel to the form's edge families → VPs on the PP
        const famDirs = [new THREE.Vector3(1, 0, 0).applyEuler(eul), new THREE.Vector3(0, 0, 1).applyEuler(eul)]
        ctx.setLineDash([4, 4])
        famDirs.forEach(v => {
          let hx = v.x, hz = v.z
          const n = Math.hypot(hx, hz)
          if (n < 0.03) return
          hx /= n; hz /= n
          let fdot = hx * fw.x + hz * fw.z
          if (fdot < 0) { hx = -hx; hz = -hz; fdot = -fdot }
          if (fdot < 0.03) return                    // parallel to PP — VP at infinity
          const t = d / fdot
          const [vx2, vy2] = P(camX + hx * t, camZ + hz * t)
          ctx.strokeStyle = RED; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.9
          ctx.beginPath(); ctx.moveTo(spx, spy); ctx.lineTo(vx2, vy2); ctx.stroke()
          ctx.setLineDash([])
          ctx.globalAlpha = 0.85; ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.moveTo(vx2 - 4, vy2); ctx.lineTo(vx2 + 4, vy2)
          ctx.moveTo(vx2, vy2 - 4); ctx.lineTo(vx2, vy2 + 4)
          ctx.stroke()
          ctx.setLineDash([4, 4])
        })
        ctx.setLineDash([])

        // form footprints — the original plus any copies receding along Z
        ctx.strokeStyle = INK; ctx.lineWidth = 1.1
        for (let ci = 0; ci < Math.max(1, nCopies); ci++) {
          const wz = -ci * gap
          ctx.globalAlpha = ci === 0 ? 0.75 : 0.45
          if (isFaceted(sid)) {
            // base and top outlines; a pyramid's top is its apex, so its
            // slanted edges run in to that point instead
            const cs = facetCorners(sid, sp).map(c => { const v = c.applyEuler(eul); return P(v.x, v.z + wz) })
            const ring = (k: number) => {
              ctx.beginPath()
              for (let i = 0; i <= 4; i++) {
                const [px, py] = cs[k + i % 4]
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
              }
              ctx.stroke()
            }
            ring(0)
            if (cs.length === 8) ring(4)
            else {
              ctx.beginPath()
              for (let i = 0; i < 4; i++) { ctx.moveTo(...cs[i]); ctx.lineTo(...cs[4]) }
              ctx.stroke()
            }
          } else if (three.footprint.length) {
            ctx.beginPath()
            three.footprint.forEach(([fx, fz], i) => {
              const [px, py] = P(fx, fz + wz)
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
            })
            ctx.closePath(); ctx.stroke()
          }
        }
        ctx.globalAlpha = 0.75

        // station point
        ctx.fillStyle = RED; ctx.globalAlpha = 0.9
        ctx.beginPath(); ctx.arc(spx, spy, 3, 0, Math.PI * 2); ctx.fill()
        ctx.font = "10px monospace"
        ctx.fillText("SP", spx + 7, spy + 3)
        ctx.globalAlpha = 1
        ctx.restore()

        // labels on the frame
        ctx.font = "10px monospace"
        ctx.fillStyle = INK; ctx.globalAlpha = 0.7
        ctx.fillText("TOP VIEW", ix0 + 8, iy0 + 14)
        ctx.fillStyle = RED
        ctx.fillText("PP", ix0 + IW - 22, oy - 5)
        ctx.globalAlpha = 1
      }

      // ── corner frame ─────────────────────────────────────────────
      const m = 12, arm = 18
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5
      ;([[m, m], [W - m, m], [m, H - m], [W - m, H - m]] as [number, number][]).forEach(([px, py], i) => {
        const sx = i % 2 === 0 ? 1 : -1, sy = i < 2 ? 1 : -1
        ctx.beginPath()
        ctx.moveTo(px, py); ctx.lineTo(px + arm * sx, py)
        ctx.moveTo(px, py); ctx.lineTo(px, py + arm * sy)
        ctx.stroke()
      })
      ctx.globalAlpha = 1

      // ── figure label (top-left) ──────────────────────────────────
      const figNo = String(ALL_SHAPE_IDS.indexOf(sid) + 1).padStart(3, "0")
      ctx.fillStyle = INK; ctx.font = "11px monospace"; ctx.globalAlpha = 0.7
      ctx.fillText(`FIG_${figNo}`, 36, 27)
      ctx.globalAlpha = 1

      // ── drill banner (top centre, while guessing) ────────────────
      if (inGuess) {
        ctx.font = "11px monospace"; ctx.fillStyle = RED; ctx.globalAlpha = 0.85
        const t = "GUESS THE BOX — imagine the form from its edge, then reveal"
        ctx.fillText(t, W / 2 - ctx.measureText(t).width / 2, 27)
        ctx.globalAlpha = 1
        return
      }

      // ── title block (bottom-right, drawing-plate style) ──────────
      const posLabel =
        vertPos > 0.06  ? "ABOVE EYE LEVEL"
        : vertPos < -0.06 ? "BELOW EYE LEVEL"
        : "AT EYE LEVEL"
      const nVPs = vps.filter(v => v.pt).length
      const lensMm = Math.round(SENSOR_HALF / Math.tan(vFOV / 2))
      const lensKind = lensMm < 28 ? "WIDE" : lensMm <= 60 ? "NORMAL" : "TELE"
      const rows: [string, string, string][] = [
        ["FORM", SHAPE_FULL_LABELS[sid], INK],
        ["LENS", orthoOn ? "∞ · ORTHO" : `${lensMm}mm ${lensKind}`, INK],
        ["PROJ", orthoOn ? "PARALLEL — VPs AT ∞" : `${nVPs}-PT PERSPECTIVE`, INK],
        ["VIEW", posLabel, RED],
      ]
      if (sunOn) rows.splice(3, 0, ["LIGHT", `AZ ${Math.round(sunAz)}° · EL ${Math.round(sunEl)}°`, RED])
      if (three.ix) {
        rows.splice(1, 0, ["MEETS", three.ix.label, pal.seam])
        // say so when there is no seam to study
        const note = three.ix.note
        if (note) {
          ctx.font = "11px monospace"; ctx.fillStyle = pal.seam; ctx.globalAlpha = 0.9
          ctx.fillText(note, W / 2 - ctx.measureText(note).width / 2, 27)
          ctx.globalAlpha = 1
        }
      }
      const tbW = 200, tbRow = 22, tbH = tbRow * rows.length
      const tbX = W - 24 - tbW, tbY = H - 24 - tbH
      ctx.font = "11px monospace"
      ctx.fillStyle = pal.washTitle
      ctx.fillRect(tbX, tbY, tbW, tbH)
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.55
      ctx.strokeRect(tbX + 0.5, tbY + 0.5, tbW, tbH)
      for (let i = 1; i < rows.length; i++) {
        ctx.beginPath()
        ctx.moveTo(tbX, tbY + i * tbRow + 0.5); ctx.lineTo(tbX + tbW, tbY + i * tbRow + 0.5)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(tbX + 50.5, tbY); ctx.lineTo(tbX + 50.5, tbY + tbH)
      ctx.stroke()
      ctx.globalAlpha = 1
      rows.forEach(([key, val, color], i) => {
        const ty = tbY + i * tbRow + 15
        ctx.fillStyle = INK; ctx.globalAlpha = 0.5
        ctx.fillText(key, tbX + 8, ty)
        ctx.globalAlpha = 0.85
        ctx.fillStyle = color
        ctx.fillText(val, tbX + 58, ty)
      })
      ctx.globalAlpha = 1
    },
    [],
  )

  // ── Init Three.js (runs once) ─────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(wrap.clientWidth, wrap.clientHeight)
    Object.assign(renderer.domElement.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
    })
    wrap.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(
      45, wrap.clientWidth / wrap.clientHeight, 0.1, 1000,
    )
    camera.position.set(...HOME_CAM)
    camera.lookAt(0, 0, 0)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan  = false
    controls.minDistance = 1.2   // close enough to study a face…
    controls.maxDistance = 10    // …far enough to see the whole apparatus, never lose the form
    controls.target.set(0, 0, 0)
    controls.update()

    const scene      = new THREE.Scene()
    const cubeGroup  = new THREE.Group()
    // Match the overlay's Euler order — tilt/roll pivot on the cube's own axes
    cubeGroup.rotation.order = "YXZ"
    const shapeGroup = new THREE.Group()
    shapeGroup.rotation.order = "YXZ"
    scene.add(cubeGroup, shapeGroup)

    // ── World-locked ground: a level grid that fades into the paper, plus
    // a soft contact shadow. It never tilts with the form — that contrast
    // is the point — and it slides to stay under the form's lowest point.
    const groundGroup = new THREE.Group()
    const { pos: gPos, col: gCol } = buildGroundGrid(PLATE_PALETTES.light)
    const gridGeo = new THREE.BufferGeometry()
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gPos, 3))
    gridGeo.setAttribute("color",    new THREE.Float32BufferAttribute(gCol, 3))
    const gridLines = new THREE.LineSegments(gridGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false }))
    gridLines.renderOrder = 1

    const shadowCanvas = document.createElement("canvas")
    shadowCanvas.width = shadowCanvas.height = 128
    const sctx = shadowCanvas.getContext("2d")!
    const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 62)
    grad.addColorStop(0, "rgba(70, 70, 140, 0.30)")
    grad.addColorStop(1, "rgba(70, 70, 140, 0)")
    sctx.fillStyle = grad
    sctx.fillRect(0, 0, 128, 128)
    const shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true, depthWrite: false,
      }),
    )
    shadowMesh.rotation.x = -Math.PI / 2
    shadowMesh.position.y = 0.002
    shadowMesh.renderOrder = 1
    groundGroup.add(gridLines, shadowMesh)
    scene.add(groundGroup)

    // Sunlight: a directional light for the shaded surfaces, a posterised
    // value ramp for the toon material, and a group for planar cast shadows
    // intensity π: physically-scaled Lambert divides by π, so the ramp's
    // white must arrive on screen as white
    const dirLight = new THREE.DirectionalLight(0xffffff, Math.PI)
    dirLight.position.set(0, 10, 0)
    scene.add(dirLight)
    const GRAD_W = 64
    const gradientTex = new THREE.DataTexture(new Uint8Array(GRAD_W * 4), GRAD_W, 1, THREE.RGBAFormat)
    gradientTex.minFilter = THREE.NearestFilter
    gradientTex.magFilter = THREE.NearestFilter
    gradientTex.generateMipmaps = false
    // surfaces sit a hair behind the lines drawn on them
    const toonMat = new THREE.MeshToonMaterial({
      color: 0xffffff, gradientMap: gradientTex, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
    const toonMatIx = toonMat.clone()
    const ixGroup = new THREE.Group()
    scene.add(ixGroup)
    const castGroup = new THREE.Group()
    scene.add(castGroup)
    const castMat = new THREE.MeshBasicMaterial({ depthWrite: false, side: THREE.DoubleSide })

    // Handles for the selected form. They move an empty proxy; every change
    // is reported up as a new placement, and the props rebuild the form.
    const proxy = new THREE.Object3D()
    proxy.rotation.order = "YXZ"
    scene.add(proxy)
    const gizmo = new TransformControls(camera, renderer.domElement)
    gizmo.setSize(0.85)
    scene.add(gizmo.getHelper())
    const emitTransform = (phase: "start" | "move" | "end") => {
      const target = threeRef.current?.gizmoTarget
      if (target == null) return
      if (gizmo.mode === "scale") {
        // scale stays uniform: follow whichever axis moved furthest
        const s0 = proxy.userData.s0 as number
        const sc = [proxy.scale.x, proxy.scale.y, proxy.scale.z]
        const s = sc.reduce((a, b) => Math.abs(b - s0) > Math.abs(a - s0) ? b : a, s0)
        proxy.scale.setScalar(Math.max(0.05, s))
      }
      const R2D = 180 / Math.PI
      onTransformRef.current?.(target, {
        pos: [proxy.position.x, proxy.position.y, proxy.position.z],
        rot: [proxy.rotation.x * R2D, proxy.rotation.y * R2D, proxy.rotation.z * R2D],
        scale: proxy.scale.x,
      }, phase)
    }
    gizmo.addEventListener("dragging-changed", e => {
      controls.enabled = !e.value
      if (e.value) proxy.userData.s0 = proxy.scale.x
      emitTransform(e.value ? "start" : "end")
    })
    gizmo.addEventListener("objectChange", () => emitTransform("move"))

    threeRef.current = {
      renderer, scene, camera, controls,
      cubeGroup, shapeGroup, groundGroup, shadowMesh, gridGeo,
      dirLight, toonMat, gradientTex, castGroup, castMat, casters: [], groundY: 0,
      ixGroup, toonMatIx, ixMats: [], ixSil: [], ix: null,
      gizmo, proxy, gizmoTarget: null,
      footprint: [], tubeRings: [], tubeBalls: [],
      fatMats: [], copyGroups: [], copyShadows: [],
    }

    // Continuous animation loop — OrbitControls needs this to interpolate damping
    let animId = 0
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()

      const three = threeRef.current
      if (!three) return

      // The eye in form A's own space: a turned round form is tinted and
      // billboarded against where the camera really sits relative to it
      three.shapeGroup.updateWorldMatrix(true, false)
      const eyeA = camera.position.clone()
        .applyMatrix4(new THREE.Matrix4().copy(three.shapeGroup.matrixWorld).invert())

      // Recolor tube rings by facing: a ring whose +tangent side points at
      // the camera opens toward you (accent); the rest open away (ink). The
      // colour flip travels along the spine as the tube bends past your
      // sight line — exactly the read the contour drill trains.
      if (three.tubeRings.length > 0) {
        const live = liveRef.current
        const pal  = PLATE_PALETTES[live.dark ? "dark" : "light"]
        const toCam = new THREE.Vector3()
        for (const ring of three.tubeRings) {
          toCam.subVectors(eyeA, ring.center)
          const facing = live.facingTint && ring.outward.dot(toCam) > 0
          ring.mat.color.set(facing ? pal.orange : pal.ink)
          ring.mat.opacity = ring.isEnd ? 0.95
            : !live.facingTint ? 0.5
            : facing ? 0.85 : 0.4
        }
      }

      // Tip circles: a ball end's silhouette is a circle from every angle —
      // billboard each one to the camera every frame.
      if (three.tubeBalls.length > 0) {
        const camDir = new THREE.Vector3()
        const right  = new THREE.Vector3()
        const up     = new THREE.Vector3()
        const BSEGS  = 48
        for (const ball of three.tubeBalls) {
          camDir.subVectors(eyeA, ball.center).normalize()
          const worldUp = Math.abs(camDir.y) < 0.99
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0)
          right.crossVectors(worldUp, camDir).normalize()
          up.crossVectors(camDir, right)
          const pos: number[] = []
          for (let i = 0; i < BSEGS; i++) {
            const a1 = 2 * Math.PI * i / BSEGS
            const a2 = 2 * Math.PI * (i + 1) / BSEGS
            pos.push(
              ball.center.x + ball.radius * (Math.cos(a1) * right.x + Math.sin(a1) * up.x),
              ball.center.y + ball.radius * (Math.cos(a1) * right.y + Math.sin(a1) * up.y),
              ball.center.z + ball.radius * (Math.cos(a1) * right.z + Math.sin(a1) * up.z),
              ball.center.x + ball.radius * (Math.cos(a2) * right.x + Math.sin(a2) * up.x),
              ball.center.y + ball.radius * (Math.cos(a2) * right.y + Math.sin(a2) * up.y),
              ball.center.z + ball.radius * (Math.cos(a2) * right.z + Math.sin(a2) * up.z),
            )
          }
          ball.geo.setPositions(pos)
        }
      }

      // Intersection study: redraw each smooth outline from the live eye
      if (three.ixSil.length > 0) {
        const eye = new THREE.Vector3(), inv = new THREE.Matrix4()
        for (const sil of three.ixSil) {
          sil.space.updateWorldMatrix(true, false)
          eye.copy(camera.position).applyMatrix4(inv.copy(sil.space.matrixWorld).invert())
          const data = (sil.line.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
          sil.line.instanceCount = silhouetteInto(sil.src, eye, data.array as Float32Array)
          data.needsUpdate = true
        }
      }

      renderer.render(scene, camera)

      const { verticalPosition, rotationDeg, activeAxis, showAxes, showGuides, shapeId, shapeParams, showTopView, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill, lightOn, lightAz, lightEl } = liveRef.current
      const hw = (shapeParams.width  ?? HALF * 2) / 2
      const hh = (shapeParams.height ?? HALF * 2) / 2
      const hd = (shapeParams.depth  ?? HALF * 2) / 2
      drawOverlay(verticalPosition, showGuides, showAxes, shapeId, hw, hh, hd, rotationDeg, activeAxis, showTopView, shapeParams, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill, lightOn, lightAz, lightEl)
    }
    animate()

    const onResize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      threeRef.current?.fatMats.forEach(m => m.resolution.set(w, h))
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)

    // Click (not drag) selects the form under the pointer
    const raycaster = new THREE.Raycaster()
    let downAt: [number, number] | null = null
    // a press on a handle belongs to the handle, not to selection
    const onDown = (e: PointerEvent) => { downAt = gizmo.axis ? null : [e.clientX, e.clientY] }
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return
      const rect = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top) / rect.height) * 2,
      ), camera)
      const targets: THREE.Object3D[] = []
      for (const group of [cubeGroup, shapeGroup, ixGroup]) {
        if (!group.visible) continue
        group.traverse(obj => { if (obj.userData.pick !== undefined && obj.parent!.visible) targets.push(obj) })
      }
      const hit = raycaster.intersectObjects(targets, false)[0]
      onPickRef.current?.(hit ? hit.object.userData.pick as PickTarget : null)
    }
    controls.addEventListener("end", reportEye)
    renderer.domElement.addEventListener("pointerdown", onDown)
    renderer.domElement.addEventListener("pointerup", onUp)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      controls.dispose()
      gizmo.dispose()
      toonMat.dispose()
      toonMatIx.dispose()
      castMat.dispose()
      gradientTex.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      threeRef.current = null
    }
  }, [drawOverlay, reportEye])

  // ── Repaint the ground grid and shadow for the active theme ──────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const pal = PLATE_PALETTES[dark ? "dark" : "light"]
    const { col } = buildGroundGrid(pal)
    three.gridGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
    const mat = three.shadowMesh.material as THREE.MeshBasicMaterial
    const tex = mat.map as THREE.CanvasTexture
    const c   = tex.image as HTMLCanvasElement
    const g   = c.getContext("2d")!
    g.clearRect(0, 0, c.width, c.height)
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62)
    grad.addColorStop(0, `rgba(${pal.shadowRGB}, ${pal.shadowA})`)
    grad.addColorStop(1, `rgba(${pal.shadowRGB}, 0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, c.width, c.height)
    tex.needsUpdate = true
  }, [dark])

  // ── Focal length: set the FOV and dolly-compensate the distance so
  // the form keeps its apparent size — only the convergence changes ──
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const { camera, controls } = three
    const newFov = 2 * Math.atan(SENSOR_HALF / focalLength) * 180 / Math.PI
    if (Math.abs(newFov - camera.fov) < 1e-3) return
    const k = Math.tan(camera.fov * Math.PI / 360) / Math.tan(newFov * Math.PI / 360)
    const offset = camera.position.clone().sub(controls.target)
    camera.position.copy(controls.target).addScaledVector(offset, k)
    camera.fov = newFov
    camera.updateProjectionMatrix()
    // keep the zoom limits in apparent-size space so long lenses can stand back
    const clampScale = focalLength / BASE_FOCAL_MM
    controls.minDistance = BASE_MIN_DIST * clampScale
    controls.maxDistance = BASE_MAX_DIST * clampScale
    controls.update()
    reportEye()
  }, [focalLength, reportEye])

  // ── Turntable: slow auto-orbit — watch the VPs slide along the horizon ──
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    three.controls.autoRotate = turntable
    three.controls.autoRotateSpeed = 0.8
  }, [turntable])

  // ── Value ramp: n·L → posterised tone. Stored linear so each band
  // lands on screen at its perceptual value after sRGB output ──────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const tex  = three.gradientTex
    const data = tex.image.data as Uint8Array
    const W    = tex.image.width
    for (let i = 0; i < W; i++) {
      const dot = ((i + 0.5) / W) * 2 - 1
      const v   = Math.round(Math.pow(valueAt(dot, lightSteps, shadowSteps), 2.2) * 255)
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255
    }
    tex.needsUpdate = true
  }, [lightSteps, shadowSteps])

  // ── Cast shadows: flatten every masked/shaded surface onto the ground
  // along the light. Shadow meshes borrow the casters' geometry — only
  // their transforms belong to this group. ─────────────────────────
  const buildCast = useCallback(() => {
    const three = threeRef.current
    if (!three) return
    const { castGroup, castMat, casters, groundY } = three
    castGroup.clear()
    const { lightOn, lightAz, lightEl, showShadow, drill, copies, spacing, dark } = liveRef.current
    if (!lightOn || !showShadow || drill === "guess" || casters.length === 0) return
    castMat.color.set(PLATE_PALETTES[dark ? "dark" : "light"].cast)
    const [lx, ly, lz] = lightDirection(lightAz, lightEl)
    const k = 1 / ly
    // P' = P − L·(P.y − g)/L.y, as a single affine map
    const flatten = new THREE.Matrix4().set(
      1, -lx * k, 0, groundY * lx * k,
      0, 0,       0, groundY,
      0, -lz * k, 1, groundY * lz * k,
      0, 0,       0, 1,
    )
    for (let ci = 0; ci < Math.max(1, copies); ci++) {
      const off = new THREE.Matrix4().makeTranslation(0, 0, -spacing * ci)
      for (const c of casters) {
        const m = new THREE.Mesh(c.geo, castMat)
        m.matrixAutoUpdate = false
        m.matrix.copy(flatten).multiply(off).multiply(c.world)
        m.renderOrder = 0.5
        castGroup.add(m)
      }
    }
  }, [])

  // ── Zoom buttons: dolly toward/away from the target, clamped ─────
  useEffect(() => {
    const three = threeRef.current
    if (!three || zoomAction.n === 0) return
    const { camera, controls } = three
    const offset = camera.position.clone().sub(controls.target)
    const dist = THREE.MathUtils.clamp(
      offset.length() * (zoomAction.dir > 0 ? 1 / 1.3 : 1.3),
      controls.minDistance, controls.maxDistance,
    )
    camera.position.copy(controls.target).addScaledVector(offset.normalize(), dist)
    controls.update()
    reportEye()
  }, [zoomAction, reportEye])

  // ── Reset: camera face-on to the form, at eye level ──────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three || resetCount === 0) return
    three.camera.position.set(...FACE_CAM)
    three.controls.target.set(0, 0, 0)
    three.controls.update()
    reportEye()
  }, [resetCount, reportEye])

  // ── Stored viewpoint: jump the camera there (scenes recreated from a
  // drawing carry the angle the drawing was made from) ─────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three || !cameraSet || cameraSet.n === 0) return
    three.camera.position.set(...cameraSet.pos)
    three.controls.target.set(0, 0, 0)
    three.controls.update()
    reportEye()
  }, [cameraSet, reportEye])

  // ── Rebuild scene geometry on prop changes ────────────────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const { cubeGroup, shapeGroup } = three

    // Theme palette shadows the module colour constants for this rebuild
    const pal = PLATE_PALETTES[dark ? "dark" : "light"]
    const INK_THREE    = new THREE.Color(pal.ink)
    const ORANGE_THREE = new THREE.Color(pal.orange)

    // Lowest point and footprint radius of the form, for the ground plane
    let groundBottom = -HALF
    let groundFoot   = 1

    // Dispose both groups upfront before rebuilding whichever is active
    for (const group of [cubeGroup, shapeGroup, three.ixGroup]) {
      const toDispose: THREE.BufferGeometry[] = []
      group.traverse(obj => {
        const o = obj as THREE.Mesh | THREE.LineSegments
        if (o.geometry) toDispose.push(o.geometry)
      })
      group.clear()
      toDispose.forEach(g => g.dispose())
    }
    three.fatMats.forEach(m => m.dispose())
    three.fatMats = []
    three.tubeRings = []
    three.tubeBalls = []
    three.ixMats.forEach(m => m.dispose())
    three.ixMats = []
    three.ixSil = []
    three.ix = null

    const ix = intersect && drill === "off" ? intersect : null

    // With sunlight on, the depth masks become the shaded surfaces
    // themselves; every mask is also a shadow caster. The overlap view
    // keeps both forms as line drawings so the shared volume reads alone.
    const shadeOn = lightOn && shading && drill !== "guess" && !(ix?.mode === "overlap" && ix.solo === null)
    const maskMesh = (
      geo: THREE.BufferGeometry, side: THREE.Side = THREE.FrontSide, toon = three.toonMat,
      pick = 0,
    ) => {
      const m = new THREE.Mesh(geo, shadeOn
        ? toon
        : new THREE.MeshBasicMaterial({
            colorWrite: false, side,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          }))
      m.renderOrder = 0
      m.userData.caster = true
      m.userData.pick = pick
      return m
    }

    // ── Line-weight hierarchy, like a drawn plate ─────────────────────
    // silhouette 2.2px > cube edges 2px > end rings 1.7px > contour
    // rings 1px at half strength (visible surface only, no ghost) >
    // hidden lines: thin dashes.
    const rendererSize = new THREE.Vector2()
    three.renderer.getSize(rendererSize)
    const segGeo = (pos: ArrayLike<number>) => {
      const g = new LineSegmentsGeometry()
      g.setPositions(Array.from(pos))
      return g
    }
    const fatLine = (
      geo: LineSegmentsGeometry,
      opts: {
        width: number; opacity?: number; ghost?: boolean; dashed?: boolean
        color?: THREE.Color; order?: number
      },
    ) => {
      const { width, ghost = false, dashed = ghost } = opts
      const opacity = opts.opacity ?? (ghost ? 0.16 : 1)
      const m = new LineMaterial({
        color: (opts.color ?? INK_THREE).getHex(),
        linewidth: width,
        transparent: ghost || opacity < 1,
        opacity,
        depthTest: !ghost,
        dashed,
        dashSize: 0.05,
        gapSize: 0.045,
      })
      m.resolution.copy(rendererSize)
      three.fatMats.push(m)
      const line = new LineSegments2(geo, m)
      if (dashed) line.computeLineDistances()
      line.renderOrder = opts.order ?? (ghost ? 2 : 3)
      return line
    }
    const SIL_W = 2.2, EDGE_W = 2, END_W = 1.7, CONTOUR_W = 1, GHOST_W = 0.9

    // a line buffer the animation loop refills with a mesh's live outline
    const SIL_CAP = 4000
    const outline = (src: THREE.BufferGeometry, space: THREE.Object3D) => {
      const g = new LineSegmentsGeometry()
      g.setPositions(new Float32Array(SIL_CAP * 6))
      g.instanceCount = 0
      three.ixSil.push({ line: g, src, space })
      return g
    }
    const unculled = (line: LineSegments2) => { line.frustumCulled = false; return line }

    // A round form A is outlined from the eye like any smooth mesh, so its
    // silhouette reads true however it is turned
    const solidA = isFaceted(shapeId) ? null : buildSolid(shapeId, shapeParams)
    const outlineA = () => {
      const g = outline(solidA!.geometry, shapeGroup)
      shapeGroup.add(
        unculled(fatLine(g, { width: GHOST_W, ghost: true, dashed: false })),
        unculled(fatLine(g, { width: SIL_W })),
      )
    }

    if (isFaceted(shapeId)) {
      shapeGroup.visible      = false

      const hw = (shapeParams.width  ?? HALF * 2) / 2
      const hh = (shapeParams.height ?? HALF * 2) / 2
      const hd = (shapeParams.depth  ?? HALF * 2) / 2

      if (drill === "guess") {
        // Drill: hide the box — draw only the starting edge, the vertical
        // edge nearest the eye, the classic first stroke of a 2-pt cube.
        const cam = three.camera.position
        const rot = new THREE.Euler(
          rotationDeg.x * Math.PI / 180,
          rotationDeg.y * Math.PI / 180,
          rotationDeg.z * Math.PI / 180,
          "YXZ",
        )
        let bx = 1, bz = 1, bestD = Infinity
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const p = new THREE.Vector3(sx * hw, 0, sz * hd).applyEuler(rot)
          p.y += verticalPosition
          const d = p.distanceTo(cam)
          if (d < bestD) { bestD = d; bx = sx; bz = sz }
        }
        const edgeGeo = segGeo([bx * hw, -hh, bz * hd, bx * hw, hh, bz * hd])
        cubeGroup.add(fatLine(edgeGeo, { width: EDGE_W }))
      } else {

      const geo   = shapeId === "pyramid"
        ? pyramidGeometry(hw * 2, hh * 2, hd * 2)
        : new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2)
      const edges = new THREE.EdgesGeometry(geo)

      const depthMesh = maskMesh(geo)

      const frontShade = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2, hh * 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(pal.capTint), transparent: true, opacity: 0.3,
          side: THREE.FrontSide, depthWrite: false,
          // coplanar with the depth mask's front face — offset wins the tie
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }),
      )
      frontShade.position.z = hd
      frontShade.renderOrder = 1

      const edgeGeo = segGeo(edges.attributes.position.array)
      edges.dispose()
      const cubeSolid = fatLine(edgeGeo, { width: EDGE_W })
      const cubeGhost = fatLine(edgeGeo, { width: GHOST_W, ghost: true })

      cubeGroup.add(depthMesh, cubeGhost, cubeSolid)
      if (!shadeOn && shapeId === "cube") cubeGroup.add(frontShade)

      // Local X/Y/Z axis lines through the form's centre — they rotate with
      // the cube so the active rotation axis is easy to spot. The axis whose
      // field is in use draws solid red; with SHOW AXES off, only that
      // active axis appears while rotating.
      const axisSegs: ["x" | "y" | "z", number[]][] = [
        ["x", [-(hw + 0.42), 0, 0,   hw + 0.42, 0, 0]],
        ["y", [0, -(hh + 0.42), 0,   0, hh + 0.42, 0]],
        ["z", [0, 0, -(hd + 0.42),   0, 0, hd + 0.42]],
      ]
      axisSegs.forEach(([axis, pts]) => {
        const active = axis === activeAxis
        if (!active && !showAxes) return
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        const line = new THREE.LineSegments(geo, active
          ? new THREE.LineBasicMaterial({
              color: ORANGE_THREE, transparent: true, opacity: 0.9, depthTest: false,
            })
          : new THREE.LineDashedMaterial({
              color: INK_THREE, transparent: true, opacity: 0.45,
              dashSize: 0.05, gapSize: 0.04, depthTest: false,
            }))
        if (!active) line.computeLineDistances()
        line.renderOrder = active ? 4 : 2
        cubeGroup.add(line)
      })
      }

      cubeGroup.visible    = true
      cubeGroup.position.y = verticalPosition
      cubeGroup.rotation.set(
        rotationDeg.x * Math.PI / 180,
        rotationDeg.y * Math.PI / 180,
        rotationDeg.z * Math.PI / 180,
      )

      // Ground sits under the lowest rotated corner — a tilted form rests on it
      groundBottom = Math.min(...facetCorners(shapeId, shapeParams).map(c => c.applyEuler(cubeGroup.rotation).y))
      groundFoot   = Math.hypot(hw, hd) * 1.3

    } else if (shapeId === "tube") {
      cubeGroup.visible        = false
      shapeGroup.visible       = true

      const radius = shapeParams.radius ?? 0.2
      const taper  = shapeParams.taper  ?? 0.35
      const length = shapeParams.length ?? 2.2
      const bendA  = shapeParams.bendA  ?? 0.7
      const bendB  = shapeParams.bendB  ?? 0.7
      const coil   = shapeParams.coil   ?? 0

      const TSEGS = 96
      const RSEGS = 48
      const BSEGS = 48

      // Sausage radius profile: full at the waist, tapering to both ends
      const rAt = (u: number) => radius * (1 - taper * (2 * u - 1) * (2 * u - 1))

      const path = new SpineCurve(length, bendA, bendB, coil)

      // Frenet frames along the spine — rings, tips and the depth mask hang off them
      const frenetFrames = path.computeFrenetFrames(TSEGS, false)
      const framePoints: THREE.Vector3[] = []
      const radii: number[] = []
      for (let i = 0; i <= TSEGS; i++) {
        framePoints.push(path.getPointAt(i / TSEGS))
        radii.push(rAt(i / TSEGS))
      }

      // Depth mask — hand-built tube so the radius can vary along the spine
      const maskPos: number[] = []
      const maskNrm: number[] = []
      for (let i = 0; i <= TSEGS; i++) {
        const N = frenetFrames.normals[i], B = frenetFrames.binormals[i]
        const P = framePoints[i], r = radii[i]
        for (let j = 0; j < RSEGS; j++) {
          const a = 2 * Math.PI * j / RSEGS
          const ca = Math.cos(a), sa = Math.sin(a)
          maskPos.push(
            P.x + r * (ca * N.x + sa * B.x),
            P.y + r * (ca * N.y + sa * B.y),
            P.z + r * (ca * N.z + sa * B.z),
          )
          maskNrm.push(ca * N.x + sa * B.x, ca * N.y + sa * B.y, ca * N.z + sa * B.z)
        }
      }
      const maskIdx: number[] = []
      for (let i = 0; i < TSEGS; i++) for (let j = 0; j < RSEGS; j++) {
        const a = i * RSEGS + j
        const b = i * RSEGS + (j + 1) % RSEGS
        const c = (i + 1) * RSEGS + j
        const d = (i + 1) * RSEGS + (j + 1) % RSEGS
        maskIdx.push(a, b, c, b, d, c)
      }
      const tubeGeo = new THREE.BufferGeometry()
      tubeGeo.setAttribute("position", new THREE.Float32BufferAttribute(maskPos, 3))
      tubeGeo.setAttribute("normal",   new THREE.Float32BufferAttribute(maskNrm, 3))
      tubeGeo.setIndex(maskIdx)
      const depthMesh = maskMesh(tubeGeo, THREE.DoubleSide)

      // Ball ends — a hemispherical depth mask closes each end, and a
      // billboarded tip circle (the ball's silhouette, always a perfect
      // circle from any angle) shows how the tip sits in space.
      const mkBall = (i: number, outward: THREE.Vector3) => {
        const r = radii[i]
        const dome = maskMesh(
          new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), THREE.DoubleSide)
        dome.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward)
        dome.position.copy(framePoints[i])
        const circleGeo = segGeo(new Float32Array(BSEGS * 2 * 3))
        shapeGroup.add(dome,
          fatLine(circleGeo, { width: END_W, opacity: 0.95 }),
          fatLine(circleGeo, { width: GHOST_W, ghost: true, dashed: false }))
        three.tubeBalls.push({ geo: circleGeo, center: framePoints[i].clone(), radius: r })
      }
      mkBall(0, frenetFrames.tangents[0].clone().negate())
      mkBall(TSEGS, frenetFrames.tangents[TSEGS].clone())
      shapeGroup.add(depthMesh)

      // Rings — one fat line each, so the animation loop can tint every
      // ellipse by whether it opens toward or away from the camera.
      const endGhostPos: number[] = []
      const contourGhostPos: number[] = []
      const ringPositions = (t: number): number[] => {
        const fi  = Math.min(Math.floor(t * TSEGS), TSEGS - 1)
        const ff  = t * TSEGS - fi
        const fi2 = Math.min(fi + 1, TSEGS)
        const P   = path.getPointAt(Math.min(t, 1))
        const N   = frenetFrames.normals[fi].clone().lerp(frenetFrames.normals[fi2], ff).normalize()
        const B   = frenetFrames.binormals[fi].clone().lerp(frenetFrames.binormals[fi2], ff).normalize()
        const r   = rAt(t)
        const pos: number[] = []
        for (let i = 0; i < RSEGS; i++) {
          const a1 = 2 * Math.PI * i / RSEGS
          const a2 = 2 * Math.PI * (i + 1) / RSEGS
          pos.push(
            P.x + r * Math.cos(a1) * N.x + r * Math.sin(a1) * B.x,
            P.y + r * Math.cos(a1) * N.y + r * Math.sin(a1) * B.y,
            P.z + r * Math.cos(a1) * N.z + r * Math.sin(a1) * B.z,
            P.x + r * Math.cos(a2) * N.x + r * Math.sin(a2) * B.x,
            P.y + r * Math.cos(a2) * N.y + r * Math.sin(a2) * B.y,
            P.z + r * Math.cos(a2) * N.z + r * Math.sin(a2) * B.z,
          )
        }
        return pos
      }
      const ringTs: { t: number; isEnd: boolean }[] = [
        { t: 0, isEnd: true }, { t: 1, isEnd: true },
      ]
      if (showContours) {
        for (let i = 1; i <= uRings; i++) ringTs.push({ t: i / (uRings + 1), isEnd: false })
      }
      ringTs.forEach(({ t, isEnd }) => {
        const pos  = ringPositions(t)
        const line = fatLine(segGeo(pos), isEnd
          ? { width: END_W, opacity: 0.95 }
          : { width: CONTOUR_W, opacity: 0.5 })
        shapeGroup.add(line)
        // "Opens toward you" direction: along the spine for surface rings,
        // but the START cap's visible face points against the spine.
        const outward = path.getTangentAt(Math.min(t, 1)).clone()
        if (t === 0) outward.negate()
        three.tubeRings.push({
          mat:    line.material as LineMaterial,
          center: path.getPointAt(Math.min(t, 1)).clone(),
          outward,
          isEnd,
        })
        ;(isEnd ? endGhostPos : contourGhostPos).push(...pos)
      })
      shapeGroup.add(fatLine(segGeo(endGhostPos), { width: GHOST_W, ghost: true }))
      if (wrapContours && contourGhostPos.length)
        shapeGroup.add(fatLine(segGeo(contourGhostPos), { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22 }))

      outlineA()
      shapeGroup.position.y = verticalPosition

      // Ground from the actual coiled spine — lowest surface point and
      // widest horizontal reach (the ball ends are covered by P.y − r).
      groundBottom = Infinity
      let foot = 0
      for (let i = 0; i <= TSEGS; i++) {
        groundBottom = Math.min(groundBottom, framePoints[i].y - radii[i])
        foot = Math.max(foot, Math.hypot(framePoints[i].x, framePoints[i].z) + radii[i])
      }
      groundFoot = foot + 0.25


    } else if (shapeId === "cylinder") {
      cubeGroup.visible        = false
      shapeGroup.visible       = true

      const radius = shapeParams.radius ?? 0.5
      const height = shapeParams.height ?? 1.5
      const SEGS   = 64

      // Depth mask: closed cylinder seals the depth buffer including caps
      const maskGeo = new THREE.CylinderGeometry(radius, radius, height, SEGS, 1, false)
      const depthMask = maskMesh(maskGeo)

      // Cap shades — FrontSide means each cap only renders when camera is on its side
      const capMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(pal.capTint), transparent: true, opacity: 0.3,
        side: THREE.FrontSide, depthWrite: false,
        // coplanar with the depth mask's caps — offset wins the tie
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      })
      const capGeo    = new THREE.CircleGeometry(radius, SEGS)
      const topCap    = new THREE.Mesh(capGeo, capMat)
      topCap.rotation.x  = -Math.PI / 2
      topCap.position.y  =  height / 2
      topCap.renderOrder = 1
      const bottomCap   = new THREE.Mesh(capGeo, capMat)
      bottomCap.rotation.x  = Math.PI / 2
      bottomCap.position.y  = -height / 2
      bottomCap.renderOrder = 1

      // Ring geometry (static — doesn't change with camera angle)
      const endPos: number[] = []
      const contourPos: number[] = []
      const addRing = (y: number, out: number[]) => {
        for (let i = 0; i < SEGS; i++) {
          const a1 = 2 * Math.PI * i / SEGS
          const a2 = 2 * Math.PI * (i + 1) / SEGS
          out.push(
            radius * Math.cos(a1), y, radius * Math.sin(a1),
            radius * Math.cos(a2), y, radius * Math.sin(a2),
          )
        }
      }
      addRing( height / 2, endPos)
      addRing(-height / 2, endPos)
      if (showContours) {
        for (let i = 1; i <= uRings; i++)
          addRing(-height / 2 + height * i / (uRings + 1), contourPos)
      }

      const endGeo    = segGeo(endPos)
      const ringSolid = fatLine(endGeo, { width: END_W, opacity: 0.95 })
      const ringGhost = fatLine(endGeo, { width: GHOST_W, ghost: true })

      shapeGroup.add(depthMask, ringGhost, ringSolid)
      outlineA()
      if (!shadeOn) shapeGroup.add(topCap, bottomCap)
      if (contourPos.length) {
        const contourGeo = segGeo(contourPos)
        shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, opacity: 0.5 }))
        if (wrapContours)
          shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22 }))
      }
      shapeGroup.position.y = verticalPosition

      groundBottom = -height / 2
      groundFoot   = radius * 1.6

    } else if (shapeId === "sphere") {
      cubeGroup.visible         = false
      shapeGroup.visible        = true

      const radius = shapeParams.radius ?? 0.8
      const SEGS   = 64

      const sphereGeo = new THREE.SphereGeometry(radius, SEGS, SEGS)
      const depthMesh = maskMesh(sphereGeo)

      // Latitude contour rings
      const ringPos: number[] = []
      if (showContours) {
        for (let i = 1; i <= uRings; i++) {
          const y = -radius + 2 * radius * i / (uRings + 1)
          const r = Math.sqrt(Math.max(0, radius * radius - y * y))
          for (let j = 0; j < SEGS; j++) {
            const a1 = 2 * Math.PI * j / SEGS
            const a2 = 2 * Math.PI * (j + 1) / SEGS
            ringPos.push(r * Math.cos(a1), y, r * Math.sin(a1), r * Math.cos(a2), y, r * Math.sin(a2))
          }
        }
      }
      shapeGroup.add(depthMesh)
      outlineA()
      if (ringPos.length) {
        const contourGeo = segGeo(ringPos)
        shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, opacity: 0.5 }))
        if (wrapContours)
          shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22 }))
      }
      shapeGroup.position.y = verticalPosition

      groundBottom = -radius
      groundFoot   = radius * 1.6

    } else {
      // Capsule, cone, egg — generic surface-of-revolution renderer
      cubeGroup.visible         = false
      shapeGroup.visible        = true

      const shapeDef = getParametricShape(shapeId)
      if (!shapeDef) return

      const USAMPLES = 64
      const RSEGS    = 64

      // Sample radial profile: surface(u, 0, params) → [r, y, 0]
      const profile: { r: number; y: number }[] = []
      for (let i = 0; i <= USAMPLES; i++) {
        const u = i / USAMPLES
        const [x, y] = shapeDef.surface(u, 0, shapeParams)
        profile.push({ r: Math.max(0, x), y })
      }

      // Depth mask via LatheGeometry
      const lathePoints = profile.map(({ r, y }) => new THREE.Vector2(r, y))
      const latheGeo    = new THREE.LatheGeometry(lathePoints, RSEGS)
      const depthMesh   = maskMesh(latheGeo)
      shapeGroup.add(depthMesh)

      // Flat cap meshes wherever the profile end is open (r > 0)
      const r0 = profile[0].r,          y0 = profile[0].y
      const rN = profile[USAMPLES].r,   yN = profile[USAMPLES].y
      if (r0 > 0.001) {
        const cap = maskMesh(new THREE.CircleGeometry(r0, RSEGS))
        cap.rotation.x = Math.PI / 2; cap.position.y = y0
        shapeGroup.add(cap)
      }
      if (rN > 0.001) {
        const cap = maskMesh(new THREE.CircleGeometry(rN, RSEGS))
        cap.rotation.x = -Math.PI / 2; cap.position.y = yN
        shapeGroup.add(cap)
      }

      // Ring geometry — end rings + contour rings
      const endPos: number[] = []
      const contourPos: number[] = []
      const addRing = (u: number, out: number[]) => {
        const [x, y] = shapeDef.surface(Math.min(u, 1), 0, shapeParams)
        const r = Math.max(0, x)
        if (r < 0.001) return
        for (let i = 0; i < RSEGS; i++) {
          const a1 = 2 * Math.PI * i / RSEGS
          const a2 = 2 * Math.PI * (i + 1) / RSEGS
          out.push(r * Math.cos(a1), y, r * Math.sin(a1), r * Math.cos(a2), y, r * Math.sin(a2))
        }
      }
      if (r0 > 0.001) addRing(0, endPos)
      if (rN > 0.001) addRing(1, endPos)
      if (showContours) {
        for (let i = 1; i <= uRings; i++) addRing(i / (uRings + 1), contourPos)
      }

      outlineA()
      if (endPos.length) {
        const endGeo = segGeo(endPos)
        shapeGroup.add(
          fatLine(endGeo, { width: END_W, opacity: 0.95 }),
          fatLine(endGeo, { width: GHOST_W, ghost: true }),
        )
      }
      if (contourPos.length) {
        const contourGeo = segGeo(contourPos)
        shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, opacity: 0.5 }))
        if (wrapContours)
          shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22 }))
      }
      shapeGroup.position.y = verticalPosition

      groundBottom = Math.min(...profile.map(p => p.y))
      groundFoot   = Math.max(...profile.map(p => p.r)) * 1.6
    }

    // Round forms turn as freely as the faceted ones, and rest on their
    // lowest point however they are turned
    three.footprint = []
    if (solidA) {
      shapeGroup.rotation.set(
        rotationDeg.x * Math.PI / 180,
        rotationDeg.y * Math.PI / 180,
        rotationDeg.z * Math.PI / 180,
      )
      const at = solidA.geometry.attributes.position, v = new THREE.Vector3()
      const plan: [number, number][] = []
      let low = Infinity, reach = 0
      for (let i = 0; i < at.count; i++) {
        v.fromBufferAttribute(at, i).applyEuler(shapeGroup.rotation)
        low = Math.min(low, v.y)
        reach = Math.max(reach, Math.hypot(v.x, v.z))
        plan.push([v.x, v.z])
      }
      groundBottom = low
      groundFoot   = Math.max(groundFoot, reach * 1.3)
      three.footprint = convexHull(plan)
    }

    // ── Intersection study: more forms pushed through the first ──────
    // A seam is the one line that lies on two surfaces at once. It is
    // drawn heaviest, in its own colour; where a surface hides it, it
    // carries on thin and faint. Every pair of forms gets its own seam.
    // A form set to cut carves its volume out of the solid forms it
    // touches: it stays as a faint ghost, and its seam is the bite's rim.
    const { ixGroup } = three
    const activeGroup = isFaceted(shapeId) ? cubeGroup : shapeGroup
    ixGroup.position.y = verticalPosition
    if (ix && ix.forms.length) {
      const D2R = Math.PI / 180
      const SEAM = new THREE.Color(pal.seam)
      const LETTERS = "ABCDEFGH"
      // solo: one form alone, with the marks the others leave on it
      const solo = ix.solo ?? -1
      const late = ix.mode === "overlap" && solo < 0
      const placed = (segs: number[], m: THREE.Matrix4) => {
        const out = segs.slice(), v = new THREE.Vector3()
        for (let i = 0; i < out.length; i += 3) {
          v.set(out[i], out[i + 1], out[i + 2]).applyMatrix4(m)
          out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z
        }
        return out
      }

      // every form in A's space, A first
      const forms = [
        {
          shapeId, solid: buildSolid(shapeId, shapeParams), cut: !!ix.cutA,
          mat: new THREE.Matrix4().makeRotationFromEuler(activeGroup.rotation),
          tone: new THREE.Color(pal.ink), toon: three.toonMat,
        },
        ...ix.forms.map((f, i) => {
          const { pose } = f
          return {
            shapeId: f.shapeId, solid: buildSolid(f.shapeId, f.params), cut: !!f.cut,
            mat: new THREE.Matrix4().compose(
              new THREE.Vector3(pose.x, pose.y, pose.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.rx * D2R, pose.ry * D2R, pose.rz * D2R, "YXZ")),
              new THREE.Vector3(pose.size, pose.size, pose.size),
            ),
            tone: new THREE.Color(pal.forms[(f.ink ?? i) % pal.forms.length]), toon: three.toonMatIx,
          }
        }),
      ]
      const baked = forms.map(f => f.solid.geometry.clone().applyMatrix4(f.mat))
      const cutters = forms.flatMap((f, i) => f.cut ? [i] : [])
      // each solid with the cutters taken out; null where none reaches it.
      // While a handle is dragged the bites wait for the drop, like seams.
      const carved = forms.map((f, i) =>
        f.cut || interacting || cutters.length === 0 ? null : carve(baked[i], cutters.map(c => baked[c])))
      const insides = new Map<number, (p: THREE.Vector3) => boolean>()
      const insideForm = (i: number) => {
        if (!insides.has(i)) insides.set(i, insideOf(baked[i]))
        return insides.get(i)!
      }
      // what is left of some segments once every cutter but `except` has
      // taken its volume
      const outsideCutters = (segs: number[], except = -1) =>
        cutters.reduce((left, c) => c === except || !left.length ? left : clipSegments(left, insideForm(c), false), segs)
      const pickOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
      three.ixMats.push(pickOnly)

      // Form A keeps its own drawing unless it cuts or is cut
      const aGeneric = forms[0].cut || carved[0] !== null
      forms.forEach((f, i) => {
        if (i === 0 && !aGeneric) return
        const lines = (g: LineSegmentsGeometry, width: number, space: THREE.Object3D, curve = false) => {
          const solidLine = fatLine(g, { width, color: f.tone })
          const ghost = fatLine(g, { width: GHOST_W, ghost: true, dashed: !curve, color: f.tone })
          space.add(curve ? unculled(ghost) : ghost, curve ? unculled(solidLine) : solidLine)
        }
        const group = new THREE.Group()
        group.visible = solo < 0 || solo === i
        ixGroup.add(group)
        const edgeW = isFaceted(f.shapeId) ? EDGE_W : END_W

        if (f.cut) {
          // the cutter: a faint dashed ghost of where it is, still clickable
          group.matrixAutoUpdate = false
          group.matrix.copy(f.mat)
          const hit = new THREE.Mesh(f.solid.geometry, pickOnly)
          hit.userData.pick = i
          group.add(hit)
          if (f.solid.creases.length)
            group.add(fatLine(segGeo(f.solid.creases), { width: 1.2, ghost: true, opacity: 0.5, color: f.tone }))
          if (!isFaceted(f.shapeId))
            group.add(unculled(fatLine(outline(f.solid.geometry, group), { width: 1.2, ghost: true, opacity: 0.5, color: f.tone })))
          return
        }

        const bitten = carved[i]
        if (bitten) {
          // drawn in A's space: the carved shell, the form's own lines where
          // they survive, and the cutters' edges where they now bound it
          if (bitten.attributes.position.count === 0) return
          group.add(maskMesh(bitten, THREE.FrontSide, f.toon, i))
          const kept = outsideCutters(placed(f.solid.creases, f.mat))
          for (const c of cutters)
            kept.push(...outsideCutters(clipSegments(placed(forms[c].solid.creases, forms[c].mat), insideForm(i), true), c))
          if (kept.length) lines(segGeo(kept), edgeW, group)
          lines(outline(bitten, ixGroup), SIL_W, group, true)
          const rings = showContours && !isFaceted(f.shapeId)
            ? outsideCutters(placed(f.solid.contours(uRings), f.mat)) : []
          if (rings.length) {
            const cg = segGeo(rings)
            group.add(fatLine(cg, { width: CONTOUR_W, opacity: 0.5, color: f.tone }))
            if (wrapContours)
              group.add(fatLine(cg, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22, color: f.tone }))
          }
          return
        }

        // whole: drawn with the same line hierarchy as form A
        group.matrixAutoUpdate = false
        group.matrix.copy(f.mat)
        group.add(maskMesh(f.solid.geometry, THREE.FrontSide, f.toon, i))
        if (f.solid.creases.length) lines(segGeo(f.solid.creases), edgeW, group)
        if (!isFaceted(f.shapeId)) {
          lines(outline(f.solid.geometry, group), SIL_W, group, true)
          const rings = showContours ? f.solid.contours(uRings) : []
          if (rings.length) {
            const cg = segGeo(rings)
            group.add(fatLine(cg, { width: CONTOUR_W, opacity: 0.5, color: f.tone }))
            if (wrapContours)
              group.add(fatLine(cg, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22, color: f.tone }))
          }
        }
      })
      activeGroup.visible = solo <= 0 && !aGeneric

      let crossings = 0
      const notes: string[] = []
      for (let i = 0; i < forms.length; i++) for (let j = i + 1; j < forms.length; j++) {
        // alone, a form shows only the marks left on its own surface
        if (solo >= 0 && i !== solo && j !== solo) continue
        // two cutters leave no mark on each other
        if (forms[i].cut && forms[j].cut) continue
        if (interacting) { crossings++; continue }
        const rim = forms[i].cut || forms[j].cut
        const m = meet(baked[i], baked[j], late && !rim)
        if (m.relation === "crossing") crossings++
        else if (rim) {
          const [s, c] = forms[i].cut ? [j, i] : [i, j]
          const swallowed = m.relation === (s === i ? "a-in-b" : "b-in-a")
          if (m.relation !== "apart")
            notes.push(swallowed
              ? `FORM ${LETTERS[c]} CUTS FORM ${LETTERS[s]} AWAY ENTIRELY`
              : `FORM ${LETTERS[c]} CARVES A HOLLOW INSIDE FORM ${LETTERS[s]}`)
        }
        else if (m.relation === "b-in-a") notes.push(`FORM ${LETTERS[j]} SITS WHOLLY INSIDE FORM ${LETTERS[i]}`)
        else if (m.relation === "a-in-b") notes.push(`FORM ${LETTERS[i]} SITS WHOLLY INSIDE FORM ${LETTERS[j]}`)

        // a seam only survives where no other cutter has taken the volume
        const seam = outsideCutters(m.seam, forms[i].cut ? i : forms[j].cut ? j : -1)
        // lines of the overlap view draw after its depth reset, so they
        // join the transparent pass (opacity a shade under 1) late
        if (seam.length) {
          const sg = segGeo(seam)
          if (seamXray || late)
            ixGroup.add(fatLine(sg, { width: 1.3, ghost: true, dashed: false, opacity: 0.4, color: SEAM, order: late ? 11 : 4 }))
          ixGroup.add(fatLine(sg, { width: 3, color: SEAM, opacity: late ? 0.99 : 1, order: late ? 12 : 5 }))
        }

        if (late && m.overlap) {
          const fill = lightOn
            ? new THREE.MeshToonMaterial({
                color: new THREE.Color(pal.seamTone), gradientMap: three.gradientTex, transparent: true,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
              })
            : new THREE.MeshBasicMaterial({
                color: SEAM, transparent: true, opacity: 0.38,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
              })
          three.ixMats.push(fill)
          const solid = new THREE.Mesh(m.overlap, fill)
          solid.renderOrder = 10
          // x-ray: the shared volume shows through the forms, but still
          // hides its own far side
          solid.onBeforeRender = renderer => renderer.clearDepth()
          ixGroup.add(solid)
          ixGroup.add(unculled(fatLine(outline(m.overlap, ixGroup), { width: 2, color: SEAM, opacity: 0.99, order: 12 })))
          // hard edges of either form that survive inside the other
          const kept = [
            ...clipSegments(placed(forms[i].solid.creases, forms[i].mat), m.insideB, true),
            ...clipSegments(placed(forms[j].solid.creases, forms[j].mat), m.insideA, true),
          ]
          if (kept.length)
            ixGroup.add(fatLine(segGeo(kept), { width: 2, color: SEAM, opacity: 0.99, order: 12 }))
        }
      }
      if (crossings === 0 && notes.length === 0) notes.push("FORMS APART — no intersection · bring the forms closer")

      // seat the ground under whichever forms are showing
      if (solo > 0) { groundBottom = Infinity; groundFoot = 0 }
      for (let k = 1; k < forms.length; k++) {
        if (solo >= 0 && solo !== k) continue
        baked[k].computeBoundingBox()
        const box = baked[k].boundingBox!
        groundBottom = Math.min(groundBottom, box.min.y)
        groundFoot   = Math.max(groundFoot,
          Math.hypot(box.min.x, box.min.z), Math.hypot(box.max.x, box.max.z))
      }
      baked.forEach(g => g.dispose())
      // form A's solid is only kept when it is drawn here
      if (!aGeneric) forms[0].solid.geometry.dispose()

      three.ix = {
        label: forms.slice(1).map(f => SHAPE_FULL_LABELS[f.shapeId]).join(" · "),
        note: notes.length ? notes.join(" · ") : null,
      }
    }

    // ── Position the world-locked ground under the form ──────────────
    const { groundGroup, shadowMesh } = three
    groundGroup.visible    = showGround && drill !== "guess"
    groundGroup.position.y = verticalPosition + groundBottom - 0.02
    shadowMesh.scale.set(groundFoot * 2, groundFoot * 2, 1)
    // the soft contact blob yields to the true cast shadow under sunlight
    shadowMesh.visible = !(lightOn && showShadow && drill !== "guess")
    three.groundY = groundGroup.position.y + 0.004

    // ── Multiples: a row of identical copies receding along world Z ──
    // Clones share geometry and materials with the original, so the row
    // is cheap; every copy obeys the same horizon and vanishing points.
    three.copyGroups.forEach(g => three.scene.remove(g))
    three.copyShadows.forEach(s => groundGroup.remove(s))
    three.copyGroups = []
    three.copyShadows = []
    if (copies > 1 && drill !== "guess") {
      const source = isFaceted(shapeId) ? cubeGroup : shapeGroup
      for (let i = 1; i < copies; i++) {
        const g = source.clone()
        g.position.z = -spacing * i
        three.scene.add(g)
        three.copyGroups.push(g)
        const s = shadowMesh.clone()
        s.position.z = -spacing * i
        groundGroup.add(s)
        three.copyShadows.push(s)
      }
    }

    // ── Register shadow casters with their final world transforms ────
    three.casters = []
    for (const group of [activeGroup, ixGroup]) {
      group.updateMatrixWorld(true)
      group.traverse(obj => {
        if (obj.userData.caster && obj.parent!.visible) {
          const m = obj as THREE.Mesh
          three.casters.push({ geo: m.geometry, world: m.matrixWorld.clone() })
        }
      })
    }
    buildCast()
  }, [shapeId, shapeParams, uRings, verticalPosition, rotationDeg.x, rotationDeg.y, rotationDeg.z, activeAxis, showAxes, showGuides, showContours, showGround, wrapContours, dark, copies, spacing, drill, lightOn, shading, showShadow, intersect, seamXray, interacting, buildCast])

  // ── Handles: sit on the selected form, in the mode of the active tool ─
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const { gizmo, proxy } = three
    if (gizmo.dragging) return
    const D2R = Math.PI / 180
    const solo = intersect?.solo ?? null
    const extra = selected ? intersect?.forms[selected - 1] : null
    const hidden =
      selected == null || drill !== "off" || (solo !== null && solo !== selected)
      || (selected > 0 && !extra)
    if (hidden) {
      gizmo.detach()
      three.gizmoTarget = null
      return
    }
    if (selected === 0) {
      proxy.position.set(0, verticalPosition, 0)
      proxy.rotation.set(
        rotationDeg.x * D2R,
        rotationDeg.y * D2R,
        rotationDeg.z * D2R,
      )
      proxy.scale.setScalar(1)
    } else if (extra) {
      const { pose } = extra
      proxy.position.set(pose.x, pose.y + verticalPosition, pose.z)
      proxy.rotation.set(pose.rx * D2R, pose.ry * D2R, pose.rz * D2R)
      proxy.scale.setScalar(pose.size)
    }
    gizmo.setMode(tool === "move" ? "translate" : tool)
    gizmo.setSpace(tool === "move" ? "world" : "local")
    // form A is the anchor of the plate: it only rises and falls
    const anchor = selected === 0 && tool === "move"
    gizmo.showX = !anchor
    gizmo.showZ = !anchor
    three.gizmoTarget = selected
    gizmo.attach(proxy)
  }, [selected, tool, intersect, verticalPosition, rotationDeg.x, rotationDeg.y, rotationDeg.z, shapeId, drill, interacting])

  // ── Sun position: the shaded surfaces respond live; cast shadows
  // re-flatten along the new light ─────────────────────────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const [lx, ly, lz] = lightDirection(lightAz, lightEl)
    three.dirLight.position.set(lx * 10, ly * 10, lz * 10)
    three.dirLight.visible = lightOn
    buildCast()
  }, [lightOn, lightAz, lightEl, showShadow, buildCast])

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full"
      style={{
        backgroundColor: PLATE_PALETTES[dark ? "dark" : "light"].paper,
        backgroundImage: [
          `radial-gradient(ellipse 90% 70% at 50% 42%, ${PLATE_PALETTES[dark ? "dark" : "light"].vignette}, transparent 75%)`,
          `radial-gradient(${PLATE_PALETTES[dark ? "dark" : "light"].dot} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: "100% 100%, 24px 24px",
      }}
    >
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 10 }}
      />
    </div>
  )
}
