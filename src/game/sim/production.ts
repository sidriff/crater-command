import { BUILDINGS, START_WORKERS, unitCapCost } from "./defs";
import type { Building, GamePhase, PlayerId, PlayerState, Unit, UnitKind } from "./types";

export type ProductionHost = {
  phase: GamePhase;
  units: Unit[];
  buildings: Building[];
  players: PlayerState[];
  freeCap: (owner: PlayerId) => number;
  spawnUnit: (owner: PlayerId, kind: UnitKind, x: number, y: number) => void;
};

/** Total seats for a unit kind: sum of produceSeats (default 1) per finished producer. Workers get START_WORKERS free. */
function seatsFor(sim: ProductionHost, owner: PlayerId, unitKind: UnitKind): number {
  let seats = unitKind === "worker" ? START_WORKERS : 0;
  for (const b of sim.buildings) {
    if (b.owner !== owner || !b.done) continue;
    // Core never grants seats — starters are START_WORKERS; Ops workers come from depots
    if (b.kind === "core") continue;
    const d = BUILDINGS[b.kind];
    if (d.produces !== unitKind) continue;
    seats += d.produceSeats ?? 1;
  }
  return seats;
}

export function tickProduction(sim: ProductionHost, dt: number) {
  if (sim.phase !== "playing") return;
  for (const b of sim.buildings) {
    if (!b.done) continue;
    const def = BUILDINGS[b.kind];
    if (!def.produces) continue;
    const p = sim.players[b.owner]!;
    if (!p.alive) continue;
    // Ops: workers come from depots only (core no longer auto-trains)
    if (p.race === "operators" && b.kind === "core" && def.produces === "worker") continue;
    // Non-ops core can still train if it has produces — seat gated below

    b.produceTimer -= dt;
    if (b.produceTimer > 0) continue;

    const kind = def.produces;
    const needCap = unitCapCost(kind);
    if (sim.freeCap(b.owner) < needCap) {
      b.produceTimer = 0.6;
      continue;
    }

    const have = sim.units.filter((u) => u.owner === b.owner && u.kind === kind).length;
    const seats = seatsFor(sim, b.owner, kind);
    if (have >= seats) {
      b.produceTimer = 1.0;
      continue;
    }

    // No energy charge — seat + cap only
    const ang = Math.random() * Math.PI * 2;
    const rad = kind === "worker" ? 0.42 + Math.random() * 0.18 : 0.48 + Math.random() * 0.22;
    sim.spawnUnit(b.owner, kind, b.x + Math.cos(ang) * rad, b.y + Math.sin(ang) * rad);
    b.produceTimer = def.produceTime ?? 6;
  }
}
