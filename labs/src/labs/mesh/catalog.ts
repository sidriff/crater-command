/**
 * Mesh catalog — real game geos from unitGeos / buildingGeos.
 * Lab never invents alternate art; it only stages these solids for isolation.
 */
import type { BufferGeometry } from "three";
import { makeBuildingGeos } from "@game/render/buildingGeos";
import { makeUnitGeos } from "@game/render/unitGeos";

export type MeshPacks = {
  units: ReturnType<typeof makeUnitGeos>;
  buildings: ReturnType<typeof makeBuildingGeos>;
};

/** Who fields this mesh in the asymmetric roster (units). */
export type MeshFaction = "operators" | "blight" | "mandate" | "shared";
/** Deck tech rung for units — mirrors concept T0–T3 where applicable. */
export type UnitTier = 0 | 1 | 2 | 3;

export type MeshDef = {
  id: string;
  label: string;
  section: "Units" | "Buildings" | "Cores" | "Props";
  /** EdgesGeometry threshold — match in-game (units 22, buildings 18). */
  crease: number;
  /** Optional display scale (Operators rover is ~0.57 in match). */
  scale?: number;
  /**
   * Concept lab plate id (`labs/concept/assets/operators/<concept>.jpg`)
   * for mesh↔concept side-by-side. Omit when there is no Ops concept plate.
   */
  concept?: string;
  /** Faction ownership for catalog grouping. Shared = multi-race / kit. */
  faction?: MeshFaction;
  /**
   * Deck tech rung for catalog grouping (units + buildings in the same bucket).
   * Omit for kit/prop meshes → "Kit / misc".
   */
  unitTier?: UnitTier;
  /** One or more solid geos (e.g. rover body + turret). */
  parts: (p: MeshPacks) => BufferGeometry[];
  note?: string;
};

export const FACTION_ORDER: readonly MeshFaction[] = [
  "operators",
  "blight",
  "mandate",
  "shared",
];

export const FACTION_LABELS: Record<MeshFaction, string> = {
  operators: "Operators",
  shared: "Shared",
  blight: "Blight",
  mandate: "Mandate",
};

export const UNIT_TIER_LABELS: Record<UnitTier, string> = {
  0: "T0 · Openers",
  1: "T1 · Combat",
  2: "T2 · Doctrines",
  3: "T3 · Apex",
};

export type FactionMeshGroup = {
  faction: MeshFaction;
  label: string;
  tiers: Array<{
    /** null = unassigned kit/misc under that faction */
    tier: UnitTier | null;
    label: string;
    meshes: MeshDef[];
  }>;
};

/** @deprecated use factionMeshesGrouped */
export type UnitMeshGroup = FactionMeshGroup;

/**
 * Catalog picker: faction → tier → meshes.
 * Units and buildings share tiers (no separate Buildings block).
 */
export function factionMeshesGrouped(): FactionMeshGroup[] {
  const out: FactionMeshGroup[] = [];
  for (const faction of FACTION_ORDER) {
    const list = MESHES.filter((m) => (m.faction ?? "shared") === faction);
    if (!list.length) continue;
    const tiers: FactionMeshGroup["tiers"] = [];
    for (const t of [0, 1, 2, 3] as UnitTier[]) {
      const meshes = list.filter((m) => m.unitTier === t);
      if (!meshes.length) continue;
      // Units first within a tier, then buildings/cores (stable label sort inside).
      const ordered = [...meshes].sort((a, b) => {
        const ak = a.section === "Units" ? 0 : a.section === "Cores" ? 1 : 2;
        const bk = b.section === "Units" ? 0 : b.section === "Cores" ? 1 : 2;
        if (ak !== bk) return ak - bk;
        return a.label.localeCompare(b.label);
      });
      tiers.push({ tier: t, label: UNIT_TIER_LABELS[t], meshes: ordered });
    }
    const misc = list.filter((m) => m.unitTier == null);
    if (misc.length) {
      tiers.push({
        tier: null,
        label: "Kit / misc",
        meshes: [...misc].sort((a, b) => a.label.localeCompare(b.label)),
      });
    }
    out.push({ faction, label: FACTION_LABELS[faction], tiers });
  }
  return out;
}

