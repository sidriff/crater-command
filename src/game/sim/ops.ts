import { MAP_H, MAP_W, UNITS } from "./defs";
import type { OpKind } from "./deck";
import type { ActiveOp, PlayerId, Unit, UnitRole } from "./types";
import { clamp, dist } from "./util";

export type OpsHost = {
  t: number;
  units: Unit[];
  ops: ActiveOp[];
  buildings: {
    id: number;
    owner: PlayerId;
    kind: string;
    x: number;
    y: number;
    hp: number;
    done: boolean;
  }[];
  paths: Map<number, unknown>;
  moveGroundUnit: (u: Unit, tx: number, ty: number, speed: number, dt: number) => void;
};


/** Roles allowed per op kind */
const OP_ROLES: Record<OpKind, UnitRole[]> = {
  recon: ["light"],
  intercept: ["light", "air"],
  bomb_run: ["air"],
  jamming: ["light", "air"],
  nuke: ["light", "air", "heavy"],
  overdrive: ["worker", "light"],
};

/**
 * Pick a unit for an operation by role.
 * Prefer free, faster, closer.
 */
export function pickOpUnit(
  units: Unit[],
  owner: PlayerId,
  tx: number,
  ty: number,
  roles: UnitRole[],
  excludeId?: number | null,
): Unit | null {
  let best: Unit | null = null;
  let bestScore = 1e18;
  for (const u of units) {
    if (u.owner !== owner) continue;
    if (u.hp <= 0) continue;
    if (excludeId != null && u.id === excludeId) continue;
    const def = UNITS[u.kind];
    if (!def) continue;
    if (!roles.includes(def.role)) continue;
    const d = dist(u.x, u.y, tx, ty);
    let score = d - def.speed * 14;
    if (u.kind === "worker" && u.buildTargetId != null) score += 50;
    if (u.kind === "worker" && u.carrying) score += 15;
    if (def.air) score -= 4;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

export function tickOperations(sim: OpsHost, dt: number) {
  if (!sim.ops.length) return;
  const keep: ActiveOp[] = [];
  const killOpIds = new Set<number>();

  for (const op of sim.ops) {
    if (op.kind === "jamming") {
      // jamming strips hostiles in radius
      for (const o of sim.ops) {
        if (o.id === op.id) continue;
        if (o.owner === op.owner) continue;
        if (dist(o.x, o.y, op.x, op.y) <= op.radius) killOpIds.add(o.id);
      }
      continue;
    }
    if (op.kind === "nuke") {
      for (const b of sim.buildings) {
        if (b.owner === op.owner || !b.done) continue;
        if (dist(b.x, b.y, op.x, op.y) <= op.radius) {
          b.hp = Math.max(1, b.hp - 280);
        }
      }
      continue;
    }
    if (op.kind === "overdrive") {
      for (const u of sim.units) {
        if (u.owner !== op.owner) continue;
        if (UNITS[u.kind]?.role !== "worker") continue;
        if (dist(u.x, u.y, op.x, op.y) > op.radius) continue;
        u.exploreX = null;
        u.exploreY = null;
      }
      continue;
    }


    if (killOpIds.has(op.id)) continue;

    const roles = OP_ROLES[op.kind] ?? ["light"];

    let u =
      op.assigneeId != null
        ? sim.units.find((x) => x.id === op.assigneeId && x.hp > 0) ?? null
        : null;
    if (u && !roles.includes(UNITS[u.kind]?.role)) {
      u = null;
      op.assigneeId = null;
    }
    if (!u) {
      u = pickOpUnit(sim.units, op.owner, op.x, op.y, roles, null);
      op.assigneeId = u?.id ?? null;
    }
    if (!u) {
      keep.push(op);
      continue;
    }

    if (u.kind === "worker" && u.buildTargetId != null) {
      const alt = pickOpUnit(sim.units, op.owner, op.x, op.y, roles, u.id);
      if (alt) {
        op.assigneeId = alt.id;
        u = alt;
      } else {
        keep.push(op);
        continue;
      }
    }

    const d = dist(u.x, u.y, op.x, op.y);
    if (d <= op.radius) {
      continue; // complete
    }

    if (u.kind === "worker") {
      u.mineMineralId = null;
      u.mineProgress = 0;
      u.exploreX = null;
      u.exploreY = null;
    }

    const def = UNITS[u.kind];
    const speed = def.speed * (op.kind === "bomb_run" ? 1.15 : 1);
    if (def.air) {
      let dx = op.x - u.x;
      if (dx > MAP_W / 2) dx -= MAP_W;
      if (dx < -MAP_W / 2) dx += MAP_W;
      const dy = op.y - u.y;
      const len = Math.hypot(dx, dy) || 1;
      u.x = (u.x + (dx / len) * speed * dt + MAP_W) % MAP_W;
      u.y = clamp(u.y + (dy / len) * speed * dt, 0.5, MAP_H - 0.5);
    } else {
      sim.moveGroundUnit(u, op.x, op.y, speed, dt);
    }
    keep.push(op);
  }
  sim.ops = keep.filter((o) => !killOpIds.has(o.id));
}

export function makeOp(
  id: number,
  owner: PlayerId,
  cardId: string,
  kind: OpKind,
  x: number,
  y: number,
  radius: number,
  t: number,
  units: Unit[],
): ActiveOp {
  const roles = OP_ROLES[kind] ?? ["light"];
  const needsUnit = kind === "recon" || kind === "intercept" || kind === "bomb_run";
  const assignee = needsUnit ? pickOpUnit(units, owner, x, y, roles, null) : null;
  return {
    id,
    owner,
    cardId,
    kind,
    x,
    y,
    radius,
    assigneeId: assignee?.id ?? null,
    born: t,
  };
}

export function makeReconOp(
  id: number,
  owner: PlayerId,
  cardId: string,
  x: number,
  y: number,
  radius: number,
  t: number,
  units: Unit[],
): ActiveOp {
  return makeOp(id, owner, cardId, "recon", x, y, radius, t, units);
}
