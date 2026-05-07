"use client";

import { useCallback, useEffect, useRef } from "react";

interface Props {
  verticalPosition: number; // world units, positive = above horizon
  rotation: number;         // radians, 0.05 – PI/2-0.05
  showGuides: boolean;
}

const INK = "#5B5BD6";
const INK_FAINT = "rgba(91,91,214,0.18)";
const BG = "#eef0f7";
const DOT = "#c0c4dc";

type Face = "right" | "left" | "front" | "back" | "top" | "bottom";

// Cube vertices: right-hand, Y-up, centered at origin
// 0-3 = back face (z=-h), 4-7 = front face (z=+h)
const RAW_VERTS: [number, number, number][] = [
  [-1, -1, -1], // 0 left  bottom back
  [ 1, -1, -1], // 1 right bottom back
  [ 1,  1, -1], // 2 right top    back
  [-1,  1, -1], // 3 left  top    back
  [-1, -1,  1], // 4 left  bottom front
  [ 1, -1,  1], // 5 right bottom front
  [ 1,  1,  1], // 6 right top    front
  [-1,  1,  1], // 7 left  top    front
];

// Edge → the two faces it borders
const EDGE_FACES: [number, number, Face, Face][] = [
  [0, 1, "back",  "bottom"],
  [1, 2, "back",  "right"],
  [2, 3, "back",  "top"],
  [3, 0, "back",  "left"],
  [4, 5, "front", "bottom"],
  [5, 6, "front", "right"],
  [6, 7, "front", "top"],
  [7, 4, "front", "left"],
  [0, 4, "left",  "bottom"],
  [1, 5, "right", "bottom"],
  [2, 6, "right", "top"],
  [3, 7, "left",  "top"],
];

// Unrotated face outward normals
const FACE_NORMALS: Record<Face, [number, number, number]> = {
  right:  [ 1, 0,  0],
  left:   [-1, 0,  0],
  front:  [ 0, 0,  1],
  back:   [ 0, 0, -1],
  top:    [ 0, 1,  0],
  bottom: [ 0,-1,  0],
};

