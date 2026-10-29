"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Camera, ChevronUp, CircleHelp, Cone, Eye, Scissors, FlipHorizontal2, FlipVertical2, FolderOpen, Move, Plus, RotateCw, Scaling, Cuboid, Cylinder, Dices, Egg, Globe, Layers, Moon, Pill, Pyramid,
  Rotate3d, RotateCcw, RotateCwSquare, Sun, SunMedium, Trash2, Worm, type LucideIcon,
} from "lucide-react"
import {
  ThreeCube, type DrillPhase, type FormTransform, type PickTarget, type TransformTool,
} from "@/components/three-cube"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { LIGHT_MAX_STEPS, valueBands } from "@/lib/light"
import type { ExtraForm, IntersectMode, IntersectPose, IntersectSpec } from "@/lib/intersect"
import { SCENES, type Scene } from "@/lib/scenes"
import { defaultParamsFor } from "@/lib/solids"
import {
  ALL_SHAPE_IDS, SHAPE_FULL_LABELS, getParametricShape, isFaceted,
  CUBE_CONTROLS, PYRAMID_CONTROLS, SPHERE_CONTROLS, TUBE_CONTROLS,
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
  pyramid:  Pyramid,
  cylinder: Cylinder,
  sphere:   Globe,
  capsule:  Pill,
  cone:     Cone,
  egg:      Egg,
  tube:     Worm,
}

// Intersection study: up to eight forms, lettered A → H. Every pair gets
// its own seam, so the cost grows with the square of the count.
const MAX_FORMS = 8
const LETTERS = "ABCDEFGH"
const FORM_TONES = "bcdefgh".split("").map(l => `var(--form-${l})`)
// what a new form starts as, in turn
const NEW_SHAPES: ShapeId[] = ["sphere", "cube", "cone", "cylinder", "pyramid", "capsule", "egg"]
// Where each extra form lands when added: B and C on either side of A,
// later ones spread round it on a golden-angle spiral so none lands on another
function homeFor(k: number): IntersectPose {
  if (k === 0) return { x: -0.25, y: 0.45, z: 0.3, rx: 0, ry: 0, rz: 0, size: 0.75 }
  if (k === 1) return { x: 0.45, y: -0.35, z: 0.25, rx: 0, ry: 0, rz: 0, size: 0.6 }
  const a = k * 2.4
  const r2 = (v: number) => Math.round(v * 100) / 100
  return { x: r2(0.6 * Math.cos(a)), y: r2(0.45 * Math.sin(a)), z: r2(0.3 * Math.sin(a * 0.5)), rx: 0, ry: 0, rz: 0, size: 0.6 }
}
const TOOLS: [TransformTool, string, LucideIcon][] = [
  ["move",   "Move (V)",   Move],
  ["rotate", "Rotate (E)", RotateCw],
  ["scale",  "Scale (S)",  Scaling],
]
// Proportions that are ratios, not lengths: a scale drag leaves them alone
const RATIO_KEYS = new Set(["taper", "coil", "roundness"])

// angles in (−180°, 180°], so a half turn reads 180°
const wrap180 = (deg: number) => { const w = ((deg % 360) + 360) % 360; return w > 180 ? w - 360 : w }

function controlsFor(id: ShapeId) {
  return id === "cube" ? CUBE_CONTROLS
    : id === "pyramid" ? PYRAMID_CONTROLS
    : id === "sphere" ? SPHERE_CONTROLS
    : id === "tube"   ? TUBE_CONTROLS
    : getParametricShape(id)?.controls ?? []
}
const MODES = [["study", "STUDY"], ["intersect", "INTERSECT"], ["drill", "DRILL"]] as const
const IX_MODES: [IntersectMode, string][] = [
  ["both",    "ALL"],
  ["overlap", "OVERLAP"],
]
// a form by its place on the plate (0 is form A), or one of the other tabs
type Selection = number | "camera" | "light"
// enough of the plate to put back what an add, copy or delete changed
interface Arrangement {
  shapeId: ShapeId; shapeParams: ShapeParams
  rotationDeg: { x: number; y: number; z: number }; vertPos: number
  ixOn: boolean; ixForms: ExtraForm[]; activeForm: number; ixSolo: number | null; aCut: boolean
}
type Mode = "study" | "intersect" | "drill"

const HAIRLINE = "color-mix(in srgb, var(--ink) 15%, transparent)"
const FAINT    = "color-mix(in srgb, var(--ink) 60%, transparent)"
const ACTION   = "border font-mono text-[12px] tracking-[0.18em] transition-colors duration-150 text-[var(--orange-deep)] hover:bg-[var(--orange)] hover:text-[var(--ink-deep-fixed)]"
const ACTION_BORDER = { borderColor: "color-mix(in srgb, var(--orange-deep) 47%, transparent)" }

