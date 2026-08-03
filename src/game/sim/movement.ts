import { MAP_H, MAP_W, UNITS, raceUnitMul } from "./defs";
import type { GroundPath } from "./path";
import { canGroundOccupy, stepGround } from "./terrain";
import type { Building, PlayerState, Unit } from "./types";
import { clamp, dist, sepRadius, slotAngle } from "./util";

export type MovementHost = {
  t: number;
  units: Unit[];
  buildings: Building[];
  players: PlayerState[];
  paths: Map<number, GroundPath>;
  ops?: { assigneeId: number | null }[];
  moveGroundUnit: (u: Unit, tx: number, ty: number, speed: number, dt: number) => void;
};

function scoutPatrolPoint(sim: MovementHost, u: Unit): { x: number; y: number } {
  const enemyCore = sim.buildings.find((b) => b.owner !== u.owner && b.kind === "core");
  const home = sim.buildings.find((b) => b.owner === u.owner && b.kind === "core");
  const period = 7.5;
  const phase = Math.floor(sim.t / period + u.id * 1.37) % 8;
  const jitter = (seed: number) => {
    const s = Math.sin(u.id * 12.9898 + seed * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const jx = (jitter(phase) - 0.5) * 3.5;
  const jy = (jitter(phase + 3) - 0.5) * 2.8;
  const points: { x: number; y: number }[] = [
    { x: MAP_W * 0.5 + jx, y: MAP_H * 0.5 + jy },
    {
      x: (enemyCore?.x ?? MAP_W * 0.75) + jx * 0.6,
      y: (enemyCore?.y ?? MAP_H * 0.72) + jy * 0.6,
    },
    { x: MAP_W * 0.38 + jx, y: MAP_H * 0.62 + jy },
    { x: MAP_W * 0.62 + jx, y: MAP_H * 0.38 + jy },
    {
      x: (enemyCore?.x ?? MAP_W * 0.7) + (u.owner === 0 ? 4 : -4) + jx,
      y: (enemyCore?.y ?? MAP_H * 0.7) + jy,
    },
    { x: MAP_W * 0.2 + jx, y: MAP_H * 0.5 + jy },
    { x: MAP_W * 0.8 + jx, y: MAP_H * 0.5 + jy },
    {
      x: (home?.x ?? MAP_W * 0.25) + (u.owner === 0 ? 6 : -6) + jx,
      y: MAP_H * 0.5 + jy,
    },
  ];
  const g = points[phase]!;
  return {
    x: ((g.x % MAP_W) + MAP_W) % MAP_W,
    y: clamp(g.y, 1.5, MAP_H - 1.5),
  };
}

export function tickMovement(sim: MovementHost, dt: number) {
  const tasked = new Set<number>();
  if (sim.ops) {
    for (const o of sim.ops) {
      if (o.assigneeId != null) tasked.add(o.assigneeId);
    }
  }
  for (const u of sim.units) {
    if (u.kind === "worker") continue;
    // Survey / ops have the wheel
    if (tasked.has(u.id)) continue;
    const def = UNITS[u.kind];
    const speed = def.speed * raceUnitMul(sim.players[u.owner]!.race, u.kind).speed;
    let tx: number | null = null;
    let ty: number | null = null;

    if (u.kind === "scout") {
      const g = scoutPatrolPoint(sim, u);
      tx = g.x;
      ty = g.y;
    } else if (u.targetId != null) {
      if (u.targetIsBuilding) {
        const b = sim.buildings.find((x) => x.id === u.targetId);
        if (b) {
          tx = b.x;
          ty = b.y;
        }
      } else {
        const ou = sim.units.find((x) => x.id === u.targetId);
        if (ou) {
          tx = ou.x;
          ty = ou.y;
        }
      }
    }
    if (tx == null) {
      const enemyCore = sim.buildings.find((b) => b.owner !== u.owner && b.kind === "core");
      if (enemyCore) {
        tx = enemyCore.x;
        ty = enemyCore.y;
      }
    }
    if (tx == null || ty == null) continue;

    if (u.kind !== "scout" && u.targetId != null) {
      const ang = slotAngle(u.id, 12);
      const orbit = Math.max(0.55, def.range * 0.72);
      tx = tx + Math.cos(ang) * orbit;
      ty = clamp(ty + Math.sin(ang) * orbit * 0.8, 0.5, MAP_H - 0.5);
    }

    let dx = tx - u.x;
    if (dx > MAP_W / 2) dx -= MAP_W;
    if (dx < -MAP_W / 2) dx += MAP_W;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    const stopAt = u.kind === "scout" ? 0.85 : u.targetId != null ? 0.35 : 0.4;
    if (d <= stopAt) {
      if (u.kind === "scout") {
        const drift = slotAngle(u.id + Math.floor(sim.t), 16);
        u.x = (u.x + Math.cos(drift) * speed * 0.35 * dt + MAP_W) % MAP_W;
        u.y = clamp(u.y + Math.sin(drift) * speed * 0.35 * dt, 0.5, MAP_H - 0.5);
      }
      continue;
    }
    if (def.air) {
      u.x = (u.x + (dx / d) * speed * dt + MAP_W) % MAP_W;
      u.y = clamp(u.y + (dy / d) * speed * dt, 0.5, MAP_H - 0.5);
    } else {
      sim.moveGroundUnit(u, tx, ty, speed, dt);
    }
  }
}

export function tickSeparation(sim: MovementHost, dt: number) {
  const list = sim.units;
  const n = list.length;
  if (n < 2) return;
  const px = new Float32Array(n);
  const py = new Float32Array(n);

  const isParkedWorker = (u: Unit) =>
    u.kind === "worker" &&
    !u.carrying &&
    u.buildTargetId == null &&
    u.mineMineralId != null &&
    u.mineProgress > 0;

  for (let i = 0; i < n; i++) {
    const a = list[i]!;
    if (isParkedWorker(a)) continue;
    const aAir = UNITS[a.kind].air;
    const aR = sepRadius(a.kind);
    for (let j = i + 1; j < n; j++) {
      const b = list[j]!;
      if (isParkedWorker(b)) continue;
      if (UNITS[b.kind].air !== aAir) continue;
      let dx = a.x - b.x;
      if (dx > MAP_W / 2) dx -= MAP_W;
      if (dx < -MAP_W * 0.5) dx += MAP_W;
      let dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      const minD = aR + sepRadius(b.kind);
      if (d >= minD) continue;
      if (d < 1e-4) {
        const ang = slotAngle(a.id + b.id * 3, 16);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const overlap = minD - d;
      const f = (overlap / minD) * 0.55;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      px[i]! += fx;
      py[i]! += fy;
      px[j]! -= fx;
      py[j]! -= fy;
    }
  }

  const pushSpeed = 3.4;
  for (let i = 0; i < n; i++) {
    const ax = px[i]!;
    const ay = py[i]!;
    const len = Math.hypot(ax, ay);
    if (len < 1e-5) continue;
    const u = list[i]!;
    if (isParkedWorker(u)) continue;
    const step = Math.min(len, 1.25) * pushSpeed * dt;
    const nx = u.x + (ax / len) * step;
    const ny = u.y + (ay / len) * step;
    if (UNITS[u.kind].air) {
      u.x = (nx + MAP_W) % MAP_W;
      u.y = clamp(ny, 0.5, MAP_H - 0.5);
    } else {
      const pos = stepGround(u.x, u.y, nx, ny, step);
      if (pos.x === u.x && pos.y === u.y && canGroundOccupy(nx, ny)) {
        u.x = (nx + MAP_W) % MAP_W;
        u.y = clamp(ny, 0.5, MAP_H - 0.5);
      } else {
        u.x = pos.x;
        u.y = pos.y;
      }
    }
  }
}
