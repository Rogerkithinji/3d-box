"use client"

import { useState } from "react"
import { ThreeCube } from "@/components/three-cube"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"

const INK = "#5B5BD6"

export default function Home() {
  const [rotDeg,  setRotDeg]  = useState(35)
  const [vertPos, setVertPos] = useState(0)
  const [guides,  setGuides]  = useState(true)

  const rotation = (rotDeg / 90) * (Math.PI / 2)

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#eef0f7" }}>

      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <ThreeCube
          rotation={rotation}
          verticalPosition={vertPos}
          showGuides={guides}
        />
      </div>

      {/* Controls */}
      <aside
        className="w-60 flex-none flex flex-col gap-7 p-6 border-l"
        style={{ borderColor: `${INK}22` }}
      >
        <p className="font-mono text-xs tracking-widest" style={{ color: INK }}>
          [ CONTROLS ]
        </p>

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

        <div className="flex flex-col gap-3">
          <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
            Y-AXIS ROTATION
          </Label>
          <Slider
            min={5} max={85} step={1}
            value={rotDeg}
            onValueChange={(v) => setRotDeg(v as number)}
          />
          <p className="font-mono text-xs" style={{ color: `${INK}66` }}>
            {rotDeg}°
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={guides} onCheckedChange={setGuides} />
          <Label className="font-mono text-xs tracking-wider" style={{ color: INK }}>
            SHOW GUIDES
          </Label>
        </div>

        <div className="mt-auto font-mono text-xs leading-relaxed" style={{ color: `${INK}44` }}>
          <p>Front edges solid.</p>
          <p>Hidden edges faint.</p>
        </div>
      </aside>
    </div>
  )
}