// One choice out of a few, as a row of joined cells
function Segmented<T extends string>({
  options, value, onChange,
}: { options: readonly (readonly [T, string])[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="flex w-full">
      {options.map(([id, label], i) => {
        const active = id === value
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-pressed={active}
            className={`shape-tile flex-1 whitespace-nowrap border px-1.5 py-1.5 font-mono text-[11px] tracking-[0.08em] transition-colors duration-150 ${i > 0 ? "-ml-px" : ""}`}
            style={{
              borderColor: active ? ORANGE_DEEP : "color-mix(in srgb, var(--ink) 20%, transparent)",
              background: active ? ORANGE : undefined,
              color: active ? "var(--ink-deep-fixed)" : "color-mix(in srgb, var(--ink) 73%, transparent)",
              zIndex: active ? 1 : undefined,
              position: "relative",
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// Square icon button for the toolbar and the panel header
function IconButton({
  icon: Icon, title, onClick, active = false,
}: { icon: LucideIcon; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="shape-tile flex size-8 flex-none items-center justify-center border transition-colors duration-150"
      style={{
        borderColor: active ? ORANGE_DEEP : "transparent",
        background: active ? ORANGE : undefined,
        color: active ? "var(--ink-deep-fixed)" : "color-mix(in srgb, var(--ink) 80%, transparent)",
      }}
    >
      <Icon size={16} strokeWidth={1.5} />
    </button>
  )
}

// A small palette that opens from a button: down from the panel header,
// up from the floating toolbar
function Dropdown({
  icon, title, open, onToggle, width, up = false, chevron = false, disabled = false, children,
}: {
  icon: LucideIcon; title: string; open: boolean; onToggle: () => void; width: number
  up?: boolean; chevron?: boolean; disabled?: boolean; children: ReactNode
}) {
  const Icon = icon
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        title={title}
        aria-label={title}
        aria-expanded={open}
        disabled={disabled}
        className={`shape-tile flex h-8 flex-none items-center justify-center gap-0.5 border transition-colors duration-150 ${chevron ? "px-1.5" : "w-8"} ${disabled ? "pointer-events-none opacity-35" : ""}`}
        style={{
          borderColor: open ? "color-mix(in srgb, var(--ink) 45%, transparent)" : "transparent",
          color: "color-mix(in srgb, var(--ink) 80%, transparent)",
        }}
      >
        <Icon size={16} strokeWidth={1.5} />
        {chevron && <ChevronUp size={11} strokeWidth={1.5} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={onToggle} />
          <div
            className={`ink-panel absolute z-30 flex flex-col gap-3 border p-3 ${up ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"}`}
            style={{ width, borderColor: "color-mix(in srgb, var(--ink) 30%, transparent)", background: "var(--panel)" }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[12px] leading-relaxed" style={{ color: FAINT }}>{children}</p>
}

function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[12px] tracking-[0.22em]" style={{ color: INK_DEEP }}>{title}</span>
      {note && <span className="font-mono text-[11px]" style={{ color: FAINT }}>{note}</span>}
    </div>
  )
}

// A Figma-style number box: type a value, nudge it with ↑ ↓ (⇧ for ×10),
// or scrub it sideways — drag the label, or hold ⌥ and drag anywhere on
// the box. Angles wrap instead of stopping.
function NumberField({
  label, value, onChange, step = 0.01, min = -Infinity, max = Infinity,
  wrap, unit = "", title, disabled, display,
}: {
  label: string; value: number; onChange: (v: number) => void
  step?: number; min?: number; max?: number; wrap?: 180 | 360
  unit?: string; title?: string; disabled?: boolean; display?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [altHover, setAltHover] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const decimals = step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step)))
  const fit = (v: number) => {
    let x = Math.round(v / step) * step
    if (wrap === 180) x = wrap180(x)
    else if (wrap === 360) x = ((x % 360) + 360) % 360
    else x = Math.max(min, Math.min(max, x))
    return Number(x.toFixed(decimals))
  }
  const shown = display ?? `${value.toFixed(decimals)}${unit}`

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const onLabel = (e.target as HTMLElement).dataset.scrub !== undefined
    if (disabled || e.button !== 0 || !(onLabel || e.altKey)) return
    e.preventDefault()
    setDraft(null)
    inputRef.current?.blur()
    const el = e.currentTarget, startX = e.clientX, base = value
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) =>
      onChange(fit(base + (ev.clientX - startX) * step * (ev.shiftKey ? 10 : 1)))
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
  }
  const commit = () => {
    if (draft === null) return
    const v = parseFloat(draft.replace(/[^0-9.+-]/g, ""))
    if (Number.isFinite(v)) onChange(fit(v))
    setDraft(null)
  }

  return (
    <div
      title={title}
      onPointerDown={scrub}
      onPointerMove={e => setAltHover(e.altKey)}
      onPointerLeave={() => setAltHover(false)}
      style={altHover ? { cursor: "ew-resize" } : undefined}
      className={`num-field flex h-8 min-w-0 items-center gap-2 border px-2 font-mono text-[12px] transition-colors duration-150 ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      <span
        data-scrub
        className="flex-none cursor-ew-resize select-none text-[11px] tracking-[0.1em]"
        style={{ color: FAINT }}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        value={draft ?? shown}
        disabled={disabled}
        inputMode="decimal"
        onFocus={e => { setDraft(value.toFixed(decimals)); requestAnimationFrame(() => e.target.select()) }}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { commit(); e.currentTarget.blur() }
          else if (e.key === "Escape") { setDraft(null); e.currentTarget.blur() }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const v = fit(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1))
            onChange(v)
            setDraft(v.toFixed(decimals))
          }
        }}
        className="w-full min-w-0 bg-transparent tabular-nums outline-none"
        style={{ color: INK_DEEP, cursor: altHover ? "ew-resize" : undefined }}
      />
    </div>
  )
}

type ToolItem = [LucideIcon, string, () => void]

// Icon-only actions joined into one quiet box, as in Figma
function ToolGroup({ items }: { items: ToolItem[] }) {
  return (
    <div className="tool-group flex h-8 min-w-0 items-stretch">
      {items.map(([Icon, title, onClick]) => (
        <button
          key={title}
          onClick={onClick}
          title={title}
          aria-label={title}
          className="shape-tile flex flex-1 items-center justify-center transition-colors duration-150"
          style={{ color: "color-mix(in srgb, var(--ink) 73%, transparent)" }}
        >
          <Icon size={15} strokeWidth={1.5} />
        </button>
      ))}
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
  const [lightOn,      setLightOn]      = useState(true)
  const [lightAz,      setLightAz]      = useState(130)
  const [lightEl,      setLightEl]      = useState(35)
  const [shading,      setShading]      = useState(false)
  const [lightSteps,   setLightSteps]   = useState(1)
  const [shadowSteps,  setShadowSteps]  = useState(1)
  const [showShadow,   setShowShadow]   = useState(false)
  const [ortho,        setOrtho]        = useState(false)
  const [drill,        setDrill]        = useState<DrillPhase>("off")
  const [ixOn,         setIxOn]         = useState(false)
  const [ixForms,      setIxForms]      = useState<ExtraForm[]>([{ shapeId: "sphere", params: {}, pose: homeFor(0) }])
  const [ixMode,       setIxMode]       = useState<IntersectMode>("both")
  const [ixSolo,       setIxSolo]       = useState<number | null>(null)
  // form A carves its volume out of the forms it touches
  const [aCut,         setACut]         = useState(false)
  // live camera position (written by the canvas) and stored viewpoints
  const [eye,          setEye]          = useState<[number, number, number]>([2.3, 1.15, 4.3])
  const [cameraSet,    setCameraSet]    = useState<{ pos: [number, number, number]; n: number }>({ pos: [0, 0, 5], n: 0 })
  const [seamXray,     setSeamXray]     = useState(true)
  // what the properties panel is showing — follows clicks on the canvas.
  // The FORM tab remembers which form it was on.
  const [panel,        setPanel]        = useState<"form" | "camera" | "light">("form")
  const [activeForm,   setActiveForm]   = useState(0)
  const setSelection = (s: Selection) => {
    if (typeof s === "number") { setActiveForm(s); setPanel("form") }
    else setPanel(s)
  }
  const [tool,         setTool]         = useState<TransformTool>("move")
  const [dragging,     setDragging]     = useState(false)
  const scaleBase = useRef<ShapeParams>({})
  const [openMenu,     setOpenMenu]     = useState<"layers" | "help" | "scenes" | "shapes" | null>(null)

  const intersect = useMemo<IntersectSpec | null>(
    () => ixOn ? { forms: ixForms, mode: ixMode, solo: ixSolo, cutA: aCut } : null,
    [ixOn, ixForms, ixMode, ixSolo, aCut],
  )
  const updateForm = (i: number, fn: (f: ExtraForm) => ExtraForm) =>
    setIxForms(prev => prev.map((f, k) => k === i ? fn(f) : f))
  const setPose = (i: number, pose: Partial<IntersectPose>) =>
    updateForm(i, f => ({ ...f, pose: { ...f.pose, ...pose } }))
  const shuffleIx = (i: number) => {
    const r = (a: number, b: number) => Math.round((a + Math.random() * (b - a)) * 100) / 100
    setPose(i, {
      x: r(-0.6, 0.6), y: r(-0.45, 0.45), z: r(-0.6, 0.6),
      // forms stay upright: only position and size are shuffled
      rx: 0, ry: 0, rz: 0,
      size: r(0.6, 1),
    })
  }

  // Depth along the line of sight. A drawing can't say how far away a form
  // is: slide it toward or away from the eye and scale it in step, and it
  // covers exactly the same patch of the picture — only the seams change.
  const sightDepth = (pose: IntersectPose) => {
    const [ex, ey, ez] = eye
    const toA = Math.hypot(ex, vertPos - ey, ez)
    const toF = Math.hypot(pose.x - ex, pose.y + vertPos - ey, pose.z - ez)
    return { toA, toF, depth: toF - toA }
  }
  const setSightDepth = (i: number, depth: number) =>
    updateForm(i, f => {
      const [ex, ey, ez] = eye
      const { toA, toF } = sightDepth(f.pose)
      const k = Math.min(4 / f.pose.size, Math.max(0.15 / f.pose.size, Math.max(0.3, toA + depth) / toF))
      return { ...f, pose: {
        ...f.pose,
        x: ex + (f.pose.x - ex) * k,
        y: ey + (f.pose.y + vertPos - ey) * k - vertPos,
        z: ez + (f.pose.z - ez) * k,
        size: f.pose.size * k,
      } }
    })

  // ⌘Z puts back the last add, copy or delete
  const history = useRef<Arrangement[]>([])
  const remember = () => {
    history.current = [...history.current.slice(-29),
      { shapeId, shapeParams, rotationDeg, vertPos, ixOn, ixForms, activeForm: af, ixSolo, aCut }]
  }
  const undo = () => {
    const a = history.current.pop()
    if (!a) return
    setDrill("off")
    setShapeId(a.shapeId); setShapeParams(a.shapeParams)
    setRotationDeg(a.rotationDeg); setVertPos(a.vertPos)
    setIxOn(a.ixOn); setIxForms(a.ixForms); setIxSolo(a.ixSolo); setACut(a.aCut)
    setSelection(a.activeForm)
  }

  const formCount = ixOn ? ixForms.length + 1 : 1
  // a new form takes the first ink no other form is using
  const freeInk = (forms: ExtraForm[]) => {
    const used = new Set(forms.map((f, i) => f.ink ?? i))
    let ink = 0
    while (used.has(ink)) ink++
    return ink
  }
  // From STUDY, the first added form starts the intersection
  const addForm = () => {
    if (drill !== "off" || formCount >= MAX_FORMS) return
    remember()
    const base = ixOn ? ixForms : []
    const k = base.length
    setIxForms([...base, { shapeId: NEW_SHAPES[k % NEW_SHAPES.length], params: {}, pose: homeFor(k), ink: freeInk(base) }])
    if (!ixOn) { setIxOn(true); setIxMode("both"); setIxSolo(null) }
    setSelection(k + 1)
  }
  // Copy the selected form. ⌘D nudges the copy aside and selects it; a
  // ⌥-drag leaves the copy where the form was and drags the original on
  const duplicateSelected = (inPlace: boolean) => {
    if (typeof sel !== "number" || drill !== "off" || formCount >= MAX_FORMS) return
    remember()
    const nudge = inPlace ? 0 : 0.3
    const copy: ExtraForm = sel === 0
      ? { shapeId, params: canvasParams, cut: aCut,
          pose: { x: nudge, y: 0, z: 0, rx: rotationDeg.x, ry: rotationDeg.y, rz: rotationDeg.z, size: 1 } }
      : { ...ixForms[sel - 1], pose: { ...ixForms[sel - 1].pose, x: r2(ixForms[sel - 1].pose.x + nudge) } }
    const base = ixOn ? ixForms : []
    setIxForms([...base, { ...copy, ink: freeInk(base) }])
    if (!ixOn) { setIxOn(true); setIxMode("both"); setIxSolo(null) }
    if (!inPlace) setSelection(base.length + 1)
  }
  // Turn the selected form about its own X or Y axis
  const turnSelected = (axis: "x" | "y", deg: number) => {
    if (drill !== "off" || typeof sel !== "number") return
    if (sel > 0) {
      const key = axis === "x" ? "rx" : "ry"
      updateForm(sel - 1, f => ({ ...f, pose: { ...f.pose, [key]: wrap180(f.pose[key] + deg) } }))
      return
    }
    setRotationDeg(r => ({ ...r, [axis]: wrap180(r[axis] + deg) }))
  }
  // Flip the selected form: upside down (v) or mirrored left–right (h)
  const flipSelected = (axis: "v" | "h") => turnSelected(axis === "v" ? "x" : "y", 180)

  // Delete a form. An extra form simply goes; deleting form A hands its
  // place to form B, keeping the arrangement where it was. With one form
  // left there is nothing to intersect, so the plate goes back to STUDY.
  const deleteForm = (k: number) => {
    if (!ixOn || drill !== "off") return
    remember()
    const backToStudy = () => {
      setIxOn(false)
      setIxForms([{ shapeId: "sphere", params: {}, pose: homeFor(0) }])
      setIxMode("both")
      setIxSolo(null)
      setACut(false)
      setSelection(0)
    }
    if (k > 0) {
      // every form keeps its ink once its neighbours move up the list
      const rest = ixForms.map((f, j) => ({ ...f, ink: f.ink ?? j })).filter((_, j) => j !== k - 1)
      if (rest.length === 0) { backToStudy(); return }
      setIxForms(rest)
      setIxSolo(s => s === null || s < k ? s : s === k ? null : s - 1)
      setSelection(Math.min(k, rest.length))
      return
    }
    const [b, ...others] = ixForms.map((f, j) => ({ ...f, ink: f.ink ?? j }))
    const base = { ...defaultParamsFor(b.shapeId), ...b.params }
    setShapeId(b.shapeId)
    setShapeParams(Object.fromEntries(controlsFor(b.shapeId).map(c => [
      c.key,
      RATIO_KEYS.has(c.key) ? base[c.key]
        : Math.max(c.min, Math.min(c.max, r2(base[c.key] * b.pose.size))),
    ])))
    setRotationDeg({ x: b.pose.rx, y: b.pose.ry, z: b.pose.rz })
    setVertPos(Math.max(-1.5, Math.min(1.5, r2(vertPos + b.pose.y))))
    setACut(!!b.cut)
    if (others.length === 0) { backToStudy(); return }
    setIxForms(others.map(f => ({ ...f, pose: {
      ...f.pose, x: r2(f.pose.x - b.pose.x), y: r2(f.pose.y - b.pose.y), z: r2(f.pose.z - b.pose.z),
    } })))
    setIxSolo(null)
    setSelection(0)
  }
  const deleteSelected = () => { if (typeof sel === "number") deleteForm(sel) }
  // Set a form to cut, or back to solid
  const toggleCut = (k: number) => {
    if (k === 0) setACut(c => !c)
    else updateForm(k - 1, f => ({ ...f, cut: !f.cut }))
  }

  const loadScene = useCallback((scene: Scene) => {
    setDrill("off")
    setShapeId(scene.formA.shapeId)
    setShapeParams(scene.formA.params)
    setRotationDeg(scene.formA.rotation)
    setVertPos(scene.formA.vertPos)
    setIxForms(scene.forms)
    setIxOn(true)
    setIxMode("both")
    setIxSolo(null)
    setACut(false)
    setCopies(1)
    setOrtho(false)
    setFocalLength(scene.focal)
    setCameraSet(c => ({ pos: scene.camera, n: c.n + 1 }))
    setActiveForm(1)
    setPanel("form")
  }, [])

  // ?scene=<id> opens straight into a stored scene
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("scene")
    const scene = SCENES.find(sc => sc.id === id)
    if (scene) loadScene(scene)
  }, [loadScene])

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

  const params   = { ...defaultParamsFor(shapeId), ...shapeParams }
  const controls = controlsFor(shapeId)

  // The canvas sees coil 0 while the toggle is off; the field keeps its value
  const canvasParams = shapeId === "tube" && !coilOn ? { ...params, coil: 0 } : params

  // contour rings apply to any round form on the plate
  const hasRound = !isFaceted(shapeId) || (ixOn && ixForms.some(f => !isFaceted(f.shapeId)))

  const posText = vertPos > 0.06 ? "above eye level" : vertPos < -0.06 ? "below eye level" : "at eye level"

  const mode: Mode = drill !== "off" ? "drill" : ixOn ? "intersect" : "study"
  // the form the FORM tab is on, kept within the forms that exist
  const af = ixOn ? Math.min(activeForm, ixForms.length) : 0
  const sel: Selection = panel === "form" ? af : panel
  // the toolbar's shape menu edits whichever form the FORM tab is on
  const railTarget = af

  const pickShape = useCallback((id: ShapeId, target: number) => {
    if (target > 0) {
      setIxForms(prev => prev.map((f, k) => k === target - 1 ? { ...f, shapeId: id, params: {} } : f))
      return
    }
    setShapeId(id)
    setShapeParams({})
  }, [])

  const onPick = useCallback((t: PickTarget) => setSelection(t ?? "camera"), [])

  // Handle drags on the canvas land here as new placements
  const r2 = (v: number) => Math.round(v * 100) / 100
  const altHeld = useRef(false)
  useEffect(() => {
    const track = (e: KeyboardEvent) => { altHeld.current = e.altKey }
    const drop = () => { altHeld.current = false }
    window.addEventListener("keydown", track)
    window.addEventListener("keyup", track)
    window.addEventListener("blur", drop)
    return () => {
      window.removeEventListener("keydown", track)
      window.removeEventListener("keyup", track)
      window.removeEventListener("blur", drop)
    }
  }, [])
  const onTransform = (target: number, t: FormTransform, phase: "start" | "move" | "end") => {
    if (phase === "start") {
      setDragging(true); scaleBase.current = params
      if (altHeld.current) duplicateSelected(true)
      return
    }
    if (phase === "end")   { setDragging(false); return }
    if (target === 0) {
      setVertPos(Math.max(-1.5, Math.min(1.5, r2(t.pos[1]))))
      setRotationDeg({ x: Math.round(t.rot[0]), y: Math.round(t.rot[1]), z: Math.round(t.rot[2]) })
      if (Math.abs(t.scale - 1) > 1e-3) {
        const base = scaleBase.current
        setShapeParams(Object.fromEntries(controls.map(c => [
          c.key,
          RATIO_KEYS.has(c.key) ? base[c.key]
            : Math.max(c.min, Math.min(c.max, r2((base[c.key] ?? c.min) * t.scale))),
        ])))
      }
      return
    }
    setPose(target - 1, {
      x: r2(t.pos[0]), y: r2(t.pos[1] - vertPos), z: r2(t.pos[2]),
      rx: Math.round(t.rot[0]), ry: Math.round(t.rot[1]), rz: Math.round(t.rot[2]),
      size: Math.max(0.15, Math.min(4, r2(t.scale))),
    })
  }

  const randomPose = useCallback(() => {
    const r = (a: number, b: number) => Math.round(a + Math.random() * (b - a))
    // intersecting forms stay upright; only the drill and study poses turn
    setRotationDeg(ixOn ? { x: 0, y: 0, z: 0 } : { x: r(-25, 25), y: r(-45, 45), z: r(-12, 12) })
    setVertPos(r(-130, 130) / 100)
  }, [ixOn])

  const resetView = useCallback(() => {
    setRotationDeg({ x: 0, y: 0, z: 0 })
    setFocalLength(30)
    setResetCount(c => c + 1)
  }, [])

  const startDrill = () => {
    setShapeId("cube")
    setShapeParams({})
    setOrtho(false)
    setIxOn(false)
    randomPose()
    setDrill("guess")
  }

  const setMode = (m: Mode) => {
    if (m === "drill") { setSelection("camera"); startDrill(); return }
    setDrill("off")
    setIxOn(m === "intersect")
    setIxSolo(null)
    setSelection(m === "intersect" ? 1 : 0)
  }

  // Keyboard shortcuts — V/E/S tools · esc deselect · ⌘D copy · ⌘Z undo · 1–8 shapes · = / − zoom · R reset · G guides · A axes ·
  // D dice · T turntable · O ortho · space reveals the drill
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      // ⌘D copies the selected form, ⌘Z undoes the last add, copy or delete
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (k === "d" || k === "z")) {
        e.preventDefault()
        if (k === "d") duplicateSelected(false); else undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // ⇧V / ⇧H flip the selected form, as in Figma
      if (e.shiftKey && (k === "v" || k === "h")) { flipSelected(k); return }
      const idx = "12345678".indexOf(k)
      if (idx >= 0) {
        if (drill !== "off") return   // drilling is cube-only — exit first
        pickShape(ALL_SHAPE_IDS[idx], railTarget)
      }
      else if (k === "=" || k === "+") setZoomAction(a => ({ dir: 1, n: a.n + 1 }))
      else if (k === "-") setZoomAction(a => ({ dir: -1, n: a.n + 1 }))
      else if (k === "r") resetView()
      else if (k === "g") setGuides(v => !v)
      else if (k === "a") setShowAxes(v => !v)
      else if (k === "d") randomPose()
      else if (k === "t") setTurntable(v => !v)
      else if (k === "o") setOrtho(v => !v)
      else if (k === "l") setLightOn(v => !v)
      else if (k === "i" && drill === "off") setMode(ixOn ? "study" : "intersect")
      else if (k === "v") setTool("move")
      else if (k === "e") setTool("rotate")
      else if (k === "s") setTool("scale")
      else if (k === "escape") setSelection("camera")
      else if (k === "delete" || k === "backspace") { e.preventDefault(); deleteSelected() }
      else if (k === " " && drill === "guess") { e.preventDefault(); setDrill("reveal") }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const formShapes = [shapeId, ...(ixOn ? ixForms.map(f => f.shapeId) : [])]
  const toneOf = (k: number) => k === 0 ? INK : FORM_TONES[(ixForms[k - 1].ink ?? k - 1) % FORM_TONES.length]
  const tabs: ["form" | "camera" | "light", string, LucideIcon][] = [
    ["form", ixOn ? `FORM ${LETTERS[af]}` : "FORM", SHAPE_ICONS[formShapes[af]]],
    ["camera", "CAMERA", Camera],
    ["light", "LIGHT", SunMedium],
  ]
  const turnTools: ToolItem[] = [
    [RotateCwSquare,   "Turn 90°",                  () => turnSelected("y", 90)],
    [FlipHorizontal2,  "Mirror left–right (⇧H)",    () => flipSelected("h")],
    [FlipVertical2,    "Flip upside down (⇧V)",     () => flipSelected("v")],
  ]
  const deleteTool: ToolItem = [Trash2, "Delete form (⌫)", deleteSelected]

  const target = formShapes[railTarget]

  return (
    <div className={`plate ${dark ? "dark-plate" : ""} flex h-screen overflow-hidden`} style={{ background: "var(--paper)" }}>

      {/* Canvas, with the tools floating over it */}
      <main className="relative min-w-0 flex-1">
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
            copies={ixOn ? 1 : copies}
            spacing={spacing}
            turntable={turntable}
            ortho={ortho}
            drill={drill}
            facingTint={facingTint}
            lightOn={lightOn}
            lightAz={lightAz}
            lightEl={lightEl}
            shading={shading}
            lightSteps={lightSteps}
            shadowSteps={shadowSteps}
            showShadow={showShadow}
            intersect={intersect}
            seamXray={seamXray}
            onPick={onPick}
            onEye={setEye}
            selected={typeof sel === "number" ? sel : null}
            tool={tool}
            interacting={dragging}
            onTransform={onTransform}
            cameraSet={cameraSet}
          />

        {/* Forms, listed like layers: select, add, solo, delete */}
        {drill === "off" && (
          <div
            className="ink-panel absolute left-3 top-3 z-10 flex max-h-[calc(100%-96px)] w-56 flex-col border"
            style={{
              background: "var(--panel)", borderColor: HAIRLINE,
              boxShadow: "0 6px 20px color-mix(in srgb, var(--ink) 16%, transparent)",
            }}
          >
            <div className="flex flex-none items-center gap-2 border-b py-1.5 pr-1.5 pl-3" style={{ borderColor: HAIRLINE }}>
              <div className="flex-1"><SectionHeader title="FORMS" note={`${formCount} of ${MAX_FORMS}`} /></div>
              <button
                onClick={addForm}
                disabled={formCount >= MAX_FORMS}
                title={formCount >= MAX_FORMS ? `${MAX_FORMS} forms is the most` : ixOn ? "Add a form" : "Add a form — starts an intersection"}
                aria-label="Add a form"
                className="shape-tile flex size-6 flex-none items-center justify-center transition-colors duration-150 disabled:opacity-35"
                style={{ color: INK }}
              >
                <Plus size={14} strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1">
              {formShapes.map((sid, k) => {
                const Icon = SHAPE_ICONS[sid]
                const active = panel === "form" && af === k
                const soloed = ixSolo === k
                const cuts = k === 0 ? aCut : !!ixForms[k - 1].cut
                const L = LETTERS[k]
                return (
                  <div
                    key={k}
                    onClick={() => setSelection(k)}
                    className="shape-tile group flex h-8 flex-none cursor-default items-center gap-2 px-2 transition-colors duration-150"
                    style={{ background: active ? "color-mix(in srgb, var(--ink) 10%, transparent)" : undefined }}
                  >
                    <span className="size-2 flex-none" style={{ background: toneOf(k) }} />
                    <Icon size={14} strokeWidth={1.5} style={{ color: toneOf(k) }} />
                    <span
                      className="flex-1 truncate font-mono text-[11px] tracking-[0.1em]"
                      style={{ color: active ? INK_DEEP : "color-mix(in srgb, var(--ink) 75%, transparent)" }}
                    >
                      {L} · {SHAPE_FULL_LABELS[sid]}
                    </span>
                    {/* soloing and deleting only mean something once there are forms to compare */}
                    {ixOn && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); toggleCut(k) }}
                          title={cuts ? `Form ${L} cuts — make it solid again` : `Cut — form ${L} carves its volume out of the forms it touches`}
                          aria-label={cuts ? `Make form ${L} solid` : `Form ${L} cuts`}
                          aria-pressed={cuts}
                          className={`flex size-6 items-center justify-center transition-opacity duration-150 ${cuts ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                          style={{ color: cuts ? ORANGE_DEEP : FAINT }}
                        >
                          <Scissors size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setIxSolo(soloed ? null : k) }}
                          title={soloed ? "Show every form" : `Show form ${L} alone, with the marks the others leave on it`}
                          aria-label={soloed ? "Show every form" : `Show form ${L} alone`}
                          aria-pressed={soloed}
                          className={`flex size-6 items-center justify-center transition-opacity duration-150 ${soloed ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                          style={{ color: soloed ? ORANGE_DEEP : FAINT }}
                        >
                          <Eye size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); deleteForm(k) }}
                          title={`Delete form ${L} (⌫)`}
                          aria-label={`Delete form ${L}`}
                          className="flex size-6 items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                          style={{ color: FAINT }}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div
          className="ink-panel absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 border p-1"
          style={{
            background: "var(--panel)", borderColor: HAIRLINE,
            boxShadow: "0 6px 20px color-mix(in srgb, var(--ink) 16%, transparent)",
          }}
        >
          {TOOLS.map(([id, title, Icon]) => (
            <IconButton key={id} icon={Icon} title={title} active={tool === id} onClick={() => setTool(id)} />
          ))}
          <div className="mx-1 h-5 w-px" style={{ background: HAIRLINE }} />
          <Dropdown
            icon={SHAPE_ICONS[target]} title="Form (1–8)" width={200} up chevron
            disabled={mode === "drill"}
            open={openMenu === "shapes"}
            onToggle={() => setOpenMenu(m => m === "shapes" ? null : "shapes")}
          >
            <div className="-m-1.5 flex flex-col">
              {ALL_SHAPE_IDS.map((id, i) => {
                const Icon = SHAPE_ICONS[id]
                const active = id === target
                return (
                  <button
                    key={id}
                    onClick={() => { pickShape(id, railTarget); setOpenMenu(null) }}
                    aria-pressed={active}
                    className="shape-tile flex items-center gap-2.5 px-2 py-1.5 font-mono text-[11px] tracking-[0.12em] transition-colors duration-150"
                    style={{
                      background: active ? ORANGE : undefined,
                      color: active ? "var(--ink-deep-fixed)" : "color-mix(in srgb, var(--ink) 80%, transparent)",
                    }}
                  >
                    <Icon size={16} strokeWidth={1.5} />
                    <span className="flex-1 text-left">{SHAPE_FULL_LABELS[id]}</span>
                    <span style={{ opacity: 0.55 }}>{i + 1}</span>
                  </button>
                )
              })}
            </div>
          </Dropdown>
          <div className="mx-1 h-5 w-px" style={{ background: HAIRLINE }} />
          <Dropdown
            icon={Layers} title="Layers" width={272} up
            open={openMenu === "layers"}
            onToggle={() => setOpenMenu(m => m === "layers" ? null : "layers")}
          >
            <div className="grid grid-cols-2 gap-1.5">
              <LayerChip label="GROUND" checked={showGround} onChange={setShowGround} />
              <LayerChip label="GUIDES" checked={guides} onChange={setGuides} />
              {isFaceted(shapeId) && (
                <LayerChip label="AXES" checked={showAxes} onChange={setShowAxes} />
              )}
              <LayerChip label="TOP VIEW" checked={showTopView} onChange={setShowTopView} />
              <LayerChip label="CONE 60°" checked={showCone} onChange={setShowCone} />
              {lightOn && (
                <>
                  <LayerChip label="SHADING" checked={shading} onChange={setShading} />
                  <LayerChip label="CAST SHADOW" checked={showShadow} onChange={setShowShadow} />
                </>
              )}
              {hasRound && (
                <LayerChip label="CONTOURS" checked={showContours} onChange={setShowContours} />
              )}
              {hasRound && showContours && (
                <LayerChip label="WRAP" checked={wrapContours} onChange={setWrapContours} />
              )}
              {ixOn && ixMode !== "overlap" && (
                <LayerChip label="SEAM X-RAY" checked={seamXray} onChange={setSeamXray} />
              )}
              {!isFaceted(shapeId) && shapeId !== "tube" && (
                <LayerChip label="DEGREES" checked={showDegrees} onChange={setShowDegrees} />
              )}
              {shapeId === "tube" && (
                <LayerChip label="FACING" checked={facingTint} onChange={setFacingTint} />
              )}
            </div>
            {shapeId === "tube" && facingTint && (
              <Hint><span style={{ color: ORANGE_DEEP }}>orange</span> ellipses open toward you — ink ones turn away</Hint>
            )}
          </Dropdown>
          <Dropdown
            icon={FolderOpen} title="Scenes" width={280} up
            open={openMenu === "scenes"}
            onToggle={() => setOpenMenu(m => m === "scenes" ? null : "scenes")}
          >
            {SCENES.map(scene => (
              <button
                key={scene.id}
                onClick={() => { loadScene(scene); setOpenMenu(null) }}
                className="shape-tile flex flex-col items-start gap-1 border px-3 py-2.5 text-left transition-colors duration-150"
                style={{ borderColor: "color-mix(in srgb, var(--ink) 25%, transparent)" }}
              >
                <span className="font-mono text-[12px] tracking-[0.14em]" style={{ color: INK_DEEP }}>{scene.label}</span>
                <span className="font-mono text-[11px] leading-relaxed" style={{ color: FAINT }}>{scene.note}</span>
              </button>
            ))}
          </Dropdown>
          <div className="mx-1 h-5 w-px" style={{ background: HAIRLINE }} />
          <IconButton icon={Dices} title="Random pose (D)" onClick={randomPose} />
          <IconButton icon={Rotate3d} title="Turntable (T)" active={turntable} onClick={() => setTurntable(v => !v)} />
          <IconButton icon={RotateCcw} title="Reset view (R)" onClick={resetView} />
        </div>
      </main>

      {/* Properties: the mode on top, then only what belongs to the selection */}
      <aside
        className="ink-panel flex w-72 flex-none flex-col border-l"
        style={{ borderColor: HAIRLINE, background: "var(--panel)" }}
      >
        <div className="flex h-12 flex-none items-center gap-0.5 border-b px-2" style={{ borderColor: HAIRLINE }}>
          {MODES.map(([id, label]) => {
            const active = mode === id
            return (
              <button
                key={id}
                onClick={() => setMode(id)}
                aria-pressed={active}
                className="shape-tile h-8 px-2.5 font-mono text-[11px] tracking-[0.12em] transition-colors duration-150"
                style={{
                  background: active ? "color-mix(in srgb, var(--ink) 10%, transparent)" : undefined,
                  color: active ? INK_DEEP : FAINT,
                }}
              >
                {label}
              </button>
            )
          })}
          <div className="flex-1" />
          <Dropdown
            icon={CircleHelp} title="Help" width={300}
            open={openMenu === "help"}
            onToggle={() => setOpenMenu(m => m === "help" ? null : "help")}
          >
            <div className="flex flex-col gap-2 font-mono text-[12px]" style={{ color: FAINT }}>
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
              <div className="flex items-center gap-2">
                <span className="flex w-[26px] gap-px">
                  {FORM_TONES.map(t => <span key={t} className="h-1.5 flex-1" style={{ background: t }} />)}
                </span>
                <span>forms B → H, each in its own ink</span>
              </div>
              <div className="flex items-center gap-2">
                <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" style={{ stroke: "var(--seam)" }} strokeWidth="3" /></svg>
                <span>seam — where two forms meet</span>
              </div>
              <div className="mt-1 border-t pt-2 leading-relaxed" style={{ borderColor: HAIRLINE }}>
                <p>drag to orbit · scroll to zoom · click a form to select it, then drag its handles · delete removes it · esc deselects</p>
                <p className="mt-1.5">
                  V move · E rotate · S scale · ⇧V / ⇧H flip · ⌥-drag a number to scrub · ⌫ delete form · ⌘D copy form · ⌥-drag a handle to leave a copy · ⌘Z undo · 1–8 shapes · = / − zoom · R reset · D dice · T turntable · O ortho · L light · G guides · A axes · I intersect · space reveals the drill
                </p>
              </div>
            </div>
          </Dropdown>
          <IconButton
            icon={dark ? Sun : Moon}
            title={dark ? "Switch to day plate" : "Switch to night plate"}
            onClick={toggleDark}
          />
        </div>

        <div className="flex flex-none border-b" style={{ borderColor: HAIRLINE }}>
          {tabs.map(([id, label, Icon]) => {
            const active = panel === id
            const tone = id === "form" && af > 0 ? toneOf(af) : ORANGE_DEEP
            return (
              <button
                key={id}
                onClick={() => setPanel(id)}
                aria-pressed={active}
                className="shape-tile -mb-px flex min-w-0 flex-1 flex-col items-center gap-1 whitespace-nowrap border-b-2 pt-2.5 pb-2 font-mono text-[10px] tracking-[0.06em] transition-colors duration-150"
                style={{
                  borderColor: active ? tone : "transparent",
                  color: active ? INK_DEEP : FAINT,
                }}
              >
                <Icon size={16} strokeWidth={1.5} style={{ color: active ? tone : undefined }} />
                {label}
              </button>
            )
          })}
        </div>

        <div className="ink-panel flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">

          {mode === "intersect" && (
            <Segmented
              options={IX_MODES}
              value={ixSolo === null ? ixMode : null}
              onChange={m => { setIxMode(m); setIxSolo(null) }}
            />
          )}

          {mode === "drill" && (
            <section className="flex flex-col gap-3">
              {drill === "guess" ? (
                <button
                  onClick={() => setDrill("reveal")}
                  className="border px-3 py-2 font-mono text-[11px] tracking-[0.18em] text-[var(--ink-deep-fixed)]"
                  style={{ borderColor: ORANGE_DEEP, background: ORANGE }}
                >
                  ◉ REVEAL
                </button>
              ) : (
                <button
                  onClick={() => { randomPose(); setDrill("guess") }}
                  className={`${ACTION} px-3 py-2 text-[11px]`}
                  style={ACTION_BORDER}
                >
                  ⟳ NEW POSE
                </button>
              )}
              <Hint>
                {drill === "guess"
                  ? "only the horizon, the vanishing points and one starting edge remain — picture the cube, then reveal"
                  : "compare what you pictured with the box — then take a new pose"}
              </Hint>
            </section>
          )}

          {sel === 0 && (
            <>
              <section className="flex flex-col gap-3">
                <SectionHeader title={SHAPE_FULL_LABELS[shapeId]} />
                <div className="grid grid-cols-2 gap-1.5">
                  {controls.map(ctrl => {
                    const coilOff = ctrl.key === "coil" && !coilOn
                    return (
                      <NumberField
                        key={ctrl.key}
                        label={ctrl.short}
                        title={ctrl.label}
                        value={params[ctrl.key] ?? ctrl.min}
                        min={ctrl.min} max={ctrl.max} step={ctrl.step}
                        disabled={coilOff}
                        display={coilOff ? "off" : undefined}
                        onChange={v => setShapeParams(prev => ({ ...prev, [ctrl.key]: v }))}
                      />
                    )
                  })}
                </div>
                {shapeId === "tube" && (
                  <ToggleRow label="COIL" checked={coilOn} onChange={setCoilOn} />
                )}
              </section>

              <section className="flex flex-col gap-1.5">
                <div className="mb-1.5"><SectionHeader title="POSITION" note={posText} /></div>
                <div className="grid grid-cols-2 gap-1.5">
                  <NumberField
                    label="Y" title="Height against eye level"
                    value={vertPos} min={-1.5} max={1.5}
                    onChange={setVertPos}
                  />
                  {drill === "off" && <ToolGroup items={ixOn ? [...turnTools, deleteTool] : turnTools} />}
                </div>
                {drill !== "guess" && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {([["x", "Tilt — swings the form's horizon off eye level"],
                       ["y", "Spin — slides the VPs along the horizon"],
                       ["z", "Roll — swings the form's horizon off eye level"]] as const).map(([axis, title]) => (
                      <NumberField
                        key={axis}
                        label={`∠${axis.toUpperCase()}`}
                        title={title}
                        value={rotationDeg[axis]}
                        step={1} wrap={180} unit="°"
                        onChange={v => {
                          markAxisActive(axis)
                          setRotationDeg(prev => ({ ...prev, [axis]: v }))
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>

              {mode === "study" && (
                <section className="flex flex-col gap-3">
                  <SectionHeader title="REPEAT" note={copies === 1 ? "off" : `${copies} in a row`} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberField
                      label="COPIES" value={copies} min={1} max={6} step={1}
                      onChange={setCopies}
                    />
                    <NumberField
                      label="GAP" title="Equal steps in space shrink lawfully toward the VP"
                      value={spacing} min={0.6} max={3} step={0.05}
                      disabled={copies === 1}
                      onChange={setSpacing}
                    />
                  </div>
                </section>
              )}
            </>
          )}

          {typeof sel === "number" && sel > 0 && (() => {
            const i = sel - 1
            const f = ixForms[i]
            const letter = LETTERS[sel]
            const { depth } = sightDepth(f.pose)
            return (
              <>
                <section className="flex flex-col gap-3">
                  <SectionHeader title={SHAPE_FULL_LABELS[f.shapeId]} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberField
                      label="SIZE" value={Math.round(f.pose.size * 100)} min={15} max={400} step={1} unit="%"
                      onChange={v => setPose(i, { size: v / 100 })}
                    />
                    <NumberField
                      label="DEPTH"
                      title={`Slides form ${letter} along your line of sight and scales it in step — the drawing looks the same, the seams don't. Negative is nearer.`}
                      value={depth} min={-2} max={2}
                      onChange={v => setSightDepth(i, v)}
                    />
                  </div>
                </section>
                <section className="flex flex-col gap-1.5">
                  <div className="mb-1.5"><SectionHeader title="POSITION" note="from A" /></div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["x", "y", "z"] as const).map(key => (
                      <NumberField
                        key={key} label={key.toUpperCase()}
                        value={f.pose[key]} min={-1.5} max={1.5}
                        onChange={v => setPose(i, { [key]: v })}
                      />
                    ))}
                    {(["rx", "ry", "rz"] as const).map(key => (
                      <NumberField
                        key={key} label={`∠${key[1].toUpperCase()}`}
                        value={Math.round(f.pose[key])} step={1} wrap={180} unit="°"
                        onChange={v => setPose(i, { [key]: v })}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <ToolGroup items={turnTools} />
                    <ToolGroup items={[
                      [RotateCcw, `Reset form ${letter}`, () => setPose(i, homeFor(i))],
                      [Dices, `Random placement for form ${letter}`, () => shuffleIx(i)],
                      deleteTool,
                    ]} />
                  </div>
                </section>
              </>
            )
          })()}

          {sel !== "camera" && sel !== "light" && hasRound && showContours && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="CONTOURS" />
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="RINGS" value={uRings} min={1} max={16} step={1} onChange={setURings} />
              </div>
            </section>
          )}

          {sel === "camera" && (
            <section className="flex flex-col gap-4">
              <SectionHeader title="LENS" />
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField
                  label="FOCAL" value={focalLength} min={20} max={135} step={1}
                  unit="mm" display={ortho ? "∞" : undefined} disabled={ortho}
                  onChange={setFocalLength}
                />
              </div>
              <Hint>
                {ortho
                  ? "parallel projection — depth without diminution"
                  : focalLength < 28
                  ? "wide angle — VPs pull close, drama up"
                  : focalLength <= 60
                  ? "normal lens — close to human vision"
                  : "telephoto — VPs fly apart, space flattens"}
              </Hint>
              <ToggleRow label="ORTHOGRAPHIC" checked={ortho} onChange={setOrtho} />
              <ToggleRow label="TURNTABLE" checked={turntable} onChange={setTurntable} />
              <button onClick={resetView} className={`${ACTION} px-3 py-2.5`} style={ACTION_BORDER}>
                ⟲ RESET VIEW
              </button>
            </section>
          )}

          {sel === "light" && (
            <section className="flex flex-col gap-4">
              <SectionHeader title="SUN" />
              <ToggleRow label="SUNLIGHT" checked={lightOn} onChange={setLightOn} />
              {lightOn && (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberField
                      label="AZ" title="Azimuth — the sun's bearing around the form"
                      value={lightAz} step={1} wrap={360} unit="°" onChange={setLightAz}
                    />
                    <NumberField
                      label="EL" title="Elevation — the sun's height above the ground"
                      value={lightEl} min={10} max={80} step={1} unit="°" onChange={setLightEl}
                    />
                    <NumberField
                      label="LIGHT" title="Light values: halftone → highlight (1 = pure white)"
                      value={lightSteps} min={1} max={LIGHT_MAX_STEPS} step={1} onChange={setLightSteps}
                    />
                    <NumberField
                      label="SHADOW" title="Shadow values: core → reflected (1 = pure black)"
                      value={shadowSteps} min={1} max={LIGHT_MAX_STEPS} step={1} onChange={setShadowSteps}
                    />
                  </div>
                  <Hint>
                    {lightEl < 25
                      ? "low sun — long cast shadows, the terminator leans"
                      : lightEl <= 55
                      ? "mid sun — the classic three-quarter light"
                      : "high sun — tops blaze, shadows tuck under the form"}
                  </Hint>
                  {/* value scale: shadow side (core → reflected) | light side (halftone → highlight) */}
                  {(() => {
                    const bands = valueBands(lightSteps, shadowSteps)
                    const swatch = (v: number, key: string) => (
                      <div
                        key={key}
                        className="h-5 flex-1 border"
                        style={{
                          background: `rgb(${Math.round(v * 255)}, ${Math.round(v * 255)}, ${Math.round(v * 255)})`,
                          borderColor: "color-mix(in srgb, var(--ink) 30%, transparent)",
                        }}
                      />
                    )
                    return (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-stretch gap-0.5">
                          {bands.shadow.map((v, i) => swatch(v, `s${i}`))}
                          <div className="w-px self-stretch mx-1" style={{ background: "var(--red)" }} />
                          {bands.light.map((v, i) => swatch(v, `l${i}`))}
                        </div>
                        <div className="flex justify-between font-mono text-[11px] tracking-[0.12em]" style={{ color: "color-mix(in srgb, var(--ink) 55%, transparent)" }}>
                          <span>SHADOW</span>
                          <span style={{ color: "var(--red)" }}>terminator</span>
                          <span>LIGHT</span>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
