export type RaceId = "operators" | "blight" | "mandate";
export type PlayerId = 0 | 1;
export type BuildingKind =
  | "core"
  | "extractor"
  | "barracks"
  | "turret"
  | "aa"
  | "factory"
  | "airpad"
  | "scout";
export type UnitKind = "worker" | "raider" | "tank" | "flyer" | "scout";
export type StratTag = "rush" | "defend" | "expand" | "scout" | "eco";
export type ProjectileStyle = "laser" | "bolt" | "shell" | "mine";

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
  attackGround?: number;
  attackAir?: number;
  range?: number;
  placeable: boolean;
}

export interface UnitDef {
  kind: UnitKind;
  name: string;
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
  /** Crystal field this worker is mining */
  mineMineralId: number | null;
  /** True while hauling a load back to drop-off */
  carrying: boolean;
  /** 0–1 channel progress while harvesting at a crystal */
  mineProgress: number;
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
  /** Mining beam aims at a mineral id (targetIsBuilding false + mine style) */
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
}

export interface PlayerState {
  id: PlayerId;
  race: RaceId;
  energy: number;
  income: number;
  alive: boolean;
  workerCap: number;
  vision: Uint8Array;
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
  messages: string[];
}

export type Intent =
  | { type: "place"; player: PlayerId; kind: BuildingKind; x: number; y: number }
  | { type: "noop" };
