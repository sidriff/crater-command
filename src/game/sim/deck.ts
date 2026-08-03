import type { BuildingKind, RaceId } from "./types";

/** Template id for a deck card (can appear multiple times). */
export type CardId =
  | "ops_depot"
  | "ops_scout"
  | "ops_dome"
  | "ops_command"
  | "ops_turret"
  | "ops_bay"
  | "ops_recon"
  | "ops_refinery"
  | "ops_logistics"
  | "ops_em_array"
  | "ops_strike_dock"
  | "ops_null_lattice"
  | "ops_bomber_works"
  | "ops_capacitor"
  | "ops_artillery"
  | "ops_interceptor"
  | "ops_airpad"
  | "ops_jamming"
  | "ops_intercept"
  | "ops_nuke"
  | "ops_bomb_run"
  | "ops_overdrive"
  | "blt_node"
  | "blt_spine"
  | "blt_spore"
  | "blt_nest"
  | "blt_fang"
  | "man_outpost"
  | "man_battery"
  | "man_hall"
  | "man_bureau"
  | "man_forge"
  | "man_pad";

export type OpKind =
  | "recon"
  | "jamming"
  | "intercept"
  | "nuke"
  | "bomb_run"
  | "overdrive";

export interface CardDef {
  id: CardId;
  name: string;
  short: string;
  building: BuildingKind | null;
  cost: number;
  tech: boolean;
  operation: boolean;
  opKind?: OpKind;
  opRadius?: number;
  blurb: string;
  inject?: CardId[];
  /** Must own a finished building of this kind to play */
  prereq?: BuildingKind;
}

export const HAND_SIZE = 4;
/** @deprecated no timed draw — CR-style cycle uses `next` */
export const DRAW_INTERVAL = 0;
export const ENERGY_MAX_BASE = 400;
export const ENERGY_TICK = 100;
export const CAPACITOR_ENERGY_BONUS = 100;


