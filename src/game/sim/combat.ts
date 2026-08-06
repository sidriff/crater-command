import { BUILDINGS, MAP_H, MAP_W, UNITS, raceUnitMul } from "./defs";
import type { CardId } from "./deck";
import { scoutPatrolPoint } from "./movement";
import type { GroundPath } from "./path";
import type {
  Building,
  BuildingKind,
  Mineral,
  PlayerId,
  PlayerState,
  Projectile,
  ProjectileStyle,
  Unit,
} from "./types";
import {
  allocId,
  buildingShotStyle,
  clamp,
  dist,
  unitShotStyle,
} from "./util";

export type CombatHost = {
  t: number;
  units: Unit[];
  buildings: Building[];
  minerals: Mineral[];
  players: PlayerState[];
  projectiles: Projectile[];
  paths: Map<number, GroundPath>;
  markOcc: (x: number, y: number, on: boolean) => void;
};

export function fireProjectile(
  sim: CombatHost,
  owner: PlayerId,
  x: number,
  y: number,
  tx: number,
  ty: number,
  targetId: number,
  targetIsBuilding: boolean,
  damage: number,
  style: ProjectileStyle,
  fromAir: number,
  toAir: number,
  targetIsMineral = false,
) {
  const d = dist(x, y, tx, ty);
  const speed =
    style === "mine" ? 0 : style === "laser" ? 28 : style === "shell" ? 10 : 16;
  const maxAge =
    style === "mine" ? 0.14 : Math.max(0.12, d / Math.max(speed, 1) + 0.05);
  sim.projectiles.push({
    id: allocId(),
    owner,
    x,
    y,
    ox: x,
    oy: y,
    tx,
    ty,
    targetId,
    targetIsBuilding,
    targetIsMineral,
    damage,
    speed,
    style,
    fromAir,
    toAir,
    age: 0,
    maxAge,
  });
}

function findBuildingTarget(
  sim: CombatHost,
  b: Building,
  def: (typeof BUILDINGS)[BuildingKind],
):
  | { kind: "unit"; unit: Unit }
  | { kind: "building"; building: Building }
  | null {
  const range = def.range ?? 0;
  let best: { kind: "unit"; unit: Unit } | { kind: "building"; building: Building } | null =
    null;
  let bestD = range + 0.01;
  for (const u of sim.units) {
    if (u.owner === b.owner) continue;
    const air = UNITS[u.kind].air;
    if (air && !def.attackAir) continue;
    if (!air && !def.attackGround) continue;
    const d = dist(b.x, b.y, u.x, u.y);
    if (d < bestD) {
      bestD = d;
      best = { kind: "unit", unit: u };
    }
  }
  if (def.attackGround) {
    for (const ob of sim.buildings) {
      if (ob.owner === b.owner) continue;
      const d = dist(b.x, b.y, ob.x, ob.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: "building", building: ob };
      }
    }
  }
  return best;
}

function acquireTarget(
  sim: CombatHost,
  u: Unit,
): { id: number; x: number; y: number; isBuilding: boolean } | null {
  const def = UNITS[u.kind];
  let best: { id: number; x: number; y: number; isBuilding: boolean } | null = null;
  let bestD = 99;
  const scan = Math.max(def.range + 7, 9);
  for (const ou of sim.units) {
    if (ou.owner === u.owner) continue;
    const oAir = UNITS[ou.kind].air;
    if (oAir && !def.attackAir) continue;
    if (!oAir && !def.attackGround) continue;
    const d = dist(u.x, u.y, ou.x, ou.y);
    if (d < bestD && d < scan) {
      bestD = d;
      best = { id: ou.id, x: ou.x, y: ou.y, isBuilding: false };
    }
  }
  if (def.attackGround) {
    for (const b of sim.buildings) {
      if (b.owner === u.owner) continue;
      const d = dist(u.x, u.y, b.x, b.y);
      const bias = b.kind === "core" ? -0.5 : 0;
      if (d + bias < bestD && d < scan) {
        bestD = d + bias;
        best = { id: b.id, x: b.x, y: b.y, isBuilding: true };
      }
    }
  }
  return best;
}

/**
 * Scout path laser: only pick enemies sitting on the flight corridor ahead —
 * positive along-track distance within range, small cross-track offset.
 * Does not set chase goals; movement keeps patrolling regardless of targetId.
 */
