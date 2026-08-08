/**
 * Glorious deaths — combat read, not reverse-construction:
 *   wound — micro-explosions / flecks on a still-solid hull
 *   boom  — solid body flings (air) or planted linger (ground), then wire shatter
 * Buildings are always planted (never list/sink/rotate as a whole).
 * Units co-located with a dying producer are absorbed into the building boom.
 *
 * Sim only filters hp<=0; all theater is render-side via pose diffs.
 */
import * as THREE from "three";
import { MAP_H, MAP_W } from "../sim/defs";
import type {
  BuildingKind,
  PlayerId,
  RaceId,
  SimSnapshot,
  UnitKind,
} from "../sim/types";
import {
  BOMBER_RIG,
  FLYER_RIG,
  INTERCEPTOR_RIG,
  SCOUT_RIG,
  attachPlumes,
  type PlumeHost,
  type PlumeRig,
} from "./entityPlumes";
import { stampScar, type ScarHost } from "./entityScars";
import type { UnitSmooth, WireEntity } from "./entityTypes";
import { placeOnSurface } from "./planetMath";
import {
  BOMBER_PIVOT_Y,
  FLYER_PIVOT_Y,
  INTERCEPTOR_PIVOT_Y,
  SCOUT_PIVOT_Y,
} from "./unitGeos";
import { spawnDust } from "./entityUnits";

export const DEATH_ACTOR_MAX = 28;
export const BUILDING_DEATH_ACTOR_MAX = 16;
export const SHARD_MAX = 128;
const SHARDS_PER_DEATH_LIGHT = 14;
const SHARDS_PER_DEATH_MED = 22;
const SHARDS_PER_DEATH_HEAVY = 32;
const FLECKS_PER_MICRO = 3;
/** Map units: product sitting in a dying producer is absorbed (no solo death). */
const ABSORB_R = 0.7;

export type UnitDeathPose = {
  id: number;
  kind: UnitKind;
  race: RaceId;
  owner: PlayerId;
  x: number;
  y: number;
  elev: number;
  yaw: number;
  bank: number;
  pitch: number;
  roll: number;
  sx: number;
  sy: number;
  sz: number;
  throttle: number;
  rcsL: number;
  rcsR: number;
  air: boolean;
  /** Map-space velocity for wound drift. */
  vx: number;
  vy: number;
  speed: number;
};

export type BuildingDeathPose = {
  id: number;
  kind: BuildingKind;
  race: RaceId;
  owner: PlayerId;
  x: number;
  y: number;
  elev: number;
  sx: number;
  sy: number;
  yaw: number;
};

type DeathPhase = "wound" | "boom" | "done";

type DeathTier = "light" | "medium" | "heavy";

type DeathActor = {
  alive: boolean;
  pose: UnitDeathPose;
  phase: DeathPhase;
  age: number;
  woundDur: number;
  boomDur: number;
  seed: number;
  shell: WireEntity | null;
  /** Residual spin during wound / air boom */
  spinYaw: number;
  spinPitch: number;
  spinRoll: number;
  /** Map-space kick while the solid body is flying */
  blowVx: number;
  blowVy: number;
  blowElevVel: number;
  detonated: boolean;
  /** Wound-time stamps for micro pops. */
  microAt: number[];
  microI: number;
};

type BuildingDeathActor = {
  alive: boolean;
  pose: BuildingDeathPose;
  phase: DeathPhase;
  age: number;
  woundDur: number;
  boomDur: number;
  seed: number;
  shell: WireEntity | null;
  detonated: boolean;
  microAt: number[];
  microI: number;
  /** Extra boom shards when a contained unit was absorbed. */
  absorbed: number;
};

type WireShard = {
  line: THREE.LineSegments;
  age: number;
  life: number;
  alive: boolean;
  vx: number;
  vy: number;
  vz: number;
  /** World angular rate (approx via quaternion delta). */
  ax: number;
  ay: number;
  az: number;
};

export type DeathHost = PlumeHost &
  ScarHost & {
    deathRoot: THREE.Group;
    deathPool: THREE.Object3D[];
    deathActors: DeathActor[];
    deathPoses: Map<number, UnitDeathPose>;
    buildingDeathPoses: Map<number, BuildingDeathPose>;
    buildingDeathActors: BuildingDeathActor[];
    shardPool: WireShard[];
    shardActive: number;
    shardRoot: THREE.Group;
    edgeMats: Record<string, THREE.LineBasicMaterial>;
    plumePool: THREE.Object3D[];
    dustPool: import("./entityTypes").DustPuff[];
    dustActive: number;
    dustGeo: THREE.BufferGeometry;
    dustMat: THREE.MeshBasicMaterial;
    dustRoot: THREE.Group;
    isVisible: (x: number, y: number) => boolean;
    unitGeo: (kind: UnitKind, race?: RaceId) => THREE.BufferGeometry;
    unitEdge: (kind: UnitKind, race?: RaceId) => THREE.EdgesGeometry | THREE.BufferGeometry;
    buildingGeo: (kind: BuildingKind) => THREE.BufferGeometry;
    buildingEdge: (kind: BuildingKind) => THREE.EdgesGeometry | THREE.BufferGeometry;
    coreGeoFor: (race: RaceId) => THREE.BufferGeometry;
    coreEdgeFor: (race: RaceId) => THREE.EdgesGeometry | THREE.BufferGeometry;
    acquireWire: (
      pool: THREE.Object3D[],
      solidGeo: THREE.BufferGeometry,
      edgeGeo: THREE.EdgesGeometry | THREE.BufferGeometry,
      race: RaceId,
      poolTag: string,
      opts?: { hull?: boolean; wireBright?: boolean },
    ) => WireEntity;
  };

