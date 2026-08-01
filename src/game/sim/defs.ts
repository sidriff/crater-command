import type { BuildingDef, BuildingKind, RaceDef, RaceId, UnitDef, UnitKind } from "./types";

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
    buildTime: 6,
    hp: 280,
    vision: 4,
    tag: "expand",
    placeable: true,
  },
  barracks: {
    kind: "barracks",
    name: "Bay",
    cost: 70,
    buildTime: 7,
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
    cost: 55,
    buildTime: 5,
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
    buildTime: 6,
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
    buildTime: 9,
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
    buildTime: 9,
    hp: 340,
    vision: 4,
    tag: "rush",
    placeable: true,
    produces: "flyer",
    produceTime: 9,
    produceCost: 50,
  },
  scout: {
    kind: "scout",
    name: "Scout Works",
    cost: 50,
    buildTime: 5,
    hp: 220,
    vision: 5,
    tag: "scout",
    placeable: true,
    produces: "scout",
    produceTime: 6,
    produceCost: 20,
  },
};

/** Speeds ~25% of prior values (another ~75% slowdown for readable globe). */
export const UNITS: Record<UnitKind, UnitDef> = {
  worker: {
    kind: "worker",
    name: "Worker",
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
  flyer: {
    kind: "flyer",
    name: "Flyer",
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
  scout: {
    kind: "scout",
    name: "Drone",
    hp: 45,
    speed: 0.59,
    vision: 7.5,
    air: true,
    damage: 0,
    range: 0.1,
    attackAir: false,
    attackGround: false,
    dpsInterval: 99,
  },
};

export const MAP_W = 48;
export const MAP_H = 36;
export const GLOBE_RADIUS = 52;
export const MATCH_SECONDS = 180;
export const START_ENERGY = 110;
export const START_WORKERS = 2;
export const BASE_INCOME = 3;
export const CORE_WORKER_CAP = 3;
export const EXTRACTOR_WORKER_BONUS = 2;
export const EXTRACTOR_LINK_RANGE = 2.4;
/** Energy granted per worker drop-off trip */
export const MINE_TRIP_YIELD = 7;
/** Seconds standing at crystal before load is full */
export const MINE_CHANNEL = 0.72;
export const TICK_DT = 1 / 20;
export const PLACEABLE = (
  Object.values(BUILDINGS).filter((b) => b.placeable) as BuildingDef[]
).map((b) => b.kind);

export function raceCostMul(race: RaceId): number {
  if (race === "operators") return 0.92;
  if (race === "blight") return 1.05;
  return 1;
}

export function raceUnitMul(race: RaceId, kind: UnitKind): { speed: number; dmg: number } {
  if (race === "operators") {
    if (kind === "raider" || kind === "worker") return { speed: 1.12, dmg: 1.05 };
    return { speed: 1.05, dmg: 1 };
  }
  if (race === "mandate") {
    if (kind === "tank") return { speed: 0.95, dmg: 1.12 };
    return { speed: 0.98, dmg: 1.05 };
  }
  if (race === "blight") {
    if (kind === "flyer" || kind === "scout") return { speed: 1.1, dmg: 1.08 };
    return { speed: 1, dmg: 1 };
  }
  return { speed: 1, dmg: 1 };
}
