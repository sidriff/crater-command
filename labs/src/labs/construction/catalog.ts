/**
 * Construction lab catalog — split Buildings (CRT assemble) vs Units (egress).
 *
 * Buildings → construct mode (scaffold + kit resolve).
 * Units → dispatch mode (finished producer + product launch / drive-off).
 */
import { BUILDINGS } from "@game/sim/defs";
import type { BuildingKind, UnitKind } from "@game/sim/types";

export type CardStatus = "ready" | "draft" | "stub";
export type CardMode = "construct" | "dispatch";
export type CardSection = "buildings" | "units";

export type ConstructionCard = {
  id: string;
  label: string;
  section: CardSection;
  /** Fixed by section — not a lever. */
  mode: CardMode;
  building: BuildingKind;
  status: CardStatus;
  note: string;
  /**
   * Key in makeBuildingGeos().kits (construct). Missing → solid CRT wink stub.
   * scout maps to kits.scout / kits.scoutPad.
   */
  kitKey: string | null;
  /** Product unit for dispatch cards. */
  product?: UnitKind;
  /**
   * Key for evalDispatchLaunch (legacy producer ids: scout_works, depot, …).
   * Defaults to id for dispatch cards when set.
   */
  launchId?: string;
  /** Match buildTime — default construct_dur baseline for buildings. */
  buildTime: number;
  meshId?: string;
};

function buildTimeOf(building: BuildingKind): number {
  return BUILDINGS[building]?.buildTime ?? 12;
}

function bldg(
  partial: Omit<ConstructionCard, "section" | "mode" | "buildTime" | "product" | "launchId"> & {
    label?: string;
  },
): ConstructionCard {
  return {
    ...partial,
    section: "buildings",
    mode: "construct",
    buildTime: buildTimeOf(partial.building),
  };
}

function unit(
  partial: Omit<ConstructionCard, "section" | "mode" | "buildTime" | "kitKey"> & {
    label: string;
    launchId: string;
    product: UnitKind;
  },
): ConstructionCard {
  return {
    ...partial,
    section: "units",
    mode: "dispatch",
    kitKey: null,
    buildTime: buildTimeOf(partial.building),
  };
}

/** Buildings — CRT construction. */
export const BUILDING_CARDS: readonly ConstructionCard[] = [
  bldg({
    id: "b:extractor",
    label: "Extractor",
    building: "extractor",
    status: "ready",
    kitKey: "extractor",
    note: "CRT kit assemble on scaffold.",
    meshId: "b:extractor",
  }),
  bldg({
    id: "b:depot",
    label: "Worker Depot",
    building: "depot",
    status: "ready",
    kitKey: "depot",
    note: "CRT kit — garage + ramp apron.",
    meshId: "b:depot",
  }),
  bldg({
    id: "b:refinery",
    label: "Refinery",
    building: "refinery",
    status: "ready",
    kitKey: "refinery",
    note: "CRT kit — drop-off / energy bank.",
    meshId: "b:refinery",
  }),
  bldg({
    id: "b:dome",
    label: "Dome",
    building: "dome",
    status: "ready",
    kitKey: "dome",
    note: "CRT kit — geodesic habitat.",
    meshId: "b:dome",
  }),
  bldg({
    id: "b:command",
    label: "Command Center",
    building: "command",
    status: "ready",
    kitKey: "command",
    note: "CRT kit — T1 tech gateway.",
    meshId: "b:command",
  }),
  bldg({
    id: "b:scout",
    label: "Scout Works",
    building: "scout",
    status: "ready",
    kitKey: "scout",
    note: "CRT kit — rail pad + dish.",
    meshId: "b:scout",
  }),
  bldg({
    id: "b:barracks",
    label: "Bay",
    building: "barracks",
    status: "ready",
    kitKey: "barracks",
    note: "CRT kit — hardstand stall.",
    meshId: "b:barracks",
  }),
  bldg({
    id: "b:turret",
    label: "Turret",
    building: "turret",
    status: "ready",
    kitKey: "turret",
    note: "CRT kit — ground defense.",
    meshId: "b:turret",
  }),
  bldg({
    id: "b:aa",
    label: "AA Nest",
    building: "aa",
    status: "ready",
    kitKey: "aa",
    note: "CRT kit — dual rails / dish.",
    meshId: "b:aa",
  }),
  bldg({
    id: "b:factory",
    label: "Forge",
    building: "factory",
    status: "ready",
    kitKey: "factory",
    note: "CRT kit — tank forge.",
    meshId: "b:factory",
  }),
  bldg({
    id: "b:airpad",
    label: "Airpad",
    building: "airpad",
    status: "ready",
    kitKey: "airpad",
    note: "CRT kit — landing ring.",
    meshId: "b:airpad",
  }),
  bldg({
    id: "b:bomber_works",
    label: "Bomber Works",
    building: "bomber_works",
    status: "draft",
    kitKey: null,
    note: "Draft solid (no kit). Airpad mesh stand-in.",
    meshId: "b:airpad",
  }),
  bldg({
    id: "b:logistics",
    label: "Logistics Hub",
    building: "logistics",
    status: "draft",
    kitKey: null,
    note: "Draft solid — no CRT kit yet.",
    meshId: "b:logistics",
  }),
  bldg({
    id: "b:em_array",
    label: "EM Array",
    building: "em_array",
    status: "draft",
    kitKey: null,
    note: "Draft solid — no CRT kit yet.",
    meshId: "b:em_array",
  }),
  bldg({
    id: "b:strike_dock",
    label: "Strike Dock",
    building: "strike_dock",
    status: "draft",
    kitKey: null,
    note: "Draft solid — no CRT kit yet.",
    meshId: "b:strike_dock",
  }),
  bldg({
    id: "b:null_lattice",
    label: "Null Lattice",
    building: "null_lattice",
    status: "draft",
    kitKey: null,
    note: "Draft solid — no CRT kit yet.",
    meshId: "b:null_lattice",
  }),
  bldg({
    id: "b:artillery",
    label: "Artillery Pad",
    building: "artillery",
    status: "draft",
    kitKey: null,
    note: "Draft solid — no CRT kit yet.",
    meshId: "b:artillery",
  }),
];

