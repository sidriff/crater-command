import { MAP_H, MAP_W } from "./defs";

/** Ground passability */
export const CELL_OPEN = 0;
export const CELL_SLOW = 1;
export const CELL_BLOCKED = 2;

export type CellPass = 0 | 1 | 2;

export interface CraterDef {
  cx: number;
  cy: number;
  floorR: number;
  rimW: number;
  /** Pass headings in radians (map-space atan2(dy, dx)) and half-width in cells */
  passes: { angle: number; halfWidth: number }[];
}

/** Player start map positions — keep in sync with GameSim cores */
export const START_P0 = { x: MAP_W * 0.25, y: MAP_H * 0.28 };
export const START_P1 = { x: MAP_W * 0.75, y: MAP_H * 0.72 };

/**
 * Strategic craters: bowls + rims + carved passes.
 * P0 faces SE toward mid; P1 faces NW toward mid.
 */
export const CRATERS: CraterDef[] = [
  {
    cx: START_P0.x,
    cy: START_P0.y,
    floorR: 5.2,
    rimW: 1.85,
    passes: [
      { angle: Math.atan2(0.55, 0.75), halfWidth: 1.45 }, // toward mid / enemy
      { angle: Math.atan2(-0.3, 0.9), halfWidth: 1.2 }, // side eco exit
    ],
  },
  {
    cx: START_P1.x,
    cy: START_P1.y,
    floorR: 5.2,
    rimW: 1.85,
    passes: [
      { angle: Math.atan2(-0.55, -0.75), halfWidth: 1.45 },
      { angle: Math.atan2(0.3, -0.9), halfWidth: 1.2 },
    ],
  },
  // Mid control crater — contested bowl
  {
    cx: MAP_W * 0.5,
    cy: MAP_H * 0.5,
    floorR: 4.0,
    rimW: 1.55,
    passes: [
      { angle: 0, halfWidth: 1.35 },
      { angle: Math.PI * 0.5, halfWidth: 1.35 },
      { angle: Math.PI, halfWidth: 1.35 },
      { angle: -Math.PI * 0.5, halfWidth: 1.35 },
    ],
  },
  // Side pocket
  {
    cx: MAP_W * 0.38,
    cy: MAP_H * 0.62,
    floorR: 3.2,
    rimW: 1.3,
    passes: [
      { angle: Math.atan2(-0.6, 0.5), halfWidth: 1.25 },
      { angle: Math.atan2(0.7, -0.2), halfWidth: 1.15 },
    ],
  },
  {
    cx: MAP_W * 0.62,
    cy: MAP_H * 0.38,
    floorR: 3.2,
    rimW: 1.3,
    passes: [
      { angle: Math.atan2(0.6, -0.5), halfWidth: 1.25 },
      { angle: Math.atan2(-0.7, 0.2), halfWidth: 1.15 },
    ],
  },
];

function wrapDx(ax: number, bx: number) {
  let dx = ax - bx;
  if (dx > MAP_W / 2) dx -= MAP_W;
  if (dx < -MAP_W / 2) dx += MAP_W;
  return dx;
}

function mapDist(ax: number, ay: number, bx: number, by: number) {
  const dx = wrapDx(ax, bx);
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

function angNorm(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function nearPass(crater: CraterDef, ang: number, d: number): boolean {
  // Pass corridor widens slightly toward outer rim
  for (const p of crater.passes) {
    const da = Math.abs(angNorm(ang - p.angle));
    // angular half-width ≈ halfWidth / radius
    const aHalf = p.halfWidth / Math.max(1.2, d);
    if (da <= aHalf) return true;
  }
  return false;
}

let _pass: Uint8Array | null = null;
let _floor: Float32Array | null = null; // height bias
let _rim: Float32Array | null = null;

function bake() {
  const pass = new Uint8Array(MAP_W * MAP_H);
  const floor = new Float32Array(MAP_W * MAP_H);
  const rim = new Float32Array(MAP_W * MAP_H);
  pass.fill(CELL_OPEN);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      const px = x + 0.5;
      const py = y + 0.5;
      let bestRim = 0;
      let bestFloor = 0;
      let blocked = false;
      let slow = false;

      for (const c of CRATERS) {
        const dx = wrapDx(px, c.cx);
        const dy = py - c.cy;
        const d = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const rimOuter = c.floorR + c.rimW;

        if (d < c.floorR * 0.92) {
          // bowl floor — depressed
          const t = 1 - d / (c.floorR * 0.92);
          bestFloor = Math.max(bestFloor, t * t);
        } else if (d < rimOuter) {
          const passHere = nearPass(c, ang, d);
          // rim ring
          const u = (d - c.floorR) / c.rimW; // 0 at inner, 1 at outer
          const ridge = Math.sin(Math.min(1, Math.max(0, u)) * Math.PI); // peak mid-rim
          if (passHere) {
            slow = true;
            bestRim = Math.max(bestRim, ridge * 0.25);
          } else {
            blocked = true;
            bestRim = Math.max(bestRim, ridge);
          }
        }
      }

      floor[i] = bestFloor;
      rim[i] = bestRim;
      if (blocked) pass[i] = CELL_BLOCKED;
      else if (slow) pass[i] = CELL_SLOW;
      else pass[i] = CELL_OPEN;
    }
  }

  // Soft ridge belt mid-map (slow only, not hard block) for texture
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      if (pass[i] === CELL_BLOCKED) continue;
      // diagonal saddle between starts
      const dx = wrapDx(x + 0.5, MAP_W * 0.5);
      const dy = y + 0.5 - MAP_H * 0.5;
      const along = Math.abs(dx * 0.6 + dy * 0.8);
      const across = Math.abs(-dx * 0.8 + dy * 0.6);
      if (along < 10 && across < 1.1 && across > 0.35) {
        if (pass[i] === CELL_OPEN) pass[i] = CELL_SLOW;
        rim[i] = Math.max(rim[i]!, 0.35);
      }
    }
  }

  _pass = pass;
  _floor = floor;
  _rim = rim;
}