export function PerspectiveCanvas({ verticalPosition, rotation, showGuides }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = W / 2;
    const cy = H / 2;
    const f = Math.min(W, H) * 0.55; // focal length
    const DEPTH = 4;                  // cube distance from camera
    const HALF = 0.55;                // half-size of cube
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // --- helpers ---
    const project = (wx: number, wy: number, wz: number): [number, number] => [
      cx + (wx / wz) * f,
      cy - (wy / wz) * f,
    ];

    const rotateY = (x: number, y: number, z: number): [number, number, number] => [
      cos * x + sin * z,
      y,
      -sin * x + cos * z,
    ];

    // --- background ---
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // dot grid
    const spacing = 24;
    ctx.fillStyle = DOT;
    for (let gx = spacing; gx < W; gx += spacing)
      for (let gy = spacing; gy < H; gy += spacing) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1, 0, Math.PI * 2);
        ctx.fill();
      }

    // --- transform cube vertices ---
    const verts = RAW_VERTS.map(([x, y, z]) => {
      const [rx, ry, rz] = rotateY(x * HALF, y * HALF, z * HALF);
      return [rx, ry + verticalPosition, rz + DEPTH] as [number, number, number];
    });
    const sv = verts.map(([x, y, z]) => project(x, y, z));

    // --- vanishing points ---
    // Depth edges (back↔front) travel in direction (sinθ, 0, cosθ) → VP_R = cx + f·tan(θ)
    const vp1x = Math.abs(cos) > 0.01 ? cx + f * (sin / cos) : (sin > 0 ? 9e4 : -9e4);
    // Horizontal edges (left↔right) travel in direction (cosθ, 0, −sinθ) → VP_L = cx − f·cot(θ)
    const vp2x = Math.abs(sin) > 0.01 ? cx - f * (cos / sin) : (cos > 0 ? -9e4 : 9e4);
    const vpy = cy;

    // --- face visibility ---
    const viewVec = (() => {
      // camera at origin, cube center at (0, verticalPosition, DEPTH)
      const dx = 0, dy = -verticalPosition, dz = -DEPTH;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return [dx / len, dy / len, dz / len] as [number, number, number];
    })();

    const faceVisible = (face: Face): boolean => {
      const [nx, ny, nz] = FACE_NORMALS[face];
      const [rnx, rny, rnz] = rotateY(nx, ny, nz);
      return rnx * viewVec[0] + rny * viewVec[1] + rnz * viewVec[2] > 0;
    };

    const vis: Record<Face, boolean> = {
      right:  faceVisible("right"),
      left:   faceVisible("left"),
      front:  faceVisible("front"),
      back:   faceVisible("back"),
      top:    faceVisible("top"),
      bottom: faceVisible("bottom"),
    };

    // --- horizon line ---
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.fillStyle = INK;
    ctx.font = "10px monospace";
    ctx.globalAlpha = 0.6;
    ctx.fillText("EYE LEVEL", 14, cy - 7);
    ctx.globalAlpha = 1;

    // --- VP markers + labels ---
    const drawVP = (vpx: number, label: string) => {
      const onScreen = vpx > 0 && vpx < W;
      if (onScreen) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(vpx - 7, vpy); ctx.lineTo(vpx + 7, vpy);
        ctx.moveTo(vpx, vpy - 7); ctx.lineTo(vpx, vpy + 7);
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.font = "10px monospace";
        const isRight = vpx > cx;
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, isRight ? vpx + 10 : vpx - 10 - tw, vpy - 9);
      } else {
        // arrow at edge pointing off-screen
        const atEdge = vpx < 0 ? 14 : W - 14;
        const arrow = vpx < 0 ? "← " : " →";
        ctx.fillStyle = INK;
        ctx.font = "10px monospace";
        ctx.globalAlpha = 0.6;
        ctx.fillText(
          vpx < 0 ? arrow + label : label + arrow,
          vpx < 0 ? atEdge : atEdge - ctx.measureText(label + arrow).width,
          vpy - 9,
        );
        ctx.globalAlpha = 1;
      }
    };
    drawVP(vp1x, "VP_R");
    drawVP(vp2x, "VP_L");

    // --- construction lines ---
    if (showGuides) {
      ctx.strokeStyle = INK_FAINT;
      ctx.lineWidth = 0.75;
      ctx.setLineDash([3, 7]);
      const cap = (v: number) => Math.max(-3000, Math.min(W + 3000, v));
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(sv[i][0], sv[i][1]);
        ctx.lineTo(cap(vp1x), vpy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sv[i][0], sv[i][1]);
        ctx.lineTo(cap(vp2x), vpy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // --- cube edges ---
    EDGE_FACES.forEach(([a, b, f1, f2]) => {
      const hidden = !vis[f1] && !vis[f2];
      ctx.strokeStyle = INK;
      ctx.lineWidth = hidden ? 1 : 2;
      ctx.globalAlpha = hidden ? 0.25 : 1;
      if (hidden) ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(sv[a][0], sv[a][1]);
      ctx.lineTo(sv[b][0], sv[b][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    // --- corner frame ---
    const m = 12, arm = 18;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    [[m, m], [W - m, m], [m, H - m], [W - m, H - m]].forEach(([px, py], i) => {
      const sx = i % 2 === 0 ? 1 : -1;
      const sy = i < 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(px + arm * sx, py);
      ctx.moveTo(px, py); ctx.lineTo(px, py + arm * sy);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // --- status labels ---
    ctx.fillStyle = INK;
    ctx.font = "10px monospace";
    ctx.globalAlpha = 0.7;
    ctx.fillText("FIG_001", 36, 24);
    ctx.fillText("[ 2-PT PERSPECTIVE ]", W - 174, 24);
    const pos = verticalPosition > 0.06
      ? "ABOVE EYE LEVEL"
      : verticalPosition < -0.06
      ? "BELOW EYE LEVEL"
      : "AT EYE LEVEL";
    ctx.fillText(pos, 36, H - 20);
    ctx.globalAlpha = 1;
  }, [verticalPosition, rotation, showGuides]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}