export const CARDS: Record<CardId, CardDef> = {
  // —— Operators T0 ——
  ops_depot: {
    id: "ops_depot",
    name: "Worker Depot",
    short: "Depot",
    building: "depot",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Trains one rover worker. Drop minerals at Core or Refinery.",
  },
  ops_scout: {
    id: "ops_scout",
    name: "Scout Works",
    short: "Scout",
    building: "scout",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Launches a recon drone. Lights fog of war.",
  },
  ops_dome: {
    id: "ops_dome",
    name: "Habitat Dome",
    short: "Dome",
    building: "dome",
    cost: 200,
    tech: false,
    operation: false,
    blurb: "Fragile geodesic house. +3 capacity. Glass from orbit.",
  },
  // —— T1 ——
  ops_command: {
    id: "ops_command",
    name: "Command Center",
    short: "Cmd",
    building: "command",
    cost: 250,
    tech: true,
    operation: false,
    blurb: "TECH T1. Unlocks combat, Refinery, Recon, and all T2 doctrines into discard.",
    inject: [
      "ops_turret",
      "ops_bay",
      "ops_refinery",
      "ops_recon",
      "ops_logistics",
      "ops_em_array",
      "ops_strike_dock",
    ],
  },
  ops_turret: {
    id: "ops_turret",
    name: "Turret",
    short: "Turret",
    building: "turret",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Ground defense hardpoint.",
    prereq: "command",
  },
  ops_bay: {
    id: "ops_bay",
    name: "Raider Bay",
    short: "Bay",
    building: "barracks",
    cost: 150,
    tech: false,
    operation: false,
    blurb: "Trains basic combat rovers (raiders).",
    prereq: "command",
  },
  ops_recon: {
    id: "ops_recon",
    name: "Recon",
    short: "Recon",
    building: null,
    cost: 50,
    tech: false,
    operation: true,
    opKind: "recon",
    opRadius: 1.35,
    blurb: "OPERATION. Tasks a LIGHT unit to the mark. Completes on arrival. Stays in hand.",
  },
  ops_refinery: {
    id: "ops_refinery",
    name: "Refinery",
    short: "Refine",
    building: "refinery",
    cost: 150,
    tech: false,
    operation: false,
    blurb: "Local mineral drop-off. +2 capacity.",
  },
  // —— T2 Eco ——
  ops_logistics: {
    id: "ops_logistics",
    name: "Logistics Hub",
    short: "Hub",
    building: "logistics",
    cost: 300,
    tech: true,
    operation: false,
    blurb: "TECH T2 ECO. Convoy tempo. No T3 — efficiency is the apex.",
    prereq: "command",
    inject: ["ops_depot", "ops_depot", "ops_dome", "ops_capacitor", "ops_overdrive"],
  },
  ops_capacitor: {
    id: "ops_capacitor",
    name: "Capacitor",
    short: "Cap",
    building: "capacitor",
    cost: 150,
    tech: false,
    operation: false,
    blurb: "+100 energy max while standing.",
    prereq: "logistics",
  },
  ops_overdrive: {
    id: "ops_overdrive",
    name: "Overdrive",
    short: "Ovrdrv",
    building: null,
    cost: 80,
    tech: false,
    operation: true,
    opKind: "overdrive",
    opRadius: 2.2,
    blurb: "OPERATION. Workers in radius move faster briefly. Stays in hand.",
  },
  // —— T2 Def ——
  ops_em_array: {
    id: "ops_em_array",
    name: "EM Array",
    short: "EM",
    building: "em_array",
    cost: 300,
    tech: true,
    operation: false,
    blurb: "TECH T2 DEF. Electronic warfare. Unlocks Jamming and Null Lattice.",
    prereq: "command",
    inject: ["ops_turret", "ops_interceptor", "ops_jamming", "ops_dome", "ops_null_lattice"],
  },
  ops_interceptor: {
    id: "ops_interceptor",
    name: "Interceptor Net",
    short: "AA",
    building: "aa",
    cost: 150,
    tech: false,
    operation: false,
    blurb: "Anti-air hardpoint.",
    prereq: "em_array",
  },
  ops_jamming: {
    id: "ops_jamming",
    name: "Jamming",
    short: "Jam",
    building: null,
    cost: 100,
    tech: false,
    operation: true,
    opKind: "jamming",
    opRadius: 2.0,
    blurb: "OPERATION. Clears + suppresses enemy ops in radius.",
  },
  // —— T2 Aggro ——
  ops_strike_dock: {
    id: "ops_strike_dock",
    name: "Strike Dock",
    short: "Dock",
    building: "strike_dock",
    cost: 300,
    tech: true,
    operation: false,
    blurb: "TECH T2 AGGRO. Air and artillery. Unlocks Bomber Works.",
    prereq: "command",
    inject: ["ops_bay", "ops_artillery", "ops_airpad", "ops_intercept", "ops_bomber_works"],
  },
  ops_artillery: {
    id: "ops_artillery",
    name: "Artillery Pad",
    short: "Arty",
    building: "artillery",
    cost: 200,
    tech: false,
    operation: false,
    blurb: "Long-range ground battery.",
    prereq: "strike_dock",
  },
  ops_airpad: {
    id: "ops_airpad",
    name: "Airpad",
    short: "Air",
    building: "airpad",
    cost: 200,
    tech: false,
    operation: false,
    blurb: "VTOL fighters.",
    prereq: "strike_dock",
  },
  ops_intercept: {
    id: "ops_intercept",
    name: "Intercept",
    short: "Intrcpt",
    building: null,
    cost: 75,
    tech: false,
    operation: true,
    opKind: "intercept",
    opRadius: 1.5,
    blurb: "OPERATION. Tasks light or air unit to the mark.",
  },
  // —— T3 Def ——
  ops_null_lattice: {
    id: "ops_null_lattice",
    name: "Null Lattice",
    short: "Lattice",
    building: "null_lattice",
    cost: 400,
    tech: true,
    operation: false,
    blurb: "TECH T3 DEF. Apex deny. Injects Nuke — launch from this site.",
    prereq: "em_array",
    inject: ["ops_nuke"],
  },
  ops_nuke: {
    id: "ops_nuke",
    name: "Nuke",
    short: "Nuke",
    building: null,
    cost: 350,
    tech: false,
    operation: true,
    opKind: "nuke",
    opRadius: 2.4,
    blurb: "OPERATION. Channel heavy structure damage at the mark. Not a one-shot Core.",
  },
  // —— T3 Aggro ——
  ops_bomber_works: {
    id: "ops_bomber_works",
    name: "Bomber Works",
    short: "Bomber",
    building: "bomber_works",
    cost: 400,
    tech: true,
    operation: false,
    blurb: "TECH T3 AGGRO. One flyer seat per Works. Death refill. Cluster for squads.",
    prereq: "strike_dock",
    inject: ["ops_bomb_run"],
  },
  ops_bomb_run: {
    id: "ops_bomb_run",
    name: "Bomb Run",
    short: "Bombrun",
    building: null,
    cost: 125,
    tech: false,
    operation: true,
    opKind: "bomb_run",
    opRadius: 1.6,
    blurb: "OPERATION. Direct an air unit to the mark.",
  },

  // —— Blight (stub) ——
  blt_node: {
    id: "blt_node",
    name: "Feed Node",
    short: "Node",
    building: "extractor",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Links a crystal. Grows worker capacity.",
  },
  blt_spine: {
    id: "blt_spine",
    name: "Spine",
    short: "Spine",
    building: "barracks",
    cost: 150,
    tech: false,
    operation: false,
    blurb: "Hatches feral raiders.",
  },
  blt_spore: {
    id: "blt_spore",
    name: "Spore Nest",
    short: "Spore",
    building: "scout",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Spawns scouting mites.",
  },
  blt_nest: {
    id: "blt_nest",
    name: "Brood Nest",
    short: "Nest",
    building: "turret",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Living turret-analogue.",
  },
  blt_fang: {
    id: "blt_fang",
    name: "Fang Cortex",
    short: "Fang",
    building: "aa",
    cost: 150,
    tech: true,
    operation: false,
    blurb: "TECH. Anti-air biomass. Unlocks more teeth into discard.",
    inject: ["blt_spine", "blt_nest", "blt_spore"],
  },

  // —— Mandate (stub) ——
  man_outpost: {
    id: "man_outpost",
    name: "Claim Post",
    short: "Post",
    building: "extractor",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Legal claim on a crystal field.",
  },
  man_battery: {
    id: "man_battery",
    name: "Battery",
    short: "Batt",
    building: "turret",
    cost: 100,
    tech: false,
    operation: false,
    blurb: "Static ground battery.",
  },
  man_hall: {
    id: "man_hall",
    name: "Muster Hall",
    short: "Hall",
    building: "barracks",
    cost: 150,
    tech: false,
    operation: false,
    blurb: "Trains surface infantry (raiders).",
  },
  man_bureau: {
    id: "man_bureau",
    name: "Bureau",
    short: "Bureau",
    building: "command",
    cost: 250,
    tech: true,
    operation: false,
    blurb: "TECH. Paperwork engine. Ships doctrine cards to discard.",
    inject: ["man_battery", "man_battery", "man_hall", "man_pad"],
  },
  man_forge: {
    id: "man_forge",
    name: "Forge",
    short: "Forge",
    building: "factory",
    cost: 200,
    tech: false,
    operation: false,
    blurb: "Heavy armor production.",
  },
  man_pad: {
    id: "man_pad",
    name: "Airpad",
    short: "Air",
    building: "airpad",
    cost: 200,
    tech: false,
    operation: false,
    blurb: "VTOL pad for flyers.",
  },
};

/** Multiset of starting templates (pre-shuffle). */
export function starterDeck(race: RaceId): CardId[] {
  if (race === "operators") {
    // 1 Depot, Refinery (T1-gated by prereq), Scout, Dome, Command
    return ["ops_depot", "ops_refinery", "ops_scout", "ops_dome", "ops_command"];
  }

  if (race === "blight") {
    return ["blt_node", "blt_node", "blt_spore", "blt_spine", "blt_nest", "blt_fang"];
  }
  return [
    "man_outpost",
    "man_outpost",
    "man_battery",
    "man_hall",
    "man_bureau",
    "man_forge",
  ];
}

export function shuffleInPlace<T>(arr: T[], rng: () => number = Math.random): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

export function cardOf(id: CardId): CardDef {
  return CARDS[id];
}

export function isOperation(id: CardId | string): boolean {
  return !!CARDS[id as CardId]?.operation;
}