function ensure() {
  if (!_pass) bake();
}

export function getPassability(): Uint8Array {
  ensure();
  return _pass!;
}

export function cellPassAt(x: number, y: number): CellPass {
  ensure();
  const cx = ((Math.floor(x) % MAP_W) + MAP_W) % MAP_W;
  const cy = Math.max(0, Math.min(MAP_H - 1, Math.floor(y)));
  return _pass![cy * MAP_W + cx]! as CellPass;
}

export function isBlockedMap(x: number, y: number): boolean {
  return cellPassAt(x, y) === CELL_BLOCKED;
}

export function moveSpeedMul(x: number, y: number, flying: boolean): number {
  if (flying) return 1;
  const p = cellPassAt(x, y);
  if (p === CELL_BLOCKED) return 0;
  if (p === CELL_SLOW) return 0.55;
  return 1;
}

/** Can a ground unit occupy / step onto this point? */
export function canGroundOccupy(x: number, y: number): boolean {
  if (y < 0.4 || y > MAP_H - 0.4) return false;
  return !isBlockedMap(x, y);
}

/** Buildings: open or slow only (not solid rim wall). Turrets allowed on slow passes. */
export function canPlaceBuilding(x: number, y: number): boolean {
  const p = cellPassAt(x, y);
  return p === CELL_OPEN || p === CELL_SLOW;
}

/**
 * Step ground unit toward target with wall slide.
 * Returns new position.
 */
export function stepGround(
  x: number,
  y: number,
  tx: number,
  ty: number,
  stepLen: number,
): { x: number; y: number } {
  let dx = tx - x;
  if (dx > MAP_W / 2) dx -= MAP_W;
  if (dx < -MAP_W / 2) dx += MAP_W;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x, y };
  const ux = dx / d;
  const uy = dy / d;

  const tryPos = (px: number, py: number) => {
    const nx = (px + MAP_W) % MAP_W;
    const ny = Math.max(0.5, Math.min(MAP_H - 0.5, py));
    if (!canGroundOccupy(nx, ny)) return null;
    // also reject if mid-step cell blocked (short steps so ok)
    return { x: nx, y: ny };
  };

  // primary
  let hit = tryPos(x + ux * stepLen, y + uy * stepLen);
  if (hit) return hit;

  // slide ±35° and ±70°
  const angles = [0.6, -0.6, 1.15, -1.15, 1.55, -1.55];
  for (const a of angles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rx = ux * c - uy * s;
    const ry = ux * s + uy * c;
    hit = tryPos(x + rx * stepLen, y + ry * stepLen);
    if (hit) return hit;
  }
  return { x, y };
}

/** Height bias in map space: negative floor, positive rim. Range roughly -1..1 */
export function strategicBiasMap(mx: number, my: number): number {
  ensure();
  // bilinear sample of floor/rim fields
  const x = ((mx % MAP_W) + MAP_W) % MAP_W;
  const y = Math.max(0, Math.min(MAP_H - 1.001, my));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % MAP_W;
  const y1 = Math.min(MAP_H - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const samp = (arr: Float32Array, ix: number, iy: number) => arr[iy * MAP_W + ix]!;
  const floor =
    samp(_floor!, x0, y0) * (1 - fx) * (1 - fy) +
    samp(_floor!, x1, y0) * fx * (1 - fy) +
    samp(_floor!, x0, y1) * (1 - fx) * fy +
    samp(_floor!, x1, y1) * fx * fy;
  const rim =
    samp(_rim!, x0, y0) * (1 - fx) * (1 - fy) +
    samp(_rim!, x1, y0) * fx * (1 - fy) +
    samp(_rim!, x0, y1) * (1 - fx) * fy +
    samp(_rim!, x1, y1) * fx * fy;
  return rim * 1.2 - floor * 0.85;
}

/** World-dir → map UV matching planetMath dirFromMap */
export function dirToMap(nx: number, ny: number, nz: number): { x: number; y: number } {
  let lon = Math.atan2(nx, nz);
  if (lon < 0) lon += Math.PI * 2;
  const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
  const x = (lon / (Math.PI * 2)) * MAP_W;
  const y = (lat / (Math.PI * 0.92) + 0.5) * MAP_H;
  return { x, y: Math.max(0, Math.min(MAP_H, y)) };
}