function acquireScoutPathTarget(
  sim: CombatHost,
  u: Unit,
): { id: number; x: number; y: number; isBuilding: boolean } | null {
  const def = UNITS.scout;
  const goal = scoutPatrolPoint(sim, u);
  let hx = goal.x - u.x;
  if (hx > MAP_W / 2) hx -= MAP_W;
  if (hx < -MAP_W / 2) hx += MAP_W;
  let hy = goal.y - u.y;
  let hLen = Math.hypot(hx, hy);
  // Near a waypoint the patrol heading collapses — fall back to "toward enemy core"
  // so the laser still has a forward while loitering.
  if (hLen < 0.45) {
    const enemyCore = sim.buildings.find((b) => b.owner !== u.owner && b.kind === "core");
    if (enemyCore) {
      hx = enemyCore.x - u.x;
      if (hx > MAP_W / 2) hx -= MAP_W;
      if (hx < -MAP_W / 2) hx += MAP_W;
      hy = enemyCore.y - u.y;
      hLen = Math.hypot(hx, hy);
    }
  }
  if (hLen < 1e-4) {
    hx = 1;
    hy = 0;
    hLen = 1;
  }
  hx /= hLen;
  hy /= hLen;

  const range = def.range;
  /** Half-width of the fire corridor (map units). */
  const halfW = 0.95;
  let best: { id: number; x: number; y: number; isBuilding: boolean } | null = null;
  let bestScore = 1e9;

  const consider = (id: number, x: number, y: number, isBuilding: boolean, air: boolean) => {
    if (air && !def.attackAir) return;
    if (!air && !def.attackGround) return;
    let ex = x - u.x;
    if (ex > MAP_W / 2) ex -= MAP_W;
    if (ex < -MAP_W / 2) ex += MAP_W;
    const ey = y - u.y;
    const d = Math.hypot(ex, ey);
    if (d > range || d < 0.12) return;
    const along = ex * hx + ey * hy;
    // Must be ahead (small rear allowance for near-misses while banking)
    if (along < -0.15) return;
    const cross = Math.abs(ex * hy - ey * hx);
    if (cross > halfW) return;
    // Prefer near-centerline and closer
    const score = d + cross * 1.4;
    if (score < bestScore) {
      bestScore = score;
      best = { id, x, y, isBuilding };
    }
  };

  for (const ou of sim.units) {
    if (ou.owner === u.owner) continue;
    consider(ou.id, ou.x, ou.y, false, UNITS[ou.kind].air);
  }
  if (def.attackGround) {
    for (const b of sim.buildings) {
      if (b.owner === u.owner) continue;
      consider(b.id, b.x, b.y, true, false);
    }
  }
  return best;
}

export function tickCombat(sim: CombatHost, dt: number) {
  for (const b of sim.buildings) {
    if (!b.done) continue;
    const def = BUILDINGS[b.kind];
    if (!def.range) continue;
    b.attackTimer -= dt;
    if (b.attackTimer > 0) continue;
    const target = findBuildingTarget(sim, b, def);
    if (!target) continue;
    if (target.kind === "unit") {
      const air = UNITS[target.unit.kind].air;
      let deal = 0;
      if (air && def.attackAir) deal = def.attackAir;
      else if (!air && def.attackGround) deal = def.attackGround;
      if (deal > 0) {
        fireProjectile(
          sim,
          b.owner,
          b.x,
          b.y,
          target.unit.x,
          target.unit.y,
          target.unit.id,
          false,
          deal,
          buildingShotStyle(b.kind),
          0.35,
          air ? 1 : 0.15,
        );
        b.attackTimer = 0.55;
      }
    } else if (def.attackGround) {
      fireProjectile(
        sim,
        b.owner,
        b.x,
        b.y,
        target.building.x,
        target.building.y,
        target.building.id,
        true,
        def.attackGround,
        buildingShotStyle(b.kind),
        0.35,
        0.4,
      );
      b.attackTimer = 0.7;
    }
  }

  for (const u of sim.units) {
    if (u.kind === "worker") continue;
    const def = UNITS[u.kind];
    u.attackTimer -= dt;

    // Scout: light path laser only — engage corridor targets, never chase.
    if (u.kind === "scout") {
      const tgt = acquireScoutPathTarget(sim, u);
      if (!tgt) {
        u.targetId = null;
        u.targetIsBuilding = false;
        continue;
      }
      // targetId is fire-lock only; movement always ignores it for scouts
      u.targetId = tgt.id;
      u.targetIsBuilding = tgt.isBuilding;
      if (u.attackTimer > 0) continue;
      const mul = raceUnitMul(sim.players[u.owner]!.race, u.kind).dmg;
      const toAir = tgt.isBuilding
        ? 0.4
        : UNITS[sim.units.find((x) => x.id === tgt.id)?.kind ?? "raider"]?.air
          ? 1
          : 0.15;
      fireProjectile(
        sim,
        u.owner,
        u.x,
        u.y,
        tgt.x,
        tgt.y,
        tgt.id,
        tgt.isBuilding,
        def.damage * mul,
        unitShotStyle(u.kind),
        // >1 lifts the muzzle toward scout cruise altitude in beam render
        1.5,
        toAir,
      );
      u.attackTimer = def.dpsInterval;
      continue;
    }

    const tgt = acquireTarget(sim, u);
    if (!tgt) {
      u.targetId = null;
      continue;
    }
    u.targetId = tgt.id;
    u.targetIsBuilding = tgt.isBuilding;
    if (dist(u.x, u.y, tgt.x, tgt.y) > def.range || u.attackTimer > 0) continue;
    const mul = raceUnitMul(sim.players[u.owner]!.race, u.kind).dmg;
    const toAir = tgt.isBuilding
      ? 0.4
      : UNITS[sim.units.find((x) => x.id === tgt.id)?.kind ?? "raider"]?.air
        ? 1
        : 0.15;
    fireProjectile(
      sim,
      u.owner,
      u.x,
      u.y,
      tgt.x,
      tgt.y,
      tgt.id,
      tgt.isBuilding,
      def.damage * mul,
      unitShotStyle(u.kind),
      def.air ? 1 : 0.2,
      toAir,
    );
    u.attackTimer = def.dpsInterval;
  }
}

