export type RaceId = "operators" | "blight" | "mandate";
export type PlayerId = 0 | 1;
export type BuildingKind =
  | "core"
  | "extractor"
  | "depot"
  | "refinery"
  | "dome"
  | "command"
  | "barracks"
  | "turret"
  | "aa"
  | "factory"
  | "airpad"
  | "scout"
  | "logistics"
  | "em_array"
  | "strike_dock"
  | "null_lattice"
  | "bomber_works"
  | "capacitor"
  | "artillery";

export type UnitKind = "worker" | "raider" | "tank" | "flyer" | "scout";
/** Coarse role for ops targeting / UI */
export type UnitRole = "worker" | "light" | "heavy" | "air";
export type StratTag = "rush" | "defend" | "expand" | "scout" | "eco";
export type ProjectileStyle = "laser" | "bolt" | "shell" | "mine";

export type { CardId, OpKind } from "./deck";

export interface ActiveOp {
  id: number;
  owner: PlayerId;
  cardId: string;
  kind: import("./deck").OpKind;
  x: number;
  y: number;
  radius: number;
  assigneeId: number | null;
  born: number;
}

export interface RaceDef {
  id: RaceId;
  name: string;
  short: string;
  tint: string;
  blurb: string;
  botLean: StratTag;
}

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  cost: number;
  buildTime: number;
  hp: number;
  vision: number;
  tag: StratTag;
  produces?: UnitKind;
  produceTime?: number;
  produceCost?: number;
  /** Max live units this building contributes (default 1). */
  produceSeats?: number;
  attackGround?: number;
  attackAir?: number;
  range?: number;
  placeable: boolean;
}

export interface UnitDef {
  kind: UnitKind;
  name: string;
  /** Targeting / op filter class */
  role: UnitRole;
  hp: number;
  speed: number;
  vision: number;
  air: boolean;
  damage: number;
  range: number;
  attackAir: boolean;
  attackGround: boolean;
  dpsInterval: number;
}

export interface Building {
  id: number;
  owner: PlayerId;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  done: boolean;
  progress: number;
  buildTime: number;
  vision: number;
  produceTimer: number;
  attackTimer: number;
  linkedMineralId: number | null;
  fromCard: string | null;
  isTech: boolean;
}

export interface Unit {
  id: number;
  owner: PlayerId;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  targetId: number | null;
  targetIsBuilding: boolean;
  attackTimer: number;
  buildTargetId: number | null;
  mineMineralId: number | null;
  carrying: boolean;
  cargo: number;
  mineProgress: number;
  exploreX: number | null;
  exploreY: number | null;
}

export interface Projectile {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  targetId: number;
  targetIsBuilding: boolean;
  targetIsMineral: boolean;
  damage: number;
  speed: number;
  style: ProjectileStyle;
  fromAir: number;
  toAir: number;
  age: number;
  maxAge: number;
}

export interface Mineral {
  id: number;
  x: number;
  y: number;
  yield: number;
  maxYield: number;
}

export interface FloatEvent {
  id: number;
  x: number;
  y: number;
  owner: PlayerId;
  amount: number;
  born: number;
  elev?: number;
}

export interface PlayerState {
  id: PlayerId;
  race: RaceId;
  energy: number;
  energyMax: number;
  income: number;
  alive: boolean;
  workerCap: number;
  capMax: number;
  vision: Uint8Array;
  hand: string[];
  /** Clash-style queue: next card shown under energy, not playable yet */
  next: string | null;
  draw: string[];
  discard: string[];
  /** Tech kinds already placed (first place triggers reshuffle) */
  techsPlaced: string[];
  visitT: Float32Array;
}


export type GamePhase = "playing" | "overtime" | "ended";

export interface SimSnapshot {
  t: number;
  phase: GamePhase;
  winner: PlayerId | null;
  mapW: number;
  mapH: number;
  players: PlayerState[];
  buildings: Building[];
  units: Unit[];
  minerals: Mineral[];
  projectiles: Projectile[];
  floaters: FloatEvent[];
  messages: string[];
  /** Active operations — visible as radio marks even in FOW */
  ops: ActiveOp[];
}

export type Intent =
  | {
      type: "place";
      player: PlayerId;
      kind: BuildingKind;
      x: number;
      y: number;
      handIndex: number;
    }
  | {
      type: "castOp";
      player: PlayerId;
      handIndex: number;
      x: number;
      y: number;
    }
  | { type: "trash"; player: PlayerId; handIndex: number }
  | { type: "noop" };

