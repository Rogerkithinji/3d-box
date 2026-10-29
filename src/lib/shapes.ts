export type ShapeId = "cube" | "pyramid" | "cylinder" | "sphere" | "capsule" | "cone" | "egg" | "tube"

export interface ControlDef {
  key: string
  label: string
  /** the few letters shown inside a compact number field */
  short: string
  min: number
  max: number
  step: number
}

export interface ShapeParams {
  [key: string]: number
}

export interface ParametricShapeDef {
  id: Exclude<ShapeId, "cube" | "pyramid">
  label: string
  controls: ControlDef[]
  defaultParams: ShapeParams
  surface: (u: number, v: number, params: ShapeParams) => [number, number, number]
}

export const SHAPE_LABELS: Record<ShapeId, string> = {
  cube:     "CUBE",
  pyramid:  "PYR",
  cylinder: "CYL",
  sphere:   "SPH",
  capsule:  "CAPS",
  cone:     "CONE",
  egg:      "EGG",
  tube:     "TUBE",
}

export const SHAPE_FULL_LABELS: Record<ShapeId, string> = {
  cube:     "CUBE",
  pyramid:  "PYRAMID",
  cylinder: "CYLINDER",
  sphere:   "SPHERE",
  capsule:  "CAPSULE",
  cone:     "CONE",
  egg:      "EGG",
  tube:     "TUBE",
}

// Forms bounded by flat faces: drawn by their edges, free to turn on all
// three axes, and seated on their lowest corner
export const isFaceted = (id: ShapeId) => id === "cube" || id === "pyramid"

export const ALL_SHAPE_IDS: ShapeId[] = ["cube", "pyramid", "cylinder", "sphere", "capsule", "cone", "egg", "tube"]

export const PARAMETRIC_SHAPES: ParametricShapeDef[] = [
  {
    id: "cylinder",
    label: "CYLINDER",
    controls: [
      { key: "radius", label: "RADIUS", short: "R", min: 0.15, max: 1.2, step: 0.01 },
      { key: "height", label: "HEIGHT", short: "H", min: 0.3,  max: 2.5, step: 0.01 },
    ],
    defaultParams: { radius: 0.5, height: 1.5 },
    surface(u, v, { radius, height }) {
      const a = 2 * Math.PI * v
      return [radius * Math.cos(a), height * (u - 0.5), radius * Math.sin(a)]
    },
  },
  {
    id: "capsule",
    label: "CAPSULE",
    controls: [
      { key: "radius",    label: "RADIUS", short: "R",        min: 0.15, max: 1.0,  step: 0.01 },
      { key: "height",    label: "HEIGHT", short: "H",        min: 0.1,  max: 2.5,  step: 0.01 },
      { key: "roundness", label: "CAP ROUNDNESS", short: "CAP", min: 0.02, max: 0.49, step: 0.01 },
    ],
    defaultParams: { radius: 0.45, height: 1.0, roundness: 0.28 },
    surface(u, v, { radius, height, roundness }) {
      const a = 2 * Math.PI * v
      const c = roundness
      let r: number
      if (u < c) {
        r = radius * Math.sin((Math.PI / 2) * (u / c))
      } else if (u > 1 - c) {
        r = radius * Math.sin((Math.PI / 2) * ((1 - u) / c))
      } else {
        r = radius
      }
      return [r * Math.cos(a), height * (u - 0.5), r * Math.sin(a)]
    },
  },
  {
    id: "cone",
    label: "CONE",
    controls: [
      { key: "baseRadius", label: "BASE RADIUS", short: "BASE", min: 0.1,  max: 1.2, step: 0.01 },
      { key: "topRadius",  label: "TOP RADIUS", short: "TOP",  min: 0.0,  max: 0.8, step: 0.01 },
      { key: "height",     label: "HEIGHT", short: "H",      min: 0.3,  max: 2.5, step: 0.01 },
    ],
    defaultParams: { baseRadius: 0.65, topRadius: 0.05, height: 1.5 },
    surface(u, v, { baseRadius, topRadius, height }) {
      const a = 2 * Math.PI * v
      const r = baseRadius + (topRadius - baseRadius) * u
      return [r * Math.cos(a), height * (u - 0.5), r * Math.sin(a)]
    },
  },
  {
    id: "egg",
    label: "EGG",
    controls: [
      { key: "radius", label: "RADIUS", short: "R", min: 0.15, max: 1.0, step: 0.01 },
      { key: "height", label: "HEIGHT", short: "H", min: 0.3,  max: 2.5, step: 0.01 },
      { key: "taper",  label: "TAPER", short: "TAPER",  min: -0.8, max: 0.8, step: 0.01 },
    ],
    defaultParams: { radius: 0.5, height: 1.5, taper: 0.35 },
    surface(u, v, { radius, height, taper }) {
      const a = 2 * Math.PI * v
      const peak = Math.max(0.05, Math.min(0.95, 0.5 + taper * 0.3))
      const r = u < peak
        ? radius * Math.sin((Math.PI / 2) * (u / peak))
        : radius * Math.sin((Math.PI / 2) * ((1 - u) / (1 - peak)))
      return [r * Math.cos(a), height * (u - 0.5), r * Math.sin(a)]
    },
  },
]

