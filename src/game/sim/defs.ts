import type { BuildingDef, BuildingKind, RaceDef, RaceId, UnitDef, UnitKind } from "./types";

// Faction identity/lore: see LORE.md (Orbital Operators = anti-automation
// space libertarians, drone pilots — fastest vehicles, strongest air power).
export const RACES: Record<RaceId, RaceDef> = {
  operators: {
    id: "operators",
    name: "Orbital Operators",
    short: "Ops",
    tint: "#2dff8c",
    blurb: "Scrappy belt crews. Thin hulls, first to the crystal.",
    botLean: "rush",
  },
  blight: {
    id: "blight",
    name: "System Blight",
    short: "Blight",
    tint: "#ff2a2a",
    blurb: "Rogue mining gear gone feral. Spreads nodes, feeds, hatches.",
    botLean: "expand",
  },
  mandate: {
    id: "mandate",
    name: "Surface Mandate",
    short: "Mandate",
    tint: "#3d9bff",
    blurb: "Settled-world bureaucracy. Slow steel, deep pockets.",
    botLean: "defend",
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  core: {
    kind: "core",
    name: "Core",
    cost: 0,
    buildTime: 0,
    hp: 1400,
    vision: 7,
    tag: "eco",
    placeable: false,
    produces: "worker",
    produceTime: 4.5,
    produceCost: 0,
  },
  extractor: {
    kind: "extractor",
    name: "Extractor",
    cost: 60,
    buildTime: 12,
    hp: 280,
    vision: 4,
    tag: "expand",
    placeable: true,
  },
  /** Ops: worker production hub (trains workers when free capacity allows). */
  depot: {
    kind: "depot",
    name: "Worker Depot",
    cost: 100,
    buildTime: 11,
    hp: 300,
    vision: 4.5,
    tag: "expand",
    placeable: true,
    produces: "worker",
    produceTime: 5.5,
    produceCost: 0,
  },
  /**
   * Ops: mineral drop-off (plus core) and energy bank.
   * Each finished refinery raises energyMax by REFINERY_ENERGY_BONUS.
   * No crystal link required. No capacity grant — that is Core / Dome.
   */
  refinery: {
    kind: "refinery",
    name: "Refinery",
    cost: 50,
    buildTime: 10,
    hp: 260,
    vision: 4,
    tag: "eco",
    placeable: true,
  },
  /**
   * Ops habitat dome — fragile geodesic house.
   * Only +3 capacity; expensive. Main Ops soft spot (orbital glass).
   */
  dome: {
    kind: "dome",
    name: "Dome",
    cost: 200,
    buildTime: 16,
    hp: 110,
    vision: 3.5,
    tag: "eco",
    placeable: true,
  },
  /** Tech: Command Center / Bureau / Fang — injects cards when finished. */
  command: {
    kind: "command",
    name: "Command Center",
    cost: 250,
    buildTime: 20,
    hp: 420,
    vision: 5.5,
    tag: "expand",
    placeable: true,
  },
  barracks: {
    kind: "barracks",
    name: "Bay",
    cost: 150,
    buildTime: 14,
    hp: 320,
    vision: 4,
    tag: "rush",
    placeable: true,
    produces: "raider",
    produceTime: 5,
    produceCost: 25,
  },
  turret: {
    kind: "turret",
    name: "Turret",
    cost: 100,
    buildTime: 10,
    hp: 360,
    vision: 5,
    tag: "defend",
    placeable: true,
    attackGround: 18,
    range: 4.5,
  },
  aa: {
    kind: "aa",
    name: "AA Nest",
    cost: 65,
    buildTime: 12,
    hp: 300,
    vision: 5,
    tag: "defend",
    placeable: true,
    attackAir: 28,
    range: 5.5,
  },
  factory: {
    kind: "factory",
    name: "Forge",
    cost: 95,
    buildTime: 18,
    hp: 400,
    vision: 4,
    tag: "defend",
    placeable: true,
    produces: "tank",
    produceTime: 8,
    produceCost: 45,
  },
  airpad: {
    kind: "airpad",
    name: "Airpad",
    cost: 100,
    buildTime: 18,
    hp: 340,
    vision: 4,
    tag: "rush",
    placeable: true,
    /** Default product (Mandate etc.). Operators override to interceptor — see unitProducedBy. */
    produces: "flyer",
    produceTime: 9,
    produceCost: 50,
  },
  scout: {
    kind: "scout",
    name: "Scout Works",
    cost: 100,
    buildTime: 10,
    hp: 220,
    vision: 5,
    tag: "scout",
    placeable: true,
    produces: "scout",
    // Product is the drone CRT-assembled on the pad — fling it as soon as
    // seat + cap allow (no separate factory queue after the building resolves).
    produceTime: 0,
    produceCost: 20,
  },
  logistics: {
    kind: "logistics",
    name: "Logistics Hub",
    cost: 300,
    buildTime: 22,
    hp: 380,
    vision: 5,
    tag: "eco",
    placeable: true,
  },
  em_array: {
    kind: "em_array",
    name: "EM Array",
    cost: 300,
    buildTime: 22,
    hp: 360,
    vision: 5.5,
    tag: "defend",
    placeable: true,
  },
  strike_dock: {
    kind: "strike_dock",
    name: "Strike Dock",
    cost: 300,
    buildTime: 22,
    hp: 400,
    vision: 5,
    tag: "rush",
    placeable: true,
  },
  null_lattice: {
    kind: "null_lattice",
    name: "Null Lattice",
    cost: 400,
    buildTime: 28,
    hp: 320,
    vision: 6,
    tag: "defend",
    placeable: true,
  },
  bomber_works: {
    kind: "bomber_works",
    name: "Bomber Works",
    cost: 400,
    buildTime: 28,
    hp: 380,
    vision: 5,
    tag: "rush",
    placeable: true,
    produces: "bomber",
    produceTime: 12,
    produceCost: 60,
  },
  /**
   * Retired Ops energy bank — role merged into refinery.
   * Kind kept so old saves / mesh aliases don't break; not placeable.
   */
  capacitor: {
    kind: "capacitor",
    name: "Capacitor",
    cost: 150,
    buildTime: 14,
    hp: 200,
    vision: 3.5,
    tag: "eco",
    placeable: false,
  },
  artillery: {
    kind: "artillery",
    name: "Artillery Pad",
    cost: 200,
    buildTime: 16,
    hp: 300,
    vision: 5.5,
    tag: "defend",
    placeable: true,
    attackGround: 28,
    range: 7.5,
  },
};


/** Speeds ~25% of prior values (another ~75% slowdown for readable globe). */
export const UNITS: Record<UnitKind, UnitDef> = {
  worker: {
    kind: "worker",
    name: "Worker",
    role: "worker",
    hp: 60,
    speed: 0.325,
    vision: 3.2,
    air: false,
    damage: 4,
    range: 1.2,
    attackAir: false,
    attackGround: true,
    dpsInterval: 0.8,
  },
  raider: {
    kind: "raider",
    name: "Raider",
    role: "light",
    hp: 70,
    speed: 0.375,
    vision: 3.5,
    air: false,
    damage: 10,
    range: 1.4,
    attackAir: false,
    attackGround: true,
    dpsInterval: 0.55,
  },
  tank: {
    kind: "tank",
    name: "Tank",
    role: "heavy",
    hp: 180,
    speed: 0.21,
    vision: 3.5,
    air: false,
    damage: 22,
    range: 2.4,
    attackAir: false,
    attackGround: true,
    dpsInterval: 0.85,
  },
  /** Shared / non-Ops combat air (Mandate pad, etc.). */
  flyer: {
    kind: "flyer",
    name: "Flyer",
    role: "air",
    hp: 95,
    speed: 0.425,
    vision: 4.5,
    air: true,
    damage: 14,
    range: 2.2,
    attackAir: true,
    attackGround: true,
    dpsInterval: 0.65,
  },
  /** Ops T2 Airpad product — VTOL interceptor, air + ground. */
  interceptor: {
    kind: "interceptor",
    name: "Interceptor",
    role: "air",
    hp: 95,
    speed: 0.45,
    vision: 4.5,
    air: true,
    damage: 14,
    range: 2.2,
    attackAir: true,
    attackGround: true,
    dpsInterval: 0.62,
  },
  /** Ops T3 Bomber Works product — heavy ground strike, weaker AA. */
  bomber: {
    kind: "bomber",
    name: "Bomber",
    role: "air",
    hp: 140,
    speed: 0.32,
    vision: 4.2,
    air: true,
    damage: 28,
    range: 2.6,
    attackAir: true,
    attackGround: true,
    dpsInterval: 0.9,
  },
  scout: {
    kind: "scout",
    name: "Drone",
    role: "light",
    hp: 45,
    speed: 0.59,
    vision: 7.5,
    air: true,
    // Light laser — harass units (incl. air) and peel buildings while on recon
    damage: 5,
    range: 2.35,
    attackAir: true,
    attackGround: true,
    dpsInterval: 0.72,
  },
};

export const MAP_W = 48;
export const MAP_H = 36;
export const GLOBE_RADIUS = 52;
export const MATCH_SECONDS = 600; // 10 minutes
export const START_ENERGY = 200;
export const START_WORKERS = 2;
export const BASE_INCOME = 3;
/** Free capacity granted by each finished core. */
export const CORE_CAP = 5;
/** Ops habitat dome capacity grant (fragile / expensive). */
export const DOME_CAP = 3;
/** Temporary: non-Ops extractors also add capacity until those races get supply buildings. */
export const EXTRACTOR_CAP_BONUS = 2;
/** @deprecated refinery no longer grants capacity — energy only (see REFINERY_ENERGY_BONUS) */
export const REFINERY_CAP = 0;

/** @deprecated worker-only cap; production now uses capacity */
export const CORE_WORKER_CAP = 3;
export const EXTRACTOR_WORKER_BONUS = 2;
/** @deprecated depot no longer grants worker slots — capacity does */
export const DEPOT_WORKER_BONUS = 0;
export const EXTRACTOR_LINK_RANGE = 2.4;
/** Min center-to-center spacing for buildings (~40% tighter than old 1.35). */
export const BUILD_MIN_DIST = 0.81;
/** Energy granted per worker drop-off trip */
export const MINE_TRIP_YIELD = 6;
/** Seconds standing at crystal before load is full (laser ease-in / hold / ease-out) */
export const MINE_CHANNEL = 2;
/** Mine laser: ease-on duration (seconds) within the channel */
export const MINE_EASE_ON = 1;
/** Mine laser: full-power hold (seconds) */
export const MINE_HOLD = 0.5;
/** Mine laser: ease-off duration (seconds) — remainder of channel after ease-on+hold */
export const MINE_EASE_OFF = 0.5;
export const TICK_DT = 1 / 20;
export const PLACEABLE = (
  Object.values(BUILDINGS).filter((b) => b.placeable) as BuildingDef[]
).map((b) => b.kind);

/** Race-filtered placeables: Ops uses depot+refinery+dome instead of classic extractor. */
export function placeableForRace(race: RaceId): BuildingKind[] {
  const opsOnly: BuildingKind[] = [
    "depot",
    "refinery",
    "dome",
    "logistics",
    "em_array",
    "strike_dock",
    "null_lattice",
    "bomber_works",
    "artillery",
  ];
  return PLACEABLE.filter((k) => {
    if (race === "operators") return k !== "extractor";
    return !opsOnly.includes(k);
  });
}


/**
 * What a finished building trains for this race.
 *
 * Factions are asymmetric long-term (no shared unit/building kit). Race
 * branches here are transitional while some BuildingKinds are still shared
 * across decks (e.g. airpad). Prefer faction-owned kinds over new overrides.
 */
export function unitProducedBy(
  buildingKind: BuildingKind,
  race: RaceId,
): UnitKind | undefined {
  const base = BUILDINGS[buildingKind]?.produces;
  if (!base) return undefined;
  // Ops Airpad → Interceptor (not the shared Flyer). Mandate keeps Flyer.
  if (race === "operators" && buildingKind === "airpad") return "interceptor";
  // Bomber Works is Ops-only; product is Bomber.
  if (buildingKind === "bomber_works") return "bomber";
  return base;
}

/** Capacity cost of a unit kind (every unit uses ≥1). */
export function unitCapCost(kind: UnitKind): number {
  if (kind === "tank") return 2;
  if (kind === "flyer" || kind === "interceptor") return 2;
  if (kind === "bomber") return 3;
  return 1;
}

export function raceCostMul(race: RaceId): number {
  if (race === "operators") return 0.92;
  if (race === "blight") return 1.05;
  return 1;
}

export function raceUnitMul(race: RaceId, kind: UnitKind): { speed: number; dmg: number } {
  if (race === "operators") {
    // Ops rovers: 2× prior effective cruise (was 1.12)
    if (kind === "worker") return { speed: 2.24, dmg: 1.05 };
    if (kind === "raider") return { speed: 1.12, dmg: 1.05 };
    return { speed: 1.05, dmg: 1 };
  }
  if (race === "mandate") {
    if (kind === "tank") return { speed: 0.95, dmg: 1.12 };
    return { speed: 0.98, dmg: 1.05 };
  }
  if (race === "blight") {
    if (kind === "flyer" || kind === "interceptor" || kind === "bomber" || kind === "scout")
      return { speed: 1.1, dmg: 1.08 };
    return { speed: 1, dmg: 1 };
  }
  return { speed: 1, dmg: 1 };
}

/** 0–1 mining laser intensity over channel progress (ease 1s → hold 0.5s → ease 0.5s). */
export function mineLaserPower(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const onEnd = MINE_EASE_ON / MINE_CHANNEL;
  const holdEnd = (MINE_EASE_ON + MINE_HOLD) / MINE_CHANNEL;
  const smooth = (u: number) => u * u * (3 - 2 * u);
  if (t < onEnd) return smooth(t / onEnd);
  if (t < holdEnd) return 1;
  return 1 - smooth((t - holdEnd) / Math.max(1e-6, 1 - holdEnd));
}
