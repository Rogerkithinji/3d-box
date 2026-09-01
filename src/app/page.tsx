"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Cone, Cuboid, Cylinder, Egg, Globe, Moon, Pill, Sun, Worm, type LucideIcon } from "lucide-react"
import { ThreeCube } from "@/components/three-cube"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  ALL_SHAPE_IDS, SHAPE_LABELS, getParametricShape,
  CUBE_CONTROLS, CUBE_DEFAULT_PARAMS,
  SPHERE_CONTROLS, SPHERE_DEFAULT_PARAMS,
  TUBE_CONTROLS, TUBE_DEFAULT_PARAMS,
  type ShapeId, type ShapeParams,
} from "@/lib/shapes"

// Palette lives in CSS variables on .plate (light) / .plate.dark-plate (dark)
const INK         = "var(--ink)"
const INK_DEEP    = "var(--ink-deep)"
const RED         = "var(--red)"      // canvas apparatus colour — panel legend only
const ORANGE      = "var(--orange)"       // interactive accent: fills for active states & controls
const ORANGE_DEEP = "var(--orange-deep)"  // same accent, darker — text, borders, thin marks

const SHAPE_ICONS: Record<ShapeId, LucideIcon> = {
  cube:     Cuboid,
  cylinder: Cylinder,
  sphere:   Globe,
  capsule:  Pill,
  cone:     Cone,
  egg:      Egg,
  tube:     Worm,
}

function SectionHeader({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>{n}</span>
      <span className="font-mono text-[11px] tracking-[0.22em]" style={{ color: INK_DEEP }}>{title}</span>
      <div className="flex-1 border-t" style={{ borderColor: "color-mix(in srgb, var(--ink) 17%, transparent)" }} />
    </div>
  )
}

