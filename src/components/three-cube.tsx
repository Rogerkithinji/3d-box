"use client"

import { useCallback, useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
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
}

const INK       = "#5B5BD6"
const INK_THREE = new THREE.Color(INK)
const RED       = "#C4553B"      // sanguine — perspective apparatus (horizon, VPs, guides)
const RED_FAINT = "rgba(196,85,59,0.16)"
const ORANGE       = "#C4651C"   // interactive accent (deep) — the axis being rotated right now
const ORANGE_THREE = new THREE.Color(ORANGE)
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
  verticalPosition, rotationDeg, activeAxis, showAxes, showGuides, showContours, resetCount, zoomAction, focalLength, showGround, showTopView,
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
    cylSilhouetteGeo:   THREE.BufferGeometry | null
    cylRadius:          number
    cylHeight:          number
    tubeSilhouetteGeo:  THREE.BufferGeometry | null
    tubeRadius:         number
    tubeFrameNormals:   THREE.Vector3[]
    tubeFrameBinormals: THREE.Vector3[]
    tubeFramePoints:    THREE.Vector3[]
    latheSilhouetteGeo:  THREE.BufferGeometry | null
    latheProfile:        { r: number; y: number }[]
    sphereSilhouetteGeo: THREE.BufferGeometry | null
    sphereRadius:        number
    groundGroup:         THREE.Group
    shadowMesh:          THREE.Mesh
  } | null>(null)

  // Latest prop values for the animation loop to read each frame
  const liveRef = useRef({ verticalPosition, rotationDeg, activeAxis, showAxes, shapeId, shapeParams, showGuides, showTopView })
  useEffect(() => { liveRef.current = { verticalPosition, rotationDeg, activeAxis, showAxes, shapeId, shapeParams, showGuides, showTopView } })

  // ── 2D overlay ────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (vertPos: number, guides: boolean, axes: boolean, sid: ShapeId, hw: number, hh: number, hd: number,
     rotDeg: { x: number; y: number; z: number }, liveAxis: "x" | "y" | "z" | null,
     topView: boolean, sp: ShapeParams) => {
      const overlay = overlayRef.current
      const three   = threeRef.current
      if (!overlay || !three) return

      const { camera } = three
      const W   = overlay.clientWidth
      const H   = overlay.clientHeight
      const dpr = window.devicePixelRatio || 1
      overlay.width  = W * dpr
      overlay.height = H * dpr
      const ctx = overlay.getContext("2d")!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

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
      if (guides && sid === "cube") {
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
      if (sid === "cube" && (axes || liveAxis)) {
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

      // ── top view inset: the textbook VP construction, live ───────
      // Seen from above, oriented view-up: the station point (SP, your
      // eye) sits below the form; the picture plane (PP) runs through
      // the form perpendicular to your gaze; rays from SP parallel to
      // the form's edges pierce the PP exactly at the vanishing points.
      if (topView) {
        const IW = 190, IH = 190
        const ix0 = 24, iy0 = H - 24 - IH
        ctx.fillStyle = "rgba(255,255,255,0.6)"
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

        // form footprint
        ctx.strokeStyle = INK; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.1
        if (sid === "cube") {
          for (const sy of [-1, 1]) {
            ctx.beginPath()
            for (let i = 0; i <= 4; i++) {
              const sx = [1, 1, -1, -1][i % 4], sz = [1, -1, -1, 1][i % 4]
              const c = new THREE.Vector3(sx * hw, sy * hh, sz * hd).applyEuler(eul)
              const [px, py] = P(c.x, c.z)
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
            : (sp.radius ?? 0.15) + Math.abs(sp.bend ?? 0.7) * 0.5
          ctx.beginPath(); ctx.arc(ox, oy, fr * s, 0, Math.PI * 2); ctx.stroke()
        }

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
        ["LENS", `${lensMm}mm ${lensKind}`, INK],
        ["PROJ", `${nVPs}-PT PERSPECTIVE`, INK],
        ["VIEW", posLabel, RED],
      ]
      const tbW = 200, tbRow = 22, tbH = tbRow * rows.length
      const tbX = W - 24 - tbW, tbY = H - 24 - tbH
      ctx.font = "11px monospace"
      ctx.fillStyle = "rgba(255,255,255,0.55)"
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
    const GRID_EXT = 3.2, GRID_STEP = 0.4, GRID_SUB = 8
    const gridInk   = new THREE.Color("#7d7dd6")
    const gridPaper = new THREE.Color("#eef0f7")
    const gPos: number[] = []
    const gCol: number[] = []
    const pushVert = (x: number, z: number, main: boolean) => {
      gPos.push(x, 0, z)
      const t = Math.min(1, Math.hypot(x, z) / (GRID_EXT * 1.05))
      const c = gridPaper.clone().lerp(gridInk, (1 - t * t) * (main ? 0.55 : 0.3))
      gCol.push(c.r, c.g, c.b)
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
      cubeGroup, shapeGroup, groundGroup, shadowMesh,
      cylSilhouetteGeo: null, cylRadius: 0.5, cylHeight: 1.5,
      tubeSilhouetteGeo: null, tubeRadius: 0.15,
      tubeFrameNormals: [], tubeFrameBinormals: [], tubeFramePoints: [],
      latheSilhouetteGeo: null, latheProfile: [],
      sphereSilhouetteGeo: null, sphereRadius: 0.8,
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
        cylSilhouetteGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
      }

      // Recompute tube silhouette from Frenet frames each frame
      if (three.tubeSilhouetteGeo && three.tubeFramePoints.length > 0) {
        const { tubeSilhouetteGeo, tubeFrameNormals, tubeFrameBinormals, tubeFramePoints, tubeRadius } = three
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
              const dn = N.dot(camDir)
              const db = B.dot(camDir)
              const a  = Math.atan2(-dn, db) + (side === 1 ? Math.PI : 0)
              const ca = Math.cos(a), sa = Math.sin(a)
              pos.push(
                P.x + ca * tubeRadius * N.x + sa * tubeRadius * B.x,
                P.y + ca * tubeRadius * N.y + sa * tubeRadius * B.y,
                P.z + ca * tubeRadius * N.z + sa * tubeRadius * B.z,
              )
            }
          }
        }
        tubeSilhouetteGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
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
        three.latheSilhouetteGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
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
        sphereSilhouetteGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
      }

      renderer.render(scene, camera)

      const { verticalPosition, rotationDeg, activeAxis, showAxes, showGuides, shapeId, shapeParams, showTopView } = liveRef.current
      const hw = (shapeParams.width  ?? HALF * 2) / 2
      const hh = (shapeParams.height ?? HALF * 2) / 2
      const hd = (shapeParams.depth  ?? HALF * 2) / 2
      drawOverlay(verticalPosition, showGuides, showAxes, shapeId, hw, hh, hd, rotationDeg, activeAxis, showTopView, shapeParams)
    }
    animate()

    const onResize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
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

      const geo   = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2)
      const edges = new THREE.EdgesGeometry(geo)

      const depthMesh = new THREE.Mesh(geo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }))
      depthMesh.renderOrder = 0

      const frontShade = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2, hh * 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color("#c8d5ff"), transparent: true, opacity: 0.3,
          side: THREE.FrontSide, depthWrite: false,
          // coplanar with the depth mask's front face — offset wins the tie
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }),
      )
      frontShade.position.z = hd
      frontShade.renderOrder = 1

      const cubeGhost = new THREE.LineSegments(edges,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      cubeGhost.renderOrder = 2

      const cubeSolid = new THREE.LineSegments(edges,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      cubeSolid.renderOrder = 3

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

      const radius = shapeParams.radius ?? 0.15
      const length = shapeParams.length ?? 2.0
      const bend   = shapeParams.bend   ?? 0.7

      const TSEGS = 32
      const RSEGS = 48

      const path = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, -length / 2, 0),
        new THREE.Vector3(bend, 0, 0),
        new THREE.Vector3(0,  length / 2, 0),
      )

      // Precompute Frenet frames — stored for per-frame silhouette recomputation
      const frenetFrames = path.computeFrenetFrames(TSEGS, false)
      const framePoints: THREE.Vector3[] = []
      for (let i = 0; i <= TSEGS; i++) framePoints.push(path.getPointAt(i / TSEGS))
      three.tubeFrameNormals   = frenetFrames.normals
      three.tubeFrameBinormals = frenetFrames.binormals
      three.tubeFramePoints    = framePoints
      three.tubeRadius         = radius

      // Depth mask (open tube body)
      const tubeGeo = new THREE.TubeGeometry(path, TSEGS, radius, RSEGS, false)
      const depthMesh = new THREE.Mesh(tubeGeo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }))
      depthMesh.renderOrder = 0

      // End cap depth masks oriented to the path tangent at each end
      const capGeo = new THREE.CircleGeometry(radius, RSEGS)
      const capMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide })
      const cap0 = new THREE.Mesh(capGeo, capMat)
      cap0.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), frenetFrames.tangents[0].clone().negate(),
      )
      cap0.position.copy(framePoints[0])
      cap0.renderOrder = 0
      const cap1 = new THREE.Mesh(capGeo, capMat)
      cap1.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), frenetFrames.tangents[TSEGS].clone(),
      )
      cap1.position.copy(framePoints[TSEGS])
      cap1.renderOrder = 0

      // Ring geometry — end rings + optional contour rings along the path
      const ringPos: number[] = []
      const addRing = (t: number) => {
        const fi  = Math.min(Math.floor(t * TSEGS), TSEGS - 1)
        const ff  = t * TSEGS - fi
        const fi2 = Math.min(fi + 1, TSEGS)
        const P   = path.getPointAt(Math.min(t, 1))
        const N   = frenetFrames.normals[fi].clone().lerp(frenetFrames.normals[fi2], ff).normalize()
        const B   = frenetFrames.binormals[fi].clone().lerp(frenetFrames.binormals[fi2], ff).normalize()
        for (let i = 0; i < RSEGS; i++) {
          const a1 = 2 * Math.PI * i / RSEGS
          const a2 = 2 * Math.PI * (i + 1) / RSEGS
          ringPos.push(
            P.x + radius * Math.cos(a1) * N.x + radius * Math.sin(a1) * B.x,
            P.y + radius * Math.cos(a1) * N.y + radius * Math.sin(a1) * B.y,
            P.z + radius * Math.cos(a1) * N.z + radius * Math.sin(a1) * B.z,
            P.x + radius * Math.cos(a2) * N.x + radius * Math.sin(a2) * B.x,
            P.y + radius * Math.cos(a2) * N.y + radius * Math.sin(a2) * B.y,
            P.z + radius * Math.cos(a2) * N.z + radius * Math.sin(a2) * B.z,
          )
        }
      }
      addRing(0); addRing(1)
      if (showContours) {
        for (let i = 1; i <= uRings; i++) addRing(i / (uRings + 1))
      }
      const ringGeo = new THREE.BufferGeometry()
      ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ringPos, 3))

      // Silhouette placeholder (2 sides × TSEGS segs × 2 pts × 3 floats)
      const silhouetteGeo = new THREE.BufferGeometry()
      silhouetteGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(2 * TSEGS * 2 * 3), 3),
      )

      const ringGhost = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      ringGhost.renderOrder = 2
      const ringSolid = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      ringSolid.renderOrder = 3

      const silGhost = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      silGhost.renderOrder = 2
      const silSolid = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      silSolid.renderOrder = 3

      shapeGroup.add(depthMesh, cap0, cap1, ringGhost, ringSolid, silGhost, silSolid)
      shapeGroup.position.y = verticalPosition

      groundBottom = -length / 2 - radius
      groundFoot   = radius + Math.abs(bend) * 0.6 + 0.25

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
        color: new THREE.Color("#c8d5ff"), transparent: true, opacity: 0.3,
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
      const ringPos: number[] = []
      const addRing = (y: number) => {
        for (let i = 0; i < SEGS; i++) {
          const a1 = 2 * Math.PI * i / SEGS
          const a2 = 2 * Math.PI * (i + 1) / SEGS
          ringPos.push(
            radius * Math.cos(a1), y, radius * Math.sin(a1),
            radius * Math.cos(a2), y, radius * Math.sin(a2),
          )
        }
      }
      addRing( height / 2)
      addRing(-height / 2)
      if (showContours) {
        for (let i = 1; i <= uRings; i++)
          addRing(-height / 2 + height * i / (uRings + 1))
      }
      const ringGeo = new THREE.BufferGeometry()
      ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ringPos, 3))

      // Silhouette geometry — placeholder updated every frame by the animation loop
      const silhouetteGeo = new THREE.BufferGeometry()
      silhouetteGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(32 * 2 * 2 * 3), 3),
      )

      const ringGhost = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      ringGhost.renderOrder = 2

      const ringSolid = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      ringSolid.renderOrder = 3

      const silGhost = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      silGhost.renderOrder = 2

      const silSolid = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      silSolid.renderOrder = 3

      shapeGroup.add(depthMask, topCap, bottomCap, ringGhost, ringSolid, silGhost, silSolid)
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
      const ringGeo = new THREE.BufferGeometry()
      ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ringPos, 3))

      // Silhouette great circle placeholder — SEGS segments × 2 pts × 3 floats
      const silhouetteGeo = new THREE.BufferGeometry()
      silhouetteGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(SEGS * 2 * 3), 3),
      )

      const ringGhost = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      ringGhost.renderOrder = 2
      const ringSolid = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      ringSolid.renderOrder = 3
      const silGhost = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      silGhost.renderOrder = 2
      const silSolid = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      silSolid.renderOrder = 3

      shapeGroup.add(depthMesh, ringGhost, ringSolid, silGhost, silSolid)
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
      const ringPos: number[] = []
      const addRing = (u: number) => {
        const [x, y] = shapeDef.surface(Math.min(u, 1), 0, shapeParams)
        const r = Math.max(0, x)
        if (r < 0.001) return
        for (let i = 0; i < RSEGS; i++) {
          const a1 = 2 * Math.PI * i / RSEGS
          const a2 = 2 * Math.PI * (i + 1) / RSEGS
          ringPos.push(r * Math.cos(a1), y, r * Math.sin(a1), r * Math.cos(a2), y, r * Math.sin(a2))
        }
      }
      if (r0 > 0.001) addRing(0)
      if (rN > 0.001) addRing(1)
      if (showContours) {
        for (let i = 1; i <= uRings; i++) addRing(i / (uRings + 1))
      }
      const ringGeo = new THREE.BufferGeometry()
      ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ringPos, 3))

      // Silhouette placeholder — 2 sides × USAMPLES segments × 2 pts × 3 floats
      const silhouetteGeo = new THREE.BufferGeometry()
      silhouetteGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(2 * USAMPLES * 2 * 3), 3),
      )

      const ringGhost = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      ringGhost.renderOrder = 2
      const ringSolid = new THREE.LineSegments(ringGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      ringSolid.renderOrder = 3
      const silGhost = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }))
      silGhost.renderOrder = 2
      const silSolid = new THREE.LineSegments(silhouetteGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }))
      silSolid.renderOrder = 3

      shapeGroup.add(ringGhost, ringSolid, silGhost, silSolid)
      shapeGroup.position.y = verticalPosition

      three.latheSilhouetteGeo = silhouetteGeo
      three.latheProfile        = profile
      groundBottom = Math.min(...profile.map(p => p.y))
      groundFoot   = Math.max(...profile.map(p => p.r)) * 1.6
    }

    // ── Position the world-locked ground under the form ──────────────
    const { groundGroup, shadowMesh } = three
    groundGroup.visible    = showGround
    groundGroup.position.y = verticalPosition + groundBottom - 0.02
    shadowMesh.scale.set(groundFoot * 2, groundFoot * 2, 1)
  }, [shapeId, shapeParams, uRings, verticalPosition, rotationDeg.x, rotationDeg.y, rotationDeg.z, activeAxis, showAxes, showGuides, showContours, showGround])

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full"
      style={{
        backgroundColor: "#eef0f7",
        backgroundImage: [
          "radial-gradient(ellipse 90% 70% at 50% 42%, rgba(255,255,255,0.5), transparent 75%)",
          "radial-gradient(#c0c4dc 1px, transparent 1px)",
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