/** @deprecated use factionMeshesGrouped */
export function unitMeshesGrouped(): FactionMeshGroup[] {
  return factionMeshesGrouped();
}

export function createPacks(): MeshPacks {
  return { units: makeUnitGeos(), buildings: makeBuildingGeos() };
}

export function disposePacks(p: MeshPacks) {
  for (const g of Object.values(p.units)) g.dispose();
  const b = p.buildings;
  // Top-level solids (kits.solid aliases these — dispose once)
  const solids: BufferGeometry[] = [
    b.pad,
    b.padLg,
    b.scaffoldDeck,
    b.scaffoldLeg,
    b.ring,
    b.marker,
    b.coreStation,
    b.coreHive,
    b.coreRocket,
    b.coreGem,
    b.coreBeam,
    b.coreBeamSoft,
    b.extractor,
    b.depot,
    b.refinery,
    b.dome,
    b.barracks,
    b.turret,
    b.aa,
    b.factory,
    b.airpad,
    b.scoutPad,
    b.scoutPadStaged,
    b.depotStaged,
    b.barracksStaged,
    b.airpadStaged,
    b.bomberWorksStaged,
    b.command,
    b.accent,
    b.crystalSpike,
    b.crystalSpikeSm,
    b.crystalSpikeTall,
  ];
  for (const g of solids) g.dispose();
  for (const kit of Object.values(b.kits)) {
    for (const g of kit.parts) g.dispose();
    for (const g of kit.edges) g.dispose();
  }
}

