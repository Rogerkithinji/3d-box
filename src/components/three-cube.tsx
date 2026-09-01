"use client"

import { useCallback, useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { ALL_SHAPE_IDS, SHAPE_FULL_LABELS, getParametricShape, type ShapeId, type ShapeParams } from "@/lib/shapes"

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
}

export type DrillPhase = "off" | "guess" | "reveal"

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
  },
  dark: {
    ink: "#8f8fe8", red: "#e08063", redFaint: "rgba(224,128,99,0.18)", orange: "#f0954f",
    wash: "rgba(21,22,31,0.72)", washTitle: "rgba(21,22,31,0.66)",
    coneWash: "rgba(224,128,99,0.05)", capTint: "#2c3161",
    gridInk: "#585ba8", gridPaper: "#15161f", shadowRGB: "0, 0, 0", shadowA: 0.45,
    paper: "#15161f", dot: "#2e3048", vignette: "rgba(70,74,110,0.25)",
  },
}

// Sausage spine: a planar cubic bend swept around the Y axis by the coil
// angle — the bend supplies the coil's radius, the coil wraps it into a
// helix. coil = 0 reduces to the flat C/S-curve.
class SpineCurve extends THREE.Curve<THREE.Vector3> {
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

const GRID_EXT = 6.4, GRID_STEP = 0.4, GRID_SUB = 8
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
    cylSilhouetteGeo:   LineSegmentsGeometry | null
    cylRadius:          number
    cylHeight:          number
    tubeSilhouetteGeo:  LineSegmentsGeometry | null
    tubeRadii:          number[]
    tubeFrameNormals:   THREE.Vector3[]
    tubeFrameBinormals: THREE.Vector3[]
    tubeFramePoints:    THREE.Vector3[]
    tubeRings:          { mat: LineMaterial; center: THREE.Vector3; outward: THREE.Vector3; isEnd: boolean }[]
    tubeBalls:          { geo: LineSegmentsGeometry; center: THREE.Vector3; radius: number }[]
    latheSilhouetteGeo:  LineSegmentsGeometry | null
    latheProfile:        { r: number; y: number }[]
    sphereSilhouetteGeo: LineSegmentsGeometry | null
    sphereRadius:        number
    groundGroup:         THREE.Group
    shadowMesh:          THREE.Mesh
    gridGeo:             THREE.BufferGeometry
    fatMats:             LineMaterial[]
    copyGroups:          THREE.Group[]
    copyShadows:         THREE.Mesh[]
  } | null>(null)

  // Latest prop values for the animation loop to read each frame
  const liveRef = useRef({ verticalPosition, rotationDeg, activeAxis, showAxes, shapeId, shapeParams, showGuides, showTopView, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill, facingTint })
  useEffect(() => { liveRef.current = { verticalPosition, rotationDeg, activeAxis, showAxes, shapeId, shapeParams, showGuides, showTopView, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill, facingTint } })

  // ── 2D overlay ────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (vertPos: number, guides: boolean, axes: boolean, sid: ShapeId, hw: number, hh: number, hd: number,
     rotDeg: { x: number; y: number; z: number }, liveAxis: "x" | "y" | "z" | null,
     topView: boolean, sp: ShapeParams,
     degrees: boolean, contours: boolean, ringsN: number, cone: boolean, dk: boolean,
     nCopies: number, gap: number, orthoOn: boolean, drillPhase: DrillPhase) => {
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
      // Z axis, so each slider rotates around the axis line drawn on the form
      const eul  = sid === "cube"
        ? new THREE.Euler(rotDeg.x * D2R, rotDeg.y * D2R, rotDeg.z * D2R, "YXZ")
        : new THREE.Euler(0, 0, 0, "YXZ")
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
        sid === "cube" &&
        (y0 === null || yW === null || Math.abs(y0 - hy) > 2.5 || Math.abs(yW - hy) > 2.5)

      // eye level — fades back a little when the form horizon departs from it
      ctx.strokeStyle = RED; ctx.lineWidth = 1; ctx.globalAlpha = horizonTilted ? 0.3 : 0.55
      ctx.setLineDash([6, 6])
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1
      if (hy > 14 && hy < H - 22) {
        ctx.fillStyle = RED; ctx.font = "11px monospace"; ctx.globalAlpha = horizonTilted ? 0.5 : 0.8
        ctx.fillText("EYE LEVEL", 36, hy + 16)
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

      // ── construction lines (cube only) ───────────────────────────
      if (guidesOn && sid === "cube") {
        const corners: [number, number, number][] = [
          [-hw, -hh, -hd], [hw, -hh, -hd], [hw,  hh, -hd], [-hw,  hh, -hd],
          [-hw, -hh,  hd], [hw, -hh,  hd], [hw,  hh,  hd], [-hw,  hh,  hd],
        ]
        const screenCorners = corners.map(([x, y, z]) => {
          const p = new THREE.Vector3(x, y, z).applyEuler(eul)
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

      // ── axis letters at the form-axis tips (cube only) ───────────
      // The axis a slider is currently rotating around lights up in red;
      // with SHOW AXES off, only that active axis appears while rotating.
      if (sid === "cube" && !inGuess && (axes || liveAxis)) {
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
      if (degrees && !inGuess && sid !== "cube" && sid !== "tube") {
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
        const dh  = Math.hypot(camera.position.x, camera.position.z) || 1e-4
        const rhx = camera.position.z / dh, rhz = -camera.position.x / dh
        const labels = rings.map(({ y, r }) => {
          const cy = y + vertPos
          const v = new THREE.Vector3(
            -camera.position.x, cy - camera.position.y, -camera.position.z,
          ).normalize()
          const deg = Math.round(Math.asin(Math.min(1, Math.abs(v.y))) * 180 / Math.PI)
          const [lx, ly] = toScreen(rhx * r, cy, rhz * r)
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
        const famDirs = sid === "cube"
          ? [new THREE.Vector3(1, 0, 0).applyEuler(eul), new THREE.Vector3(0, 0, 1).applyEuler(eul)]
          : [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]
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
          if (sid === "cube") {
            for (const sy of [-1, 1]) {
              ctx.beginPath()
              for (let i = 0; i <= 4; i++) {
                const sx = [1, 1, -1, -1][i % 4], sz = [1, -1, -1, 1][i % 4]
                const c = new THREE.Vector3(sx * hw, sy * hh, sz * hd).applyEuler(eul)
                const [px, py] = P(c.x, c.z + wz)
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
              }
              ctx.stroke()
            }
          } else {
            const fr =
              sid === "cylinder" ? (sp.radius ?? 0.5)
              : sid === "sphere"  ? (sp.radius ?? 0.8)
              : sid === "capsule" ? (sp.radius ?? 0.45)
              : sid === "cone"    ? Math.max(sp.baseRadius ?? 0.65, sp.topRadius ?? 0)
              : sid === "egg"     ? (sp.radius ?? 0.5)
              : (sp.radius ?? 0.2) + Math.max(Math.abs(sp.bendA ?? 0.7), Math.abs(sp.bendB ?? 0.7)) * 0.5
            const [ccx2, ccy2] = P(0, wz)
            ctx.beginPath(); ctx.arc(ccx2, ccy2, fr * s, 0, Math.PI * 2); ctx.stroke()
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

    threeRef.current = {
      renderer, scene, camera, controls,
      cubeGroup, shapeGroup, groundGroup, shadowMesh, gridGeo,
      cylSilhouetteGeo: null, cylRadius: 0.5, cylHeight: 1.5,
      tubeSilhouetteGeo: null, tubeRadii: [],
      tubeFrameNormals: [], tubeFrameBinormals: [], tubeFramePoints: [], tubeRings: [], tubeBalls: [],
      latheSilhouetteGeo: null, latheProfile: [],
      sphereSilhouetteGeo: null, sphereRadius: 0.8,
      fatMats: [], copyGroups: [], copyShadows: [],
    }

    // Continuous animation loop — OrbitControls needs this to interpolate damping
    let animId = 0
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()

      const three = threeRef.current
      if (!three) return

      // Recompute cylinder silhouette lines from the live camera angle
      if (three.cylSilhouetteGeo) {
        const { cylSilhouetteGeo, cylRadius, cylHeight } = three
        const phi  = Math.atan2(camera.position.x, camera.position.z)
        const VSEGS = 32
        const pos: number[] = []
        for (const a of [phi, Math.PI + phi]) {
          const sx = cylRadius * Math.cos(a)
          const sz = cylRadius * Math.sin(a)
          for (let i = 0; i < VSEGS; i++) {
            const y1 = -cylHeight / 2 + cylHeight * i / VSEGS
            const y2 = -cylHeight / 2 + cylHeight * (i + 1) / VSEGS
            pos.push(sx, y1, sz, sx, y2, sz)
          }
        }
        cylSilhouetteGeo.setPositions(pos)
      }

      // Recompute tube silhouette from Frenet frames each frame
      if (three.tubeSilhouetteGeo && three.tubeFramePoints.length > 0) {
        const { tubeSilhouetteGeo, tubeFrameNormals, tubeFrameBinormals, tubeFramePoints, tubeRadii } = three
        const TSEGS = tubeFramePoints.length - 1
        const camDir = new THREE.Vector3()
          .subVectors(camera.position, controls.target)
          .normalize()
        const pos: number[] = []
        for (let side = 0; side < 2; side++) {
          for (let i = 0; i < TSEGS; i++) {
            for (const ti of [i, i + 1]) {
              const N = tubeFrameNormals[ti]
              const B = tubeFrameBinormals[ti]
              const P = tubeFramePoints[ti]
              const r = tubeRadii[ti]
              const dn = N.dot(camDir)
              const db = B.dot(camDir)
              const a  = Math.atan2(-dn, db) + (side === 1 ? Math.PI : 0)
              const ca = Math.cos(a), sa = Math.sin(a)
              pos.push(
                P.x + ca * r * N.x + sa * r * B.x,
                P.y + ca * r * N.y + sa * r * B.y,
                P.z + ca * r * N.z + sa * r * B.z,
              )
            }
          }
        }
        tubeSilhouetteGeo.setPositions(pos)
      }

      // Recolor tube rings by facing: a ring whose +tangent side points at
      // the camera opens toward you (accent); the rest open away (ink). The
      // colour flip travels along the spine as the tube bends past your
      // sight line — exactly the read the contour drill trains.
      if (three.tubeRings.length > 0) {
        const live = liveRef.current
        const pal  = PLATE_PALETTES[live.dark ? "dark" : "light"]
        const toCam = new THREE.Vector3()
        for (const ring of three.tubeRings) {
          toCam.set(
            camera.position.x - ring.center.x,
            camera.position.y - (ring.center.y + live.verticalPosition),
            camera.position.z - ring.center.z,
          )
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
        const vp = liveRef.current.verticalPosition
        const camDir = new THREE.Vector3()
        const right  = new THREE.Vector3()
        const up     = new THREE.Vector3()
        const BSEGS  = 48
        for (const ball of three.tubeBalls) {
          camDir.set(
            camera.position.x - ball.center.x,
            camera.position.y - (ball.center.y + vp),
            camera.position.z - ball.center.z,
          ).normalize()
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

      // Recompute lathe (surface of revolution) silhouette from camera azimuth
      if (three.latheSilhouetteGeo && three.latheProfile.length > 0) {
        const phi     = Math.atan2(camera.position.x, camera.position.z)
        const profile = three.latheProfile
        const pos: number[] = []
        for (const a of [phi, Math.PI + phi]) {
          const cx = Math.cos(a), cz = Math.sin(a)
          for (let i = 0; i < profile.length - 1; i++) {
            const { r: r1, y: y1 } = profile[i]
            const { r: r2, y: y2 } = profile[i + 1]
            pos.push(r1 * cx, y1, r1 * cz, r2 * cx, y2, r2 * cz)
          }
        }
        three.latheSilhouetteGeo.setPositions(pos)
      }

      // Recompute sphere silhouette — great circle perpendicular to camera direction
      if (three.sphereSilhouetteGeo) {
        const { sphereSilhouetteGeo, sphereRadius: r } = three
        const vertPos = liveRef.current.verticalPosition
        const SSEGS   = 64
        const camDir  = new THREE.Vector3()
          .subVectors(camera.position, new THREE.Vector3(0, vertPos, 0))
          .normalize()
        const worldUp = Math.abs(camDir.y) < 0.99
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0)
        const right = new THREE.Vector3().crossVectors(worldUp, camDir).normalize()
        const up    = new THREE.Vector3().crossVectors(camDir, right)
        const pos: number[] = []
        for (let i = 0; i < SSEGS; i++) {
          const a1 = 2 * Math.PI * i / SSEGS
          const a2 = 2 * Math.PI * (i + 1) / SSEGS
          pos.push(
            r * Math.cos(a1) * right.x + r * Math.sin(a1) * up.x,
            r * Math.cos(a1) * right.y + r * Math.sin(a1) * up.y,
            r * Math.cos(a1) * right.z + r * Math.sin(a1) * up.z,
            r * Math.cos(a2) * right.x + r * Math.sin(a2) * up.x,
            r * Math.cos(a2) * right.y + r * Math.sin(a2) * up.y,
            r * Math.cos(a2) * right.z + r * Math.sin(a2) * up.z,
          )
        }
        sphereSilhouetteGeo.setPositions(pos)
      }

      renderer.render(scene, camera)

      const { verticalPosition, rotationDeg, activeAxis, showAxes, showGuides, shapeId, shapeParams, showTopView, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill } = liveRef.current
      const hw = (shapeParams.width  ?? HALF * 2) / 2
      const hh = (shapeParams.height ?? HALF * 2) / 2
      const hd = (shapeParams.depth  ?? HALF * 2) / 2
      drawOverlay(verticalPosition, showGuides, showAxes, shapeId, hw, hh, hd, rotationDeg, activeAxis, showTopView, shapeParams, showDegrees, showContours, uRings, showCone, dark, copies, spacing, ortho, drill)
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

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      threeRef.current = null
    }
  }, [drawOverlay])

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
  }, [focalLength])

  // ── Turntable: slow auto-orbit — watch the VPs slide along the horizon ──
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    three.controls.autoRotate = turntable
    three.controls.autoRotateSpeed = 0.8
  }, [turntable])

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
  }, [zoomAction])

  // ── Reset: camera face-on to the form, at eye level ──────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three || resetCount === 0) return
    three.camera.position.set(...FACE_CAM)
    three.controls.target.set(0, 0, 0)
    three.controls.update()
  }, [resetCount])

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
    for (const group of [cubeGroup, shapeGroup]) {
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
      opts: { width: number; opacity?: number; ghost?: boolean; dashed?: boolean },
    ) => {
      const { width, ghost = false, dashed = ghost } = opts
      const opacity = opts.opacity ?? (ghost ? 0.16 : 1)
      const m = new LineMaterial({
        color: INK_THREE.getHex(),
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
      line.renderOrder = ghost ? 2 : 3
      return line
    }
    const SIL_W = 2.2, EDGE_W = 2, END_W = 1.7, CONTOUR_W = 1, GHOST_W = 0.9

    if (shapeId === "cube") {
      shapeGroup.visible      = false
      three.cylSilhouetteGeo  = null
      three.tubeSilhouetteGeo = null
      three.tubeFramePoints   = []
      three.latheSilhouetteGeo  = null
      three.latheProfile        = []
      three.sphereSilhouetteGeo = null

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

      const geo   = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2)
      const edges = new THREE.EdgesGeometry(geo)

      const depthMesh = new THREE.Mesh(geo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }))
      depthMesh.renderOrder = 0

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

      cubeGroup.add(depthMesh, frontShade, cubeGhost, cubeSolid)

      // Local X/Y/Z axis lines through the form's centre — they rotate with
      // the cube so the active rotation axis is easy to spot. The axis whose
      // slider is in use draws solid red; with SHOW AXES off, only that
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

      // Ground sits under the lowest rotated corner — a tilted cube rests on it
      let minCornerY = Infinity
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(sx * hw, sy * hh, sz * hd).applyEuler(cubeGroup.rotation)
        if (p.y < minCornerY) minCornerY = p.y
      }
      groundBottom = minCornerY
      groundFoot   = Math.hypot(hw, hd) * 1.3

    } else if (shapeId === "tube") {
      cubeGroup.visible        = false
      shapeGroup.visible       = true
      three.cylSilhouetteGeo    = null
      three.latheSilhouetteGeo  = null
      three.latheProfile        = []
      three.sphereSilhouetteGeo = null

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

      // Precompute Frenet frames — stored for per-frame silhouette recomputation
      const frenetFrames = path.computeFrenetFrames(TSEGS, false)
      const framePoints: THREE.Vector3[] = []
      const radii: number[] = []
      for (let i = 0; i <= TSEGS; i++) {
        framePoints.push(path.getPointAt(i / TSEGS))
        radii.push(rAt(i / TSEGS))
      }
      three.tubeFrameNormals   = frenetFrames.normals
      three.tubeFrameBinormals = frenetFrames.binormals
      three.tubeFramePoints    = framePoints
      three.tubeRadii          = radii

      // Depth mask — hand-built tube so the radius can vary along the spine
      const maskPos: number[] = []
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
      tubeGeo.setIndex(maskIdx)
      const depthMesh = new THREE.Mesh(tubeGeo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }))
      depthMesh.renderOrder = 0

      // Ball ends — a hemispherical depth mask closes each end, and a
      // billboarded tip circle (the ball's silhouette, always a perfect
      // circle from any angle) shows how the tip sits in space.
      const capMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
      const mkBall = (i: number, outward: THREE.Vector3) => {
        const r = radii[i]
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), capMat)
        dome.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward)
        dome.position.copy(framePoints[i])
        dome.renderOrder = 0
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

      // Silhouette placeholder (2 sides × TSEGS segs × 2 pts × 3 floats)
      const silhouetteGeo = segGeo(new Float32Array(2 * TSEGS * 2 * 3))
      const silSolid  = fatLine(silhouetteGeo, { width: SIL_W })
      const silGhost  = fatLine(silhouetteGeo, { width: GHOST_W, ghost: true, dashed: false })
      shapeGroup.add(silGhost, silSolid)
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

      three.tubeSilhouetteGeo = silhouetteGeo

    } else if (shapeId === "cylinder") {
      cubeGroup.visible        = false
      shapeGroup.visible       = true
      three.tubeSilhouetteGeo   = null
      three.tubeFramePoints     = []
      three.latheSilhouetteGeo  = null
      three.latheProfile        = []
      three.sphereSilhouetteGeo = null

      const radius = shapeParams.radius ?? 0.5
      const height = shapeParams.height ?? 1.5
      const SEGS   = 64

      // Depth mask: closed cylinder seals the depth buffer including caps
      const maskGeo = new THREE.CylinderGeometry(radius, radius, height, SEGS, 1, false)
      const depthMask = new THREE.Mesh(maskGeo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }))
      depthMask.renderOrder = 0

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

      // Silhouette geometry — placeholder updated every frame by the animation loop
      const silhouetteGeo = segGeo(new Float32Array(32 * 2 * 2 * 3))

      const endGeo    = segGeo(endPos)
      const ringSolid = fatLine(endGeo, { width: END_W, opacity: 0.95 })
      const ringGhost = fatLine(endGeo, { width: GHOST_W, ghost: true })
      const silSolid  = fatLine(silhouetteGeo, { width: SIL_W })
      const silGhost  = fatLine(silhouetteGeo, { width: GHOST_W, ghost: true, dashed: false })

      shapeGroup.add(depthMask, topCap, bottomCap, ringGhost, ringSolid, silGhost, silSolid)
      if (contourPos.length) {
        const contourGeo = segGeo(contourPos)
        shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, opacity: 0.5 }))
        if (wrapContours)
          shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22 }))
      }
      shapeGroup.position.y = verticalPosition

      three.cylSilhouetteGeo = silhouetteGeo
      three.cylRadius        = radius
      three.cylHeight        = height
      groundBottom = -height / 2
      groundFoot   = radius * 1.6

    } else if (shapeId === "sphere") {
      cubeGroup.visible         = false
      shapeGroup.visible        = true
      three.cylSilhouetteGeo    = null
      three.tubeSilhouetteGeo   = null
      three.tubeFramePoints     = []
      three.latheSilhouetteGeo  = null
      three.latheProfile        = []

      const radius = shapeParams.radius ?? 0.8
      const SEGS   = 64

      const sphereGeo = new THREE.SphereGeometry(radius, SEGS, SEGS)
      const depthMesh = new THREE.Mesh(sphereGeo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }))
      depthMesh.renderOrder = 0

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
      // Silhouette great circle placeholder — SEGS segments × 2 pts × 3 floats
      const silhouetteGeo = segGeo(new Float32Array(SEGS * 2 * 3))

      const silSolid = fatLine(silhouetteGeo, { width: SIL_W })
      const silGhost = fatLine(silhouetteGeo, { width: GHOST_W, ghost: true, dashed: false })

      shapeGroup.add(depthMesh, silGhost, silSolid)
      if (ringPos.length) {
        const contourGeo = segGeo(ringPos)
        shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, opacity: 0.5 }))
        if (wrapContours)
          shapeGroup.add(fatLine(contourGeo, { width: CONTOUR_W, ghost: true, dashed: false, opacity: 0.22 }))
      }
      shapeGroup.position.y = verticalPosition

      three.sphereSilhouetteGeo = silhouetteGeo
      three.sphereRadius        = radius
      groundBottom = -radius
      groundFoot   = radius * 1.6

    } else {
      // Capsule, cone, egg — generic surface-of-revolution renderer
      cubeGroup.visible         = false
      shapeGroup.visible        = true
      three.cylSilhouetteGeo    = null
      three.tubeSilhouetteGeo   = null
      three.tubeFramePoints     = []
      three.sphereSilhouetteGeo = null

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
      const depthMesh   = new THREE.Mesh(latheGeo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }))
      depthMesh.renderOrder = 0
      shapeGroup.add(depthMesh)

      // Flat cap meshes wherever the profile end is open (r > 0)
      const capMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide })
      const r0 = profile[0].r,          y0 = profile[0].y
      const rN = profile[USAMPLES].r,   yN = profile[USAMPLES].y
      if (r0 > 0.001) {
        const cap = new THREE.Mesh(new THREE.CircleGeometry(r0, RSEGS), capMat)
        cap.rotation.x = Math.PI / 2; cap.position.y = y0; cap.renderOrder = 0
        shapeGroup.add(cap)
      }
      if (rN > 0.001) {
        const cap = new THREE.Mesh(new THREE.CircleGeometry(rN, RSEGS), capMat)
        cap.rotation.x = -Math.PI / 2; cap.position.y = yN; cap.renderOrder = 0
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

      // Silhouette placeholder — 2 sides × USAMPLES segments × 2 pts × 3 floats
      const silhouetteGeo = segGeo(new Float32Array(2 * USAMPLES * 2 * 3))

      const silSolid = fatLine(silhouetteGeo, { width: SIL_W })
      const silGhost = fatLine(silhouetteGeo, { width: GHOST_W, ghost: true, dashed: false })

      shapeGroup.add(silGhost, silSolid)
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

      three.latheSilhouetteGeo = silhouetteGeo
      three.latheProfile        = profile
      groundBottom = Math.min(...profile.map(p => p.y))
      groundFoot   = Math.max(...profile.map(p => p.r)) * 1.6
    }

    // ── Position the world-locked ground under the form ──────────────
    const { groundGroup, shadowMesh } = three
    groundGroup.visible    = showGround && drill !== "guess"
    groundGroup.position.y = verticalPosition + groundBottom - 0.02
    shadowMesh.scale.set(groundFoot * 2, groundFoot * 2, 1)

    // ── Multiples: a row of identical copies receding along world Z ──
    // Clones share geometry and materials with the original, so the row
    // is cheap; every copy obeys the same horizon and vanishing points.
    three.copyGroups.forEach(g => three.scene.remove(g))
    three.copyShadows.forEach(s => groundGroup.remove(s))
    three.copyGroups = []
    three.copyShadows = []
    if (copies > 1 && drill !== "guess") {
      const source = shapeId === "cube" ? cubeGroup : shapeGroup
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
  }, [shapeId, shapeParams, uRings, verticalPosition, rotationDeg.x, rotationDeg.y, rotationDeg.z, activeAxis, showAxes, showGuides, showContours, showGround, wrapContours, dark, copies, spacing, drill])

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
