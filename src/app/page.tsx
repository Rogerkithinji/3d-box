"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Cone, Cuboid, Cylinder, Dices, Egg, Globe, Moon, Pill, Sun, Worm, type LucideIcon } from "lucide-react"
import { ThreeCube, type DrillPhase } from "@/components/three-cube"
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
      <span className="font-mono text-[11px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>{n}</span>
      <span className="font-mono text-[12px] tracking-[0.22em]" style={{ color: INK_DEEP }}>{title}</span>
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
        <Label className="font-mono text-[12px] tracking-[0.14em]" style={{ color: "color-mix(in srgb, var(--ink-deep) 80%, transparent)" }}>
          {label}
        </Label>
        <span className="font-mono text-[12px] tabular-nums" style={{ color: INK }}>
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
      <Label className="font-mono text-[12px] tracking-[0.14em]" style={{ color: "color-mix(in srgb, var(--ink-deep) 80%, transparent)" }}>
        {label}
      </Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// Compact visibility flag for the LAYERS palette — the diamond lights
// orange when the layer is on, like a plotted layer tick.
function LayerChip({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="shape-tile flex items-center gap-2 border px-2.5 py-1.5 font-mono text-[11px] tracking-[0.14em] transition-colors duration-150"
      style={{
        borderColor: checked
          ? "color-mix(in srgb, var(--ink) 45%, transparent)"
          : "color-mix(in srgb, var(--ink) 15%, transparent)",
        color: checked ? INK_DEEP : "color-mix(in srgb, var(--ink) 45%, transparent)",
      }}
    >
      <span
        className="size-1.5 flex-none rotate-45 border"
        style={{
          borderColor: checked ? ORANGE_DEEP : "currentColor",
          background: checked ? ORANGE : undefined,
        }}
      />
      {label}
    </button>
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
  const [copies,       setCopies]       = useState(1)
  const [spacing,      setSpacing]      = useState(1.6)
  const [resetCount,   setResetCount]   = useState(0)
  const [zoomAction,   setZoomAction]   = useState({ dir: 1, n: 0 })
  const [focalLength,  setFocalLength]  = useState(30)
  const [activeAxis,   setActiveAxis]   = useState<"x" | "y" | "z" | null>(null)
  const [dark,         setDark]         = useState(false)
  const [turntable,    setTurntable]    = useState(false)
  const [facingTint,   setFacingTint]   = useState(true)
  const [coilOn,       setCoilOn]       = useState(true)
  const [ortho,        setOrtho]        = useState(false)
  const [drill,        setDrill]        = useState<DrillPhase>("off")

  // Orthographic is approximated by an extreme telephoto: the focal-length
  // effect dolly-compensates, so only the convergence drains away.
  const ORTHO_FOCAL = 700

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

  // The canvas sees coil 0 while the toggle is off; the slider keeps its value
  const canvasParams = shapeId === "tube" && !coilOn ? { ...params, coil: 0 } : params

  const plateNo = String(ALL_SHAPE_IDS.indexOf(shapeId) + 1).padStart(3, "0")
  const posText = vertPos > 0.06 ? "above eye level" : vertPos < -0.06 ? "below eye level" : "at eye level"

  const handleShapeChange = (id: ShapeId) => {
    setShapeId(id)
    setShapeParams({})
    setDrill("off")
  }

  const randomPose = useCallback(() => {
    const r = (a: number, b: number) => Math.round(a + Math.random() * (b - a))
    setRotationDeg({ x: r(-25, 25), y: r(-45, 45), z: r(-12, 12) })
    setVertPos(r(-130, 130) / 100)
  }, [])

  const resetView = useCallback(() => {
    setRotationDeg({ x: 0, y: 0, z: 0 })
    setFocalLength(30)
    setResetCount(c => c + 1)
  }, [])

  const startDrill = () => {
    setShapeId("cube")
    setShapeParams({})
    setOrtho(false)
    randomPose()
    setDrill("guess")
  }

  // Keyboard shortcuts — 1–7 forms · R reset · G guides · A axes ·
  // D dice · T turntable · O ortho · space reveals the drill
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      const idx = "1234567".indexOf(k)
      if (idx >= 0) {
        if (drill !== "off") return   // drilling is cube-only — exit first
        setShapeId(ALL_SHAPE_IDS[idx])
        setShapeParams({})
      }
      else if (k === "r") resetView()
      else if (k === "g") setGuides(v => !v)
      else if (k === "a") setShowAxes(v => !v)
      else if (k === "d") randomPose()
      else if (k === "t") setTurntable(v => !v)
      else if (k === "o") setOrtho(v => !v)
      else if (k === " " && drill === "guess") { e.preventDefault(); setDrill("reveal") }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [drill, randomPose, resetView])

  return (
    <div className={`plate ${dark ? "dark-plate" : ""} flex h-screen overflow-hidden`} style={{ background: "var(--paper)" }}>

      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <ThreeCube
          shapeId={shapeId}
          shapeParams={canvasParams}
          uRings={uRings}
          verticalPosition={vertPos}
          rotationDeg={rotationDeg}
          activeAxis={activeAxis}
          showAxes={showAxes}
          showGuides={guides}
          showContours={showContours}
          resetCount={resetCount}
          zoomAction={zoomAction}
          focalLength={ortho ? ORTHO_FOCAL : focalLength}
          showGround={showGround}
          showTopView={showTopView}
          showDegrees={showDegrees}
          wrapContours={wrapContours}
          showCone={showCone}
          dark={dark}
          copies={copies}
          spacing={spacing}
          turntable={turntable}
          ortho={ortho}
          drill={drill}
          facingTint={facingTint}
        />
      </div>

      {/* Controls */}
      <aside
        className="ink-panel w-80 flex-none flex flex-col gap-7 px-7 py-6 border-l overflow-y-auto"
        style={{ borderColor: "color-mix(in srgb, var(--ink) 15%, transparent)", background: "var(--panel)" }}
      >
        {/* Plate header */}
        <header className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between font-mono text-[11px] tracking-[0.18em]">
            <span style={{ color: "color-mix(in srgb, var(--ink) 67%, transparent)" }}>PLATE Nº {plateNo}</span>
            <span className="flex items-center gap-2.5">
              <span style={{ color: "color-mix(in srgb, var(--ink) 47%, transparent)" }}>PERSPECTIVE</span>
              <button
                onClick={toggleDark}
                title={dark ? "Switch to day plate" : "Switch to night plate"}
                className="icon-button -my-1.5 -mx-1 flex size-6 items-center justify-center"
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
          <p className="font-mono text-[12px]" style={{ color: "color-mix(in srgb, var(--ink) 53%, transparent)" }}>
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
                  className="shape-tile flex flex-col items-center gap-1 border pt-2 pb-1.5 transition-colors duration-150"
                  style={{
                    borderColor: active ? ORANGE_DEEP : "color-mix(in srgb, var(--ink) 20%, transparent)",
                    background: active ? ORANGE : undefined,
                    color: active ? "var(--ink-deep-fixed)" : "color-mix(in srgb, var(--ink) 73%, transparent)",
                  }}
                >
                  <Icon size={24} strokeWidth={1.5} />
                  <span className="font-mono text-[10px] tracking-wider">
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
          {controls.map(ctrl => {
            const coilOff = ctrl.key === "coil" && !coilOn
            return (
              <ControlRow
                key={ctrl.key}
                label={ctrl.label}
                valueText={coilOff ? "off" : (params[ctrl.key] ?? ctrl.min).toFixed(2)}
              >
                <div className={coilOff ? "pointer-events-none opacity-40" : undefined}>
                  <Slider
                    min={Math.round(ctrl.min * 100)}
                    max={Math.round(ctrl.max * 100)}
                    step={1}
                    value={Math.round((params[ctrl.key] ?? ctrl.min) * 100)}
                    onValueChange={(v) =>
                      setShapeParams(prev => ({ ...prev, [ctrl.key]: (v as number) / 100 }))
                    }
                  />
                </div>
              </ControlRow>
            )
          })}
          {shapeId === "tube" && (
            <>
              <ToggleRow label="COIL" checked={coilOn} onChange={setCoilOn} />
              {coilOn && (
                <p className="-mt-1 font-mono text-[12px] leading-relaxed" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
                  coil wraps the bend around the vertical axis — the bend sets the coil&apos;s width, so no bend means no coil
                </p>
              )}
            </>
          )}
        </section>

        {/* 03 · View */}
        <section className="flex flex-col gap-4">
          <SectionHeader n="03" title="VIEW" />

          <ControlRow label="FOCAL LENGTH" valueText={ortho ? "∞" : `${focalLength}mm`}>
            <div className={ortho ? "pointer-events-none opacity-40" : undefined}>
              <Slider
                min={20} max={135} step={1}
                value={focalLength}
                onValueChange={(v) => setFocalLength(v as number)}
              />
            </div>
            <p className="font-mono text-[12px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
              {ortho
                ? "parallel projection — depth without diminution"
                : focalLength < 28
                ? "wide angle — VPs pull close, drama up"
                : focalLength <= 60
                ? "normal lens — close to human vision"
                : "telephoto — VPs fly apart, space flattens"}
            </p>
          </ControlRow>

          <ToggleRow label="ORTHOGRAPHIC" checked={ortho} onChange={setOrtho} />

          {shapeId === "cube" && drill !== "guess" && (
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
              <p className="-mt-1 font-mono text-[12px] leading-relaxed" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
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
            <p className="font-mono text-[12px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
              {posText}
            </p>
          </ControlRow>

          <ToggleRow label="TURNTABLE" checked={turntable} onChange={setTurntable} />

          <div className="mt-1 flex gap-1.5">
            {([["−", -1], ["+", 1]] as const).map(([sym, dir]) => (
              <button
                key={sym}
                onClick={() => setZoomAction(a => ({ dir, n: a.n + 1 }))}
                className="flex-1 border px-3 py-2 font-mono text-[12px] tracking-[0.18em] transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
                style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }}
              >
                ZOOM {sym}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={resetView}
              className="flex-1 border px-3 py-2.5 font-mono text-[12px] tracking-[0.18em] transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
              style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }}
            >
              ⟲ RESET VIEW
            </button>
            <button
              onClick={randomPose}
              title="Random pose (D)"
              className="flex items-center justify-center border px-3 transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
              style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }}
            >
              <Dices size={15} strokeWidth={1.5} />
            </button>
          </div>
        </section>

        {/* 04 · Layers */}
        <section className="flex flex-col gap-3">
          <SectionHeader n="04" title="LAYERS" />
          <div className="grid grid-cols-2 gap-1.5">
            <LayerChip label="GROUND" checked={showGround} onChange={setShowGround} />
            <LayerChip label="GUIDES" checked={guides} onChange={setGuides} />
            {shapeId === "cube" && (
              <LayerChip label="AXES" checked={showAxes} onChange={setShowAxes} />
            )}
            <LayerChip label="TOP VIEW" checked={showTopView} onChange={setShowTopView} />
            <LayerChip label="CONE 60°" checked={showCone} onChange={setShowCone} />
            {shapeId !== "cube" && (
              <LayerChip label="CONTOURS" checked={showContours} onChange={setShowContours} />
            )}
            {shapeId !== "cube" && showContours && (
              <LayerChip label="WRAP" checked={wrapContours} onChange={setWrapContours} />
            )}
            {shapeId !== "cube" && shapeId !== "tube" && (
              <LayerChip label="DEGREES" checked={showDegrees} onChange={setShowDegrees} />
            )}
            {shapeId === "tube" && (
              <LayerChip label="FACING" checked={facingTint} onChange={setFacingTint} />
            )}
          </div>
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
          {shapeId === "tube" && facingTint && (
            <p className="font-mono text-[12px] leading-relaxed" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
              <span style={{ color: ORANGE_DEEP }}>orange</span> ellipses open toward you — ink ones turn away
            </p>
          )}
        </section>

        {/* 05 · Repeat */}
        <section className="flex flex-col gap-4">
          <SectionHeader n="05" title="REPEAT" />
          <ControlRow
            label="COPIES"
            valueText={copies === 1 ? "off" : `${copies} in a row`}
          >
            <Slider
              min={1} max={6} step={1}
              value={copies}
              onValueChange={(v) => setCopies(v as number)}
            />
          </ControlRow>
          {copies > 1 && (
            <ControlRow label="SPACING" valueText={spacing.toFixed(2)}>
              <Slider
                min={60} max={300} step={5}
                value={Math.round(spacing * 100)}
                onValueChange={(v) => setSpacing((v as number) / 100)}
              />
              <p className="font-mono text-[12px] leading-relaxed" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
                equal steps in space shrink lawfully toward the VP
              </p>
            </ControlRow>
          )}
        </section>

        {/* 06 · Drill */}
        <section className="flex flex-col gap-3">
          <SectionHeader n="06" title="DRILL" />
          {drill === "off" ? (
            <>
              <button
                onClick={startDrill}
                className="w-full border px-3 py-2.5 font-mono text-[12px] tracking-[0.18em] transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
                style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }}
              >
                ▶ GUESS THE BOX
              </button>
              <p className="font-mono text-[12px] leading-relaxed" style={{ color: "color-mix(in srgb, var(--ink) 60%, transparent)" }}>
                only horizon, VPs &amp; one starting edge remain — imagine the cube, then reveal
              </p>
            </>
          ) : (
            <div className="flex gap-1.5">
              {drill === "guess" ? (
                <button
                  onClick={() => setDrill("reveal")}
                  className="flex-1 border px-3 py-2.5 font-mono text-[12px] tracking-[0.18em] text-[var(--ink-deep-fixed)] transition-colors duration-150"
                  style={{ borderColor: ORANGE_DEEP, background: ORANGE }}
                >
                  ◉ REVEAL
                </button>
              ) : (
                <button
                  onClick={() => { randomPose(); setDrill("guess") }}
                  className="flex-1 border px-3 py-2.5 font-mono text-[12px] tracking-[0.18em] transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
                  style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }}
                >
                  ⟳ NEW POSE
                </button>
              )}
              <button
                onClick={() => setDrill("off")}
                className="border px-3 py-2.5 font-mono text-[12px] tracking-[0.18em] transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
                style={{ borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }}
              >
                EXIT
              </button>
            </div>
          )}
        </section>

        {/* Legend / footer */}
        <footer
          className="mt-auto flex flex-col gap-2 border-t pt-4 font-mono text-[12px]"
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
          <p style={{ color: "color-mix(in srgb, var(--ink) 40%, transparent)" }}>
            keys · 1–7 forms · R reset · G guides · A axes · D dice · T turntable · O ortho
          </p>
        </footer>
      </aside>
    </div>
  )
}