export const MESHES: readonly MeshDef[] = [
  // ── Units · Operators ──────────────────────────────────
  {
    id: "u:rover",
    label: "Worker Rover",
    section: "Units",
    crease: 22,
    concept: "rover",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.units.workerOps, p.units.workerOpsTurret],
    note: "Open-bed tub + mast; head at ROVER_TURRET_PIVOT (forward on mast).",
  },
  {
    id: "u:workerOps",
    label: "Rover body",
    section: "Units",
    crease: 22,
    scale: 1,
    concept: "rover",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.units.workerOps],
    note: "Tub + rails + fixed mast — no lattice (concept is denser).",
  },
  {
    id: "u:workerOpsTurret",
    label: "Rover turret",
    section: "Units",
    crease: 22,
    concept: "rover",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.units.workerOpsTurret],
    note: "Box sensor head; pivot-local, +Z aperture.",
  },
  {
    id: "u:scout",
    label: "Recon Drone",
    section: "Units",
    crease: 22,
    concept: "scout",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.units.scout],
    note: "Notched delta — aperture plate, not a wing. Heading reads top-down.",
  },
  {
    id: "u:raider",
    label: "Raider",
    section: "Units",
    crease: 22,
    concept: "raider",
    faction: "operators",
    unitTier: 1,
    parts: (p) => [p.units.raider],
  },
  {
    id: "u:interceptor",
    label: "Interceptor",
    section: "Units",
    crease: 22,
    concept: "interceptor",
    faction: "operators",
    unitTier: 2,
    parts: (p) => [p.units.interceptor],
    note: "Ops Airpad product — own VTOL fighter geo (not flyer).",
  },
  {
    id: "u:bomber",
    label: "Bomber",
    section: "Units",
    crease: 22,
    concept: "bomber",
    faction: "operators",
    unitTier: 3,
    parts: (p) => [p.units.bomber],
    note: "Ops Bomber Works product — fat airframe + munitions; not flyer.",
  },

  // ── Units · Shared (multi-race / transitional) ─────────
  {
    id: "u:worker",
    label: "Worker (biped)",
    section: "Units",
    crease: 22,
    faction: "shared",
    unitTier: 0,
    parts: (p) => [p.units.worker],
    note: "Generic biped worker — non-Ops.",
  },
  {
    id: "u:tank",
    label: "Tank",
    section: "Units",
    crease: 22,
    concept: "tank",
    faction: "shared",
    unitTier: 1,
    parts: (p) => [p.units.tank],
    note: "Shared heavy; Ops deck has no factory seat yet.",
  },
  {
    id: "u:flyer",
    label: "Flyer",
    section: "Units",
    crease: 22,
    concept: "flyer",
    faction: "shared",
    unitTier: 2,
    parts: (p) => [p.units.flyer],
    note: "Non-Ops airpad product. Ops uses Interceptor + Bomber.",
  },
  {
    id: "u:pip",
    label: "Pip",
    section: "Units",
    crease: 22,
    faction: "shared",
    parts: (p) => [p.units.pip],
    note: "Debug / marker solid.",
  },

  // ── Cores (per-faction T0) ─────────────────────────────
  {
    id: "b:coreStation",
    label: "Core · Operators station",
    section: "Cores",
    crease: 18,
    concept: "core",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.buildings.coreStation],
  },
  {
    id: "b:coreHive",
    label: "Core · Blight hive",
    section: "Cores",
    crease: 18,
    faction: "blight",
    unitTier: 0,
    parts: (p) => [p.buildings.coreHive],
  },
  {
    id: "b:coreRocket",
    label: "Core · Mandate rocket",
    section: "Cores",
    crease: 18,
    faction: "mandate",
    unitTier: 0,
    parts: (p) => [p.buildings.coreRocket],
  },

  // ── Buildings · Operators (tiers match concept / deck) ─
  {
    id: "b:depot",
    label: "Worker Depot",
    section: "Buildings",
    crease: 18,
    concept: "depot",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.buildings.depot],
    note: "Empty apron — match stages the rover on it live.",
  },
  {
    id: "b:depotStaged",
    label: "Worker Depot · parked rover",
    section: "Buildings",
    crease: 18,
    concept: "depot",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.buildings.depotStaged],
    note: "Garage bay aft, rover nose-out on the apron with the guide rails.",
  },
  {
    id: "b:scoutPad",
    label: "Scout Works",
    section: "Buildings",
    crease: 18,
    concept: "scout_works",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.buildings.scoutPadStaged],
    note: "Ground station: launch rail with a drone parked on it + uplink dish. Match draws the drone live (supply-cap / launch).",
  },
  {
    id: "b:dome",
    label: "Habitat dome",
    section: "Buildings",
    crease: 18,
    concept: "dome",
    faction: "operators",
    unitTier: 0,
    parts: (p) => [p.buildings.dome],
  },
  {
    id: "b:command",
    label: "Command",
    section: "Buildings",
    crease: 18,
    concept: "command",
    faction: "operators",
    unitTier: 1,
    parts: (p) => [p.buildings.command],
  },
  {
    id: "b:refinery",
    label: "Refinery",
    section: "Buildings",
    crease: 18,
    concept: "refinery",
    faction: "operators",
    unitTier: 1,
    parts: (p) => [p.buildings.refinery],
  },
  {
    id: "b:barracks",
    label: "Raider Bay",
    section: "Buildings",
    crease: 18,
    concept: "bay",
    faction: "operators",
    unitTier: 1,
    parts: (p) => [p.buildings.barracks],
    note: "Gantry on four legs — the deck is the stall, not a floor.",
  },
  {
    id: "b:barracksStaged",
    label: "Raider Bay · parked raider",
    section: "Buildings",
    crease: 18,
    concept: "bay",
    faction: "operators",
    unitTier: 1,
    parts: (p) => [p.buildings.barracksStaged],
    note: "Raider is nearly as long as the deck; the building mass goes overhead.",
  },
  {
    id: "b:turret",
    label: "Turret",
    section: "Buildings",
    crease: 18,
    concept: "turret",
    faction: "operators",
    unitTier: 1,
    parts: (p) => [p.buildings.turret],
  },
  {
    id: "b:factory",
    label: "Logistics (factory geo)",
    section: "Buildings",
    crease: 18,
    concept: "logistics",
    faction: "operators",
    unitTier: 2,
    parts: (p) => [p.buildings.factory],
    note: "Ops Logistics currently aliases this geo.",
  },
  {
    id: "b:aa",
    label: "AA / Interceptor Net",
    section: "Buildings",
    crease: 18,
    concept: "aa",
    faction: "operators",
    unitTier: 2,
    parts: (p) => [p.buildings.aa],
  },
  {
    id: "b:airpad",
    label: "Airpad",
    section: "Buildings",
    crease: 18,
    concept: "airpad",
    faction: "operators",
    unitTier: 2,
    parts: (p) => [p.buildings.airpad],
    note: "Clamps sit outside the interceptor wingspan. Bomber Works reuses this.",
  },
  {
    id: "b:airpadStaged",
    label: "Airpad · parked interceptor",
    section: "Buildings",
    crease: 18,
    concept: "airpad",
    faction: "operators",
    unitTier: 2,
    parts: (p) => [p.buildings.airpadStaged],
    note: "No landing gear — an Operators airframe rests on its thrust.",
  },
  {
    id: "b:bomber_works",
    label: "Bomber Works",
    section: "Buildings",
    crease: 18,
    concept: "bomber_works",
    faction: "operators",
    unitTier: 3,
    parts: (p) => [p.buildings.bomberWorksStaged],
    note: "Match still aliases airpad solid; staged parks a bomber for mesh-lab chrome.",
  },
  {
    id: "b:null_lattice",
    label: "Null Lattice",
    section: "Buildings",
    crease: 18,
    concept: "null_lattice",
    faction: "operators",
    unitTier: 3,
    parts: (p) => [p.buildings.dome],
    note: "Match aliases habitat dome until a lattice geo exists — plate is open wireframe octahedron.",
  },

  // ── Shared buildings / props ───────────────────────────
  {
    id: "b:extractor",
    label: "Extractor",
    section: "Buildings",
    crease: 18,
    faction: "shared",
    unitTier: 0,
    parts: (p) => [p.buildings.extractor],
  },
  {
    id: "p:scaffoldDeck",
    label: "Scaffold deck",
    section: "Props",
    crease: 18,
    faction: "shared",
    parts: (p) => [p.buildings.scaffoldDeck],
  },
  {
    id: "p:scaffoldLeg",
    label: "Scaffold leg",
    section: "Props",
    crease: 18,
    faction: "shared",
    parts: (p) => [p.buildings.scaffoldLeg],
  },
  {
    id: "p:pad",
    label: "Pad hex",
    section: "Props",
    crease: 18,
    faction: "shared",
    parts: (p) => [p.buildings.pad],
  },
  {
    id: "p:crystal",
    label: "Crystal spike",
    section: "Props",
    crease: 18,
    faction: "shared",
    parts: (p) => [p.buildings.crystalSpike],
  },
  {
    id: "p:crystalSm",
    label: "Crystal small",
    section: "Props",
    crease: 18,
    faction: "shared",
    parts: (p) => [p.buildings.crystalSpikeSm],
  },
  {
    id: "p:crystalTall",
    label: "Crystal tall",
    section: "Props",
    crease: 18,
    faction: "shared",
    parts: (p) => [p.buildings.crystalSpikeTall],
  },
];

