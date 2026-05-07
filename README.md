# 3D Form Explorer

An interactive tool for understanding how 3D forms exist in space — their contour lines, silhouettes, and how perspective governs what you see from any given viewpoint.

The motivation is simple: before you can draw or design something in three dimensions, you need to feel how it sits in space. This tool makes that tangible. You can rotate shapes, move them above and below eye level, stretch their proportions, and watch how the perspective lines respond in real time.

## What it does

Every shape is rendered using a three-layer WebGL pipeline that mirrors how a technical illustrator would draw it:

1. **Depth mask** — an invisible solid that writes depth values, so the renderer knows what's in front and what's behind
2. **Ghost edges** — all structural lines drawn at low opacity, ignoring depth, so you can see through the form
3. **Solid edges** — the same lines drawn at full opacity with depth testing, so only front-facing edges survive

The result: front edges are solid, back edges are faint. No filled surfaces, no lighting — just the geometry made legible.

A 2D canvas overlay draws the perspective construction on top: horizon line, vanishing points, and (for the cube) construction lines extending each corner back to the VPs.

## Shapes

| Shape | What's interesting |
|---|---|
| Cube | Width, height, and depth are independent — see how changing depth shifts the vanishing points |
| Cylinder | Contour rings are evenly spaced; silhouette lines are computed analytically, not sampled |

More shapes coming: sphere, capsule, cone, torus, tube (curved cylinder via spline).

## Controls

- **Shape selector** — switch between forms; params reset on each switch
- **Vertical position** — move the shape above or below the horizon to see how foreshortening changes
- **Y-axis rotation** — rotate around the vertical axis; watch the VP spread change
- **Shape params** — width/height/depth for cube; radius/height for cylinder
- **Contour rings** — add or remove horizontal cross-sections on curved forms
- **Show contours** — toggle contour rings on/off
- **Show guides** — toggle VP construction lines

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
