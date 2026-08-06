import {
  BASE_INCOME,
  BUILDINGS,
  BUILD_MIN_DIST,
  CORE_CAP,
  CORE_WORKER_CAP,
  DOME_CAP,
  EXTRACTOR_CAP_BONUS,
  EXTRACTOR_LINK_RANGE,
  MAP_H,
  MAP_W,
  MATCH_SECONDS,
  MINE_TRIP_YIELD,

  START_ENERGY,
  START_WORKERS,
  TICK_DT,
  UNITS,
  raceCostMul,
  unitCapCost,
} from "./defs";
import {
  START_P0,
  START_P1,
  canGroundOccupy,
  canPlaceBuilding,
  moveSpeedMul,
} from "./terrain";
import {
  cellInReach,
  computeReachable,
  findPath,
  hasPath,
  moveAlongPath,
  nearestWalkable,
  type GroundPath,
} from "./path";
import { fireProjectile, tickCombat, tickProjectiles } from "./combat";
import {
  REFINERY_ENERGY_BONUS,
  CARDS,
  ENERGY_MAX_BASE,
  HAND_SIZE,
  cardOf,
  shuffleInPlace,
  starterDeck,
  type CardId,
} from "./deck";
import { tickMovement, tickSeparation } from "./movement";
import { tickProduction } from "./production";
import { makeOp, tickOperations } from "./ops";
import { stampAllVisits, tickWorkers } from "./workers";
import {
  allocId,
  cellKey,
  clamp,
  dist,
  getNextId,
  setNextId,
} from "./util";
import type {
  ActiveOp,
  Building,
  BuildingKind,
  GamePhase,
  Intent,
  Mineral,
  PlayerId,
  PlayerState,
  Projectile,
  ProjectileStyle,
  RaceId,
  SimSnapshot,
  Unit,
  UnitKind,
  FloatEvent,
} from "./types";

export class GameSim {
  t = 0;
  phase: GamePhase = "playing";
  winner: PlayerId | null = null;
  buildings: Building[] = [];
  units: Unit[] = [];
  minerals: Mineral[] = [];
  projectiles: Projectile[] = [];
  floaters: FloatEvent[] = [];
  ops: ActiveOp[] = [];
  players: PlayerState[] = [];
  messages: string[] = [];
  occupied = new Set<string>();
  private msgCd = 0;
  paths = new Map<number, GroundPath>();
  private reach0 = new Set<number>();
  private reach1 = new Set<number>();
  private reachUnion = new Set<number>();

  constructor(race0: RaceId, race1: RaceId) {
    setNextId(1);
    this.players = [this.makePlayer(0, race0), this.makePlayer(1, race1)];
    this.reach0 = computeReachable(START_P0.x, START_P0.y);
    this.reach1 = computeReachable(START_P1.x, START_P1.y);
    this.reachUnion = new Set([...this.reach0, ...this.reach1]);
    this.seedMinerals();
    this.spawnCore(0, START_P0.x, START_P0.y);
    this.spawnCore(1, START_P1.x, START_P1.y);
    for (const p of [0, 1] as PlayerId[]) {
      const core = this.buildings.find((b) => b.owner === p && b.kind === "core")!;
      for (let i = 0; i < START_WORKERS; i++) {
        const a = (i / START_WORKERS) * Math.PI * 2 + (p === 0 ? 0.4 : Math.PI + 0.4);
        const r = 0.55;
        this.spawnUnit(p, "worker", core.x + Math.cos(a) * r, core.y + Math.sin(a) * r);
      }
    }
    this.refreshCapacity();
    this.recomputeVision();
  }

  private makePlayer(pid: PlayerId, race: RaceId): PlayerState {
    const pool = starterDeck(race);
    shuffleInPlace(pool);
    const hand: string[] = [];
    while (hand.length < HAND_SIZE && pool.length) hand.push(pool.pop()!);
    const next = pool.length ? pool.pop()! : null;
    return {
      id: pid,
      race,
      energy: START_ENERGY,
      energyMax: ENERGY_MAX_BASE,
      income: BASE_INCOME,
      alive: true,
      workerCap: CORE_WORKER_CAP,
      capMax: CORE_CAP,
      vision: new Uint8Array(MAP_W * MAP_H),
      hand,
      next,
      draw: pool,
      discard: [],
      techsPlaced: [],
      visitT: new Float32Array(MAP_W * MAP_H).fill(-1e9),
    };
  }