function tierOf(kind: UnitKind): DeathTier {
  if (kind === "tank" || kind === "bomber") return "heavy";
  if (kind === "flyer" || kind === "interceptor") return "medium";
  return "light";
}

function tierDurations(tier: DeathTier): { wound: number; boom: number } {
  // boom = solid linger before wire shatter
  if (tier === "heavy") return { wound: 0.72, boom: 0.48 };
  if (tier === "medium") return { wound: 0.58, boom: 0.4 };
  return { wound: 0.45, boom: 0.34 };
}

function buildingTier(kind: BuildingKind): DeathTier {
  if (kind === "core" || kind === "command" || kind === "bomber_works") return "heavy";
  if (kind === "scout" || kind === "dome" || kind === "depot") return "light";
  return "medium";
}

function mapDist2(ax: number, ay: number, bx: number, by: number): number {
  let dx = ax - bx;
  if (dx > MAP_W * 0.5) dx -= MAP_W;
  if (dx < -MAP_W * 0.5) dx += MAP_W;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function shardBudget(tier: DeathTier): number {
  if (tier === "heavy") return SHARDS_PER_DEATH_HEAVY;
  if (tier === "medium") return SHARDS_PER_DEATH_MED;
  return SHARDS_PER_DEATH_LIGHT;
}

function airPivotY(kind: UnitKind): number {
  if (kind === "scout") return SCOUT_PIVOT_Y;
  if (kind === "interceptor") return INTERCEPTOR_PIVOT_Y;
  if (kind === "bomber") return BOMBER_PIVOT_Y;
  return FLYER_PIVOT_Y;
}

function airPlumeRig(kind: UnitKind): PlumeRig {
  if (kind === "scout") return SCOUT_RIG;
  if (kind === "interceptor") return INTERCEPTOR_RIG;
  if (kind === "bomber") return BOMBER_RIG;
  return FLYER_RIG;
}

/** Record a live unit pose so we can theater its death when the id vanishes. */
export function recordUnitPose(host: { deathPoses: Map<number, UnitDeathPose> }, pose: UnitDeathPose) {
  host.deathPoses.set(pose.id, pose);
}

/** Record a live building pose for planted death theater when the id vanishes. */
export function recordBuildingPose(
  host: { buildingDeathPoses: Map<number, BuildingDeathPose> },
  pose: BuildingDeathPose,
) {
  host.buildingDeathPoses.set(pose.id, pose);
}

function stripDeathChildren(host: DeathHost, shell: THREE.Object3D) {
  for (let i = shell.children.length - 1; i >= 0; i--) {
    const ch = shell.children[i]!;
    if (ch.userData?.pool !== "plume") continue;
    shell.remove(ch);
    ch.visible = false;
    ch.position.set(0, 0, 0);
    ch.rotation.set(0, 0, 0);
    ch.scale.set(1, 1, 1);
    host.plumePool.push(ch);
  }
}

function releaseShell(host: DeathHost, actor: DeathActor) {
  if (!actor.shell) return;
  stripDeathChildren(host, actor.shell);
  actor.shell.visible = false;
  if (actor.shell.parent) actor.shell.parent.remove(actor.shell);
  host.deathPool.push(actor.shell);
  actor.shell = null;
}

function ensureShell(host: DeathHost, actor: DeathActor, hull: boolean): WireEntity {
  const p = actor.pose;
  const geo = host.unitGeo(p.kind, p.race);
  const edge = host.unitEdge(p.kind, p.race);
  if (!actor.shell) {
    actor.shell = host.acquireWire(host.deathPool, geo, edge, p.race, "death", { hull });
    host.deathRoot.add(actor.shell);
  } else {
    const hullM = actor.shell.userData.hull;
    const wire = actor.shell.userData.wire;
    hullM.geometry = geo;
    wire.geometry = edge;
    wire.material = host.edgeMats[p.race]!;
    hullM.visible = hull;
    hullM.scale.setScalar(hull ? 0.96 : 0.001);
    actor.shell.visible = true;
  }
  return actor.shell;
}

function placeActor(actor: DeathActor, shell: WireEntity) {
  const p = actor.pose;
  // Air rolls about the craft spine (model pivotY). Ground is planted — no
  // bank/pitch/roll so we never orbit a surface-tangent far from the hull.
  const pivotY = p.air ? airPivotY(p.kind) : 0;
  const bank = p.air ? p.bank + p.roll : 0;
  const pitch = p.air ? p.pitch : 0;
  placeOnSurface(shell, p.x, p.y, p.elev, 0, 0, 0, p.sx, p.sy, p.sz, p.yaw, bank, pitch, pivotY);
}

function spawnActor(host: DeathHost, pose: UnitDeathPose): void {
  let actor: DeathActor | undefined;
  for (const a of host.deathActors) {
    if (!a.alive) {
      actor = a;
      break;
    }
  }
  if (!actor) {
    if (host.deathActors.length >= DEATH_ACTOR_MAX) {
      actor = host.deathActors[0]!;
      for (const a of host.deathActors) {
        if (a.age > actor.age) actor = a;
      }
      releaseShell(host, actor);
    } else {
      actor = {
        alive: false,
        pose,
        phase: "wound",
        age: 0,
        woundDur: 0.5,
        boomDur: 0.18,
        seed: 0,
        shell: null,
        spinYaw: 0,
        spinPitch: 0,
        spinRoll: 0,
        blowVx: 0,
        blowVy: 0,
        blowElevVel: 0,
        detonated: false,
        microAt: [],
        microI: 0,
      };
      host.deathActors.push(actor);
    }
  }

  const tier = tierOf(pose.kind);
  const durs = tierDurations(tier);
  const seed = pose.id * 0.17 + pose.kind.length * 0.3;
  const nMicro = tier === "heavy" ? 4 : tier === "light" ? 2 : 3;
  const microAt: number[] = [];
  for (let i = 0; i < nMicro; i++) {
    microAt.push(durs.wound * (0.1 + (i / Math.max(1, nMicro - 0.15)) * 0.7));
  }

  actor.alive = true;
  actor.pose = { ...pose };
  actor.phase = "wound";
  actor.age = 0;
  actor.woundDur = durs.wound;
  actor.boomDur = durs.boom;
  actor.seed = seed;
  actor.detonated = false;
  actor.blowVx = 0;
  actor.blowVy = 0;
  actor.blowElevVel = 0;
  actor.microAt = microAt;
  actor.microI = 0;
  // Spin is vacuum-only. Ground units die planted.
  if (pose.air) {
    actor.spinYaw = (Math.sin(seed * 12.1) * 2.2 + 1.4) * (seed % 2 ? 1 : -1);
    actor.spinPitch = Math.sin(seed * 7.7) * 1.8;
    actor.spinRoll = (Math.cos(seed * 9.3) * 3.5 + 2.5) * (Math.sin(seed) > 0 ? 1 : -1);
  } else {
    actor.spinYaw = 0;
    actor.spinPitch = 0;
    actor.spinRoll = 0;
    actor.pose.bank = 0;
    actor.pose.pitch = 0;
    actor.pose.roll = 0;
    actor.pose.vx = 0;
    actor.pose.vy = 0;
  }
}

function releaseBuildingShell(host: DeathHost, actor: BuildingDeathActor) {
  if (!actor.shell) return;
  actor.shell.visible = false;
  if (actor.shell.parent) actor.shell.parent.remove(actor.shell);
  host.deathPool.push(actor.shell);
  actor.shell = null;
}

function ensureBuildingShell(host: DeathHost, actor: BuildingDeathActor): WireEntity {
  const p = actor.pose;
  const geo =
    p.kind === "core" ? host.coreGeoFor(p.race) : host.buildingGeo(p.kind);
  const edge =
    p.kind === "core" ? host.coreEdgeFor(p.race) : host.buildingEdge(p.kind);
  if (!actor.shell) {
    actor.shell = host.acquireWire(host.deathPool, geo, edge, p.race, "death", {
      hull: true,
    });
    host.deathRoot.add(actor.shell);
  } else {
    const hullM = actor.shell.userData.hull;
    const wire = actor.shell.userData.wire;
    hullM.geometry = geo;
    wire.geometry = edge;
    wire.material = host.edgeMats[p.race]!;
    hullM.visible = true;
    hullM.scale.setScalar(0.96);
    actor.shell.visible = true;
  }
  const p0 = actor.pose;
  placeOnSurface(
    actor.shell,
    p0.x,
    p0.y,
    p0.elev,
    0,
    0,
    0,
    p0.sx,
    p0.sy,
    p0.sx,
    p0.yaw,
    0,
    0,
  );
  return actor.shell;
}

function spawnBuildingActor(host: DeathHost, pose: BuildingDeathPose): BuildingDeathActor {
  let actor: BuildingDeathActor | undefined;
  for (const a of host.buildingDeathActors) {
    if (!a.alive) {
      actor = a;
      break;
    }
  }
  if (!actor) {
    if (host.buildingDeathActors.length >= BUILDING_DEATH_ACTOR_MAX) {
      actor = host.buildingDeathActors[0]!;
      for (const a of host.buildingDeathActors) {
        if (a.age > actor.age) actor = a;
      }
      releaseBuildingShell(host, actor);
    } else {
      actor = {
        alive: false,
        pose,
        phase: "wound",
        age: 0,
        woundDur: 0.55,
        boomDur: 0.42,
        seed: 0,
        shell: null,
        detonated: false,
        microAt: [],
        microI: 0,
        absorbed: 0,
      };
      host.buildingDeathActors.push(actor);
    }
  }

  const tier = buildingTier(pose.kind);
  const durs = tierDurations(tier);
  const seed = pose.id * 0.19 + pose.kind.length * 0.31;
  const nMicro = tier === "heavy" ? 4 : tier === "light" ? 2 : 3;
  const microAt: number[] = [];
  for (let i = 0; i < nMicro; i++) {
    microAt.push(durs.wound * (0.1 + (i / Math.max(1, nMicro - 0.15)) * 0.7));
  }

  actor.alive = true;
  actor.pose = { ...pose };
  actor.phase = "wound";
  actor.age = 0;
  actor.woundDur = durs.wound;
  actor.boomDur = durs.boom;
  actor.seed = seed;
  actor.detonated = false;
  actor.microAt = microAt;
  actor.microI = 0;
  actor.absorbed = 0;
  return actor;
}

function spawnBuildingMicro(host: DeathHost, actor: BuildingDeathActor) {
  const p = actor.pose;
  const tier = buildingTier(p.kind);
  const shell = ensureBuildingShell(host, actor);
  shell.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  shell.getWorldPosition(origin);
  const ang = actor.seed * 2.7 + actor.microI * 2.1;
  const r = tier === "heavy" ? 0.28 : 0.18;
  origin.x += Math.cos(ang) * r * 0.35;
  origin.y += Math.sin(ang * 0.6) * r * 0.25;
  origin.z += Math.sin(ang) * r * 0.35;

  const tint = host.edgeMats[p.race]?.color ?? new THREE.Color(0x2dff8c);
  const n = FLECKS_PER_MICRO + (tier === "heavy" ? 2 : 1);
  for (let i = 0; i < n; i++) {
    const shard = acquireShard(host);
    if (!shard) break;
    const a = ang + i * 1.7;
    const len = 0.05 + Math.random() * 0.06;
    const arr = (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    arr[0] = -len * 0.5;
    arr[1] = 0;
    arr[2] = 0;
    arr[3] = len * 0.5;
    arr[4] = 0;
    arr[5] = 0;
    (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    shard.line.position.copy(origin);
    shard.line.rotation.set(0, a, (Math.random() - 0.5) * 1.2);
    shard.line.scale.setScalar(1);
    const kick = 1.2 + Math.random() * 0.9;
    const lenO = origin.length() || 1;
    shard.vx = Math.cos(a) * kick * 0.55 + (origin.x / lenO) * 0.35;
    shard.vy = (origin.y / lenO) * kick + 0.45;
    shard.vz = Math.sin(a) * kick * 0.55 + (origin.z / lenO) * 0.35;
    shard.ax = (Math.random() - 0.5) * 10;
    shard.ay = (Math.random() - 0.5) * 9;
    shard.az = (Math.random() - 0.5) * 10;
    shard.age = 0;
    shard.life = 0.12 + Math.random() * 0.1;
    shard.alive = true;
    shard.line.visible = true;
    const mat = shard.line.material as THREE.LineBasicMaterial;
    mat.color.copy(tint);
    mat.opacity = 0.95;
    host.shardActive++;
  }
  spawnDust(
    host as never,
    p.x,
    p.y,
    Math.max(0.02, p.elev * 0.1),
    Math.cos(ang) * 0.1,
    Math.sin(ang) * 0.1,
    ang,
    0.55 + (tier === "heavy" ? 0.25 : 0),
  );
}

function detonateBuilding(host: DeathHost, actor: BuildingDeathActor) {
  if (actor.detonated) return;
  actor.detonated = true;
  const p = actor.pose;
  const tier = buildingTier(p.kind);
  const nShards = shardBudget(tier) + actor.absorbed * 8;
  const edge =
    p.kind === "core" ? host.coreEdgeFor(p.race) : host.buildingEdge(p.kind);
  const posAttr = edge.getAttribute("position") as THREE.BufferAttribute | undefined;

  const shell = ensureBuildingShell(host, actor);
  shell.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  shell.getWorldPosition(origin);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tint = host.edgeMats[p.race]?.color ?? new THREE.Color(0x2dff8c);

  const segCount = posAttr ? Math.floor(posAttr.count / 2) : 0;
  const pick = Math.min(nShards, Math.max(1, segCount));
  const stride = segCount > 0 ? Math.max(1, Math.floor(segCount / pick)) : 1;

  for (let i = 0; i < pick; i++) {
    const shard = acquireShard(host);
    if (!shard) break;
    let wx1 = origin.x;
    let wy1 = origin.y;
    let wz1 = origin.z;
    let wx2 = origin.x + 0.1;
    let wy2 = origin.y;
    let wz2 = origin.z;
    if (posAttr && segCount > 0) {
      const si = (i * stride) % segCount;
      e1.fromBufferAttribute(posAttr, si * 2);
      e2.fromBufferAttribute(posAttr, si * 2 + 1);
      e1.applyMatrix4(shell.matrixWorld);
      e2.applyMatrix4(shell.matrixWorld);
      wx1 = e1.x;
      wy1 = e1.y;
      wz1 = e1.z;
      wx2 = e2.x;
      wy2 = e2.y;
      wz2 = e2.z;
    }
    mid.set((wx1 + wx2) * 0.5, (wy1 + wy2) * 0.5, (wz1 + wz2) * 0.5);
    dir.copy(mid).sub(origin);
    if (dir.lengthSq() < 1e-8) dir.set(Math.sin(i * 2.1), 0.45, Math.cos(i * 1.7));
    dir.normalize();
    const arr = (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    arr[0] = wx1 - mid.x;
    arr[1] = wy1 - mid.y;
    arr[2] = wz1 - mid.z;
    arr[3] = wx2 - mid.x;
    arr[4] = wy2 - mid.y;
    arr[5] = wz2 - mid.z;
    (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    shard.line.position.copy(mid);
    shard.line.rotation.set(0, 0, 0);
    shard.line.scale.setScalar(1);
    const kick = 2.4 + (tier === "heavy" ? 1.0 : 0.35) + actor.absorbed * 0.25;
    shard.vx = dir.x * kick + (Math.random() - 0.5) * 0.9;
    shard.vy = dir.y * kick + (Math.random() - 0.5) * 0.9 + 1.0;
    shard.vz = dir.z * kick + (Math.random() - 0.5) * 0.9;
    shard.ax = (Math.random() - 0.5) * 10;
    shard.ay = (Math.random() - 0.5) * 9;
    shard.az = (Math.random() - 0.5) * 10;
    shard.age = 0;
    shard.life = 0.38 + Math.random() * 0.35 + (tier === "heavy" ? 0.12 : 0);
    shard.alive = true;
    shard.line.visible = true;
    const mat = shard.line.material as THREE.LineBasicMaterial;
    mat.color.copy(tint);
    mat.opacity = 0.95;
    host.shardActive++;
  }

  const scarScale = (tier === "heavy" ? 1.45 : tier === "medium" ? 1.15 : 0.85) + actor.absorbed * 0.15;
  stampScar(host, p.x, p.y, p.race, scarScale, "impact");
  const dustN = 5 + actor.absorbed * 2 + (tier === "heavy" ? 2 : 0);
  for (let d = 0; d < dustN; d++) {
    const ang = (d / dustN) * Math.PI * 2 + actor.seed;
    spawnDust(
      host as never,
      p.x,
      p.y,
      0.05,
      Math.cos(ang) * 0.22,
      Math.sin(ang) * 0.22,
      ang,
      1.05 + (tier === "heavy" ? 0.35 : 0.15),
    );
  }
  releaseBuildingShell(host, actor);
}

function updateBuildingActor(host: DeathHost, actor: BuildingDeathActor, dt: number) {
  actor.age += dt;
  // Always planted — no elev/yaw drift
  if (actor.phase === "wound") {
    ensureBuildingShell(host, actor);
    while (actor.microI < actor.microAt.length && actor.age >= actor.microAt[actor.microI]!) {
      spawnBuildingMicro(host, actor);
      actor.microI++;
    }
    if (actor.age >= actor.woundDur) {
      // Triple flash at boom
      spawnBuildingMicro(host, actor);
      spawnBuildingMicro(host, actor);
      actor.phase = "boom";
      actor.age = 0;
    }
    return;
  }
  if (actor.phase === "boom") {
    // Solid hull lingers planted, then wire detonation
    ensureBuildingShell(host, actor);
    if (actor.age >= actor.boomDur) {
      detonateBuilding(host, actor);
      actor.phase = "done";
    }
    return;
  }
  actor.alive = false;
  releaseBuildingShell(host, actor);
}

function acquireShard(host: DeathHost): WireShard | null {
  for (const s of host.shardPool) {
    if (!s.alive) return s;
  }
  if (host.shardPool.length >= SHARD_MAX) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  const line = new THREE.LineSegments(geo, mat);
  line.frustumCulled = true;
  line.renderOrder = 6;
  host.shardRoot.add(line);
  const shard: WireShard = {
    line,
    age: 0,
    life: 0.4,
    alive: false,
    vx: 0,
    vy: 0,
    vz: 0,
    ax: 0,
    ay: 0,
    az: 0,
  };
  host.shardPool.push(shard);
  return shard;
}

/**
 * Micro-explosion: a few short-lived phosphor flecks + dust at the hull.
 * Structure stays solid.
 */
function spawnMicro(host: DeathHost, actor: DeathActor) {
  const p = actor.pose;
  const tier = tierOf(p.kind);
  const shell = actor.shell ?? ensureShell(host, actor, true);
  placeActor(actor, shell);
  shell.updateMatrixWorld(true);

  const origin = new THREE.Vector3();
  shell.getWorldPosition(origin);
  // Jitter offset around the craft so pops land on the silhouette
  const ang = actor.seed * 3.1 + actor.microI * 2.4;
  const r = tier === "heavy" ? 0.2 : tier === "medium" ? 0.15 : 0.11;
  origin.x += Math.cos(ang) * r * 0.4;
  origin.y += Math.sin(ang * 0.8) * r * 0.3;
  origin.z += Math.sin(ang) * r * 0.4;

  const tint = host.edgeMats[p.race]?.color ?? new THREE.Color(0x2dff8c);
  const n = FLECKS_PER_MICRO + (tier === "heavy" ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const shard = acquireShard(host);
    if (!shard) break;
    const a = ang + i * 1.9;
    const len = 0.04 + Math.random() * 0.05;
    const arr = (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    arr[0] = -len * 0.5;
    arr[1] = 0;
    arr[2] = 0;
    arr[3] = len * 0.5;
    arr[4] = 0;
    arr[5] = 0;
    (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    shard.line.position.copy(origin);
    shard.line.rotation.set(0, a, (Math.random() - 0.5) * 1.2);
    shard.line.scale.setScalar(1);

    const kick = 1.1 + Math.random() * 0.8;
    // Radial in tangent plane-ish + up
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    // Project roughly outward from planet center
    const lenO = origin.length() || 1;
    const upX = origin.x / lenO;
    const upY = origin.y / lenO;
    const upZ = origin.z / lenO;
    shard.vx = ux * kick * 0.6 + upX * 0.4;
    shard.vy = upY * kick + 0.5;
    shard.vz = uz * kick * 0.6 + upZ * 0.4;
    shard.ax = (Math.random() - 0.5) * 12;
    shard.ay = (Math.random() - 0.5) * 10;
    shard.az = (Math.random() - 0.5) * 12;
    shard.age = 0;
    shard.life = 0.1 + Math.random() * 0.1;
    shard.alive = true;
    shard.line.visible = true;
    const mat = shard.line.material as THREE.LineBasicMaterial;
    mat.color.copy(tint);
    mat.opacity = 0.95;
    host.shardActive++;
  }

  // Dust bloom at the wound
  spawnDust(
    host as never,
    p.x,
    p.y,
    Math.max(0.02, p.elev * 0.15),
    Math.cos(ang) * 0.08,
    Math.sin(ang) * 0.08,
    ang,
    0.45 + (tier === "heavy" ? 0.2 : 0),
  );
}

/**
 * Detonate wire edges into flying phosphor shards + surface scar.
 */
function detonate(host: DeathHost, actor: DeathActor) {
  if (actor.detonated) return;
  actor.detonated = true;

  const p = actor.pose;
  const tier = tierOf(p.kind);
  const nShards = shardBudget(tier);
  const edge = host.unitEdge(p.kind, p.race);
  const posAttr = edge.getAttribute("position") as THREE.BufferAttribute | undefined;

  let shell: WireEntity | null = actor.shell;
  if (!shell) {
    shell = ensureShell(host, actor, false);
    placeActor(actor, shell);
    shell.updateMatrixWorld(true);
  } else {
    shell.updateMatrixWorld(true);
  }

  const origin = new THREE.Vector3();
  shell.getWorldPosition(origin);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tint = host.edgeMats[p.race]?.color ?? new THREE.Color(0x2dff8c);

  const segCount = posAttr ? Math.floor(posAttr.count / 2) : 0;
  const pick = Math.min(nShards, Math.max(1, segCount));
  const stride = segCount > 0 ? Math.max(1, Math.floor(segCount / pick)) : 1;

  for (let i = 0; i < pick; i++) {
    const shard = acquireShard(host);
    if (!shard) break;

    let wx1 = origin.x;
    let wy1 = origin.y;
    let wz1 = origin.z;
    let wx2 = origin.x + 0.08;
    let wy2 = origin.y;
    let wz2 = origin.z;

    if (posAttr && segCount > 0) {
      const si = (i * stride) % segCount;
      e1.fromBufferAttribute(posAttr, si * 2);
      e2.fromBufferAttribute(posAttr, si * 2 + 1);
      e1.applyMatrix4(shell.matrixWorld);
      e2.applyMatrix4(shell.matrixWorld);
      wx1 = e1.x;
      wy1 = e1.y;
      wz1 = e1.z;
      wx2 = e2.x;
      wy2 = e2.y;
      wz2 = e2.z;
    }

    mid.set((wx1 + wx2) * 0.5, (wy1 + wy2) * 0.5, (wz1 + wz2) * 0.5);
    dir.copy(mid).sub(origin);
    if (dir.lengthSq() < 1e-8) dir.set(Math.sin(i * 2.1), 0.4, Math.cos(i * 1.7));
    dir.normalize();

    const arr = (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    arr[0] = wx1 - mid.x;
    arr[1] = wy1 - mid.y;
    arr[2] = wz1 - mid.z;
    arr[3] = wx2 - mid.x;
    arr[4] = wy2 - mid.y;
    arr[5] = wz2 - mid.z;
    (shard.line.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    shard.line.position.copy(mid);
    shard.line.rotation.set(0, 0, 0);
    shard.line.scale.setScalar(1);

    const kick = (p.air ? 3.2 : 2.0) + (tier === "heavy" ? 0.9 : 0);
    const jitter = 0.75;
    shard.vx = dir.x * kick + (Math.random() - 0.5) * jitter + actor.blowVx * 0.3;
    shard.vy = dir.y * kick + (Math.random() - 0.5) * jitter + (p.air ? 0.5 : 1.1);
    shard.vz = dir.z * kick + (Math.random() - 0.5) * jitter + actor.blowVy * 0.3;
    shard.ax = actor.spinRoll * 0.4 + (Math.random() - 0.5) * 8;
    shard.ay = actor.spinYaw * 0.3 + (Math.random() - 0.5) * 7;
    shard.az = actor.spinPitch * 0.3 + (Math.random() - 0.5) * 7;
    shard.age = 0;
    shard.life = 0.3 + Math.random() * 0.3 + (tier === "heavy" ? 0.12 : 0);
    shard.alive = true;
    shard.line.visible = true;
    const mat = shard.line.material as THREE.LineBasicMaterial;
    mat.color.copy(tint);
    mat.opacity = 0.95;
    host.shardActive++;
  }

  const scarKind = p.air ? "burn" : tier === "heavy" ? "impact" : "skid";
  const scarScale = tier === "heavy" ? 1.3 : tier === "medium" ? 1.0 : 0.72;
  stampScar(host, p.x, p.y, p.race, scarScale, scarKind);
  const dustN = tier === "heavy" ? 6 : tier === "medium" ? 4 : 3;
  for (let d = 0; d < dustN; d++) {
    const ang = (d / dustN) * Math.PI * 2 + actor.seed;
    spawnDust(
      host as never,
      p.x,
      p.y,
      0.04,
      Math.cos(ang) * 0.18,
      Math.sin(ang) * 0.18,
      ang,
      0.95 + (tier === "heavy" ? 0.4 : 0.2),
    );
  }

  releaseShell(host, actor);
}

function updateShards(host: DeathHost, dt: number) {
  if (host.shardActive <= 0) return;
  let live = 0;
  for (const s of host.shardPool) {
    if (!s.alive) continue;
    s.age += dt;
    if (s.age >= s.life) {
      s.alive = false;
      s.line.visible = false;
      continue;
    }
    live++;
    const t = s.age / s.life;
    s.line.position.x += s.vx * dt;
    s.line.position.y += s.vy * dt;
    s.line.position.z += s.vz * dt;
    // Pull gently toward planet center (origin) — vacuum debris falls "down"
    const pos = s.line.position;
    const len = pos.length() || 1;
    const grav = 6;
    s.vx += (-pos.x / len) * grav * dt;
    s.vy += (-pos.y / len) * grav * dt;
    s.vz += (-pos.z / len) * grav * dt;
    s.vx *= 1 - 0.8 * dt;
    s.vy *= 1 - 0.8 * dt;
    s.vz *= 1 - 0.8 * dt;
    s.line.rotation.x += s.ax * dt;
    s.line.rotation.y += s.ay * dt;
    s.line.rotation.z += s.az * dt;
    let op = 1 - t;
    if (t > 0.7) {
      const ft = (t - 0.7) / 0.3;
      op = ft < 0.33 ? 0.15 : ft < 0.66 ? 0.55 : 0.05;
    }
    (s.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, op * 0.95);
    s.line.scale.setScalar(Math.max(0.15, 1 - t * 0.55));
  }
  host.shardActive = live;
}

function updateActor(host: DeathHost, actor: DeathActor, dt: number, simT: number) {
  actor.age += dt;
  const p = actor.pose;

  if (actor.phase === "wound") {
    const u = Math.min(1, actor.age / Math.max(1e-4, actor.woundDur));
    // Drift + tumble for air; ground stays planted
    if (p.air) {
      p.x = (p.x + p.vx * dt * (0.35 + u * 0.4) + MAP_W) % MAP_W;
      p.y = Math.min(MAP_H - 0.2, Math.max(0.2, p.y + p.vy * dt * (0.35 + u * 0.4)));
      p.yaw += actor.spinYaw * dt * (0.55 + u * 0.45);
      p.pitch += actor.spinPitch * dt * 0.7;
      p.roll += actor.spinRoll * dt * 0.75;
      p.elev = Math.max(0.18, p.elev - (0.3 + u * 0.95) * dt);
      p.throttle = 0.85 + 0.15 * Math.sin(simT * 28 + actor.seed);
      p.rcsL = 0.55 + 0.35 * Math.sin(simT * 36 + actor.seed);
      p.rcsR = 0.55 + 0.35 * Math.cos(simT * 33 + actor.seed);
    }

    const shell = ensureShell(host, actor, true);
    placeActor(actor, shell);
    stripDeathChildren(host, shell);
    if (p.air) {
      const smooth = {
        throttle: p.throttle,
        rcsL: p.rcsL,
        rcsR: p.rcsR,
      } as UnitSmooth;
      attachPlumes(host, shell, airPlumeRig(p.kind), smooth, p.race, simT, p.id);
    }

    while (actor.microI < actor.microAt.length && actor.age >= actor.microAt[actor.microI]!) {
      spawnMicro(host, actor);
      actor.microI++;
    }

    if (actor.age >= actor.woundDur) {
      // Air: kick solid body. Ground: stay planted for the linger.
      if (p.air) {
        const ang = actor.seed * 2.1;
        const kick = 0.7;
        actor.blowVx = Math.cos(ang) * kick + p.vx * 0.25;
        actor.blowVy = Math.sin(ang) * kick + p.vy * 0.25;
        actor.blowElevVel = 1.15;
      } else {
        actor.blowVx = 0;
        actor.blowVy = 0;
        actor.blowElevVel = 0;
      }
      actor.phase = "boom";
      actor.age = 0;
    }
    return;
  }

  if (actor.phase === "boom") {
    // Air: solid body ejects. Ground: planted linger — never sink/spin.
    if (p.air) {
      p.x = (p.x + actor.blowVx * dt + MAP_W) % MAP_W;
      p.y = Math.min(MAP_H - 0.2, Math.max(0.2, p.y + actor.blowVy * dt));
      p.elev += actor.blowElevVel * dt;
      actor.blowElevVel -= 2.4 * dt;
      if (p.elev < 0.12) {
        p.elev = 0.12;
        actor.blowElevVel = 0;
      }
      p.yaw += actor.spinYaw * dt * 0.7;
      p.pitch += actor.spinPitch * dt * 0.55;
      p.roll += actor.spinRoll * dt * 0.8;
    } else {
      actor.blowVx = 0;
      actor.blowVy = 0;
      actor.blowElevVel = 0;
      p.bank = 0;
      p.pitch = 0;
      p.roll = 0;
    }
    const shell = ensureShell(host, actor, true);
    shell.visible = true;
    placeActor(actor, shell);
    stripDeathChildren(host, shell);

    if (actor.age >= actor.boomDur) {
      detonate(host, actor);
      actor.phase = "done";
    }
    return;
  }

  // done
  actor.alive = false;
  releaseShell(host, actor);
}

/**
 * Diff live units/buildings vs last poses, spawn death theater, advance actors/shards.
 * Poses recorded during syncUnits / syncBuildings; call after both.
 */
export function syncDeaths(host: DeathHost, snap: SimSnapshot, dt: number) {
  const liveUnits = new Set(snap.units.map((u) => u.id));
  const liveBuildings = new Set(snap.buildings.map((b) => b.id));

  // Buildings first — so co-located unit deaths can absorb into the boom
  const freshBuildingDeaths: BuildingDeathActor[] = [];
  for (const [id, pose] of host.buildingDeathPoses) {
    if (liveBuildings.has(id)) continue;
    const actor = spawnBuildingActor(host, pose);
    freshBuildingDeaths.push(actor);
    host.buildingDeathPoses.delete(id);
  }

  for (const [id, pose] of host.deathPoses) {
    if (liveUnits.has(id)) continue;
    // Contained product: fold into building boom, no solo unit death theater
    let absorbed = false;
    for (const ba of freshBuildingDeaths) {
      if (ba.pose.owner !== pose.owner) continue;
      if (mapDist2(ba.pose.x, ba.pose.y, pose.x, pose.y) <= ABSORB_R * ABSORB_R) {
        ba.absorbed += 1;
        // Louder boom when a unit is inside
        ba.boomDur = Math.max(ba.boomDur, 0.5);
        absorbed = true;
        break;
      }
    }
    // Also absorb into any still-running building death at this site
    if (!absorbed) {
      for (const ba of host.buildingDeathActors) {
        if (!ba.alive || ba.detonated) continue;
        if (ba.pose.owner !== pose.owner) continue;
        if (mapDist2(ba.pose.x, ba.pose.y, pose.x, pose.y) <= ABSORB_R * ABSORB_R) {
          ba.absorbed += 1;
          absorbed = true;
          break;
        }
      }
    }
    if (!absorbed) spawnActor(host, pose);
    host.deathPoses.delete(id);
  }

  if (host.deathPoses.size > liveUnits.size + 40) {
    for (const id of [...host.deathPoses.keys()]) {
      if (!liveUnits.has(id)) host.deathPoses.delete(id);
    }
  }
  if (host.buildingDeathPoses.size > liveBuildings.size + 12) {
    for (const id of [...host.buildingDeathPoses.keys()]) {
      if (!liveBuildings.has(id)) host.buildingDeathPoses.delete(id);
    }
  }

  for (const actor of host.buildingDeathActors) {
    if (!actor.alive) continue;
    updateBuildingActor(host, actor, dt);
  }
  for (const actor of host.deathActors) {
    if (!actor.alive) continue;
    updateActor(host, actor, dt, snap.t);
  }
  updateShards(host, dt);
}

/** Smooth map velocity from UnitSmooth for wound drift. */
export function poseVelocity(s: UnitSmooth, prevX: number, prevY: number, dt: number) {
  if (dt < 1e-6) return { vx: 0, vy: 0 };
  let dx = s.x - prevX;
  if (dx > MAP_W * 0.5) dx -= MAP_W;
  if (dx < -MAP_W * 0.5) dx += MAP_W;
  return { vx: dx / dt, vy: (s.y - prevY) / dt };
}
