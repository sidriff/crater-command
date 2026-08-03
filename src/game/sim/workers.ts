import {
  BUILDINGS,
  MAP_H,
  MAP_W,
  MINE_CHANNEL,
  MINE_TRIP_YIELD,
  UNITS,
  raceUnitMul,
} from "./defs";
import { hasPath, nearestWalkable } from "./path";
import type { GroundPath } from "./path";
import type {
  Building,
  BuildingKind,
  FloatEvent,
  Mineral,
  PlayerId,
  PlayerState,
  ProjectileStyle,
  Unit,
} from "./types";
import { allocId, clamp, dist, slotAngle } from "./util";

/** Minimal surface workers need from the sim host. */
export type WorkersHost = {
  t: number;
  units: Unit[];
  buildings: Building[];
  minerals: Mineral[];
  players: PlayerState[];
  floaters: FloatEvent[];
  paths: Map<number, GroundPath>;
  ops?: { assigneeId: number | null }[];
  moveGroundUnit: (u: Unit, tx: number, ty: number, speed: number, dt: number) => void;
  fire: (
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
    targetIsMineral?: boolean,
  ) => void;
  refreshCapacity: () => void;
  onBuildingFinished: (b: Building) => void;
};

/** Close enough that A* can be flaky on crater slopes — just walk. */
const MINE_SOFT_RANGE = 4.2;
const MINE_RANGE = 0.95;
/** How often explorers pick a new never/rare-visit waypoint */
const EXPLORE_RETARGET = 6.5;

/**
 * Stamp visit times for cells a unit currently reveals (approx vision disc).
 * Cheap grid stamp — used so idle workers bias toward dark rock.
 */
export function stampUnitVisits(sim: WorkersHost, u: Unit, radius: number) {
  const p = sim.players[u.owner];
  if (!p?.visitT) return;
  const r = Math.max(1, Math.ceil(radius));
  const cx0 = Math.floor(u.x);
  const cy0 = Math.floor(u.y);
  const r2 = radius * radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2 + 0.5) continue;
      const cx = ((cx0 + dx) % MAP_W + MAP_W) % MAP_W;
      const cy = cy0 + dy;
      if (cy < 0 || cy >= MAP_H) continue;
      p.visitT[cy * MAP_W + cx] = sim.t;
    }
  }
}

export function stampAllVisits(sim: WorkersHost) {
  for (const u of sim.units) {
    const vis = UNITS[u.kind]?.vision ?? 3;
    stampUnitVisits(sim, u, vis * 0.85);
  }
  for (const b of sim.buildings) {
    if (!b.done) continue;
    const fake: Unit = {
      id: b.id,
      owner: b.owner,
      kind: "worker",
      x: b.x,
      y: b.y,
      hp: 1,
      maxHp: 1,
      targetId: null,
      targetIsBuilding: false,
      attackTimer: 0,
      buildTargetId: null,
      mineMineralId: null,
      carrying: false,
      cargo: 0,
      mineProgress: 0,
      exploreX: null,
      exploreY: null,
    };
    stampUnitVisits(sim, fake, (b.vision || 4) * 0.9);
  }
}

