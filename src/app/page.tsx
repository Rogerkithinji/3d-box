"use client"

import { useState } from "react"
import { ThreeCube } from "@/components/three-cube"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  SHAPE_LABELS, getParametricShape,
  CUBE_CONTROLS, CUBE_DEFAULT_PARAMS,
  SPHERE_CONTROLS, SPHERE_DEFAULT_PARAMS,
  TUBE_CONTROLS, TUBE_DEFAULT_PARAMS,
  type ShapeId, type ShapeParams,
} from "@/lib/shapes"

const INK = "#5B5BD6"

export default function Home() {
  const [shapeId,      setShapeId]      = useState<ShapeId>("cube")
  const [shapeParams,  setShapeParams]  = useState<ShapeParams>({})
  const [uRings,       setURings]       = useState(6)
  const [showContours, setShowContours] = useState(true)
  const [vertPos,      setVertPos]      = useState(0)
  const [guides,       setGuides]       = useState(true)
  const [resetCount,   setResetCount]   = useState(0)

  const shapeDef = shapeId !== "cube" && shapeId !== "tube" ? getParametricShape(shapeId) : null
  const params   = shapeId === "cube"    ? { ...CUBE_DEFAULT_PARAMS,   ...shapeParams }
                 : shapeId === "sphere" ? { ...SPHERE_DEFAULT_PARAMS, ...shapeParams }
                 : shapeId === "tube"   ? { ...TUBE_DEFAULT_PARAMS,   ...shapeParams }
                 : shapeDef            ? { ...shapeDef.defaultParams, ...shapeParams } : {}
  const controls = shapeId === "cube"    ? CUBE_CONTROLS
                 : shapeId === "sphere" ? SPHERE_CONTROLS
                 : shapeId === "tube"   ? TUBE_CONTROLS
                 : (shapeDef?.controls ?? [])

  const handleShapeChange = (id: ShapeId) => {
    setShapeId(id)
    setShapeParams({})
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#eef0f7" }}>

      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <ThreeCube
          shapeId={shapeId}
          shapeParams={params}
          uRings={uRings}
          verticalPosition={vertPos}
          showGuides={guides}
          showContours={showContours}
          resetCount={resetCount}
        />
      </div>

      {/* Controls */}
      <aside
        className="w-60 flex-none flex flex-col gap-6 p-6 border-l overflow-y-auto"
        style={{ borderColor: `${INK}22` }}
      >
        <p className="font-mono text-xs tracking-widest" style={{ color: INK }}>
          [ CONTROLS ]
        </p>

        {/* Shape selector */}
        <div className="flex flex-col gap-2">
          <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
            SHAPE
          </Label>
          <div className="flex flex-wrap gap-1">
            {(["cube", "cylinder", "sphere", "capsule", "cone", "egg", "tube"] as ShapeId[]).map(id => (
              <button
                key={id}
                onClick={() => handleShapeChange(id)}
                className="font-mono text-xs px-2 py-1 border transition-colors"
                style={{
                  borderColor: `${INK}44`,
                  background: shapeId === id ? INK : "transparent",
                  color: shapeId === id ? "#fff" : `${INK}99`,
                }}
              >
                {SHAPE_LABELS[id]}
              </button>
            ))}
          </div>
        </div>

        {/* Common controls */}
        <div className="flex flex-col gap-3">
          <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
            VERTICAL POSITION
          </Label>
          <Slider
            min={-150} max={150} step={1}
            value={Math.round(vertPos * 100)}
            onValueChange={(v) => setVertPos((v as number) / 100)}
          />
          <p className="font-mono text-xs" style={{ color: `${INK}66` }}>
            {vertPos > 0.06 ? "above eye level" : vertPos < -0.06 ? "below eye level" : "at eye level"}
          </p>
        </div>

        {/* Shape-specific params */}
        {controls.map(ctrl => (
          <div key={ctrl.key} className="flex flex-col gap-3">
            <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
              {ctrl.label}
            </Label>
            <Slider
              min={Math.round(ctrl.min * 100)}
              max={Math.round(ctrl.max * 100)}
              step={1}
              value={Math.round((params[ctrl.key] ?? ctrl.min) * 100)}
              onValueChange={(v) =>
                setShapeParams(prev => ({ ...prev, [ctrl.key]: (v as number) / 100 }))
              }
            />
            <p className="font-mono text-xs" style={{ color: `${INK}66` }}>
              {(params[ctrl.key] ?? ctrl.min).toFixed(2)}
            </p>
          </div>
        ))}

        {/* Contour ring count — only visible when contours are on */}
        {shapeId !== "cube" && showContours && (
          <div className="flex flex-col gap-3">
            <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
              CONTOUR RINGS
            </Label>
            <Slider
              min={1} max={16} step={1}
              value={uRings}
              onValueChange={(v) => setURings(v as number)}
            />
            <p className="font-mono text-xs" style={{ color: `${INK}66` }}>
              {uRings} ring{uRings !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {shapeId !== "cube" && (
          <div className="flex items-center gap-3">
            <Switch checked={showContours} onCheckedChange={setShowContours} />
            <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
              SHOW CONTOURS
            </Label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Switch checked={guides} onCheckedChange={setGuides} />
          <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
            SHOW GUIDES
          </Label>
        </div>

        <button
          onClick={() => setResetCount(c => c + 1)}
          className="font-mono text-xs px-3 py-1.5 border w-full transition-colors"
          style={{ borderColor: `${INK}44`, color: `${INK}99` }}
        >
          RESET VIEW
        </button>

        <div className="mt-auto font-mono text-xs leading-relaxed" style={{ color: `${INK}44` }}>
          <p>Drag to orbit.</p>
          <p>Scroll to zoom.</p>
          <p>Front edges solid.</p>
          <p>Hidden edges faint.</p>
        </div>
      </aside>
    </div>
  )
}
