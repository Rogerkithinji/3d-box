"use client"

import { useCallback, useEffect, useRef } from "react"
import { getParametricShape, type ShapeId, type ShapeParams } from "@/lib/shapes"

interface Props {
  shapeId: ShapeId
  shapeParams: ShapeParams
  bend: number
  uRings: number
  vLines: number
  verticalPosition: number
  rotation: number
  showGuides: boolean
}

const INK       = "#5B5BD6"
const INK_FAINT = "rgba(91,91,214,0.15)"
const BG        = "#eef0f7"
const DOT       = "#c0c4dc"

type Face = "right" | "left" | "front" | "back" | "top" | "bottom"
type Pt3  = [number, number, number]
type Pt2  = [number, number]

const RAW_VERTS: Pt3[] = [
  [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
  [-1,-1, 1],[1,-1, 1],[1,1, 1],[-1,1, 1],
]

const EDGE_FACES: [number, number, Face, Face][] = [
  [0,1,"back","bottom"],[1,2,"back","right"],[2,3,"back","top"],[3,0,"back","left"],
  [4,5,"front","bottom"],[5,6,"front","right"],[6,7,"front","top"],[7,4,"front","left"],
  [0,4,"left","bottom"],[1,5,"right","bottom"],[2,6,"right","top"],[3,7,"left","top"],
]

const FACE_NORMALS: Record<Face, Pt3> = {
  right:  [ 1, 0, 0], left:  [-1, 0, 0],
  front:  [ 0, 0, 1], back:  [ 0, 0,-1],
  top:    [ 0, 1, 0], bottom:[ 0,-1, 0],
}

export function PerspectiveCanvas({
  shapeId, shapeParams, bend, uRings, vLines,
  verticalPosition, rotation, showGuides,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const cx = W / 2
    const cy = H / 2
    const f  = Math.min(W, H) * 0.55
    const DEPTH = 4
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)

    const project = (wx: number, wy: number, wz: number): Pt2 => [
      cx + (wx / wz) * f,
      cy - (wy / wz) * f,
    ]

    const rotateY = (x: number, y: number, z: number): Pt3 => [
      cos * x + sin * z,
      y,
      -sin * x + cos * z,
    ]

    // ── background ───────────────────────────────────────────────
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = DOT
    for (let gx = 24; gx < W; gx += 24)
      for (let gy = 24; gy < H; gy += 24) {
        ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill()
      }

    // ── vanishing points ─────────────────────────────────────────
    const vp_r = Math.abs(cos) > 0.01 ? cx + f * (sin / cos) : (sin > 0 ? 9e4 : -9e4)
    const vp_l = Math.abs(sin) > 0.01 ? cx - f * (cos / sin) : (cos > 0 ? -9e4 : 9e4)
    const vpy  = cy

    // ── horizon line ─────────────────────────────────────────────
    ctx.save()
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.5
    ctx.setLineDash([6, 6])
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    ctx.fillStyle = INK; ctx.font = "10px monospace"; ctx.globalAlpha = 0.6
    ctx.fillText("EYE LEVEL", 14, cy - 7)
    ctx.globalAlpha = 1

    // ── VP markers ───────────────────────────────────────────────
    const drawVP = (vpx: number, label: string) => {
      if (vpx > 0 && vpx < W) {
        ctx.strokeStyle = INK; ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(vpx - 7, vpy); ctx.lineTo(vpx + 7, vpy)
        ctx.moveTo(vpx, vpy - 7); ctx.lineTo(vpx, vpy + 7)
        ctx.stroke()
        ctx.fillStyle = INK; ctx.font = "10px monospace"
        const tw = ctx.measureText(label).width
        ctx.fillText(label, vpx > cx ? vpx + 10 : vpx - 10 - tw, vpy - 9)
      } else {
        ctx.fillStyle = INK; ctx.font = "10px monospace"; ctx.globalAlpha = 0.6
        const txt = vpx < 0 ? `← ${label}` : `${label} →`
        const ex  = vpx < 0 ? 14 : W - 14 - ctx.measureText(txt).width
        ctx.fillText(txt, ex, vpy - 9)
        ctx.globalAlpha = 1
      }
    }
    drawVP(vp_r, "VP_R")
    drawVP(vp_l, "VP_L")

    // ════════════════════════════════════════════════════════════
    // CUBE
    // ════════════════════════════════════════════════════════════
    if (shapeId === "cube") {
      const HALF = 0.55
      const verts = RAW_VERTS.map(([x, y, z]): Pt3 => {
        const [rx, ry, rz] = rotateY(x * HALF, y * HALF, z * HALF)
        return [rx, ry + verticalPosition, rz + DEPTH]
      })
      const sv = verts.map(([x, y, z]) => project(x, y, z))

      const vlen = Math.sqrt(verticalPosition * verticalPosition + DEPTH * DEPTH)
      const viewVec: Pt3 = [0, -verticalPosition / vlen, -DEPTH / vlen]
      const faceVisible = (face: Face): boolean => {
        const [nx, ny, nz] = FACE_NORMALS[face]
        const [rnx, rny, rnz] = rotateY(nx, ny, nz)
        return rnx * viewVec[0] + rny * viewVec[1] + rnz * viewVec[2] > 0
      }
      const vis: Record<Face, boolean> = {
        right: faceVisible("right"), left:   faceVisible("left"),
        front: faceVisible("front"), back:   faceVisible("back"),
        top:   faceVisible("top"),   bottom: faceVisible("bottom"),
      }

      if (showGuides) {
        ctx.strokeStyle = INK_FAINT; ctx.lineWidth = 0.75; ctx.setLineDash([3, 7])
        const cap = (v: number) => Math.max(-3000, Math.min(W + 3000, v))
        for (let i = 0; i < 8; i++) {
          ctx.beginPath(); ctx.moveTo(sv[i][0], sv[i][1]); ctx.lineTo(cap(vp_r), vpy); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(sv[i][0], sv[i][1]); ctx.lineTo(cap(vp_l), vpy); ctx.stroke()
        }
        ctx.setLineDash([])
      }

      EDGE_FACES.forEach(([a, b, f1, f2]) => {
        const hidden = !vis[f1] && !vis[f2]
        ctx.strokeStyle = INK; ctx.lineWidth = hidden ? 1 : 2
        ctx.globalAlpha = hidden ? 0.25 : 1
        if (hidden) ctx.setLineDash([4, 5])
        ctx.beginPath()
        ctx.moveTo(sv[a][0], sv[a][1]); ctx.lineTo(sv[b][0], sv[b][1])
        ctx.stroke()
        ctx.setLineDash([]); ctx.globalAlpha = 1
      })

    // ════════════════════════════════════════════════════════════
    // PARAMETRIC SURFACE
    // ════════════════════════════════════════════════════════════
    } else {
      const shapeDef = getParametricShape(shapeId)
      if (!shapeDef) return
      const params = Object.keys(shapeParams).length > 0 ? shapeParams : shapeDef.defaultParams

      const uSamples = uRings + 2   // includes both tip points
      const vSamples = vLines

      // sample raw surface
      const rawGrid: Pt3[][] = []
      for (let ui = 0; ui < uSamples; ui++) {
        const u = ui / (uSamples - 1)
        const row: Pt3[] = []
        for (let vi = 0; vi < vSamples; vi++) {
          row.push(shapeDef.surface(u, vi / vSamples, params))
        }
        rawGrid.push(row)
      }

      // compute y range for bend
      const allY = rawGrid.flat().map(p => p[1])
      const yMin = Math.min(...allY)
      const yRange = Math.max(Math.max(...allY) - yMin, 0.001)

      // apply bend → rotate → translate
      const grid: Pt3[][] = rawGrid.map(row =>
        row.map(([x, y, z]) => {
          const t = (y - yMin) / yRange
          const [rx, ry, rz] = rotateY(x + bend * Math.sin(Math.PI * t), y, z)
          return [rx, ry + verticalPosition, rz + DEPTH] as Pt3
        })
      )

      // project to screen
      const sg: Pt2[][] = grid.map(row => row.map(([x, y, z]) => project(x, y, z)))

      // front/back split by circumference angle relative to camera
      const isFront = (angle: number) => Math.sin(rotation - angle) > 0

      // ── U-rings (horizontal contours) ────────────────────────
      const ringFront: Pt2[][] = [] // pairs [p1, p2]
      const ringBack:  Pt2[][] = []

      for (let ui = 1; ui < uSamples - 1; ui++) {
        for (let vi = 0; vi < vSamples; vi++) {
          const nextVi = (vi + 1) % vSamples
          const midAngle = 2 * Math.PI * (vi + 0.5) / vSamples
          const pair: Pt2[] = [sg[ui][vi], sg[ui][nextVi]]
          if (isFront(midAngle)) ringFront.push(pair)
          else                   ringBack.push(pair)
        }
      }

      ctx.strokeStyle = INK
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85
      ctx.beginPath()
      ringFront.forEach(([p1, p2]) => { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]) })
      ctx.stroke()

      ctx.lineWidth = 0.75; ctx.globalAlpha = 0.2
      ctx.beginPath()
      ringBack.forEach(([p1, p2]) => { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]) })
      ctx.stroke()
      ctx.globalAlpha = 1

      // ── V-lines (length contours) ─────────────────────────────
      const vlineFront: Pt2[][] = []
      const vlineBack:  Pt2[][] = []

      for (let vi = 0; vi < vSamples; vi++) {
        const angle = 2 * Math.PI * vi / vSamples
        const front = isFront(angle)
        for (let ui = 0; ui < uSamples - 1; ui++) {
          const pair: Pt2[] = [sg[ui][vi], sg[ui + 1][vi]]
          if (front) vlineFront.push(pair)
          else        vlineBack.push(pair)
        }
      }

      ctx.strokeStyle = INK
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85
      ctx.beginPath()
      vlineFront.forEach(([p1, p2]) => { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]) })
      ctx.stroke()

      ctx.lineWidth = 0.75; ctx.globalAlpha = 0.2
      ctx.beginPath()
      vlineBack.forEach(([p1, p2]) => { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]) })
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // ── corner frame ─────────────────────────────────────────────
    const m = 12, arm = 18
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5
    ;([[m,m],[W-m,m],[m,H-m],[W-m,H-m]] as Pt2[]).forEach(([px, py], i) => {
      const sx = i % 2 === 0 ? 1 : -1
      const sy = i < 2 ? 1 : -1
      ctx.beginPath()
      ctx.moveTo(px, py); ctx.lineTo(px + arm * sx, py)
      ctx.moveTo(px, py); ctx.lineTo(px, py + arm * sy)
      ctx.stroke()
    })
    ctx.globalAlpha = 1

    // ── labels ───────────────────────────────────────────────────
    ctx.fillStyle = INK; ctx.font = "10px monospace"; ctx.globalAlpha = 0.7
    ctx.fillText("FIG_001", 36, 24)
    ctx.fillText(`[ ${shapeId.toUpperCase()} ]`, W / 2 - 28, 24)
    ctx.fillText("[ 2-PT PERSPECTIVE ]", W - 174, 24)
    const posLabel = verticalPosition > 0.06
      ? "ABOVE EYE LEVEL"
      : verticalPosition < -0.06
      ? "BELOW EYE LEVEL"
      : "AT EYE LEVEL"
    ctx.fillText(posLabel, 36, H - 20)
    ctx.globalAlpha = 1
  }, [shapeId, shapeParams, bend, uRings, vLines, verticalPosition, rotation, showGuides])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width  = width  * dpr
      canvas.height = height * dpr
      draw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw])

  return <canvas ref={canvasRef} className="block w-full h-full" />
}
