"use client";
import { useRef, useState } from "react";
import { project, type P3 } from "@/lib/surface3d";
import { ivColor } from "@/lib/ivColor";

// A rotatable 3D implied-vol surface: the same fitted-IV grid as the heatmap, drawn as a projected SVG
// mesh you can drag to spin. Pure inline SVG (no chart-lib / WebGL) — the grid is small (≤8×11), so a
// painter's-algorithm quad fill is smooth and dependency-free. Height = IV, color = IV (same scale as 2D).
interface Props {
  moneyness: number[]; // % (K/spot − 1) — columns
  expiries: { dte: number }[]; // rows (near → far)
  grid: number[][]; // rows × cols → fitted IV %
}

const W = 680,
  H = 400,
  SCALE = 168,
  CX = W / 2,
  CY = H / 2 + 26,
  HEIGHT = 1.45; // vertical extent of the surface in model units
const YAW0 = -0.62,
  PITCH0 = 0.5;

export default function VolSurface3D({ moneyness, expiries, grid }: Props) {
  const [yaw, setYaw] = useState(YAW0);
  const [pitch, setPitch] = useState(PITCH0);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const rows = grid.length,
    cols = moneyness.length;
  const vals = grid.flat().filter((v) => v > 0);
  if (rows < 2 || cols < 2 || vals.length < 4) {
    return <div className="rounded-lg bg-[var(--surface-2)] p-6 text-center text-xs text-[var(--text-4)]">Not enough of a chain to build a 3D surface.</div>;
  }
  const ivMin = Math.min(...vals),
    ivMax = Math.max(...vals);
  const span = ivMax - ivMin || 1;

  const nx = (j: number) => (cols > 1 ? (j / (cols - 1)) * 2 - 1 : 0); // moneyness → [-1,1]
  const nz = (i: number) => (rows > 1 ? (i / (rows - 1)) * 2 - 1 : 0); // expiry → [-1,1]
  const ny = (v: number) => ((v - ivMin) / span - 0.5) * HEIGHT; // IV → centered height
  const P = (p: P3) => project(p, yaw, pitch, SCALE, CX, CY);
  const node = (i: number, j: number): P3 => ({ x: nx(j), y: ny(grid[i][j]), z: nz(i) });
  const baseY = -HEIGHT / 2;

  // Surface faces (quads), painter's-sorted back-to-front. Skip a face if any corner is a masked cell.
  const quads: { pts: string; depth: number; iv: number }[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const cs = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]];
      if (cs.some((v) => !(v > 0))) continue;
      const pr = [node(i, j), node(i, j + 1), node(i + 1, j + 1), node(i + 1, j)].map(P);
      quads.push({
        pts: pr.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" "),
        depth: pr.reduce((s, p) => s + p.depth, 0) / 4,
        iv: cs.reduce((s, v) => s + v, 0) / 4,
      });
    }
  }
  quads.sort((a, b) => a.depth - b.depth);

  // Faint bounding box for depth cue.
  const corner = (xi: number, yi: number, zi: number) => P({ x: xi, y: (yi * HEIGHT) / 2, z: zi });
  const boxEdges: [number[], number[]][] = [
    // bottom
    [[-1, -1, -1], [1, -1, -1]], [[1, -1, -1], [1, -1, 1]], [[1, -1, 1], [-1, -1, 1]], [[-1, -1, 1], [-1, -1, -1]],
    // top
    [[-1, 1, -1], [1, 1, -1]], [[1, 1, -1], [1, 1, 1]], [[1, 1, 1], [-1, 1, 1]], [[-1, 1, 1], [-1, 1, -1]],
    // verticals
    [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[1, -1, 1], [1, 1, 1]], [[-1, -1, 1], [-1, 1, 1]],
  ];
  // Axis ticks + named titles. Each axis gets min/mid/max value ticks pushed OUTSIDE its box edge, plus a
  // named title, all haloed (paint-order stroke) so they stay legible over the mesh. moneyness runs along
  // the front-bottom edge (below), expiry along the right-bottom edge (right), IV up the back-left edge.
  const lbl = (p: P3, dx = 0, dy = 0) => { const s = P(p); return { x: s.sx + dx, y: s.sy + dy }; };
  const mLast = moneyness[moneyness.length - 1];
  const midIdx = Math.round((expiries.length - 1) / 2);
  const zMid = expiries.length > 1 ? (midIdx / (expiries.length - 1)) * 2 - 1 : 0;
  const ivMid = (ivMin + ivMax) / 2;
  const mTicks = [
    { p: lbl({ x: -1, y: baseY, z: 1 }, 0, 15), t: `${moneyness[0]}%` },
    { p: lbl({ x: 0, y: baseY, z: 1 }, 0, 15), t: "0%" },
    { p: lbl({ x: 1, y: baseY, z: 1 }, 0, 15), t: `+${mLast}%` },
  ];
  const mTitle = lbl({ x: 0, y: baseY, z: 1 }, 0, 30);
  const eTicks = [
    { p: lbl({ x: 1, y: baseY, z: -1 }, 12, 4), t: `${expiries[0]?.dte}d` },
    { p: lbl({ x: 1, y: baseY, z: zMid }, 12, 4), t: `${expiries[midIdx]?.dte}d` },
    { p: lbl({ x: 1, y: baseY, z: 1 }, 12, 4), t: `${expiries[expiries.length - 1]?.dte}d` },
  ];
  const eTitle = lbl({ x: 1, y: baseY, z: zMid }, 14, 19);
  const ivTicks = [
    { p: lbl({ x: -1, y: baseY, z: -1 }, -8, 3), t: `${ivMin.toFixed(0)}%` },
    { p: lbl({ x: -1, y: 0, z: -1 }, -8, 3), t: `${ivMid.toFixed(0)}%` },
    { p: lbl({ x: -1, y: HEIGHT / 2, z: -1 }, -8, 3), t: `${ivMax.toFixed(0)}%` },
  ];
  const ivTitle = lbl({ x: -1, y: HEIGHT / 2, z: -1 }, -8, -10);
  const halo = { stroke: "var(--surface)", strokeWidth: 2.6, strokeLinejoin: "round" as const, paintOrder: "stroke" as const };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, yaw, pitch };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    setYaw(d.yaw + (e.clientX - d.x) * 0.01);
    setPitch(Math.max(-0.25, Math.min(1.35, d.pitch + (e.clientY - d.y) * 0.01)));
  };
  const onUp = () => { drag.current = null; setDragging(false); };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-4)]">
        <span>drag to rotate · height &amp; color = IV</span>
        <button onClick={() => { setYaw(YAW0); setPitch(PITCH0); }} className="text-[var(--accent)] hover:underline">reset view</button>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[520px] select-none"
        style={{ height: "auto", touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {boxEdges.map((e, i) => {
          const a = corner(e[0][0], e[0][1], e[0][2]),
            b = corner(e[1][0], e[1][1], e[1][2]);
          return <line key={`b${i}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="var(--text-4)" strokeOpacity={0.22} strokeWidth={0.6} />;
        })}
        {quads.map((q, i) => (
          <polygon key={i} points={q.pts} fill={ivColor((q.iv - ivMin) / span)} fillOpacity={0.92} stroke="rgba(15,23,42,0.28)" strokeWidth={0.4} strokeLinejoin="round" />
        ))}
        {/* axis ticks + named titles (rotate with the box; haloed for legibility over the mesh) */}
        {mTicks.map((k, i) => (
          <text key={`m${i}`} x={k.p.x} y={k.p.y} fontSize={10} textAnchor="middle" fill="var(--text-2)" className="tabular-nums" {...halo}>{k.t}</text>
        ))}
        {eTicks.map((k, i) => (
          <text key={`e${i}`} x={k.p.x} y={k.p.y} fontSize={10} textAnchor="start" fill="var(--text-2)" className="tabular-nums" {...halo}>{k.t}</text>
        ))}
        {ivTicks.map((k, i) => (
          <text key={`v${i}`} x={k.p.x} y={k.p.y} fontSize={10} textAnchor="end" fill="var(--text-2)" className="tabular-nums" {...halo}>{k.t}</text>
        ))}
        <text x={mTitle.x} y={mTitle.y} fontSize={11.5} fontWeight={700} textAnchor="middle" fill="var(--text)" {...halo}>moneyness</text>
        <text x={eTitle.x} y={eTitle.y} fontSize={11.5} fontWeight={700} textAnchor="start" fill="var(--text)" {...halo}>expiry</text>
        <text x={ivTitle.x} y={ivTitle.y} fontSize={11.5} fontWeight={700} textAnchor="end" fill="var(--text)" {...halo}>IV</text>
      </svg>
    </div>
  );
}
