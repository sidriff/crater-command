import { MAP_H, MAP_W } from "./defs";
import {
  CELL_BLOCKED,
  CELL_SLOW,
  canGroundOccupy,
  cellPassAt,
  stepGround,
} from "./terrain";

/** Cell centers are walkable if the cell is not blocked. */
export function cellWalkable(cx: number, cy: number): boolean {
  if (cy < 0 || cy >= MAP_H) return false;
  const x = ((cx % MAP_W) + MAP_W) % MAP_W;
  return cellPassAt(x + 0.5, cy + 0.5) !== CELL_BLOCKED;
}

function cellCost(cx: number, cy: number): number {
  const x = ((cx % MAP_W) + MAP_W) % MAP_W;
  if (cy < 0 || cy >= MAP_H) return Infinity;
  const p = cellPassAt(x + 0.5, cy + 0.5);
  if (p === CELL_BLOCKED) return Infinity;
  if (p === CELL_SLOW) return 1.55;
  return 1;
}

export function toCell(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: ((Math.floor(x) % MAP_W) + MAP_W) % MAP_W,
    cy: Math.max(0, Math.min(MAP_H - 1, Math.floor(y))),
  };
}

export function cellCenter(cx: number, cy: number): { x: number; y: number } {
  return {
    x: ((cx % MAP_W) + MAP_W) % MAP_W + 0.5,
    y: Math.max(0.5, Math.min(MAP_H - 0.5, cy + 0.5)),
  };
}

function wrapDxCells(ax: number, bx: number): number {
  let d = ax - bx;
  if (d > MAP_W / 2) d -= MAP_W;
  if (d < -MAP_W / 2) d += MAP_W;
  return d;
}

function heur(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(wrapDxCells(ax, bx));
  const dy = Math.abs(ay - by);
  // octile
  const dmin = Math.min(dx, dy);
  const dmax = Math.max(dx, dy);
  return dmax + dmin * 0.414;
}

/** Nearest walkable cell to a map point (spiral). */
export function nearestWalkable(
  x: number,
  y: number,
  maxR = 6,
): { x: number; y: number } | null {
  const { cx, cy } = toCell(x, y);
  if (cellWalkable(cx, cy)) return cellCenter(cx, cy);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = ((cx + dx) % MAP_W + MAP_W) % MAP_W;
        const ny = cy + dy;
        if (cellWalkable(nx, ny)) return cellCenter(nx, ny);
      }
    }
  }
  return null;
}

/**
 * A* on the passability grid. Returns map-space waypoints (cell centers),
 * including goal, or null if unreachable.
 */
export function findPath(sx: number, sy: number, gx: number, gy: number): { x: number; y: number }[] | null {
  const start = nearestWalkable(sx, sy, 4);
  const goal = nearestWalkable(gx, gy, 5);
  if (!start || !goal) return null;

  const sc = toCell(start.x, start.y);
  const gc = toCell(goal.x, goal.y);
  if (sc.cx === gc.cx && sc.cy === gc.cy) {
    return [{ x: goal.x, y: goal.y }];
  }

  const N = MAP_W * MAP_H;
  const came = new Int32Array(N).fill(-1);
  const gScore = new Float32Array(N).fill(Infinity);
  const fScore = new Float32Array(N).fill(Infinity);
  const closed = new Uint8Array(N);

  const startI = sc.cy * MAP_W + sc.cx;
  const goalI = gc.cy * MAP_W + gc.cx;
  gScore[startI] = 0;
  fScore[startI] = heur(sc.cx, sc.cy, gc.cx, gc.cy);

  // Binary-ish open set as array of indices (grid is small 48×36)
  const open: number[] = [startI];
  const inOpen = new Uint8Array(N);
  inOpen[startI] = 1;

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ] as const;

  let guard = 0;
  while (open.length > 0 && guard++ < N * 4) {
    // pop lowest f
    let bi = 0;
    let best = open[0]!;
    for (let i = 1; i < open.length; i++) {
      const id = open[i]!;
      if (fScore[id]! < fScore[best]!) {
        best = id;
        bi = i;
      }
    }
    open[bi] = open[open.length - 1]!;
    open.pop();
    inOpen[best] = 0;

    if (best === goalI) {
      // reconstruct
      const cells: { cx: number; cy: number }[] = [];
      let cur = goalI;
      while (cur !== startI && cur >= 0) {
        cells.push({ cx: cur % MAP_W, cy: (cur / MAP_W) | 0 });
        cur = came[cur]!;
      }
      cells.reverse();
      const path = cells.map((c) => cellCenter(c.cx, c.cy));
      // final exact goal point
      path.push({ x: goal.x, y: goal.y });
      return simplifyPath(path);
    }

    if (closed[best]) continue;
    closed[best] = 1;

    const cx = best % MAP_W;
    const cy = (best / MAP_W) | 0;

    for (const [dx, dy, base] of dirs) {
      const nx = ((cx + dx) % MAP_W + MAP_W) % MAP_W;
      const ny = cy + dy;
      if (ny < 0 || ny >= MAP_H) continue;
      // no corner-cutting through blocked
      if (dx !== 0 && dy !== 0) {
        if (!cellWalkable(cx + dx, cy) && !cellWalkable(cx, cy + dy)) continue;
        // still need both orthos open enough — require both walkable
        if (!cellWalkable(((cx + dx) % MAP_W + MAP_W) % MAP_W, cy)) continue;
        if (!cellWalkable(cx, cy + dy)) continue;
      }
      const ni = ny * MAP_W + nx;
      if (closed[ni]) continue;
      const stepC = cellCost(nx, ny);
      if (!Number.isFinite(stepC)) continue;
      const tent = gScore[best]! + base * stepC;
      if (tent >= gScore[ni]!) continue;
      came[ni] = best;
      gScore[ni] = tent;
      fScore[ni] = tent + heur(nx, ny, gc.cx, gc.cy);
      if (!inOpen[ni]) {
        open.push(ni);
        inOpen[ni] = 1;
      }
    }
  }
  return null;
}

