"use client"

import { useCallback, useEffect, useRef } from "react"
import * as THREE from "three"

interface Props {
  rotation: number
  verticalPosition: number
  showGuides: boolean
}

const INK       = "#5B5BD6"
const INK_THREE = new THREE.Color(INK)
const HALF      = 0.55

export function ThreeCube({ rotation, verticalPosition, showGuides }: Props) {
  const wrapRef    = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const threeRef = useRef<{
    renderer:  THREE.WebGLRenderer
    scene:     THREE.Scene
    camera:    THREE.PerspectiveCamera
    group:     THREE.Group
  } | null>(null)

  // Store latest render fn so the resize observer always calls the current one
  const renderRef = useRef<() => void>(() => {})

  // ── Init Three.js (runs once) ───────────────────────────────────
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

    // Cube: depth mask + ghost edges + solid edges
    const geo   = new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2)
    const edges = new THREE.EdgesGeometry(geo)

    // Depth mask — writes depth for all front faces, invisible
    const depthMesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide }),
    )
    depthMesh.renderOrder = 0

    // Front face shade — PlaneGeometry sitting exactly at z=+HALF (the front face)
    const frontShade = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#c8d5ff"),
        transparent: true,
        opacity: 0.3,
        side: THREE.FrontSide,
        depthWrite: false,
      }),
    )
    frontShade.position.z = HALF
    frontShade.renderOrder = 1

    // Ghost — all edges faint, ignores depth so back edges show through
    const ghost = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: INK_THREE, transparent: true, opacity: 0.2, depthTest: false,
      }),
    )
    ghost.renderOrder = 2

    // Solid — depth-tested, only front edges draw over the ghost
    const solid = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: INK_THREE, depthTest: true }),
    )
    solid.renderOrder = 3

    const group = new THREE.Group()
    group.add(depthMesh, frontShade, ghost, solid)
    scene.add(group)

    threeRef.current = { renderer, scene, camera, group }

    // Resize — calls whatever renderRef.current is at that moment
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

  // ── 2D overlay: horizon, VPs, construction lines, labels ────────
  const drawOverlay = useCallback(
    (rot: number, vertPos: number, guides: boolean) => {
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

      // Focal lengths in pixels from camera FOV
      const vFOV = (camera.fov * Math.PI) / 180
      const f_y  = H / 2 / Math.tan(vFOV / 2)
      const f_x  = f_y * camera.aspect

      const hy = H / 2 // horizon always at screen centre

      // Project world → screen (camera at z=5)
      const toScreen = (wx: number, wy: number, wz: number): [number, number] => {
        const d = 5 - wz
        return [W / 2 + (wx / d) * f_x, H / 2 - (wy / d) * f_y]
      }

      // VP positions (same formula as the canvas approach)
      const vp_rx = Math.abs(cos) > 0.01 ? W / 2 + f_x * (sin / cos) : sin > 0 ? 9e4 : -9e4
      const vp_lx = Math.abs(sin) > 0.01 ? W / 2 - f_x * (cos / sin) : cos > 0 ? -9e4 : 9e4

      // ── horizon ─────────────────────────────────────────────────
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.5
      ctx.setLineDash([6, 6])
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1

      // ── VP markers ──────────────────────────────────────────────
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

      // ── construction lines ───────────────────────────────────────
      if (guides) {
        const screenCorners = (
          [
            [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
            [-1,-1, 1],[1,-1, 1],[1,1, 1],[-1,1, 1],
          ] as [number,number,number][]
        ).map(([lx, ly, lz]) => {
          const rx = cos * lx * HALF + sin * lz * HALF
          const ry = ly * HALF + vertPos
          const rz = -sin * lx * HALF + cos * lz * HALF
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
      ctx.fillText("[ CUBE ]", W / 2 - 24, 24)
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

  // ── Update scene + overlay on every prop change ──────────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const { renderer, scene, camera, group } = three

    group.rotation.y = rotation
    group.position.y  = verticalPosition

    const run = () => {
      renderer.render(scene, camera)
      drawOverlay(rotation, verticalPosition, showGuides)
    }

    renderRef.current = run
    run()
  }, [rotation, verticalPosition, showGuides, drawOverlay])

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