export const CUBE_CONTROLS: ControlDef[] = [
  { key: "width",  label: "WIDTH", short: "W",  min: 0.4, max: 2.0, step: 0.01 },
  { key: "height", label: "HEIGHT", short: "H", min: 0.4, max: 2.0, step: 0.01 },
  { key: "depth",  label: "DEPTH", short: "D",  min: 0.4, max: 2.0, step: 0.01 },
]

export const CUBE_DEFAULT_PARAMS: ShapeParams = { width: 1.1, height: 1.1, depth: 1.1 }

// Square-based pyramid in the same bounding box as the cube: base on the
// floor of the box, apex straight above its centre
export const PYRAMID_CONTROLS: ControlDef[] = [
  { key: "width",  label: "WIDTH", short: "W",  min: 0.4, max: 2.0, step: 0.01 },
  { key: "height", label: "HEIGHT", short: "H", min: 0.4, max: 2.5, step: 0.01 },
  { key: "depth",  label: "DEPTH", short: "D",  min: 0.4, max: 2.0, step: 0.01 },
]

export const PYRAMID_DEFAULT_PARAMS: ShapeParams = { width: 1.3, height: 1.3, depth: 1.3 }

export function getParametricShape(id: ShapeId): ParametricShapeDef | undefined {
  return PARAMETRIC_SHAPES.find(s => s.id === id)
}

export const SPHERE_CONTROLS: ControlDef[] = [
  { key: "radius", label: "RADIUS", short: "R", min: 0.2, max: 1.5, step: 0.01 },
]

export const SPHERE_DEFAULT_PARAMS: ShapeParams = { radius: 0.8 }

export const TUBE_CONTROLS: ControlDef[] = [
  { key: "radius", label: "MID RADIUS", short: "R", min: 0.05, max: 0.45, step: 0.01 },
  { key: "taper",  label: "TAPER ENDS", short: "TAPER", min: 0,    max: 0.85, step: 0.01 },
  { key: "length", label: "LENGTH", short: "LEN",     min: 0.5,  max: 3.0,  step: 0.01 },
  { key: "bendA",  label: "BEND · A", short: "BEND A",   min: -1.5, max: 1.5,  step: 0.01 },
  { key: "bendB",  label: "BEND · B", short: "BEND B",   min: -1.5, max: 1.5,  step: 0.01 },
  { key: "coil",   label: "COIL · TURNS", short: "COIL", min: -2.5, max: 2.5, step: 0.01 },
]

export const TUBE_DEFAULT_PARAMS: ShapeParams = { radius: 0.2, taper: 0.35, length: 2.2, bendA: 0.7, bendB: 0.7, coil: 0 }
