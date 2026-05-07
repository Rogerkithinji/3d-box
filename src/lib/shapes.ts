export type ShapeId = "cube" | "cylinder" | "capsule" | "cone" | "egg"

export interface ControlDef {
  key: string
  label: string
  min: number
  max: number
  step: number
}

export interface ShapeParams {
  [key: string]: number
}

export interface ParametricShapeDef {
  id: Exclude<ShapeId, "cube">
  label: string
  controls: ControlDef[]
  defaultParams: ShapeParams
  surface: (u: number, v: number, params: ShapeParams) => [number, number, number]
}

export const SHAPE_LABELS: Record<ShapeId, string> = {
  cube:     "CUBE",
  cylinder: "CYL",
  capsule:  "CAPS",
  cone:     "CONE",
  egg:      "EGG",
}

export const ALL_SHAPE_IDS: ShapeId[] = ["cube", "cylinder", "capsule", "cone", "egg"]

export const PARAMETRIC_SHAPES: ParametricShapeDef[] = [
  {
    id: "cylinder",
    label: "CYLINDER",
    controls: [
      { key: "radius", label: "RADIUS", min: 0.15, max: 1.2, step: 0.01 },
      { key: "height", label: "HEIGHT", min: 0.3,  max: 2.5, step: 0.01 },
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
      { key: "radius",    label: "RADIUS",        min: 0.15, max: 1.0,  step: 0.01 },
      { key: "height",    label: "HEIGHT",        min: 0.1,  max: 2.5,  step: 0.01 },
      { key: "roundness", label: "CAP ROUNDNESS", min: 0.02, max: 0.49, step: 0.01 },
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
      { key: "baseRadius", label: "BASE RADIUS", min: 0.1,  max: 1.2, step: 0.01 },
      { key: "topRadius",  label: "TOP RADIUS",  min: 0.0,  max: 0.8, step: 0.01 },
      { key: "height",     label: "HEIGHT",      min: 0.3,  max: 2.5, step: 0.01 },
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
      { key: "radius", label: "RADIUS", min: 0.15, max: 1.0, step: 0.01 },
      { key: "height", label: "HEIGHT", min: 0.3,  max: 2.5, step: 0.01 },
      { key: "taper",  label: "TAPER",  min: -0.8, max: 0.8, step: 0.01 },
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
  { key: "width",  label: "WIDTH",  min: 0.4, max: 2.0, step: 0.01 },
  { key: "height", label: "HEIGHT", min: 0.4, max: 2.0, step: 0.01 },
  { key: "depth",  label: "DEPTH",  min: 0.4, max: 2.0, step: 0.01 },
]

export const CUBE_DEFAULT_PARAMS: ShapeParams = { width: 1.1, height: 1.1, depth: 1.1 }

export function getParametricShape(id: ShapeId): ParametricShapeDef | undefined {
  return PARAMETRIC_SHAPES.find(s => s.id === id)
}