function ControlRow({
  label, valueText, children,
}: { label: string; valueText: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <Label className="font-mono text-[11px] tracking-[0.14em]" style={{ color: "color-mix(in srgb, var(--ink-deep) 80%, transparent)" }}>
          {label}
        </Label>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: INK }}>
          {valueText}
        </span>
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="font-mono text-[11px] tracking-[0.14em]" style={{ color: "color-mix(in srgb, var(--ink-deep) 80%, transparent)" }}>
        {label}
      </Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export default function Home() {
  const [shapeId,      setShapeId]      = useState<ShapeId>("cube")
  const [shapeParams,  setShapeParams]  = useState<ShapeParams>({})
  const [uRings,       setURings]       = useState(6)
  const [showContours, setShowContours] = useState(true)
  const [vertPos,      setVertPos]      = useState(0)
  const [rotationDeg,  setRotationDeg]  = useState({ x: 0, y: 0, z: 0 })
  const [guides,       setGuides]       = useState(true)
  const [showAxes,     setShowAxes]     = useState(true)
  const [showGround,   setShowGround]   = useState(true)
  const [showTopView,  setShowTopView]  = useState(true)
  const [showDegrees,  setShowDegrees]  = useState(true)
  const [wrapContours, setWrapContours] = useState(true)
  const [showCone,     setShowCone]     = useState(true)
  const [resetCount,   setResetCount]   = useState(0)
  const [zoomAction,   setZoomAction]   = useState({ dir: 1, n: 0 })
  const [focalLength,  setFocalLength]  = useState(30)
  const [activeAxis,   setActiveAxis]   = useState<"x" | "y" | "z" | null>(null)
  const [dark,         setDark]         = useState(false)

  // Restore the saved theme after mount (avoids a hydration mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("fs-theme")
      if (stored) setDark(stored === "dark")
      else setDark(window.matchMedia("(prefers-color-scheme: dark)").matches)
    } catch { /* no storage — stay light */ }
  }, [])
  const toggleDark = () => {
    setDark(d => {
      try { localStorage.setItem("fs-theme", d ? "light" : "dark") } catch { /* ignore */ }
      return !d
    })
  }

  // Highlight the axis being rotated; fade it out shortly after the last change
  const axisTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markAxisActive = (axis: "x" | "y" | "z") => {
    setActiveAxis(axis)
    if (axisTimer.current) clearTimeout(axisTimer.current)
    axisTimer.current = setTimeout(() => setActiveAxis(null), 900)
  }
  useEffect(() => () => { if (axisTimer.current) clearTimeout(axisTimer.current) }, [])

  const shapeDef = shapeId !== "cube" && shapeId !== "tube" ? getParametricShape(shapeId) : null
  const params   = shapeId === "cube"    ? { ...CUBE_DEFAULT_PARAMS,   ...shapeParams }
                 : shapeId === "sphere" ? { ...SPHERE_DEFAULT_PARAMS, ...shapeParams }
                 : shapeId === "tube"   ? { ...TUBE_DEFAULT_PARAMS,   ...shapeParams }
                 : shapeDef            ? { ...shapeDef.defaultParams, ...shapeParams } : {}
  const controls = shapeId === "cube"    ? CUBE_CONTROLS
                 : shapeId === "sphere" ? SPHERE_CONTROLS
                 : shapeId === "tube"   ? TUBE_CONTROLS
                 : (shapeDef?.controls ?? [])

  const plateNo = String(ALL_SHAPE_IDS.indexOf(shapeId) + 1).padStart(3, "0")
  const posText = vertPos > 0.06 ? "above eye level" : vertPos < -0.06 ? "below eye level" : "at eye level"

  const handleShapeChange = (id: ShapeId) => {
    setShapeId(id)
    setShapeParams({})
  }

  return (
    <div className={`plate ${dark ? "dark-plate" : ""} flex h-screen overflow-hidden`} style={{ background: "var(--paper)" }}>

      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <ThreeCube
          shapeId={shapeId}
          shapeParams={params}
          uRings={uRings}
          verticalPosition={vertPos}
          rotationDeg={rotationDeg}
          activeAxis={activeAxis}
          showAxes={showAxes}
          showGuides={guides}
          showContours={showContours}
          resetCount={resetCount}
          zoomAction={zoomAction}
          focalLength={focalLength}
          showGround={showGround}
          showTopView={showTopView}
          showDegrees={showDegrees}
          wrapContours={wrapContours}
          showCone={showCone}
          dark={dark}
        />
      </div>

      {/* Controls */}
      <aside
        className="ink-panel w-80 flex-none flex flex-col gap-7 px-7 py-6 border-l overflow-y-auto"
        style={{ borderColor: "color-mix(in srgb, var(--ink) 15%, transparent)", background: "var(--panel)" }}
      >
        {/* Plate header */}
        <header className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.18em]">
            <span style={{ color: "color-mix(in srgb, var(--ink) 67%, transparent)" }}>PLATE Nº {plateNo}</span>
            <span className="flex items-center gap-2.5">
              <span style={{ color: "color-mix(in srgb, var(--ink) 47%, transparent)" }}>PERSPECTIVE</span>
              <button
                onClick={toggleDark}
                title={dark ? "Switch to day plate" : "Switch to night plate"}
                className="transition-all duration-200 hover:rotate-45 hover:scale-125 hover:opacity-100"
                style={{ color: ORANGE_DEEP, opacity: 0.85 }}
              >
                {dark ? <Sun size={13} /> : <Moon size={13} />}
              </button>
            </span>
          </div>
          <h1
            className="text-[36px] leading-tight italic"
            style={{ fontFamily: "var(--font-display)", color: INK_DEEP }}
          >
            Form Study
          </h1>
          <p className="font-mono text-[11px]" style={{ color: "color-mix(in srgb, var(--ink) 53%, transparent)" }}>
            drawing the basic forms in space
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex-1 border-t" style={{ borderColor: "color-mix(in srgb, var(--ink) 27%, transparent)" }} />
            <div className="size-1 rotate-45 border" style={{ borderColor: INK, opacity: 0.55 }} />
            <div className="flex-1 border-t" style={{ borderColor: "color-mix(in srgb, var(--ink) 27%, transparent)" }} />
          </div>
        </header>

        {/* 01 · Form */}
        <section className="flex flex-col gap-3">
          <SectionHeader n="01" title="FORM" />
          <div className="grid grid-cols-4 gap-1.5">
            {ALL_SHAPE_IDS.map(id => {
              const active = shapeId === id
              const Icon = SHAPE_ICONS[id]
              return (
                <button
                  key={id}
                  onClick={() => handleShapeChange(id)}
                  title={SHAPE_LABELS[id]}
                  className="flex flex-col items-center gap-1 border pt-2 pb-1.5 transition-colors duration-150 hover:bg-white"
                  style={{
                    borderColor: active ? ORANGE_DEEP : "color-mix(in srgb, var(--ink) 20%, transparent)",
                    background: active ? ORANGE : undefined,
                    color: active ? INK_DEEP : "color-mix(in srgb, var(--ink) 73%, transparent)",
                  }}
                >
                  <Icon size={24} strokeWidth={1.5} />
                  <span className="font-mono text-[9px] tracking-wider">
                    {SHAPE_LABELS[id]}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 02 · Proportion */}
        <section className="flex flex-col gap-4">
          <SectionHeader n="02" title="PROPORTION" />
          {controls.map(ctrl => (
            <ControlRow
              key={ctrl.key}
              label={ctrl.label}
              valueText={(params[ctrl.key] ?? ctrl.min).toFixed(2)}
            >
              <Slider
                min={Math.round(ctrl.min * 100)}
                max={Math.round(ctrl.max * 100)}
                step={1}
                value={Math.round((params[ctrl.key] ?? ctrl.min) * 100)}
                onValueChange={(v) =>
                  setShapeParams(prev => ({ ...prev, [ctrl.key]: (v as number) / 100 }))
                }
              />
            </ControlRow>
          ))}
        </section>

        {/* 03 · View */}
        <section className="flex flex-col gap-4">
          <SectionHeader n="03" title="VIEW" />

          <ControlRow label="FOCAL LENGTH" valueText={`${focalLength}mm`}>
            <Slider
              min={20} max={135} step={1}
              value={focalLength}
              onValueChange={(v) => setFocalLength(v as number)}
            />
            <p className="font-mono text-[11px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
              {focalLength < 28
                ? "wide angle — VPs pull close, drama up"
                : focalLength <= 60
                ? "normal lens — close to human vision"
                : "telephoto — VPs fly apart, space flattens"}
            </p>
          </ControlRow>

          {shapeId === "cube" && (
            <>
              {([["SPIN · Y", "y"], ["TILT · X", "x"], ["ROLL · Z", "z"]] as const).map(([label, axis]) => (
                <ControlRow
                  key={axis}
                  label={label}
                  valueText={`${rotationDeg[axis] > 0 ? "+" : ""}${rotationDeg[axis]}°`}
                >
                  <div className="relative">
                    {/* center tick marking the unrotated orientation */}
                    <div
                      className="absolute left-1/2 -top-1 h-1.5 w-px -translate-x-1/2"
                      style={{ background: ORANGE_DEEP, opacity: 0.8 }}
                    />
                    <Slider
                      min={-45} max={45} step={1}
                      value={rotationDeg[axis]}
                      onValueChange={(v) => {
                        markAxisActive(axis)
                        setRotationDeg(prev => ({ ...prev, [axis]: v as number }))
                      }}
                    />
                  </div>
                </ControlRow>
              ))}
              <p className="-mt-1 font-mono text-[11px] leading-relaxed" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
                spin slides the VPs — tilt &amp; roll swing the form&apos;s horizon off eye level
              </p>
            </>
          )}

          <ControlRow
            label="VERTICAL POSITION"
            valueText={`${vertPos > 0 ? "+" : vertPos < 0 ? "−" : ""}${Math.abs(vertPos).toFixed(2)}`}
          >
            <div className="relative">
              {/* center tick marking eye level */}
              <div
                className="absolute left-1/2 -top-1 h-1.5 w-px -translate-x-1/2"
                style={{ background: ORANGE_DEEP, opacity: 0.8 }}
              />
              <Slider
                min={-150} max={150} step={1}
                value={Math.round(vertPos * 100)}
                onValueChange={(v) => setVertPos((v as number) / 100)}
              />
            </div>
            <p className="font-mono text-[11px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
              {posText}
            </p>
          </ControlRow>

          {shapeId !== "cube" && showContours && (
            <ControlRow
              label="CONTOUR RINGS"
              valueText={`${uRings} ring${uRings !== 1 ? "s" : ""}`}
            >
              <Slider
                min={1} max={16} step={1}
                value={uRings}
                onValueChange={(v) => setURings(v as number)}
              />
            </ControlRow>
          )}

          <div className="flex flex-col gap-3 pt-1">
            {shapeId !== "cube" && (
              <ToggleRow label="SHOW CONTOURS" checked={showContours} onChange={setShowContours} />
            )}
            {shapeId !== "cube" && showContours && (
              <ToggleRow label="WRAP CONTOURS" checked={wrapContours} onChange={setWrapContours} />
            )}
            {shapeId !== "cube" && shapeId !== "tube" && (
              <ToggleRow label="ELLIPSE DEGREES" checked={showDegrees} onChange={setShowDegrees} />
            )}
            <ToggleRow label="SHOW GROUND" checked={showGround} onChange={setShowGround} />
            <ToggleRow label="SHOW GUIDES" checked={guides} onChange={setGuides} />
            {shapeId === "cube" && (
              <ToggleRow label="SHOW AXES" checked={showAxes} onChange={setShowAxes} />
            )}
            <ToggleRow label="SHOW TOP VIEW" checked={showTopView} onChange={setShowTopView} />
            <ToggleRow label="CONE OF VISION" checked={showCone} onChange={setShowCone} />
          </div>

          <div className="mt-1 flex gap-1.5">
            {([["−", -1], ["+", 1]] as const).map(([sym, dir]) => (
              <button
                key={sym}
                onClick={() => setZoomAction(a => ({ dir, n: a.n + 1 }))}
                className="flex-1 border px-3 py-2 font-mono text-[11px] tracking-[0.18em] transition-colors duration-150 hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
                style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)", color: ORANGE_DEEP }}
              >
                ZOOM {sym}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setRotationDeg({ x: 0, y: 0, z: 0 })
              setFocalLength(30)
              setResetCount(c => c + 1)
            }}
            className="w-full border px-3 py-2.5 font-mono text-[11px] tracking-[0.18em] transition-colors duration-150 hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
            style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)", color: ORANGE_DEEP }}
          >
            ⟲ RESET VIEW
          </button>
        </section>

        {/* Legend / footer */}
        <footer
          className="mt-auto flex flex-col gap-2 border-t pt-4 font-mono text-[11px]"
          style={{ borderColor: "color-mix(in srgb, var(--ink) 15%, transparent)", color: "color-mix(in srgb, var(--ink) 53%, transparent)" }}
        >
          <div className="flex items-center gap-2">
            <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" style={{ stroke: INK }} strokeWidth="1.6" /></svg>
            <span>visible edge</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" style={{ stroke: INK }} strokeWidth="1" strokeDasharray="3 3" opacity="0.4" /></svg>
            <span>hidden edge</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" style={{ stroke: RED }} strokeWidth="1" strokeDasharray="5 3" opacity="0.8" /></svg>
            <span>horizon · eye level · guides</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" style={{ stroke: INK }} strokeWidth="1" strokeDasharray="3 2" opacity="0.5" /></svg>
            <span>form axes X · Y · Z</span>
          </div>
          <p className="mt-2" style={{ color: "color-mix(in srgb, var(--ink) 40%, transparent)" }}>
            drag to orbit · scroll to zoom
          </p>
        </footer>
      </aside>
    </div>
  )
}