export function pickMineFor(
  sim: WorkersHost,
  owner: PlayerId,
  wx: number,
  wy: number,
): Mineral | null {
  const linked = new Set(
    sim.buildings
      .filter(
        (b) =>
          b.owner === owner && b.kind === "extractor" && b.done && b.linkedMineralId != null,
      )
      .map((b) => b.linkedMineralId!),
  );
  const assigned = new Map<number, number>();
  for (const u of sim.units) {
    if (u.owner !== owner || u.kind !== "worker" || u.mineMineralId == null) continue;
    if (u.buildTargetId != null || u.carrying) continue;
    assigned.set(u.mineMineralId, (assigned.get(u.mineMineralId) ?? 0) + 1);
  }

  let best: Mineral | null = null;
  let bestScore = 1e9;

  for (const m of sim.minerals) {
    if (m.yield <= 0) continue;
    const d = dist(wx, wy, m.x, m.y);
    // Far crystals need a real path; near ones (slope / crater lip) skip A*
    if (d > MINE_SOFT_RANGE && !hasPath(wx, wy, m.x, m.y)) continue;
    const load = assigned.get(m.id) ?? 0;
    // Prefer under-assigned + linked extractors; slight bias to richer crystals
    const stockBias = 1 - Math.min(1, m.yield / 100) * 0.15;
    const score = d + load * 1.8 + (linked.has(m.id) ? -8 : 0) + stockBias;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** Pick a walkable explore goal biased to never / stale visit cells. */
export function pickExploreGoal(
  sim: WorkersHost,
  owner: PlayerId,
  wx: number,
  wy: number,
  unitId: number,
): { x: number; y: number } {
  const p = sim.players[owner]!;
  const visit = p.visitT;
  let best: { x: number; y: number } | null = null;
  let bestScore = -1e18;
  const seed = unitId * 17.13 + sim.t * 0.37;

  for (let i = 0; i < 28; i++) {
    const a = (seed + i * 2.399) % (Math.PI * 2);
    const ring = 2.2 + ((i * 1.7 + unitId) % 9);
    let x = wx + Math.cos(a) * ring;
    let y = wy + Math.sin(a) * ring * 0.85;
    // Mix in global samples so they fan out across the rock
    if (i % 3 === 0) {
      x = ((i * 7 + unitId * 3) % MAP_W) + 0.5;
      y = ((i * 5 + unitId * 2) % (MAP_H - 4)) + 2;
    }
    x = ((x % MAP_W) + MAP_W) % MAP_W;
    y = clamp(y, 1.2, MAP_H - 1.2);
    const walk = nearestWalkable(x, y, 3);
    if (!walk) continue;
    // Soft path check — skip unreachable far goals
    const dHome = dist(wx, wy, walk.x, walk.y);
    if (dHome > 5 && !hasPath(wx, wy, walk.x, walk.y)) continue;

    const cx = Math.floor(walk.x) % MAP_W;
    const cy = Math.max(0, Math.min(MAP_H - 1, Math.floor(walk.y)));
    const last = visit[cy * MAP_W + cx] ?? -1e9;
    const age = sim.t - last; // large if never / stale
    // Never-visited bonus + age, prefer medium range (not right under feet)
    const rangePref = dHome < 1.2 ? -4 : dHome > 14 ? -2 : 0;
    const score = age * 1.15 + (last < 0 ? 40 : 0) + rangePref + Math.sin(seed + i) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = walk;
    }
  }

  if (best) return best;
  // Fallback: drift toward map center ring
  const home = sim.buildings.find((b) => b.owner === owner && b.kind === "core");
  const ang = (unitId * 1.7 + sim.t * 0.2) % (Math.PI * 2);
  const cx = home?.x ?? wx;
  const cy = home?.y ?? wy;
  return {
    x: ((cx + Math.cos(ang) * 5) % MAP_W + MAP_W) % MAP_W,
    y: clamp(cy + Math.sin(ang) * 4, 1.5, MAP_H - 1.5),
  };
}

export function depositCargo(
  sim: WorkersHost,
  u: Unit,
  drop: { x: number; y: number; id?: number },
  dropKind?: BuildingKind,
) {
  const p = sim.players[u.owner]!;
  const yieldAmt = Math.max(0, u.cargo || MINE_TRIP_YIELD);
  p.energy += yieldAmt;
  u.carrying = false;
  u.cargo = 0;
  u.mineProgress = 0;
  u.mineMineralId = null;
  u.exploreX = null;
  u.exploreY = null;

  let fx = drop.x;
  let fy = drop.y;
  if (dropKind === "core") {
    const ang = (u.id * 2.399) % (Math.PI * 2);
    fx += Math.cos(ang) * 0.55;
    fy += Math.sin(ang) * 0.55;
  }
  sim.floaters.push({
    id: allocId(),
    x: fx,
    y: fy,
    owner: u.owner,
    amount: yieldAmt,
    born: sim.t,
    elev: dropKind === "core" ? 2.6 : 1.15,
  });
}

export function pickDropoff(
  sim: WorkersHost,
  owner: PlayerId,
  wx: number,
  wy: number,
  mineralId: number | null,
): { x: number; y: number; id: number; kind: BuildingKind } | null {
  const race = sim.players[owner]!.race;
  let best: { x: number; y: number; id: number; kind: BuildingKind } | null = null;
  let bestScore = 1e9;
  for (const b of sim.buildings) {
    if (b.owner !== owner || !b.done) continue;
    if (race === "operators") {
      if (b.kind !== "core") continue;
    } else {
      if (b.kind !== "extractor" && b.kind !== "core") continue;
    }
    const d = dist(wx, wy, b.x, b.y);
    let score = d;
    if (race !== "operators") {
      if (b.kind === "core") score += 4;
      else if (mineralId != null && b.linkedMineralId === mineralId) score -= 6;
      else score -= 1.5;
    }
    if (score < bestScore) {
      bestScore = score;
      best = { x: b.x, y: b.y, id: b.id, kind: b.kind };
    }
  }
  return best;
}

function clearExplore(u: Unit) {
  u.exploreX = null;
  u.exploreY = null;
}

export function tickWorkers(sim: WorkersHost, dt: number) {
  const tasked = new Set<number>();
  if (sim.ops) {
    for (const o of sim.ops) {
      if (o.assigneeId != null) tasked.add(o.assigneeId);
    }
  }
  for (const u of sim.units) {
    if (u.kind !== "worker") continue;
    // Op survey has control
    if (tasked.has(u.id) && u.buildTargetId == null) continue;
    const sp = UNITS.worker.speed * raceUnitMul(sim.players[u.owner]!.race, u.kind).speed;

    // —— Construction takes priority ——
    if (u.buildTargetId != null) {
      u.mineMineralId = null;
      u.mineProgress = 0;
      clearExplore(u);
      const b = sim.buildings.find((x) => x.id === u.buildTargetId);
      if (!b || b.done) {
        u.buildTargetId = null;
        u.carrying = false;
        u.cargo = 0;
        sim.paths.delete(u.id);
      } else {
        const d = dist(u.x, u.y, b.x, b.y);
        if (d > 0.55) {
          sim.moveGroundUnit(u, b.x, b.y, sp, dt);
        } else {
          b.progress += dt / Math.max(0.5, b.buildTime);
          b.hp = Math.min(b.maxHp, b.maxHp * (0.15 + 0.85 * b.progress));
          if (b.progress >= 1) {
            b.done = true;
            b.progress = 1;
            b.hp = b.maxHp;
            u.buildTargetId = null;
            u.carrying = false;
            u.cargo = 0;
            sim.paths.delete(u.id);
            if (BUILDINGS[b.kind].produces) b.produceTimer = BUILDINGS[b.kind].produceTime ?? 5;
            sim.refreshCapacity();
            sim.onBuildingFinished(b);
          } else {
            continue;
          }
        }
        if (u.buildTargetId != null) continue;
      }
    }

    // —— Haul load to nearest drop-off ——
    if (u.carrying) {
      clearExplore(u);
      const drop = pickDropoff(sim, u.owner, u.x, u.y, u.mineMineralId);
      if (!drop) {
        u.carrying = false;
        u.cargo = 0;
        continue;
      }
      const dDrop = dist(u.x, u.y, drop.x, drop.y);
      const dropR = drop.kind === "core" ? 1.15 : 0.75;
      if (dDrop > dropR) {
        sim.moveGroundUnit(u, drop.x, drop.y, sp, dt);
      } else {
        depositCargo(sim, u, drop, drop.kind);
        sim.paths.delete(u.id);
      }
      continue;
    }

    // —— Empty: walk to crystal, channel, fill cargo ——
    let m =
      u.mineMineralId != null
        ? sim.minerals.find((mm) => mm.id === u.mineMineralId && mm.yield > 0) ?? null
        : null;

    if (m) {
      const dCur = dist(u.x, u.y, m.x, m.y);
      // Only abandon for path when far; nearby crystals always valid
      if (dCur > MINE_SOFT_RANGE && !hasPath(u.x, u.y, m.x, m.y)) {
        m = null;
        u.mineMineralId = null;
      }
    }

    if (!m) {
      m = pickMineFor(sim, u.owner, u.x, u.y);
      u.mineMineralId = m?.id ?? null;
      u.mineProgress = 0;
      if (m) {
        clearExplore(u);
        sim.paths.delete(u.id);
      }
    }

    if (!m) {
      // No crystals → scout the dark rock so we don't soft-lock eco
      let tx = u.exploreX;
      let ty = u.exploreY;
      const needNew =
        tx == null ||
        ty == null ||
        dist(u.x, u.y, tx, ty) < 0.7 ||
        // re-roll on a slow period so they keep sweeping stale cells
        Math.floor(sim.t / EXPLORE_RETARGET + u.id) !==
          Math.floor((sim.t - dt) / EXPLORE_RETARGET + u.id);

      if (needNew) {
        const g = pickExploreGoal(sim, u.owner, u.x, u.y, u.id);
        u.exploreX = g.x;
        u.exploreY = g.y;
        tx = g.x;
        ty = g.y;
        sim.paths.delete(u.id);
      }
      if (tx != null && ty != null) {
        sim.moveGroundUnit(u, tx, ty, sp * 1.05, dt);
      }
      continue;
    }

    // Mining crystal
    clearExplore(u);
    const ang = slotAngle(u.id, 10);
    const holdR = 0.55 + (u.id % 3) * 0.08;
    const hx = m.x + Math.cos(ang) * holdR;
    const hy = clamp(m.y + Math.sin(ang) * holdR * 0.85, 0.5, MAP_H - 0.5);
    const d = dist(u.x, u.y, m.x, m.y);

    if (d > MINE_RANGE) {
      // Walk straight at hold point; movement handles terrain
      sim.moveGroundUnit(u, hx, hy, sp, dt);
      u.mineProgress = 0;
    } else {
      u.mineProgress = Math.min(1, u.mineProgress + dt / MINE_CHANNEL);
      u.attackTimer -= dt;
      if (u.attackTimer <= 0) {
        sim.fire(u.owner, u.x, u.y, m.x, m.y, m.id, false, 0, "mine", 0.45, 0.55, true);
        u.attackTimer = 0.1;
      }
      if (u.mineProgress >= 1) {
        const take = Math.min(MINE_TRIP_YIELD, m.yield);
        if (take <= 0) {
          u.mineMineralId = null;
          u.mineProgress = 0;
          continue;
        }
        m.yield -= take;
        u.carrying = true;
        u.cargo = take;
        u.mineProgress = 0;
        sim.paths.delete(u.id);
        if (m.yield <= 0) {
          sim.minerals = sim.minerals.filter((mm) => mm.id !== m!.id);
          for (const w of sim.units) {
            if (w.mineMineralId === m!.id) {
              w.mineMineralId = null;
              w.mineProgress = 0;
            }
          }
        }
      }
    }
  }
}
