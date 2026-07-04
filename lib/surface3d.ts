/**
 * Minimal 3D projection for the rotatable vol surface — pure, dependency-free, unit-testable. A point in
 * model space (x right, y up, z depth) is rotated by yaw (about the vertical Y axis) then pitch (about the
 * horizontal X axis), then orthographically projected to screen coordinates (screen y grows downward).
 *
 * Orthographic (no perspective foreshortening) keeps a small surface mesh clean and undistorted; `depth`
 * is the rotated z, used only to order faces back-to-front (painter's algorithm). No matrix library needed
 * — the two rotations are written out inline.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}
export interface P2 {
  sx: number;
  sy: number;
  depth: number; // rotated z; larger = nearer the viewer (drawn last)
}

// Yaw about Y (turn left/right), then pitch about X (tilt up/down). Orthonormal → preserves lengths.
export function rotate(p: P3, yaw: number, pitch: number): P3 {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;
  return { x: x1, y: y2, z: z2 };
}

export function project(p: P3, yaw: number, pitch: number, scale: number, cx: number, cy: number): P2 {
  const r = rotate(p, yaw, pitch);
  return { sx: cx + r.x * scale, sy: cy - r.y * scale, depth: r.z };
}
