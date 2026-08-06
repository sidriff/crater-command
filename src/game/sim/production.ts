import { BUILDINGS, START_WORKERS, unitCapCost, unitProducedBy } from "./defs";
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
  const race = sim.players[owner]?.race ?? "operators";
  let seats = unitKind === "worker" ? START_WORKERS : 0;
  for (const b of sim.buildings) {
    if (b.owner !== owner || !b.done) continue;
    // Core never grants seats — starters are START_WORKERS; Operators workers come from depots
    if (b.kind === "core") continue;
    if (unitProducedBy(b.kind, race) !== unitKind) continue;
    const d = BUILDINGS[b.kind];
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
    // Operators: workers come from depots only (core no longer auto-trains)
    if (p.race === "operators" && b.kind === "core" && def.produces === "worker") continue;
    // Non-Operators core can still train if it has produces — seat gated below

    b.produceTimer -= dt;
    if (b.produceTimer > 0) continue;

    const kind = unitProducedBy(b.kind, p.race);
    if (!kind) continue;
    const needCap = unitCapCost(kind);
    if (sim.freeCap(b.owner) < needCap) {
      b.produceTimer = 0.6;
      continue;
    }

    const have = sim.units.filter((u) => u.owner === b.owner && u.kind === kind).length;
    const seats = seatsFor(sim, b.owner, kind);
    if (have >= seats) {
      // Scouts: snappy retry so a dead drone re-stages on the rail quickly
      b.produceTimer = kind === "scout" ? 0.2 : 1.0;
      continue;
    }

    // No energy charge — seat + cap only
    // Scouts leave from the rail cradle (render does the fling); others pop on the apron ring.
    if (kind === "scout") {
      sim.spawnUnit(b.owner, kind, b.x, b.y);
    } else {
      const ang = Math.random() * Math.PI * 2;
      const rad = kind === "worker" ? 0.42 + Math.random() * 0.18 : 0.48 + Math.random() * 0.22;
      sim.spawnUnit(b.owner, kind, b.x + Math.cos(ang) * rad, b.y + Math.sin(ang) * rad);
    }
    b.produceTimer = def.produceTime ?? 6;
  }
}