export function tickProjectiles(sim: CombatHost, dt: number) {
  const survivors: Projectile[] = [];
  for (const p of sim.projectiles) {
    p.age += dt;

    if (p.style === "mine" || p.targetIsMineral) {
      const miner = sim.units.find(
        (u) =>
          u.owner === p.owner &&
          u.kind === "worker" &&
          u.mineMineralId === p.targetId &&
          !u.carrying,
      );
      const m = sim.minerals.find((mm) => mm.id === p.targetId);
      if (!m || !miner || p.age >= p.maxAge) continue;
      p.ox = miner.x;
      p.oy = miner.y;
      p.x = m.x;
      p.y = m.y;
      p.tx = m.x;
      p.ty = m.y;
      survivors.push(p);
      continue;
    }

    if (p.targetIsBuilding) {
      const b = sim.buildings.find((x) => x.id === p.targetId);
      if (b) {
        p.tx = b.x;
        p.ty = b.y;
      }
    } else {
      const u = sim.units.find((x) => x.id === p.targetId);
      if (u) {
        p.tx = u.x;
        p.ty = u.y;
        p.toAir = UNITS[u.kind].air ? 1 : 0.15;
      }
    }

    let dx = p.tx - p.x;
    if (dx > MAP_W / 2) dx -= MAP_W;
    if (dx < -MAP_W / 2) dx += MAP_W;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;

    if (d <= step || p.age >= p.maxAge) {
      if (p.damage > 0) {
        if (p.targetIsBuilding) {
          const b = sim.buildings.find((x) => x.id === p.targetId);
          if (b) b.hp -= p.damage;
        } else {
          const u = sim.units.find((x) => x.id === p.targetId);
          if (u) u.hp -= p.damage;
        }
      }
      continue;
    }
    p.x = (p.x + (dx / d) * step + MAP_W) % MAP_W;
    p.y = clamp(p.y + (dy / d) * step, 0.2, MAP_H - 0.2);
    survivors.push(p);
  }
  sim.projectiles = survivors;

  for (const b of sim.buildings) {
    if (b.hp <= 0) {
      sim.markOcc(b.x, b.y, false);
      if (b.isTech && b.fromCard) {
        const pl = sim.players[b.owner]!;
        pl.discard.push(b.fromCard as CardId);
      }
      for (const u of sim.units) {
        if (u.buildTargetId === b.id) {
          u.buildTargetId = null;
          u.carrying = false;
        }
      }
    }
  }
  sim.buildings = sim.buildings.filter((b) => b.hp > 0);
  sim.units = sim.units.filter((u) => u.hp > 0);
  if (sim.paths.size > sim.units.length + 4) {
    const live = new Set(sim.units.map((u) => u.id));
    for (const id of sim.paths.keys()) {
      if (!live.has(id)) sim.paths.delete(id);
    }
  }
}