export function meshById(id: string): MeshDef {
  return MESHES.find((m) => m.id === id) ?? MESHES[0]!;
}

/**
 * Resolve a mesh from a deep-link / model param.
 * Accepts exact id (`u:scout`), bare slug (`scout`), or label (`Drone (scout)`).
 * Returns null if nothing matches.
 */
export function resolveMeshId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;

  if (MESHES.some((m) => m.id === s)) return s;

  const lower = s.toLowerCase();
  const byId = MESHES.find((m) => m.id.toLowerCase() === lower);
  if (byId) return byId.id;

  // bare slug after "u:" / "b:" / "p:"
  const tails = MESHES.filter((m) => {
    const tail = m.id.includes(":") ? m.id.slice(m.id.indexOf(":") + 1) : m.id;
    return tail.toLowerCase() === lower;
  });
  if (tails.length === 1) return tails[0]!.id;

  const byLabelExact = MESHES.find((m) => m.label.toLowerCase() === lower);
  if (byLabelExact) return byLabelExact.id;

  const byLabelPart = MESHES.filter((m) => m.label.toLowerCase().includes(lower));
  if (byLabelPart.length === 1) return byLabelPart[0]!.id;

  return null;
}

export function listMeshCatalog(): { id: string; label: string; section: string }[] {
  return MESHES.map((m) => ({ id: m.id, label: m.label, section: m.section }));
}

export function sections(): MeshDef["section"][] {
  return ["Units", "Cores", "Buildings", "Props"];
}
