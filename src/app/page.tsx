"use client";

import { useState } from "react";
import { PerspectiveCanvas } from "@/components/perspective-canvas";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const INK = "#5B5BD6";

export default function Home() {
  const [verticalPosition, setVerticalPosition] = useState(0);
  const [rotationDeg, setRotationDeg] = useState(35);
  const [showGuides, setShowGuides] = useState(true);

  const rotation = (rotationDeg / 90) * (Math.PI / 2);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#eef0f7" }}>
      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <PerspectiveCanvas
          verticalPosition={verticalPosition}
          rotation={rotation}
          showGuides={showGuides}
        />
      </div>

      {/* Side panel */}
      <aside
        className="w-64 flex-none flex flex-col gap-8 p-6 border-l"
        style={{ borderColor: `${INK}22` }}
      >
        <p
          className="font-mono text-xs tracking-widest"
          style={{ color: INK }}
        >
          [ CONTROLS ]
        </p>

        {/* Vertical position */}
        <div className="flex flex-col gap-3">
          <Label
            className="font-mono text-xs tracking-wider"
            style={{ color: INK }}
          >
            VERTICAL POSITION
          </Label>
          <Slider
            min={-150}
            max={150}
            step={1}
            value={Math.round(verticalPosition * 100)}
            onValueChange={(v) => setVerticalPosition((v as number) / 100)}
          />
          <p className="font-mono text-xs" style={{ color: `${INK}88` }}>
            {verticalPosition > 0.06
              ? "above eye level"
              : verticalPosition < -0.06
              ? "below eye level"
              : "at eye level"}
          </p>
        </div>

        {/* Rotation */}
        <div className="flex flex-col gap-3">
          <Label
            className="font-mono text-xs tracking-wider"
            style={{ color: INK }}
          >
            Y-AXIS ROTATION
          </Label>
          <Slider
            min={5}
            max={85}
            step={1}
            value={rotationDeg}
            onValueChange={(v) => setRotationDeg(v as number)}
          />
          <p className="font-mono text-xs" style={{ color: `${INK}88` }}>
            {rotationDeg}°
          </p>
        </div>

        {/* Show guides */}
        <div className="flex items-center gap-3">
          <Switch
            checked={showGuides}
            onCheckedChange={setShowGuides}
          />
          <Label
            className="font-mono text-xs tracking-wider"
            style={{ color: INK }}
          >
            SHOW GUIDES
          </Label>
        </div>

        {/* Hint text */}
        <div
          className="mt-auto font-mono text-xs leading-relaxed"
          style={{ color: `${INK}55` }}
        >
          <p>Move the cube above or below the horizon to see how top and bottom faces appear.</p>
          <br />
          <p>Rotate to push the vanishing points off screen.</p>
        </div>
      </aside>
    </div>
  );
}
