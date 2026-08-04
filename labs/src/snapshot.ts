import { ENERGY_MAX_BASE } from "@game/sim/deck";
import { BUILDINGS, MAP_H, MAP_W, START_ENERGY, UNITS } from "@game/sim/defs";
import type {
  Building,
  BuildingKind,
  PlayerId,
  PlayerState,
  RaceId,
  SimSnapshot,
  Unit,
  UnitKind,
} from "@game/sim/types";

let nextId = 1;

export function resetLabIds(start = 1) {
  nextId = start;
}

function allocId() {
  return nextId++;
}

export function makeLabPlayer(
  id: PlayerId,
  race: RaceId,
  opts?: { fullVision?: boolean },
): PlayerState {
  const vision = new Uint8Array(MAP_W * MAP_H);
  if (opts?.fullVision !== false) vision.fill(1);
  return {
    id,
    race,
    energy: START_ENERGY,
    energyMax: ENERGY_MAX_BASE,
    income: 3,
    alive: true,
    workerCap: 3,
    capMax: 5,
    vision,
    hand: [],
    next: null,
    draw: [],
    discard: [],
    techsPlaced: [],
    visitT: new Float32Array(MAP_W * MAP_H).fill(-1e9),
  };
}

/** Empty match-shaped snapshot: blank globe, full vision, no entities. */
export function emptySnapshot(opts?: {
  race0?: RaceId;
  race1?: RaceId;
  fullVision?: boolean;
  t?: number;
}): SimSnapshot {
  resetLabIds(1);
  const fullVision = opts?.fullVision !== false;
  return {
    t: opts?.t ?? 0,
    phase: "playing",
    winner: null,
    mapW: MAP_W,
    mapH: MAP_H,
    players: [
      makeLabPlayer(0, opts?.race0 ?? "operators", { fullVision }),
      makeLabPlayer(1, opts?.race1 ?? "blight", { fullVision }),
    ],
    buildings: [],
    units: [],
    minerals: [],
    projectiles: [],
    floaters: [],
    ops: [],
    messages: [],
  };
}

export function makeBuilding(
  owner: PlayerId,
  kind: BuildingKind,
  x: number,
  y: number,
  opts?: { done?: boolean; progress?: number; isTech?: boolean },
): Building {
  const def = BUILDINGS[kind];
  const done = opts?.done !== false;
  const progress = opts?.progress ?? (done ? 1 : 0.45);
  return {
    id: allocId(),
    owner,
    kind,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    done,
    progress,
    buildTime: def.buildTime,
    vision: def.vision,
    produceTimer: 0,
    attackTimer: 0,
    linkedMineralId: null,
    fromCard: null,
    isTech: opts?.isTech ?? false,
  };
}

export function makeUnit(owner: PlayerId, kind: UnitKind, x: number, y: number): Unit {
  const def = UNITS[kind];
  return {
    id: allocId(),
    owner,
    kind,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
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
}

/** Paint a disk of vision cells (map space). */
export function paintVisionDisk(
  vision: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(MAP_W - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(MAP_H - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) vision[y * MAP_W + x] = 1;
    }
  }
}

export function cloneSnapshot(snap: SimSnapshot): SimSnapshot {
  return {
    ...snap,
    players: snap.players.map((p) => ({
      ...p,
      vision: p.vision.slice(),
      visitT: p.visitT.slice(),
      hand: [...p.hand],
      draw: [...p.draw],
      discard: [...p.discard],
      techsPlaced: [...p.techsPlaced],
    })),
    buildings: snap.buildings.map((b) => ({ ...b })),
    units: snap.units.map((u) => ({ ...u })),
    minerals: snap.minerals.map((m) => ({ ...m })),
    projectiles: snap.projectiles.map((p) => ({ ...p })),
    floaters: snap.floaters.map((f) => ({ ...f })),
    ops: snap.ops.map((o) => ({ ...o })),
    messages: [...snap.messages],
  };
}
