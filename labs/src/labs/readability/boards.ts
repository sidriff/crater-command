import { START_P0 } from "@game/sim/terrain";
import type { BuildingKind, RaceId, SimSnapshot } from "@game/sim/types";
import {
  emptySnapshot,
  makeBuilding,
  makeUnit,
  paintVisionDisk,
} from "../../snapshot";

export type BoardId = "blank" | "identity" | "contact" | "fow_edge" | "clutter";

export interface BoardDef {
  id: BoardId;
  label: string;
  blurb: string;
  /** Map focus for camera */
  focus: { x: number; y: number };
  build: () => SimSnapshot;
}

/** Ops identity chart — every placeable kind in a grid near P0. */
const IDENTITY_KINDS: BuildingKind[] = [
  "core",
  "depot",
  "refinery",
  "dome",
  "command",
  "barracks",
  "turret",
  "aa",
  "scout",
  "logistics",
  "em_array",
  "strike_dock",
  "null_lattice",
  "bomber_works",
  "capacitor",
  "artillery",
  "airpad",
  "factory",
];

function identityBoard(): SimSnapshot {
  const snap = emptySnapshot({ race0: "operators", race1: "blight" });
  const origin = { x: START_P0.x - 3.5, y: START_P0.y - 2.2 };
  const cols = 6;
  const spacing = 1.35;
  IDENTITY_KINDS.forEach((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    snap.buildings.push(
      makeBuilding(0, kind, origin.x + col * spacing, origin.y + row * spacing, {
        isTech:
          kind === "command" ||
          kind === "logistics" ||
          kind === "em_array" ||
          kind === "strike_dock" ||
          kind === "null_lattice" ||
          kind === "bomber_works",
      }),
    );
  });
  // One of each unit for silhouette check
  const ux = origin.x + cols * spacing + 0.8;
  const units = ["worker", "raider", "tank", "flyer", "scout"] as const;
  units.forEach((k, i) => {
    snap.units.push(makeUnit(0, k, ux, origin.y + i * 1.1));
  });
  return snap;
}

function contactBoard(): SimSnapshot {
  const snap = emptySnapshot({ race0: "operators", race1: "blight" });
  const c = START_P0;
  snap.buildings.push(
    makeBuilding(0, "core", c.x, c.y),
    makeBuilding(0, "depot", c.x - 1.4, c.y + 0.6),
    makeBuilding(0, "refinery", c.x - 2.2, c.y - 0.4),
    makeBuilding(0, "barracks", c.x + 1.6, c.y + 0.3),
    makeBuilding(0, "turret", c.x + 2.4, c.y + 1.5),
    makeBuilding(0, "turret", c.x + 1.1, c.y + 2.2),
    makeBuilding(0, "command", c.x - 0.2, c.y - 1.8, { isTech: true }),
  );
  // Friendly screen
  for (let i = 0; i < 4; i++) {
    snap.units.push(
      makeUnit(0, "raider", c.x + 2.8 + i * 0.55, c.y + 2.6 + (i % 2) * 0.35),
    );
  }
  snap.units.push(makeUnit(0, "worker", c.x - 1.0, c.y + 1.2));
  snap.units.push(makeUnit(0, "worker", c.x - 1.8, c.y + 0.2));
  // Enemy push
  for (let i = 0; i < 6; i++) {
    snap.units.push(
      makeUnit(1, "raider", c.x + 5.2 + (i % 3) * 0.6, c.y + 4.0 + Math.floor(i / 3) * 0.7),
    );
  }
  snap.buildings.push(makeBuilding(1, "barracks", c.x + 6.5, c.y + 5.2));
  return snap;
}

function fowEdgeBoard(): SimSnapshot {
  const snap = emptySnapshot({
    race0: "operators",
    race1: "mandate",
    fullVision: false,
  });
  const c = START_P0;
  paintVisionDisk(snap.players[0]!.vision, c.x, c.y, 6.5);
  paintVisionDisk(snap.players[0]!.vision, c.x + 2, c.y + 1.5, 3.2);

  snap.buildings.push(
    makeBuilding(0, "core", c.x, c.y),
    makeBuilding(0, "depot", c.x - 1.3, c.y + 0.5),
    makeBuilding(0, "scout", c.x + 1.5, c.y - 0.8),
    makeBuilding(0, "turret", c.x + 2.0, c.y + 1.4),
  );
  snap.units.push(makeUnit(0, "scout", c.x + 3.5, c.y + 2.0));
  snap.units.push(makeUnit(0, "worker", c.x - 0.8, c.y + 1.0));

  // Enemy on the fog line / past it
  snap.buildings.push(
    makeBuilding(1, "core", c.x + 9.5, c.y + 7.5),
    makeBuilding(1, "barracks", c.x + 7.2, c.y + 5.0),
    makeBuilding(1, "turret", c.x + 6.0, c.y + 4.2),
    makeBuilding(1, "turret", c.x + 8.0, c.y + 6.0),
  );
  for (let i = 0; i < 3; i++) {
    snap.units.push(makeUnit(1, "raider", c.x + 5.5 + i * 0.5, c.y + 3.8));
  }
  // Partial vision on one enemy turret only
  paintVisionDisk(snap.players[0]!.vision, c.x + 6.0, c.y + 4.2, 1.8);
  return snap;
}

