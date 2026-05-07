"use client"

import { useCallback, useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { SHAPE_LABELS, type ShapeId, type ShapeParams } from "@/lib/shapes"

interface Props {
  shapeId:          ShapeId
  shapeParams:      ShapeParams
  uRings:           number
  verticalPosition: number
  showGuides:       boolean
  showContours:     boolean
  resetCount:       number
}

const INK       = "#5B5BD6"
const INK_THREE = new THREE.Color(INK)
const HALF      = 0.55

export function ThreeCube({
  shapeId, shapeParams, uRings,
  verticalPosition, showGuides, showContours, resetCount,
}: Props) {
  const wrapRef    = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const threeRef = useRef<{
    renderer:         THREE.WebGLRenderer
    scene:            THREE.Scene
    camera:           THREE.PerspectiveCamera
    controls:         OrbitControls
    cubeGroup:        THREE.Group
    shapeGroup:       THREE.Group
    cylSilhouetteGeo: THREE.BufferGeometry | null
    cylRadius:        number
    cylHeight:        number
  } | null>(null)

  // Latest prop values for the animation loop to read each frame
  const liveRef = useRef({ verticalPosition, showGuides, shapeId, shapeParams })
  useEffect(() => { liveRef.current = { verticalPosition, showGuides, shapeId, shapeParams } })

  // ── 2D overlay ────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (vertPos: number, guides: boolean, sid: ShapeId, hw: number, hh: number, hd: number) => {
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

      // VP x positions: analytical from camera azimuth (correct for any zoom/tilt)
      const phi   = Math.atan2(camera.position.x, camera.position.z)
      const cos   = Math.cos(phi), sin = Math.sin(phi)
      const f_y   = H / 2 / Math.tan(vFOV / 2)
      const vp_rx = Math.abs(cos) > 0.01 ? W / 2 + f_y * (sin / cos) : sin > 0 ? 9e4 : -9e4
      const vp_lx = Math.abs(sin) > 0.01 ? W / 2 - f_y * (cos / sin) : cos > 0 ? -9e4 : 9e4

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
        const corners: [number, number, number][] = [
          [-hw, -hh, -hd], [hw, -hh, -hd], [hw,  hh, -hd], [-hw,  hh, -hd],
          [-hw, -hh,  hd], [hw, -hh,  hd], [hw,  hh,  hd], [-hw,  hh,  hd],
        ]
        const screenCorners = corners.map(([x, y, z]) => toScreen(x, y + vertPos, z))
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
      ;([[m, m], [W - m, m], [m, H - m], [W - m, H - m]] as [number, number][]).forEach(([px, py], i) => {
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
        vertPos > 0.06  ? "ABOVE EYE LEVEL"
        : vertPos < -0.06 ? "BELOW EYE LEVEL"
        : "AT EYE LEVEL"
      ctx.fillText(posLabel, 36, H - 20)
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
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan  = false
    controls.minDistance = 2
    controls.maxDistance = 15
    controls.target.set(0, 0, 0)
    controls.update()

    const scene      = new THREE.Scene()
    const cubeGroup  = new THREE.Group()
    const shapeGroup = new THREE.Group()
    scene.add(cubeGroup, shapeGroup)

    threeRef.current = {
      renderer, scene, camera, controls,
      cubeGroup, shapeGroup,
      cylSilhouetteGeo: null, cylRadius: 0.5, cylHeight: 1.5,
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

      renderer.render(scene, camera)

      const { verticalPosition, showGuides, shapeId, shapeParams } = liveRef.current
      const hw = (shapeParams.width  ?? HALF * 2) / 2
      const hh = (shapeParams.height ?? HALF * 2) / 2
      const hd = (shapeParams.depth  ?? HALF * 2) / 2
      drawOverlay(verticalPosition, showGuides, shapeId, hw, hh, hd)
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

  // ── Reset camera to default position ─────────────────────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three || resetCount === 0) return
    three.camera.position.set(0, 0, 5)
    three.controls.target.set(0, 0, 0)
    three.controls.update()
  }, [resetCount])

  // ── Rebuild scene geometry on prop changes ────────────────────────
  useEffect(() => {
    const three = threeRef.current
    if (!three) return
    const { cubeGroup, shapeGroup } = three

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
      shapeGroup.visible   = false
      three.cylSilhouetteGeo = null

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
      cubeGroup.visible    = true
      cubeGroup.position.y = verticalPosition

    } else {
      cubeGroup.visible  = false
      shapeGroup.visible = true

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
    }
  }, [shapeId, shapeParams, uRings, verticalPosition, showGuides, showContours])

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
