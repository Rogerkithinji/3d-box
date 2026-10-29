// Scenes: a whole arrangement of forms plus the viewpoint it was drawn
// from, so a sketch can be rebuilt on the plate and its seams studied.

import type { ExtraForm } from "./intersect"
import type { ShapeId, ShapeParams } from "./shapes"

export interface Scene {
  id:     string
  label:  string
  note:   string
  formA:  {
    shapeId:  ShapeId
    params:   ShapeParams
    rotation: { x: number; y: number; z: number }
    vertPos:  number
  }
  forms:  ExtraForm[]
  camera: [number, number, number]
  focal:  number
}

export const SCENES: Scene[] = [
  {
    id: "img-1262",
    label: "SKETCH 1262",
    note: "box, cone, sphere — from your ink drawing, with the forms upright",
    formA: { shapeId: "cube", params: {}, rotation: { x: 0, y: 0, z: 0 }, vertPos: 0 },
    forms: [
      {
        // cone standing upright beside the box, its base sunk into the
        // box's left side (intersecting forms are always kept upright)
        shapeId: "cone",
        params: { baseRadius: 0.62, topRadius: 0, height: 1.5 },
        pose: { x: -0.85, y: 0.2, z: 0, rx: 0, ry: 0, rz: 0, size: 1 },
      },
      {
        // sphere over the lower right of the front face; its depth is the
        // open question the drawing leaves
        shapeId: "sphere",
        params: {},
        pose: { x: 0.38, y: -0.32, z: 0.55, rx: 0, ry: 0, rz: 0, size: 0.82 },
      },
    ],
    camera: [-1.45, 1.45, 4.55],
    focal: 30,
  },
]