function clutterBoard(): SimSnapshot {
  const snap = emptySnapshot({ race0: "operators", race1: "blight" });
  const c = START_P0;
  snap.buildings.push(makeBuilding(0, "core", c.x, c.y));
  const kinds: BuildingKind[] = [
    "depot",
    "depot",
    "refinery",
    "dome",
    "command",
    "barracks",
    "barracks",
    "turret",
    "turret",
    "aa",
    "scout",
    "logistics",
    "em_array",
    "strike_dock",
    "capacitor",
    "artillery",
    "airpad",
  ];
  kinds.forEach((kind, i) => {
    const a = (i / kinds.length) * Math.PI * 2;
    const r = 1.6 + (i % 3) * 0.85;
    const done = i % 4 !== 0;
    snap.buildings.push(
      makeBuilding(0, kind, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, {
        done,
        progress: done ? 1 : 0.35 + (i % 5) * 0.1,
        isTech: kind === "command" || kind === "logistics" || kind === "em_array",
      }),
    );
  });
  for (let i = 0; i < 10; i++) {
    const a = i * 0.7;
    snap.units.push(
      makeUnit(0, i % 3 === 0 ? "worker" : "raider", c.x + Math.cos(a) * 3.2, c.y + Math.sin(a) * 2.4),
    );
  }
  for (let i = 0; i < 5; i++) {
    snap.units.push(makeUnit(1, "raider", c.x + 4.5 + i * 0.4, c.y + 3.5));
  }
  snap.units.push(makeUnit(0, "flyer", c.x + 1.2, c.y + 3.0));
  snap.units.push(makeUnit(1, "flyer", c.x + 5.0, c.y + 2.0));
  // A few crystals for landmark read
  snap.minerals.push(
    { id: 9001, x: c.x - 3.2, y: c.y + 0.5, yield: 80, maxYield: 100 },
    { id: 9002, x: c.x - 2.4, y: c.y - 1.5, yield: 60, maxYield: 100 },
    { id: 9003, x: c.x + 0.5, y: c.y - 3.0, yield: 90, maxYield: 100 },
  );
  return snap;
}

function blankBoard(): SimSnapshot {
  return emptySnapshot({ race0: "operators", race1: "blight" });
}

export const BOARDS: BoardDef[] = [
  {
    id: "blank",
    label: "Blank",
    blurb: "Empty rock — pure globe chrome. Baseline for modular previews.",
    focus: { x: START_P0.x, y: START_P0.y },
    build: blankBoard,
  },
  {
    id: "identity",
    label: "Identity grid",
    blurb: "Every building kind + unit roles. Name them from the camera alone.",
    focus: { x: START_P0.x, y: START_P0.y },
    build: identityBoard,
  },
  {
    id: "contact",
    label: "Contact",
    blurb: "Friendly pocket under a blight push. Owner + role at a glance.",
    focus: { x: START_P0.x + 2.5, y: START_P0.y + 2.0 },
    build: contactBoard,
  },
  {
    id: "fow_edge",
    label: "FOW edge",
    blurb: "Partial vision — last-known vs live, fog line pressure.",
    focus: { x: START_P0.x + 3.0, y: START_P0.y + 2.5 },
    build: fowEdgeBoard,
  },
  {
    id: "clutter",
    label: "Clutter max",
    blurb: "Dense base + scaffolds + air. Still find the core in under a second.",
    focus: { x: START_P0.x, y: START_P0.y },
    build: clutterBoard,
  },
];

export function boardById(id: BoardId): BoardDef {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]!;
}

/** Optional faction swap on player 0 race (rebuilds board with same layout logic). */
export function buildBoard(id: BoardId, race0: RaceId = "operators"): SimSnapshot {
  const snap = boardById(id).build();
  if (snap.players[0]) snap.players[0].race = race0;
  // Keep enemy contrast: operators→blight, else operators as foe when you're not ops
  if (snap.players[1]) {
    snap.players[1].race = race0 === "operators" ? "blight" : "operators";
  }
  return snap;
}