  /** Shuffle discard → draw. Never touches hand or next. */
  private reshuffleDiscardIntoDraw(p: PlayerState) {
    if (!p.discard.length) return;
    p.draw.push(...p.discard);
    p.discard = [];
    shuffleInPlace(p.draw);
  }

  private ensureNext(p: PlayerState) {
    if (p.next != null) return;
    if (!p.draw.length) this.reshuffleDiscardIntoDraw(p);
    if (!p.draw.length) {
      p.next = null;
      return;
    }
    p.next = p.draw.pop()!;
  }

  private cycleIntoHand(p: PlayerState) {
    if (p.hand.length >= HAND_SIZE) return;
    this.ensureNext(p);
    if (p.next == null) return;
    p.hand.push(p.next);
    p.next = null;
    this.ensureNext(p);
  }

  private resolveOpCard(player: PlayerId, cardId: string) {
    const p = this.players[player]!;
    const idx = p.hand.indexOf(cardId);
    if (idx < 0) return;
    p.hand.splice(idx, 1);
    p.discard.push(cardId);
    this.cycleIntoHand(p);
  }

  private seedMinerals() {
    /**
     * Mineral FIELDS: ~3× surface density.
     * Each crystal 20–100 stock; only on path-reachable cells.
     */
    const minCrystalSep = 0.42;
    const minFieldSep = 1.7;
    const fieldCenters: { x: number; y: number }[] = [];
    const HOME_STOCK_TARGET = 6000;
    const HOME_FLOOR_R = 5.2; // keep in sync with CRATERS[0/1].floorR

    const okSpot = (x: number, y: number, sep: number, minCoreDist = 1.85) => {
      x = (x + MAP_W) % MAP_W;
      y = clamp(y, 1.2, MAP_H - 1.2);
      if (!canGroundOccupy(x, y)) return null;
      if (!cellInReach(this.reachUnion, x, y)) return null;
      for (const c of [START_P0, START_P1]) {
        if (dist(x, y, c.x, c.y) < minCoreDist) return null;
      }
      for (const m of this.minerals) {
        if (dist(x, y, m.x, m.y) < sep) return null;
      }
      return { x, y };
    };

    const pushCrystal = (x: number, y: number, stock: number, minCoreDist = 1.85) => {
      const p = okSpot(x, y, minCrystalSep, minCoreDist);
      if (!p) return 0;
      const maxYield = clamp(Math.round(stock), 20, 100);
      this.minerals.push({ id: allocId(), x: p.x, y: p.y, yield: maxYield, maxYield });
      return maxYield;
    };

    const addField = (
      cx: number,
      cy: number,
      crystalCount: number,
      avgStock: number,
      radius = 0.72,
      minCoreDist = 1.85,
    ) => {
      for (const f of fieldCenters) {
        if (dist(cx, cy, f.x, f.y) < minFieldSep) return 0;
      }
      if (!canGroundOccupy(cx, cy)) return 0;
      fieldCenters.push({ x: cx, y: cy });
      const n = clamp(crystalCount, 2, 14);
      let placed = 0;
      let gained = 0;
      for (let i = 0; i < n * 8 && placed < n; i++) {
        const a = (placed / n) * Math.PI * 2 + Math.random() * 0.45 + i * 0.17;
        const r =
          placed === 0
            ? 0.08 + Math.random() * 0.12
            : radius * (0.4 + Math.random() * 0.6);
        const stock = avgStock * (0.78 + Math.random() * 0.4);
        const got = pushCrystal(cx + Math.cos(a) * r, cy + Math.sin(a) * r, stock, minCoreDist);
        if (got > 0) {
          placed++;
          gained += got;
        }
      }
      return gained;
    };

    const seedHomeCrater = (hx: number, hy: number, target: number) => {
      let stock = 0;
      let guard = 0;
      const rings = [
        { r0: 2.05, r1: 3.0, n: 12, crystals: 7, avg: 70, rad: 0.72 },
        { r0: 3.0, r1: 4.1, n: 14, crystals: 6, avg: 62, rad: 0.7 },
        { r0: 3.9, r1: HOME_FLOOR_R - 0.35, n: 12, crystals: 5, avg: 48, rad: 0.62 },
      ];
      for (const ring of rings) {
        for (let i = 0; i < ring.n && stock < target && guard < 360; i++) {
          guard++;
          const a = (i / ring.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35 + hx * 0.01;
          const r = ring.r0 + Math.random() * (ring.r1 - ring.r0);
          const fx = hx + Math.cos(a) * r;
          const fy = hy + Math.sin(a) * r;
          stock += addField(fx, fy, ring.crystals, ring.avg, ring.rad, 1.7);
        }
      }
      guard = 0;
      while (stock < target && guard++ < 700) {
        const a = Math.random() * Math.PI * 2;
        const r = 2.0 + Math.random() * (HOME_FLOOR_R - 2.15);
        const s = 28 + Math.random() * 55;
        stock += pushCrystal(hx + Math.cos(a) * r, hy + Math.sin(a) * r, s, 1.7);
      }
      return stock;
    };

    const home0 = seedHomeCrater(START_P0.x, START_P0.y, HOME_STOCK_TARGET);
    const home1 = seedHomeCrater(START_P1.x, START_P1.y, HOME_STOCK_TARGET);

    const mid = [
      [0.5 - 1.8, 0.5 + 1.1, 8, 88, 1.0],
      [0.5 + 1.8, 0.5 - 1.1, 8, 88, 1.0],
      [0.5 + 0.2, 0.5 + 2.2, 6, 70, 0.85],
      [0.38, 0.62, 7, 60, 0.9],
      [0.62, 0.38, 7, 60, 0.9],
      [0.45, 0.48, 6, 65, 0.8],
      [0.55, 0.52, 6, 65, 0.8],
      [0.42, 0.55, 5, 55, 0.75],
      [0.58, 0.45, 5, 55, 0.75],
      [0.35, 0.5, 5, 50, 0.7],
      [0.65, 0.5, 5, 50, 0.7],
      [0.5, 0.4, 5, 55, 0.75],
      [0.5, 0.6, 5, 55, 0.75],
      [0.48, 0.35, 4, 48, 0.7],
      [0.52, 0.65, 4, 48, 0.7],
    ] as const;
    for (const [fx, fy, n, avg, rad] of mid) {
      addField(MAP_W * fx, MAP_H * fy, n, avg, rad);
    }

    let scatter = 0;
    for (let attempt = 0; attempt < 500 && scatter < 36; attempt++) {
      const x = 2.5 + Math.random() * (MAP_W - 5);
      const y = 2.5 + Math.random() * (MAP_H - 5);
      if (dist(x, y, START_P0.x, START_P0.y) < HOME_FLOOR_R + 0.6) continue;
      if (dist(x, y, START_P1.x, START_P1.y) < HOME_FLOOR_R + 0.6) continue;
      const n = 3 + ((Math.random() * 4) | 0);
      const stock = 22 + Math.random() * 40;
      const before = this.minerals.length;
      addField(x, y, n, stock, 0.65 + Math.random() * 0.25);
      if (this.minerals.length > before) scatter++;
    }

    void home0;
    void home1;
  }

  private spawnCore(owner: PlayerId, x: number, y: number) {
    const def = BUILDINGS.core;
    this.buildings.push({
      id: allocId(),
      owner,
      kind: "core",
      x,
      y,
      hp: def.hp,
      maxHp: def.hp,
      done: true,
      progress: 1,
      buildTime: 0,
      vision: def.vision,
      produceTimer: def.produceTime ?? 4,
      attackTimer: 0,
      linkedMineralId: null,
      fromCard: null,
      isTech: false,
    });
    this.markOcc(x, y, true);
  }

  spawnUnit(owner: PlayerId, kind: UnitKind, x: number, y: number) {
    const def = UNITS[kind];
    // Air units (scouts, flyers) spawn exactly where asked — no ground snap off the pad.
    const walk = def.air ? { x, y } : nearestWalkable(x, y, 4) ?? { x, y };
    this.units.push({
      id: allocId(),
      owner,
      kind,
      x: (walk.x + MAP_W) % MAP_W,
      y: clamp(walk.y, 0.5, MAP_H - 0.5),
      hp: def.hp,
      maxHp: def.hp,
      targetId: null,
      targetIsBuilding: false,
      attackTimer: 0.2,
      buildTargetId: null,
      mineMineralId: null,
      carrying: false,
      cargo: 0,
      mineProgress: 0,
      exploreX: null,
      exploreY: null,
    });
  }

  markOcc(x: number, y: number, on: boolean) {
    const k = cellKey(x, y);
    if (on) this.occupied.add(k);
    else this.occupied.delete(k);
  }

  moveGroundUnit(u: Unit, tx: number, ty: number, speed: number, dt: number) {
    const mul = moveSpeedMul(u.x, u.y, false);
    const stepLen = speed * Math.max(0.12, mul) * dt;
    const prev = this.paths.get(u.id);
    const res = moveAlongPath(prev, u.x, u.y, tx, ty, stepLen, findPath);
    u.x = res.x;
    u.y = res.y;
    this.paths.set(u.id, res.path);
  }

  /** Path from nearest owned finished building (or start) to a map point. */
  private hasPathFromBase(owner: PlayerId, x: number, y: number): boolean {
    let best: { x: number; y: number; d: number } | null = null;
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.done) continue;
      const d = dist(b.x, b.y, x, y);
      if (!best || d < best.d) best = { x: b.x, y: b.y, d };
    }
    if (!best) {
      const core = owner === 0 ? START_P0 : START_P1;
      best = { x: core.x, y: core.y, d: dist(core.x, core.y, x, y) };
    }
    if (best.d < 1.2 && canGroundOccupy(x, y)) return true;
    return hasPath(best.x, best.y, x, y);
  }

  private pushMsg(s: string) {
    if (this.msgCd > 0) return;
    this.messages.push(s);
    if (this.messages.length > 4) this.messages.shift();
    this.msgCd = 2.5;
  }

  tryPlace(player: PlayerId, kind: BuildingKind, x: number, y: number, handIndex?: number): boolean {
    if (handIndex != null) return this.placeFromHand(player, handIndex, x, y);
    const p = this.players[player]!;
    const idx = p.hand.findIndex((c) => {
      const cd = cardOf(c as CardId);
      return !cd.operation && cd.building === kind;
    });
    if (idx < 0) return false;
    return this.placeFromHand(player, idx, x, y);
  }

  recomp(_player: PlayerId): boolean {
    return false;
  }

  trashCard(player: PlayerId, handIndex: number): boolean {
    if (this.phase !== "playing") return false;
    const p = this.players[player]!;
    if (handIndex < 0 || handIndex >= p.hand.length) return false;
    const [c] = p.hand.splice(handIndex, 1);
    if (c) p.discard.push(c);
    this.cycleIntoHand(p);
    return true;
  }

  canPlacePreview(
    player: PlayerId,
    kind: BuildingKind,
    x: number,
    y: number,
    handIndex?: number,
  ): { ok: boolean; reason: string } {
    if (this.phase !== "playing") return { ok: false, reason: "Match locked" };
    const p = this.players[player]!;
    if (!p?.alive) return { ok: false, reason: "Dead" };
    const def = BUILDINGS[kind];
    if (!def?.placeable) return { ok: false, reason: "Can't place" };
    let cost = Math.round(def.cost * raceCostMul(p.race));
    if (handIndex != null) {
      const cid = p.hand[handIndex] as CardId | undefined;
      if (!cid) return { ok: false, reason: "No card" };
      const card = cardOf(cid);
      if (card.building !== kind) return { ok: false, reason: "Wrong card" };
      cost = card.cost;
      if (card.prereq && !this.hasPrereq(player, card.prereq)) {
        return { ok: false, reason: `Need ${card.prereq}` };
      }
    } else {
      if (!p.hand.some((c) => cardOf(c as CardId).building === kind))
        return { ok: false, reason: "Not in hand" };
      const cid = p.hand.find((c) => cardOf(c as CardId).building === kind)!;
      const card = cardOf(cid as CardId);
      cost = card.cost;
      if (card.prereq && !this.hasPrereq(player, card.prereq)) {
        return { ok: false, reason: `Need ${card.prereq}` };
      }
    }
    if (p.energy < cost) return { ok: false, reason: "Need energy" };
    x = (x + MAP_W) % MAP_W;
    y = clamp(y, 1, MAP_H - 1);
    if (!canPlaceBuilding(x, y)) return { ok: false, reason: "Bad terrain" };
    if (this.occupied.has(cellKey(x, y))) return { ok: false, reason: "Blocked" };
    for (const b of this.buildings) {
      if (dist(b.x, b.y, x, y) < BUILD_MIN_DIST) return { ok: false, reason: "Too close" };
    }
    if (!this.hasPathFromBase(player, x, y)) return { ok: false, reason: "No path" };
    if (kind === "extractor") {
      let bestD = EXTRACTOR_LINK_RANGE;
      let found = false;
      for (const mm of this.minerals) {
        const d = dist(mm.x, mm.y, x, y);
        if (d < bestD) {
          bestD = d;
          found = true;
        }
      }
      if (!found) return { ok: false, reason: "Need crystal" };
    }
    return { ok: true, reason: "Ready" };
  }


  cancelOp(player: PlayerId, opId?: number): boolean {
    const doomed = this.ops.filter(
      (o) => o.owner === player && (opId == null || o.id === opId),
    );
    if (!doomed.length) return false;
    this.ops = this.ops.filter(
      (o) => !(o.owner === player && (opId == null || o.id === opId)),
    );
    for (const o of doomed) this.resolveOpCard(player, o.cardId);
    return true;
  }

  castOp(player: PlayerId, handIndex: number, x: number, y: number): boolean {
    if (this.phase !== "playing") return false;
    const p = this.players[player]!;
    if (!p.alive) return false;
    const cid = p.hand[handIndex] as CardId | undefined;
    if (!cid) return false;
    const card = cardOf(cid);
    if (!card.operation || !card.opKind) return false;
    if (p.energy < card.cost) return false;
    x = (x + MAP_W) % MAP_W;
    y = clamp(y, 1, MAP_H - 1);
    p.energy -= card.cost;
    // Card stays in hand until op ends/cancels
    const radius = card.opRadius ?? 1.35;
    this.ops.push(
      makeOp(allocId(), player, cid, card.opKind, x, y, radius, this.t, this.units),
    );
    this.pushMsg(`${card.short.toUpperCase()} // mark set`);
    return true;
  }

  placeFromHand(player: PlayerId, handIndex: number, x: number, y: number): boolean {
    if (this.phase !== "playing") return false;
    const p = this.players[player]!;
    if (!p.alive) return false;
    const cid = p.hand[handIndex] as CardId | undefined;
    if (!cid) return false;
    const card = cardOf(cid);
    if (card.operation || !card.building) return false;
    const kind = card.building;
    const def = BUILDINGS[kind];
    if (!def?.placeable) return false;
    if (card.prereq && !this.hasPrereq(player, card.prereq)) return false;
    if (p.energy < card.cost) return false;
    x = (x + MAP_W) % MAP_W;
    y = clamp(y, 1, MAP_H - 1);
    if (!canPlaceBuilding(x, y)) return false;
    if (this.occupied.has(cellKey(x, y))) return false;
    for (const b of this.buildings) {
      if (dist(b.x, b.y, x, y) < BUILD_MIN_DIST) return false;
    }
    if (!this.hasPathFromBase(player, x, y)) return false;
    let linked: number | null = null;
    if (kind === "extractor") {
      let best: Mineral | null = null;
      let bestD = EXTRACTOR_LINK_RANGE;
      for (const mm of this.minerals) {
        const d = dist(mm.x, mm.y, x, y);
        if (d < bestD) {
          bestD = d;
          best = mm;
        }
      }
      if (!best) return false;
      linked = best.id;
    }
    p.hand.splice(handIndex, 1);
    p.energy -= card.cost;
    if (!card.tech) p.discard.push(cid);
    if (card.tech && !p.techsPlaced.includes(kind)) {
      p.techsPlaced.push(kind);
      this.reshuffleDiscardIntoDraw(p);
    }
    this.buildings.push({
      id: allocId(),
      owner: player,
      kind,
      x,
      y,
      hp: def.hp * 0.15,
      maxHp: def.hp,
      done: false,
      progress: 0,
      buildTime: def.buildTime,
      vision: def.vision,
      produceTimer: 0,
      attackTimer: 0,
      linkedMineralId: linked,
      fromCard: cid,
      isTech: card.tech,
    });
    this.markOcc(x, y, true);
    this.cycleIntoHand(p);
    let bestW: Unit | null = null;
    let bestD = 99;
    for (const u of this.units) {
      if (u.owner !== player || u.kind !== "worker" || u.buildTargetId != null) continue;
      const d = dist(u.x, u.y, x, y);
      if (d < bestD) {
        bestD = d;
        bestW = u;
      }
    }
    if (bestW) {
      bestW.buildTargetId = this.buildings[this.buildings.length - 1]!.id;
      bestW.carrying = false;
      bestW.cargo = 0;
      bestW.mineMineralId = null;
      bestW.mineProgress = 0;
      bestW.exploreX = null;
      bestW.exploreY = null;
      this.paths.delete(bestW.id);
    } else {
      this.pushMsg("No free workers — build will idle");
    }
    return true;
  }

  place(player: PlayerId, kind: BuildingKind, x: number, y: number): boolean {
    return this.tryPlace(player, kind, x, y);
  }

  applyIntent(intent: Intent) {
    if (intent.type === "place")
      this.placeFromHand(intent.player, intent.handIndex, intent.x, intent.y);
    else if (intent.type === "castOp")
      this.castOp(intent.player, intent.handIndex, intent.x, intent.y);
    else if (intent.type === "trash") this.trashCard(intent.player, intent.handIndex);
  }

  private tickDraw(_dt: number) {
    // Timed draw removed — CR-style cycle.
  }

  onBuildingFinished(b: Building) {
    if (!b.isTech || !b.fromCard) return;
    const card = CARDS[b.fromCard as CardId];
    if (!card?.inject?.length) return;
    const p = this.players[b.owner]!;
    for (const id of card.inject) p.discard.push(id);
    this.pushMsg(`${card.short} // blueprints to discard`);
  }


  private refreshWorkerCaps() {
    this.refreshCapacity();
  }

  /** Rebuild capMax from cores + supply buildings. energyMax from Ops refineries. */
  refreshCapacity() {
    for (const p of this.players) {
      let cap = 0;
      let refineries = 0;
      for (const b of this.buildings) {
        if (b.owner !== p.id || !b.done) continue;
        if (b.kind === "core") cap += CORE_CAP;
        else if (b.kind === "dome") cap += DOME_CAP;
        else if (b.kind === "refinery") refineries += 1;
        else if (b.kind === "extractor" && p.race !== "operators") cap += EXTRACTOR_CAP_BONUS;
      }
      p.capMax = Math.max(0, cap);
      p.workerCap = p.capMax;
      p.energyMax = ENERGY_MAX_BASE + refineries * REFINERY_ENERGY_BONUS;
    }
  }

  hasPrereq(player: PlayerId, kind: BuildingKind): boolean {
    return this.buildings.some(
      (b) => b.owner === player && b.kind === kind && b.done,
    );
  }

  /** How much capacity a player is currently using. */
  capUsed(owner: PlayerId): number {
    let used = 0;
    for (const u of this.units) {
      if (u.owner === owner) used += unitCapCost(u.kind);
    }
    return used;
  }

  freeCap(owner: PlayerId): number {
    const p = this.players[owner]!;
    return Math.max(0, p.capMax - this.capUsed(owner));
  }

  step(dt: number = TICK_DT) {
    if (this.phase === "ended") return;
    this.t += dt;
    if (this.msgCd > 0) this.msgCd -= dt;
    if (this.phase === "playing" && this.t >= MATCH_SECONDS) {
      this.endByClock();
      return;
    }
    this.tickIncome(dt);
    for (const p of this.players) {
      if (p.energy > p.energyMax) p.energy = p.energyMax;
    }
    this.tickDraw(dt);
    this.tickWorkers(dt);
    stampAllVisits(this);
    this.tickProduction(dt);
    this.tickCombat(dt);
    this.tickProjectiles(dt);
    this.tickMovement(dt);
    const opsBefore = this.ops.map((o) => ({ id: o.id, owner: o.owner, cardId: o.cardId }));
    tickOperations(this, dt);
    const still = new Set(this.ops.map((o) => o.id));
    for (const o of opsBefore) {
      if (!still.has(o.id)) this.resolveOpCard(o.owner, o.cardId);
    }
    this.tickSeparation(dt);
    this.refreshCapacity();
    this.recomputeVision();
    this.pruneFloaters();
    this.checkWin();
  }

  private pruneFloaters() {
    const life = 1.35;
    if (this.floaters.length === 0) return;
    this.floaters = this.floaters.filter((f) => this.t - f.born < life);
  }

  private tickIncome(_dt: number) {
    // No passive energy — only worker dump-offs grant resources.
    // HUD income is an estimate from active haulers.
    for (const p of this.players) {
      if (!p.alive) continue;
      const miners = this.units.filter(
        (u) =>
          u.owner === p.id &&
          u.kind === "worker" &&
          u.mineMineralId != null &&
          u.buildTargetId == null,
      ).length;
      const ex = this.buildings.filter(
        (b) =>
          b.owner === p.id &&
          b.done &&
          (b.kind === "extractor" || b.kind === "refinery" || b.kind === "depot"),
      ).length;
      const cycle = Math.max(2.2, 3.4 - ex * 0.25);
      let income = miners * (MINE_TRIP_YIELD / cycle);
      p.income = income;
    }
  }

  private tickWorkers(dt: number) {
    tickWorkers(this, dt);
  }

  private tickProduction(dt: number) {
    tickProduction(this, dt);
  }

  fire(
    owner: PlayerId,
    x: number,
    y: number,
    tx: number,
    ty: number,
    targetId: number,
    targetIsBuilding: boolean,
    damage: number,
    style: ProjectileStyle,
    fromAir: number,
    toAir: number,
    targetIsMineral = false,
  ) {
    fireProjectile(
      this,
      owner,
      x,
      y,
      tx,
      ty,
      targetId,
      targetIsBuilding,
      damage,
      style,
      fromAir,
      toAir,
      targetIsMineral,
    );
  }

  private tickCombat(dt: number) {
    tickCombat(this, dt);
  }

  private tickProjectiles(dt: number) {
    tickProjectiles(this, dt);
  }

  private tickMovement(dt: number) {
    tickMovement(this, dt);
  }

  private tickSeparation(dt: number) {
    tickSeparation(this, dt);
  }

  private recomputeVision() {
    for (const p of this.players) p.vision.fill(0);
    const paint = (owner: PlayerId, x: number, y: number, r: number) => {
      const vis = this.players[owner]!.vision;
      const r2 = r * r;
      const y0 = Math.max(0, Math.floor(y - r));
      const y1 = Math.min(MAP_H - 1, Math.ceil(y + r));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = Math.floor(x - r - 1); cx <= Math.ceil(x + r + 1); cx++) {
          const wx = ((cx % MAP_W) + MAP_W) % MAP_W;
          let dx = Math.abs(wx + 0.5 - x);
          if (dx > MAP_W / 2) dx = MAP_W - dx;
          const dy = cy + 0.5 - y;
          if (dx * dx + dy * dy <= r2) vis[cy * MAP_W + wx] = 1;
        }
      }
    };
    for (const b of this.buildings) {
      paint(b.owner, b.x, b.y, b.done ? BUILDINGS[b.kind].vision : 2.2);
    }
    for (const u of this.units) paint(u.owner, u.x, u.y, UNITS[u.kind].vision);
  }

  canSee(viewer: PlayerId, x: number, y: number): boolean {
    const cx = ((Math.floor(x) % MAP_W) + MAP_W) % MAP_W;
    const cy = clamp(Math.floor(y), 0, MAP_H - 1);
    return this.players[viewer]!.vision[cy * MAP_W + cx] === 1;
  }

  private checkWin() {
    const c0 = this.buildings.find((b) => b.owner === 0 && b.kind === "core");
    const c1 = this.buildings.find((b) => b.owner === 1 && b.kind === "core");
    if (!c0 && !c1) {
      this.phase = "ended";
      this.winner = null;
      return;
    }
    if (!c0) {
      this.phase = "ended";
      this.winner = 1;
      this.players[0]!.alive = false;
      return;
    }
    if (!c1) {
      this.phase = "ended";
      this.winner = 0;
      this.players[1]!.alive = false;
      return;
    }
  }

  /** Time expired — higher core HP wins (draw if equal). */
  private endByClock() {
    const c0 = this.buildings.find((b) => b.owner === 0 && b.kind === "core");
    const c1 = this.buildings.find((b) => b.owner === 1 && b.kind === "core");
    this.phase = "ended";
    if (!c0 && !c1) this.winner = null;
    else if (!c0) this.winner = 1;
    else if (!c1) this.winner = 0;
    else this.winner = c0.hp === c1.hp ? null : c0.hp > c1.hp ? 0 : 1;
  }

  snapshot(): SimSnapshot {
    return {
      t: this.t,
      phase: this.phase,
      winner: this.winner,
      mapW: MAP_W,
      mapH: MAP_H,
      players: this.players.map((p) => ({ ...p, vision: p.vision.slice() })),
      buildings: this.buildings.map((b) => ({ ...b })),
      units: this.units.map((u) => ({ ...u })),
      minerals: this.minerals.map((m) => ({ ...m })),
      projectiles: this.projectiles.map((p) => ({ ...p })),
      floaters: this.floaters.map((f) => ({ ...f })),
      ops: this.ops.map((o) => ({ ...o })),
      messages: [...this.messages],
    };
  }

  toJSON() {
    return {
      t: this.t,
      phase: this.phase,
      winner: this.winner,
      nextId: getNextId(),
      players: this.players.map((p) => ({
        id: p.id,
        race: p.race,
        energy: p.energy,
        energyMax: p.energyMax,
        income: p.income,
        alive: p.alive,
        workerCap: p.workerCap,
        capMax: p.capMax,
        vision: Array.from(p.vision),
        hand: [...p.hand],
        next: p.next,
        draw: [...p.draw],
        discard: [...p.discard],
        techsPlaced: [...p.techsPlaced],
      })),
      buildings: this.buildings,
      units: this.units,
      minerals: this.minerals,
      projectiles: this.projectiles,
      floaters: this.floaters,
      messages: this.messages,
    };
  }

  static fromJSON(data: ReturnType<GameSim["toJSON"]>): GameSim {
    const sim = new GameSim(data.players[0]!.race, data.players[1]!.race);
    sim.t = data.t;
    sim.phase = data.phase;
    sim.winner = data.winner;
    setNextId(data.nextId);
    sim.buildings = data.buildings.map((b) => ({
      ...b,
      linkedMineralId: b.linkedMineralId ?? null,
      fromCard: (b as Building).fromCard ?? null,
      isTech: (b as Building).isTech ?? false,
    }));
    sim.units = data.units.map((u) => ({
      ...u,
      mineMineralId: (u as Unit).mineMineralId ?? null,
      carrying: (u as Unit).carrying ?? false,
      cargo: (u as Unit & { cargo?: number }).cargo ?? 0,
      mineProgress: (u as Unit).mineProgress ?? 0,
      exploreX: (u as Unit).exploreX ?? null,
      exploreY: (u as Unit).exploreY ?? null,
    }));
    sim.minerals = data.minerals.map((m) => {
      const y = m.yield ?? 40;
      const maxY = (m as Mineral).maxYield ?? Math.max(y, 40);
      return { ...m, yield: y, maxYield: maxY };
    });
    sim.projectiles = (data.projectiles ?? []).map((p) => ({ ...p }));
    sim.floaters = (data.floaters ?? []).map((f) => ({ ...f }));
    sim.ops = ((data as { ops?: ActiveOp[] }).ops ?? []).map((o) => ({ ...o }));
    sim.messages = data.messages;
    sim.occupied.clear();
    for (const b of sim.buildings) sim.markOcc(b.x, b.y, true);
    sim.players = data.players.map((p) => {
      const raw = p as unknown as {
        id: PlayerId;
        race: RaceId;
        energy: number;
        energyMax?: number;
        income: number;
        alive: boolean;
        workerCap?: number;
        capMax?: number;
        vision: number[];
        hand?: string[];
        next?: string | null;
        draw?: string[];
        discard?: string[];
        techsPlaced?: string[];
      };
      return {
        id: raw.id,
        race: raw.race,
        energy: raw.energy,
        energyMax: raw.energyMax ?? ENERGY_MAX_BASE,
        income: raw.income,
        alive: raw.alive,
        workerCap: raw.workerCap ?? CORE_WORKER_CAP,
        capMax: raw.capMax ?? CORE_CAP,
        vision: Uint8Array.from(raw.vision),
        hand: raw.hand ? [...raw.hand] : [],
        next: raw.next ?? null,
        draw: raw.draw ? [...raw.draw] : [],
        discard: raw.discard ? [...raw.discard] : [],
        techsPlaced: raw.techsPlaced ? [...raw.techsPlaced] : [],
        visitT: new Float32Array(MAP_W * MAP_H).fill(-1e9),
      };
    });
    sim.refreshCapacity();
    return sim;
  }
}