/** Units — producer egress / launch (former dispatch mode). */
export const UNIT_CARDS: readonly ConstructionCard[] = [
  unit({
    id: "u:worker",
    label: "Worker Rover",
    building: "depot",
    product: "worker",
    launchId: "depot",
    status: "draft",
    note: "Draft: ramp roll-out → level → drive.",
    meshId: "u:rover",
  }),
  unit({
    id: "u:scout",
    label: "Recon Drone",
    building: "scout",
    product: "scout",
    launchId: "scout_works",
    status: "ready",
    note: "Rail fling → free flight. Gold standard egress.",
    meshId: "u:scout",
  }),
  unit({
    id: "u:raider",
    label: "Raider",
    building: "barracks",
    product: "raider",
    launchId: "barracks",
    status: "draft",
    note: "Draft: hardstand roll-out → drive.",
    meshId: "u:raider",
  }),
  unit({
    id: "u:interceptor",
    label: "Interceptor",
    building: "airpad",
    product: "interceptor",
    launchId: "airpad",
    status: "draft",
    note: "Draft: vertical lift → pitch-over push.",
    meshId: "u:interceptor",
  }),
  unit({
    id: "u:bomber",
    label: "Bomber",
    building: "bomber_works",
    product: "bomber",
    launchId: "bomber_works",
    status: "draft",
    note: "Draft: heavier VTOL lift → push.",
    meshId: "u:bomber",
  }),
];

export const CARDS: readonly ConstructionCard[] = [
  ...BUILDING_CARDS,
  ...UNIT_CARDS,
];

const LEGACY_ID_MAP: Record<string, string> = {
  extractor: "b:extractor",
  depot: "b:depot",
  refinery: "b:refinery",
  dome: "b:dome",
  command: "b:command",
  scout_works: "u:scout",
  scout: "b:scout",
  barracks: "b:barracks",
  bay: "b:barracks",
  turret: "b:turret",
  aa: "b:aa",
  factory: "b:factory",
  forge: "b:factory",
  airpad: "b:airpad",
  bomber_works: "b:bomber_works",
  logistics: "b:logistics",
  em_array: "b:em_array",
  strike_dock: "b:strike_dock",
  null_lattice: "b:null_lattice",
  artillery: "b:artillery",
  worker: "u:worker",
  rover: "u:worker",
  raider: "u:raider",
  interceptor: "u:interceptor",
  bomber: "u:bomber",
};

export function cardById(id: string): ConstructionCard {
  return (
    CARDS.find((c) => c.id === id) ??
    CARDS.find((c) => c.id === "u:scout") ??
    CARDS[0]!
  );
}

export function cardPlayable(def: ConstructionCard): boolean {
  return def.status === "ready" || def.status === "draft";
}

export function resolveCardId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;

  const exact = CARDS.find(
    (d) => d.id === t || d.id.toLowerCase() === t || d.id.replace(/:/g, "") === t.replace(/:/g, ""),
  );
  if (exact) return exact.id;

  const legacy = LEGACY_ID_MAP[t] ?? LEGACY_ID_MAP[t.replace(/_/g, "")];
  if (legacy && CARDS.some((c) => c.id === legacy)) return legacy;

  const byLabel = CARDS.find(
    (d) =>
      d.label.toLowerCase() === t ||
      d.label.toLowerCase().replace(/\s+/g, "_") === t ||
      d.building === t,
  );
  return byLabel?.id ?? null;
}

export function cardsBySection(): {
  section: CardSection;
  label: string;
  cards: ConstructionCard[];
}[] {
  return [
    { section: "buildings", label: "Buildings", cards: [...BUILDING_CARDS] },
    { section: "units", label: "Units", cards: [...UNIT_CARDS] },
  ];
}

export function listConstructionCatalog(): {
  id: string;
  label: string;
  status: CardStatus;
  section: CardSection;
  mode: CardMode;
}[] {
  return CARDS.map((d) => ({
    id: d.id,
    label: d.label,
    status: d.status,
    section: d.section,
    mode: d.mode,
  }));
}

/** Launch evaluator id for a card (dispatch only). */
export function launchKeyFor(def: ConstructionCard): string {
  return def.launchId ?? def.id;
}

/** @deprecated — old dispatch-only list */
export const DISPATCHES = UNIT_CARDS;
export type DispatchDef = ConstructionCard;
export type DispatchStatus = CardStatus;
export const dispatchById = cardById;
export const dispatchPlayable = cardPlayable;
export const resolveDispatchId = resolveCardId;
export const listDispatchCatalog = () =>
  UNIT_CARDS.map((d) => ({
    id: d.id,
    label: d.label,
    status: d.status,
    section: d.section,
    mode: d.mode,
  }));
