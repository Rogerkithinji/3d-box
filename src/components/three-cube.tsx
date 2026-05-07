"use client"

import { useCallback, useEffect, useRef } from "react"
import * as THREE from "three"
import { SHAPE_LABELS, type ShapeId, type ShapeParams } from "@/lib/shapes"

interface Props {
  shapeId:          ShapeId
  shapeParams:      ShapeParams
  uRings:           number
  vLines:           number
  rotation:         number
  verticalPosition: number
  showGuides:       boolean
  showContours:     boolean
}

const INK       = "#5B5BD6"
const INK_THREE = new THREE.Color(INK)
const HALF      = 0.55

export function ThreeCube({
  shapeId, shapeParams, uRings, vLines,
  rotation, verticalPosition, showGuides, showContours,
}: Props) {
  const wrapRef    = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const threeRef = useRef<{
    renderer:   THREE.WebGLRenderer
    scene:      THREE.Scene
    camera:     THREE.PerspectiveCamera
    cubeGroup:  THREE.Group
    shapeGroup: THREE.Group
  } | null>(null)

  const renderRef = useRef<() => void>(() => {})

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
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)

    const scene = new THREE.Scene()

    const cubeGroup = new THREE.Group()
    scene.add(cubeGroup)

    // ── Parametric shape placeholder ──────────────────────────────
    const shapeGroup = new THREE.Group()
    scene.add(shapeGroup)

    threeRef.current = { renderer, scene, camera, cubeGroup, shapeGroup }

    const onResize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderRef.current()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)

    return () => {
      ro.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
      threeRef.current = null
    }
  }, [])

  // ── 2D overlay ────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (rot: number, vertPos: number, guides: boolean, sid: ShapeId, hw: number, hh: number, hd: number) => {
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

      const cos = Math.cos(rot)
      const sin = Math.sin(rot)

      const vFOV = (camera.fov * Math.PI) / 180
      const f_y  = H / 2 / Math.tan(vFOV / 2)
      const f_x  = f_y

      const hy = H / 2

      const toScreen = (wx: number, wy: number, wz: number): [number, number] => {
        const d = 5 - wz
        return [W / 2 + (wx / d) * f_x, H / 2 - (wy / d) * f_y]
      }

      const vp_rx = Math.abs(cos) > 0.01 ? W / 2 + f_x * (sin / cos) : sin > 0 ? 9e4 : -9e4
      const vp_lx = Math.abs(sin) > 0.01 ? W / 2 - f_x * (cos / sin) : cos > 0 ? -9e4 : 9e4

      // ── horizon ──────────────────────────────────────────────────
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.5
      ctx.setLineDash([6, 6])
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1

      // ── VP markers ───────────────────────────────────────────────
      const drawVP = (vpx: number, label: string) => {
        if (vpx > 0 && vpx < W) {
          ctx.strokeStyle = INK; ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(vpx - 7, hy); ctx.lineTo(vpx + 7, hy)
          ctx.moveTo(vpx, hy - 7); ctx.lineTo(vpx, hy + 7)
          ctx.stroke()
          ctx.fillStyle = INK; ctx.font = "10px monospace"
          const tw = ctx.measureText(label).width
          ctx.fillText(label, vpx > W / 2 ? vpx + 10 : vpx - 10 - tw, hy - 9)
        } else {
          ctx.fillStyle = INK; ctx.font = "10px monospace"; ctx.globalAlpha = 0.6
          const txt = vpx < 0 ? `← ${label}` : `${label} →`
          ctx.fillText(txt, vpx < 0 ? 14 : W - 14 - ctx.measureText(txt).width, hy - 9)
          ctx.globalAlpha = 1
        }
      }
      drawVP(vp_lx, "VP_L")
      drawVP(vp_rx, "VP_R")

      // ── construction lines (cube only) ───────────────────────────
      if (guides && sid === "cube") {
        const screenCorners = (
          [
            [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
            [-1,-1, 1],[1,-1, 1],[1,1, 1],[-1,1, 1],
          ] as [number,number,number][]
        ).map(([lx, ly, lz]) => {
          const rx = cos * lx * hw - sin * lz * hd
          const ry = ly * hh + vertPos
          const rz = sin * lx * hw + cos * lz * hd
          return toScreen(rx, ry, rz)
        })

        const cap = (v: number) => Math.max(-3000, Math.min(W + 3000, v))
        ctx.strokeStyle = "rgba(91,91,214,0.15)"; ctx.lineWidth = 0.75; ctx.setLineDash([3, 7])
        screenCorners.forEach(([sx, sy]) => {
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cap(vp_lx), hy); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cap(vp_rx), hy); ctx.stroke()
        })
        ctx.setLineDash([])
      }

      // ── corner frame ─────────────────────────────────────────────
      const m = 12, arm = 18
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5
      ;([[m,m],[W-m,m],[m,H-m],[W-m,H-m]] as [number,number][]).forEach(([px,py],i) => {
        const sx = i % 2 === 0 ? 1 : -1, sy = i < 2 ? 1 : -1
        ctx.beginPath()
        ctx.moveTo(px, py); ctx.lineTo(px + arm * sx, py)
        ctx.moveTo(px, py); ctx.lineTo(px, py + arm * sy)
        ctx.stroke()
      })
      ctx.globalAlpha = 1

      // ── labels ───────────────────────────────────────────────────
      ctx.fillStyle = INK; ctx.font = "10px monospace"; ctx.globalAlpha = 0.7
      ctx.fillText("FIG_001", 36, 24)
      const shapeLabel = `[ ${SHAPE_LABELS[sid]} ]`
      ctx.fillText(shapeLabel, W / 2 - ctx.measureText(shapeLabel).width / 2, 24)
      ctx.fillText("[ 2-PT PERSPECTIVE ]", W - 174, 24)
      const posLabel =
        vertPos > 0.06 ? "ABOVE EYE LEVEL"
        : vertPos < -0.06 ? "BELOW EYE LEVEL"
        : "AT EYE LEVEL"
      ctx.fillText(posLabel, 36, H - 20)
      ctx.globalAlpha = 1
    },
    [],
  )

  // ── Update scene + overlay on every prop change ───────────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const { renderer, scene, camera, cubeGroup, shapeGroup } = three

    if (shapeId === "cube") {
      shapeGroup.visible = false

      const hw = (shapeParams.width  ?? HALF * 2) / 2
      const hh = (shapeParams.height ?? HALF * 2) / 2
      const hd = (shapeParams.depth  ?? HALF * 2) / 2

      const toDispose: THREE.BufferGeometry[] = []
      cubeGroup.traverse(obj => {
        const o = obj as THREE.Mesh | THREE.LineSegments
        if (o.geometry) toDispose.push(o.geometry)
      })
      cubeGroup.clear()
      toDispose.forEach(g => g.dispose())

      const geo   = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2)
      const edges = new THREE.EdgesGeometry(geo)

      const depthMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }),
      )
      depthMesh.renderOrder = 0

      const frontShade = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2, hh * 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color("#c8d5ff"),
          transparent: true, opacity: 0.3,
          side: THREE.FrontSide, depthWrite: false,
        }),
      )
      frontShade.position.z = hd
      frontShade.renderOrder = 1

      const cubeGhost = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false }),
      )
      cubeGhost.renderOrder = 2

      const cubeSolid = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }),
      )
      cubeSolid.renderOrder = 3

      cubeGroup.add(depthMesh, frontShade, cubeGhost, cubeSolid)
      cubeGroup.visible    = true
      cubeGroup.rotation.y = -rotation
      cubeGroup.position.y  = verticalPosition
    } else {
      cubeGroup.visible  = false
      shapeGroup.visible = true

      const radius = shapeParams.radius ?? 0.5
      const height = shapeParams.height ?? 1.5
      const SEGS   = 64  // smooth circle

      // Dispose old
      const toDispose: THREE.BufferGeometry[] = []
      shapeGroup.traverse(obj => {
        const o = obj as THREE.Mesh | THREE.LineSegments
        if (o.geometry) toDispose.push(o.geometry)
      })
      shapeGroup.clear()
      toDispose.forEach(g => g.dispose())

      // ── Depth mask: closed solid cylinder (barrel + caps) ────────
      // Caps seal the depth buffer so back edges are properly blocked.
      const maskGeo = new THREE.CylinderGeometry(radius, radius, height, SEGS, 1, false)
      const depthMask = new THREE.Mesh(
        maskGeo,
        new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }),
      )
      depthMask.renderOrder = 0

      // ── Edge geometry ────────────────────────────────────────────
      const edgePos: number[] = []

      // Smooth ring at height y
      const addRing = (y: number) => {
        for (let i = 0; i < SEGS; i++) {
          const a1 = 2 * Math.PI * i / SEGS
          const a2 = 2 * Math.PI * (i + 1) / SEGS
          edgePos.push(
            radius * Math.cos(a1), y, radius * Math.sin(a1),
            radius * Math.cos(a2), y, radius * Math.sin(a2),
          )
        }
      }

      // Top and bottom circles always shown
      addRing( height / 2)
      addRing(-height / 2)

      // Contour rings in between
      if (showContours) {
        for (let i = 1; i <= uRings; i++) {
          addRing(-height / 2 + height * i / (uRings + 1))
        }
      }

      // Silhouette lines — in local space the tangent angles are -rotation and π-rotation.
      // After the group rotates by -rotation these land at world x = ±radius, z = 0,
      // which are exactly the left and right silhouettes as seen from the camera.
      const VSEGS = 32
      for (const a of [-rotation, Math.PI - rotation]) {
        const sx = radius * Math.cos(a), sz = radius * Math.sin(a)
        for (let i = 0; i < VSEGS; i++) {
          const y1 = -height / 2 + height * i / VSEGS
          const y2 = -height / 2 + height * (i + 1) / VSEGS
          edgePos.push(sx, y1, sz, sx, y2, sz)
        }
      }

      const edgeGeo = new THREE.BufferGeometry()
      edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePos, 3))

      // Ghost: all edges always visible at low opacity
      const ghost = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({
          color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false,
        }),
      )
      ghost.renderOrder = 2

      // Solid: only edges that pass depth test (front half)
      const solid = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }),
      )
      solid.renderOrder = 3

      shapeGroup.add(depthMask, ghost, solid)
      shapeGroup.rotation.y = -rotation
      shapeGroup.position.y  = verticalPosition
    }

    const hw = (shapeParams.width  ?? HALF * 2) / 2
    const hh = (shapeParams.height ?? HALF * 2) / 2
    const hd = (shapeParams.depth  ?? HALF * 2) / 2

    const run = () => {
      renderer.render(scene, camera)
      drawOverlay(rotation, verticalPosition, showGuides, shapeId, hw, hh, hd)
    }

    renderRef.current = run
    run()
  }, [shapeId, shapeParams, uRings, vLines, rotation, verticalPosition, showGuides, showContours, drawOverlay])

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full"
      style={{
        backgroundColor: "#eef0f7",
        backgroundImage: "radial-gradient(#c0c4dc 1px, transparent 1px)",
        backgroundSize: "24px 24px",
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