export function hasPath(sx: number, sy: number, gx: number, gy: number): boolean {
  return findPath(sx, sy, gx, gy) != null;
}

/** Flood-fill all walkable cells reachable from a seed point. */
export function computeReachable(sx: number, sy: number): Set<number> {
  const seed = nearestWalkable(sx, sy, 5);
  const out = new Set<number>();
  if (!seed) return out;
  const sc = toCell(seed.x, seed.y);
  const q: number[] = [sc.cy * MAP_W + sc.cx];
  out.add(q[0]!);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    const cx = i % MAP_W;
    const cy = (i / MAP_W) | 0;
    for (const [dx, dy] of dirs) {
      const nx = ((cx + dx) % MAP_W + MAP_W) % MAP_W;
      const ny = cy + dy;
      if (ny < 0 || ny >= MAP_H) continue;
      if (!cellWalkable(nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (out.has(ni)) continue;
      out.add(ni);
      q.push(ni);
    }
  }
  return out;
}

export function cellInReach(set: Set<number>, x: number, y: number): boolean {
  const { cx, cy } = toCell(x, y);
  if (set.has(cy * MAP_W + cx)) return true;
  // allow if any neighbor walkable in set (crystal slightly off cell)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ((cx + dx) % MAP_W + MAP_W) % MAP_W;
      const ny = cy + dy;
      if (ny < 0 || ny >= MAP_H) continue;
      if (set.has(ny * MAP_W + nx)) return true;
    }
  }
  return false;
}

/** Drop intermediate waypoints that are roughly collinear. */
function simplifyPath(path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length <= 2) return path;
  const out: { x: number; y: number }[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = path[i]!;
    const c = path[i + 1]!;
    let abx = b.x - a.x;
    if (abx > MAP_W / 2) abx -= MAP_W;
    if (abx < -MAP_W / 2) abx += MAP_W;
    const aby = b.y - a.y;
    let bcx = c.x - b.x;
    if (bcx > MAP_W / 2) bcx -= MAP_W;
    if (bcx < -MAP_W / 2) bcx += MAP_W;
    const bcy = c.y - b.y;
    // cross product ~ 0 and same general direction → skip b
    const cross = abx * bcy - aby * bcx;
    const dot = abx * bcx + aby * bcy;
    if (Math.abs(cross) < 0.15 && dot > 0) continue;
    out.push(b);
  }
  out.push(path[path.length - 1]!);
  return out;
}

export type GroundPath = {
  waypoints: { x: number; y: number }[];
  idx: number;
  gx: number;
  gy: number;
  stuck: number;
};

/**
 * Advance along a path. Replans if goal moved / stuck / missing path.
 * Returns new position.
 */
export function moveAlongPath(
  state: GroundPath | undefined,
  x: number,
  y: number,
  tx: number,
  ty: number,
  stepLen: number,
  repath: (sx: number, sy: number, gx: number, gy: number) => { x: number; y: number }[] | null,
): { x: number; y: number; path: GroundPath } {
  let path: GroundPath | undefined = state;
  let dxg = tx - (path?.gx ?? tx);
  if (dxg > MAP_W / 2) dxg -= MAP_W;
  if (dxg < -MAP_W / 2) dxg += MAP_W;
  const goalMoved = !path || Math.hypot(dxg, ty - path.gy) > 0.75;
  const needPath = !path || path.idx >= path.waypoints.length || goalMoved || path.stuck > 18;

  if (needPath) {
    const wp = repath(x, y, tx, ty);
    if (!wp || wp.length === 0) {
      const hit = stepGround(x, y, tx, ty, stepLen);
      const stuckPath: GroundPath = path
        ? { ...path, gx: tx, gy: ty, stuck: path.stuck + 1 }
        : { waypoints: [], idx: 0, gx: tx, gy: ty, stuck: 1 };
      return { x: hit.x, y: hit.y, path: stuckPath };
    }
    path = { waypoints: wp, idx: 0, gx: tx, gy: ty, stuck: 0 };
  }

  // path is defined after needPath branch
  const p = path!;

  while (p.idx < p.waypoints.length) {
    const w = p.waypoints[p.idx]!;
    let dx = w.x - x;
    if (dx > MAP_W / 2) dx -= MAP_W;
    if (dx < -MAP_W / 2) dx += MAP_W;
    const dy = w.y - y;
    if (Math.hypot(dx, dy) < 0.35) p.idx++;
    else break;
  }

  if (p.idx >= p.waypoints.length) {
    const hit = stepGround(x, y, tx, ty, stepLen);
    return { x: hit.x, y: hit.y, path: p };
  }

  const w = p.waypoints[p.idx]!;
  const prevX = x;
  const prevY = y;
  const hit = stepGround(x, y, w.x, w.y, stepLen);
  let mdx = hit.x - prevX;
  if (mdx > MAP_W / 2) mdx -= MAP_W;
  if (mdx < -MAP_W / 2) mdx += MAP_W;
  const moved = Math.hypot(mdx, hit.y - prevY);
  if (moved < stepLen * 0.05) p.stuck++;
  else p.stuck = Math.max(0, p.stuck - 2);

  return { x: hit.x, y: hit.y, path: p };
}

export function isMapWalkable(x: number, y: number): boolean {
  return canGroundOccupy(x, y);
}
