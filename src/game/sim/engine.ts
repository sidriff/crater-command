import {
  BASE_INCOME,
  BUILDINGS,
  CORE_WORKER_CAP,
  EXTRACTOR_LINK_RANGE,
  EXTRACTOR_WORKER_BONUS,
  MAP_H,
  MAP_W,
  MATCH_SECONDS,
  MINE_CHANNEL,
  MINE_TRIP_YIELD,
  PLACEABLE,
  START_ENERGY,
  START_WORKERS,
  TICK_DT,
  UNITS,
  raceCostMul,
  raceUnitMul,
} from "./defs";
import {
  START_P0,
  START_P1,
  canGroundOccupy,
  canPlaceBuilding,
  moveSpeedMul,
  stepGround,
} from "./terrain";
import type {
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
} from "./types";

let nextId = 1;
function id() {
  return nextId++;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function dist(ax: number, ay: number, bx: number, by: number) {
  let dx = Math.abs(ax - bx);
  if (dx > MAP_W / 2) dx = MAP_W - dx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

function cellKey(x: number, y: number) {
  return `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2}`;
}

function unitShotStyle(kind: UnitKind): ProjectileStyle {
  if (kind === "tank") return "shell";
  if (kind === "flyer" || kind === "scout") return "laser";
  return "bolt";
}

function buildingShotStyle(kind: BuildingKind): ProjectileStyle {
  if (kind === "aa") return "laser";
  return "bolt";
}

function sepRadius(kind: UnitKind): number {
  if (kind === "tank") return 0.95;
  if (kind === "flyer") return 0.85;
  if (kind === "raider") return 0.7;
  if (kind === "scout") return 0.65;
  return 0.55; // worker
}

/** Stable slot angle for unit around a focus point */
function slotAngle(id: number, slots = 8): number {
  return ((id * 2.399) % slots) * ((Math.PI * 2) / slots);
}

export class GameSim {
  t = 0;
  phase: GamePhase = "playing";
  winner: PlayerId | null = null;
  buildings: Building[] = [];
  units: Unit[] = [];
  minerals: Mineral[] = [];
  projectiles: Projectile[] = [];
  players: PlayerState[] = [];
  messages: string[] = [];
  private occupied = new Set<string>();
  private msgCd = 0;

  constructor(race0: RaceId, race1: RaceId) {
    nextId = 1;
    this.players = [this.makePlayer(0, race0), this.makePlayer(1, race1)];
    this.seedMinerals();
    this.spawnCore(0, START_P0.x, START_P0.y);
    this.spawnCore(1, START_P1.x, START_P1.y);
    for (const p of [0, 1] as PlayerId[]) {
      const core = this.buildings.find((b) => b.owner === p && b.kind === "core")!;
      for (let i = 0; i < START_WORKERS; i++) {
        this.spawnUnit(
          p,
          "worker",
          core.x + (i - 0.5) * 0.9,
          core.y + (p === 0 ? 1.1 : -1.1),
        );
      }
    }
    this.refreshWorkerCaps();
    this.recomputeVision();
  }

  private makePlayer(pid: PlayerId, race: RaceId): PlayerState {
    return {
      id: pid,
      race,
      energy: START_ENERGY,
      income: BASE_INCOME,
      alive: true,
      workerCap: CORE_WORKER_CAP,
      vision: new Uint8Array(MAP_W * MAP_H),
    };
  }

  private seedMinerals() {
    // Crystals in start bowls + pass-adjacent + mid crater
    const spots: { x: number; y: number; yield: number }[] = [
      // P0 bowl
      { x: START_P0.x - 1.6, y: START_P0.y - 1.2, yield: 9 },
      { x: START_P0.x + 1.8, y: START_P0.y + 0.6, yield: 8 },
      { x: START_P0.x - 0.4, y: START_P0.y + 2.0, yield: 7 },
      // P1 bowl
      { x: START_P1.x + 1.6, y: START_P1.y + 1.2, yield: 9 },
      { x: START_P1.x - 1.8, y: START_P1.y - 0.6, yield: 8 },
      { x: START_P1.x + 0.4, y: START_P1.y - 2.0, yield: 7 },
      // mid crater
      { x: MAP_W * 0.5 - 1.2, y: MAP_H * 0.5 + 0.8, yield: 7 },
      { x: MAP_W * 0.5 + 1.2, y: MAP_H * 0.5 - 0.8, yield: 7 },
      // side pockets
      { x: MAP_W * 0.38, y: MAP_H * 0.62, yield: 6 },
      { x: MAP_W * 0.62, y: MAP_H * 0.38, yield: 6 },
    ];
    for (const s of spots) {
      this.minerals.push({ id: id(), x: s.x, y: s.y, yield: s.yield });
    }
  }

  private spawnCore(owner: PlayerId, x: number, y: number) {
    const def = BUILDINGS.core;
    this.buildings.push({
      id: id(),
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
    });
    this.markOcc(x, y, true);
  }

  private spawnUnit(owner: PlayerId, kind: UnitKind, x: number, y: number) {
    const def = UNITS[kind];
    this.units.push({
      id: id(),
      owner,
      kind,
      x: (x + MAP_W) % MAP_W,
      y: clamp(y, 0.5, MAP_H - 0.5),
      hp: def.hp,
      maxHp: def.hp,
      targetId: null,
      targetIsBuilding: false,
      attackTimer: 0.2,
      buildTargetId: null,
      mineMineralId: null,
      carrying: false,
      mineProgress: 0,
    });
  }

  private markOcc(x: number, y: number, on: boolean) {
    const k = cellKey(x, y);
    if (on) this.occupied.add(k);
    else this.occupied.delete(k);
  }

  private pushMsg(s: string) {
    if (this.msgCd > 0) return;
    this.messages.push(s);
    if (this.messages.length > 4) this.messages.shift();
    this.msgCd = 2.5;
  }

  /** Public API used by session / bot */
  tryPlace(player: PlayerId, kind: BuildingKind, x: number, y: number): boolean {
    return this.place(player, kind, x, y);
  }

  place(player: PlayerId, kind: BuildingKind, x: number, y: number): boolean {
    if (this.phase !== "playing") return false;
    const p = this.players[player]!;
    if (!p.alive) return false;
    const def = BUILDINGS[kind];
    if (!def.placeable) return false;
    const cost = Math.round(def.cost * raceCostMul(p.race));
    if (p.energy < cost) return false;
    x = (x + MAP_W) % MAP_W;
    y = clamp(y, 1, MAP_H - 1);
    if (!canPlaceBuilding(x, y)) {
      this.pushMsg("Can't build on crater rim — use floor or a pass");
      return false;
    }
    if (this.occupied.has(cellKey(x, y))) {
      this.pushMsg("Blocked — too close to another structure");
      return false;
    }
    for (const b of this.buildings) {
      if (dist(b.x, b.y, x, y) < 1.35) {
        this.pushMsg("Too close to another structure");
        return false;
      }
    }

    let linked: number | null = null;
    if (kind === "extractor") {
      let best: Mineral | null = null;
      let bestD = EXTRACTOR_LINK_RANGE;
      for (const m of this.minerals) {
        const d = dist(m.x, m.y, x, y);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      if (!best) {
        this.pushMsg("Extractors need a crystal field");
        return false;
      }
      linked = best.id;
    }

    p.energy -= cost;
    this.buildings.push({
      id: id(),
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
    });
    this.markOcc(x, y, true);

    // nearest free worker starts construction
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
      bestW.carrying = true;
      bestW.mineMineralId = null;
      bestW.mineProgress = 0;
    } else {
      this.pushMsg("No free workers — build will idle");
    }
    return true;
  }

  applyIntent(intent: Intent) {
    if (intent.type === "place") this.place(intent.player, intent.kind, intent.x, intent.y);
  }

  private refreshWorkerCaps() {
    for (const p of this.players) {
      const ex = this.buildings.filter(
        (b) =>
          b.owner === p.id && b.kind === "extractor" && b.done && b.linkedMineralId != null,
      ).length;
      p.workerCap = CORE_WORKER_CAP + ex * EXTRACTOR_WORKER_BONUS;
    }
  }

  step(dt: number = TICK_DT) {
    if (this.phase === "ended") return;
    this.t += dt;
    if (this.msgCd > 0) this.msgCd -= dt;
    if (this.phase === "playing" && this.t >= MATCH_SECONDS) {
      this.phase = "overtime";
      this.pushMsg("Overtime — no new builds or units");
    }
    this.tickIncome(dt);
    this.tickWorkers(dt);
    this.tickProduction(dt);
    this.tickCombat(dt);
    this.tickProjectiles(dt);
    this.tickMovement(dt);
    this.tickSeparation(dt);
    this.refreshWorkerCaps();
    this.recomputeVision();
    this.checkWin();
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
        (b) => b.owner === p.id && b.kind === "extractor" && b.done,
      ).length;
      const cycle = Math.max(2.2, 3.4 - ex * 0.25);
      let income = miners * (MINE_TRIP_YIELD / cycle);
      if (p.race === "operators") income *= 1.04;
      if (p.race === "blight") income *= 1.06;
      p.income = income;
    }
  }

  private pickMineFor(owner: PlayerId, wx: number, wy: number): Mineral | null {
    // Prefer crystals linked to own extractors, else nearest crystal
    const linked = new Set(
      this.buildings
        .filter(
          (b) =>
            b.owner === owner && b.kind === "extractor" && b.done && b.linkedMineralId != null,
        )
        .map((b) => b.linkedMineralId!),
    );
    let best: Mineral | null = null;
    let bestScore = 1e9;
    for (const m of this.minerals) {
      const d = dist(wx, wy, m.x, m.y);
      const score = d + (linked.has(m.id) ? -8 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  /** Nearest drop-off: prefer extractor linked to this crystal, then any own extractor, then core. */
  private pickDropoff(
    owner: PlayerId,
    wx: number,
    wy: number,
    mineralId: number | null,
  ): { x: number; y: number; id: number } | null {
    let best: { x: number; y: number; id: number } | null = null;
    let bestScore = 1e9;
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.done) continue;
      if (b.kind !== "extractor" && b.kind !== "core") continue;
      const d = dist(wx, wy, b.x, b.y);
      let score = d;
      if (b.kind === "core") score += 4; // prefer extractors when similar distance
      else if (mineralId != null && b.linkedMineralId === mineralId) score -= 6;
      else score -= 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = { x: b.x, y: b.y, id: b.id };
      }
    }
    return best;
  }

  private tickWorkers(dt: number) {
    for (const u of this.units) {
      if (u.kind !== "worker") continue;
      const sp = UNITS.worker.speed * (this.players[u.owner]!.race === "operators" ? 1.1 : 1);
      const p = this.players[u.owner]!;

      // —— Construction takes priority ——
      if (u.buildTargetId != null) {
        u.mineMineralId = null;
        u.mineProgress = 0;
        const b = this.buildings.find((x) => x.id === u.buildTargetId);
        if (!b || b.done) {
          u.buildTargetId = null;
          u.carrying = false;
          continue;
        }
        const d = dist(u.x, u.y, b.x, b.y);
        if (d > 0.55) {
          const mul = moveSpeedMul(u.x, u.y, false);
          const pos = stepGround(u.x, u.y, b.x, b.y, sp * mul * dt);
          u.x = pos.x;
          u.y = pos.y;
        } else {
          b.progress += dt / Math.max(0.5, b.buildTime);
          b.hp = Math.min(b.maxHp, b.maxHp * (0.15 + 0.85 * b.progress));
          if (b.progress >= 1) {
            b.done = true;
            b.progress = 1;
            b.hp = b.maxHp;
            u.buildTargetId = null;
            u.carrying = false;
            if (BUILDINGS[b.kind].produces) b.produceTimer = BUILDINGS[b.kind].produceTime ?? 5;
            this.refreshWorkerCaps();
          }
        }
        continue;
      }

      // —— Haul load to nearest extractor / core ——
      if (u.carrying) {
        const drop = this.pickDropoff(u.owner, u.x, u.y, u.mineMineralId);
        if (!drop) {
          u.carrying = false;
          continue;
        }
        const dDrop = dist(u.x, u.y, drop.x, drop.y);
        const dropR = 0.7;
        if (dDrop > dropR) {
          const mul = moveSpeedMul(u.x, u.y, false);
          const pos = stepGround(u.x, u.y, drop.x, drop.y, sp * mul * dt);
          u.x = pos.x;
          u.y = pos.y;
        } else {
          // Deposit
          let yieldAmt = MINE_TRIP_YIELD;
          if (p.race === "operators") yieldAmt *= 1.04;
          if (p.race === "blight") yieldAmt *= 1.06;
          p.energy += yieldAmt;
          u.carrying = false;
          u.mineProgress = 0;
          // keep mineMineralId so they return to the same field
        }
        continue;
      }

      // —— Empty: walk to crystal, channel, fill cargo ——
      let m =
        u.mineMineralId != null
          ? this.minerals.find((mm) => mm.id === u.mineMineralId) ?? null
          : null;
      if (!m) {
        m = this.pickMineFor(u.owner, u.x, u.y);
        u.mineMineralId = m?.id ?? null;
        u.mineProgress = 0;
      }
      if (!m) continue;

      const mineRange = 0.85;
      const ang = slotAngle(u.id, 10);
      const holdR = 0.5 + (u.id % 3) * 0.1;
      const hx = m.x + Math.cos(ang) * holdR;
      const hy = clamp(m.y + Math.sin(ang) * holdR * 0.85, 0.5, MAP_H - 0.5);
      const dHold = dist(u.x, u.y, hx, hy);
      const d = dist(u.x, u.y, m.x, m.y);

      if (d > mineRange || dHold > 0.12) {
        // Approach pad
        const mul = moveSpeedMul(u.x, u.y, false);
        const pos = stepGround(u.x, u.y, hx, hy, sp * (d > mineRange ? 1 : 0.4) * mul * dt);
        u.x = pos.x;
        u.y = pos.y;
        u.mineProgress = 0;
      } else {
        // Channel at crystal
        u.mineProgress = Math.min(1, u.mineProgress + dt / MINE_CHANNEL);
        u.attackTimer -= dt;
        if (u.attackTimer <= 0) {
          this.fire(
            u.owner,
            u.x,
            u.y,
            m.x,
            m.y,
            m.id,
            false,
            0,
            "mine",
            0.55,
            0.9,
            true,
          );
          u.attackTimer = 0.28;
        }
        if (u.mineProgress >= 1) {
          u.carrying = true;
          u.mineProgress = 0;
        }
      }
    }
  }

  private tickProduction(dt: number) {
    if (this.phase === "overtime") return;
    for (const b of this.buildings) {
      if (!b.done) continue;
      const def = BUILDINGS[b.kind];
      if (!def.produces) continue;
      const p = this.players[b.owner]!;
      if (!p.alive) continue;
      const army = this.units.filter((u) => u.owner === b.owner && u.kind !== "worker").length;
      if (def.produces !== "worker" && army >= 32) continue;
      b.produceTimer -= dt;
      if (b.produceTimer > 0) continue;

      if (def.produces === "worker") {
        const workers = this.units.filter((u) => u.owner === b.owner && u.kind === "worker").length;
        if (workers >= p.workerCap) {
          b.produceTimer = 1.5;
          continue;
        }
        const a = Math.random() * Math.PI * 2;
        this.spawnUnit(
          b.owner,
          "worker",
          b.x + Math.cos(a) * (1.0 + Math.random() * 0.8),
          b.y + Math.sin(a) * (1.0 + Math.random() * 0.8),
        );
        b.produceTimer = def.produceTime ?? 4;
        continue;
      }

      // One living scout per Scout Works
      if (def.produces === "scout") {
        const pads = this.buildings.filter(
          (x) => x.owner === b.owner && x.kind === "scout" && x.done,
        ).length;
        const scouts = this.units.filter((u) => u.owner === b.owner && u.kind === "scout").length;
        if (scouts >= pads) {
          b.produceTimer = 1.2;
          continue;
        }
      }

      const cost = def.produceCost ?? 0;
      if (p.energy < cost) {
        b.produceTimer = 0.5;
        continue;
      }
      p.energy -= cost;
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.3 + Math.random() * 1.1;
      this.spawnUnit(
        b.owner,
        def.produces,
        b.x + Math.cos(ang) * rad,
        b.y + Math.sin(ang) * rad,
      );
      b.produceTimer = def.produceTime ?? 6;
    }
  }

  private fire(
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
    const d = dist(x, y, tx, ty);
    // mine beams are held; lasers fast; shells slow
    const speed =
      style === "mine" ? 0 : style === "laser" ? 28 : style === "shell" ? 10 : 16;
    const maxAge =
      style === "mine" ? 0.28 : Math.max(0.12, (d / Math.max(speed, 1)) + 0.05);
    this.projectiles.push({
      id: id(),
      owner,
      x,
      y,
      ox: x,
      oy: y,
      tx,
      ty,
      targetId,
      targetIsBuilding,
      targetIsMineral,
      damage,
      speed,
      style,
      fromAir,
      toAir,
      age: 0,
      maxAge,
    });
  }

  private tickCombat(dt: number) {
    for (const b of this.buildings) {
      if (!b.done) continue;
      const def = BUILDINGS[b.kind];
      if (!def.range) continue;
      b.attackTimer -= dt;
      if (b.attackTimer > 0) continue;
      const target = this.findBuildingTarget(b, def);
      if (!target) continue;
      if (target.kind === "unit") {
        const air = UNITS[target.unit.kind].air;
        let deal = 0;
        if (air && def.attackAir) deal = def.attackAir;
        else if (!air && def.attackGround) deal = def.attackGround;
        if (deal > 0) {
          this.fire(
            b.owner,
            b.x,
            b.y,
            target.unit.x,
            target.unit.y,
            target.unit.id,
            false,
            deal,
            buildingShotStyle(b.kind),
            0.35,
            air ? 1 : 0.15,
          );
          b.attackTimer = 0.55;
        }
      } else if (def.attackGround) {
        this.fire(
          b.owner,
          b.x,
          b.y,
          target.building.x,
          target.building.y,
          target.building.id,
          true,
          def.attackGround,
          buildingShotStyle(b.kind),
          0.35,
          0.4,
        );
        b.attackTimer = 0.7;
      }
    }

    for (const u of this.units) {
      if (u.kind === "worker") continue; // workers mine / build only
      if (u.kind === "scout") {
        // pure recon — never lock onto combat targets
        u.targetId = null;
        u.targetIsBuilding = false;
        continue;
      }
      const def = UNITS[u.kind];
      u.attackTimer -= dt;
      const tgt = this.acquireTarget(u);
      if (!tgt) {
        u.targetId = null;
        continue;
      }
      u.targetId = tgt.id;
      u.targetIsBuilding = tgt.isBuilding;
      if (dist(u.x, u.y, tgt.x, tgt.y) > def.range || u.attackTimer > 0) continue;
      const mul = raceUnitMul(this.players[u.owner]!.race, u.kind).dmg;
      const toAir = tgt.isBuilding
        ? 0.4
        : UNITS[this.units.find((x) => x.id === tgt.id)?.kind ?? "raider"]?.air
          ? 1
          : 0.15;
      this.fire(
        u.owner,
        u.x,
        u.y,
        tgt.x,
        tgt.y,
        tgt.id,
        tgt.isBuilding,
        def.damage * mul,
        unitShotStyle(u.kind),
        def.air ? 1 : 0.2,
        toAir,
      );
      u.attackTimer = def.dpsInterval;
    }
  }

  private tickProjectiles(dt: number) {
    const survivors: Projectile[] = [];
    for (const p of this.projectiles) {
      p.age += dt;

      // Mining beams: pin origin to living worker, tip to crystal, no travel
      if (p.style === "mine" || p.targetIsMineral) {
        const miner = this.units.find(
          (u) => u.owner === p.owner && u.kind === "worker" && u.mineMineralId === p.targetId,
        );
        const m = this.minerals.find((mm) => mm.id === p.targetId);
        if (!m || p.age >= p.maxAge) continue;
        if (miner) {
          p.ox = miner.x;
          p.oy = miner.y;
          p.x = miner.x;
          p.y = miner.y;
        }
        p.tx = m.x;
        p.ty = m.y;
        survivors.push(p);
        continue;
      }

      // home toward live target
      if (p.targetIsBuilding) {
        const b = this.buildings.find((x) => x.id === p.targetId);
        if (b) {
          p.tx = b.x;
          p.ty = b.y;
        }
      } else {
        const u = this.units.find((x) => x.id === p.targetId);
        if (u) {
          p.tx = u.x;
          p.ty = u.y;
          p.toAir = UNITS[u.kind].air ? 1 : 0.15;
        }
      }

      let dx = p.tx - p.x;
      if (dx > MAP_W / 2) dx -= MAP_W;
      if (dx < -MAP_W / 2) dx += MAP_W;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;

      if (d <= step || p.age >= p.maxAge) {
        if (p.damage > 0) {
          if (p.targetIsBuilding) {
            const b = this.buildings.find((x) => x.id === p.targetId);
            if (b) b.hp -= p.damage;
          } else {
            const u = this.units.find((x) => x.id === p.targetId);
            if (u) u.hp -= p.damage;
          }
        }
        continue;
      }
      p.x = (p.x + (dx / d) * step + MAP_W) % MAP_W;
      p.y = clamp(p.y + (dy / d) * step, 0.2, MAP_H - 0.2);
      survivors.push(p);
    }
    this.projectiles = survivors;

    // cleanup dead after projectile hits
    for (const b of this.buildings) {
      if (b.hp <= 0) {
        this.markOcc(b.x, b.y, false);
        for (const u of this.units) {
          if (u.buildTargetId === b.id) {
            u.buildTargetId = null;
            u.carrying = false;
          }
        }
      }
    }
    this.buildings = this.buildings.filter((b) => b.hp > 0);
    this.units = this.units.filter((u) => u.hp > 0);
  }

  private findBuildingTarget(
    b: Building,
    def: (typeof BUILDINGS)[BuildingKind],
  ):
    | { kind: "unit"; unit: Unit }
    | { kind: "building"; building: Building }
    | null {
    const range = def.range ?? 0;
    let best: { kind: "unit"; unit: Unit } | { kind: "building"; building: Building } | null =
      null;
    let bestD = range + 0.01;
    for (const u of this.units) {
      if (u.owner === b.owner) continue;
      const air = UNITS[u.kind].air;
      if (air && !def.attackAir) continue;
      if (!air && !def.attackGround) continue;
      const d = dist(b.x, b.y, u.x, u.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: "unit", unit: u };
      }
    }
    if (def.attackGround) {
      for (const ob of this.buildings) {
        if (ob.owner === b.owner) continue;
        const d = dist(b.x, b.y, ob.x, ob.y);
        if (d < bestD) {
          bestD = d;
          best = { kind: "building", building: ob };
        }
      }
    }
    return best;
  }

  private acquireTarget(u: Unit): { id: number; x: number; y: number; isBuilding: boolean } | null {
    const def = UNITS[u.kind];
    let best: { id: number; x: number; y: number; isBuilding: boolean } | null = null;
    let bestD = 99;
    const scan = Math.max(def.range + 7, 9);
    for (const ou of this.units) {
      if (ou.owner === u.owner) continue;
      const oAir = UNITS[ou.kind].air;
      if (oAir && !def.attackAir) continue;
      if (!oAir && !def.attackGround) continue;
      const d = dist(u.x, u.y, ou.x, ou.y);
      if (d < bestD && d < scan) {
        bestD = d;
        best = { id: ou.id, x: ou.x, y: ou.y, isBuilding: false };
      }
    }
    if (def.attackGround) {
      for (const b of this.buildings) {
        if (b.owner === u.owner) continue;
        const d = dist(u.x, u.y, b.x, b.y);
        const bias = b.kind === "core" ? -0.5 : 0;
        if (d + bias < bestD && d < scan) {
          bestD = d + bias;
          best = { id: b.id, x: b.x, y: b.y, isBuilding: true };
        }
      }
    }
    return best;
  }

  private scoutPatrolPoint(u: Unit): { x: number; y: number } {
    // Cycle map waypoints so drones keep sweeping instead of parking on contacts
    const enemyCore = this.buildings.find((b) => b.owner !== u.owner && b.kind === "core");
    const home = this.buildings.find((b) => b.owner === u.owner && b.kind === "core");
    const period = 7.5;
    const phase = Math.floor(this.t / period + u.id * 1.37) % 8;
    const jitter = (seed: number) => {
      const s = Math.sin(u.id * 12.9898 + seed * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const jx = (jitter(phase) - 0.5) * 3.5;
    const jy = (jitter(phase + 3) - 0.5) * 2.8;
    const points: { x: number; y: number }[] = [
      { x: MAP_W * 0.5 + jx, y: MAP_H * 0.5 + jy },
      {
        x: (enemyCore?.x ?? MAP_W * 0.75) + jx * 0.6,
        y: (enemyCore?.y ?? MAP_H * 0.72) + jy * 0.6,
      },
      { x: MAP_W * 0.38 + jx, y: MAP_H * 0.62 + jy },
      { x: MAP_W * 0.62 + jx, y: MAP_H * 0.38 + jy },
      {
        x: (enemyCore?.x ?? MAP_W * 0.7) + (u.owner === 0 ? 4 : -4) + jx,
        y: (enemyCore?.y ?? MAP_H * 0.7) + jy,
      },
      { x: MAP_W * 0.2 + jx, y: MAP_H * 0.5 + jy },
      { x: MAP_W * 0.8 + jx, y: MAP_H * 0.5 + jy },
      {
        x: (home?.x ?? MAP_W * 0.25) + (u.owner === 0 ? 6 : -6) + jx,
        y: MAP_H * 0.5 + jy,
      },
    ];
    const g = points[phase]!;
    return {
      x: ((g.x % MAP_W) + MAP_W) % MAP_W,
      y: clamp(g.y, 1.5, MAP_H - 1.5),
    };
  }

  private tickMovement(dt: number) {
    for (const u of this.units) {
      if (u.kind === "worker") continue; // workers handled in tickWorkers
      const def = UNITS[u.kind];
      const speed = def.speed * raceUnitMul(this.players[u.owner]!.race, u.kind).speed;
      let tx: number | null = null;
      let ty: number | null = null;

      if (u.kind === "scout") {
        const g = this.scoutPatrolPoint(u);
        tx = g.x;
        ty = g.y;
      } else if (u.targetId != null) {
        if (u.targetIsBuilding) {
          const b = this.buildings.find((x) => x.id === u.targetId);
          if (b) {
            tx = b.x;
            ty = b.y;
          }
        } else {
          const ou = this.units.find((x) => x.id === u.targetId);
          if (ou) {
            tx = ou.x;
            ty = ou.y;
          }
        }
      }
      if (tx == null) {
        const enemyCore = this.buildings.find((b) => b.owner !== u.owner && b.kind === "core");
        if (enemyCore) {
          tx = enemyCore.x;
          ty = enemyCore.y;
        }
      }
      if (tx == null || ty == null) continue;

      // Approach slot around combat target (not scouts — they fly through waypoints)
      if (u.kind !== "scout" && u.targetId != null) {
        const ang = slotAngle(u.id, 12);
        const orbit = Math.max(0.55, def.range * 0.72);
        tx = tx + Math.cos(ang) * orbit;
        ty = clamp(ty + Math.sin(ang) * orbit * 0.8, 0.5, MAP_H - 0.5);
      }

      let dx = tx - u.x;
      if (dx > MAP_W / 2) dx -= MAP_W;
      if (dx < -MAP_W / 2) dx += MAP_W;
      const dy = ty - u.y;
      const d = Math.hypot(dx, dy);
      // Scouts only briefly touch a waypoint then the phase advances — don't hard-stop
      const stopAt = u.kind === "scout" ? 0.85 : u.targetId != null ? 0.35 : 0.4;
      if (d <= stopAt) {
        if (u.kind === "scout") {
          // drift past waypoint so motion never freezes
          const drift = slotAngle(u.id + Math.floor(this.t), 16);
          u.x = (u.x + Math.cos(drift) * speed * 0.35 * dt + MAP_W) % MAP_W;
          u.y = clamp(u.y + Math.sin(drift) * speed * 0.35 * dt, 0.5, MAP_H - 0.5);
        }
        continue;
      }
      if (def.air) {
        u.x = (u.x + (dx / d) * speed * dt + MAP_W) % MAP_W;
        u.y = clamp(u.y + (dy / d) * speed * dt, 0.5, MAP_H - 0.5);
      } else {
        const mul = moveSpeedMul(u.x, u.y, false);
        const pos = stepGround(u.x, u.y, tx, ty, speed * Math.max(0.15, mul) * dt);
        u.x = pos.x;
        u.y = pos.y;
      }
    }
  }

  /** Soft collision: push units apart (ground vs ground, air vs air). */
  private tickSeparation(dt: number) {
    const list = this.units;
    const n = list.length;
    if (n < 2) return;
    // accumulate pushes then apply (symmetric-ish)
    const px = new Float32Array(n);
    const py = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const a = list[i]!;
      // Mining workers stand still — don't shove them off the crystal
      if (a.kind === "worker" && a.carrying) continue;
      const aAir = UNITS[a.kind].air;
      const aR = sepRadius(a.kind);
      for (let j = i + 1; j < n; j++) {
        const b = list[j]!;
        if (b.kind === "worker" && b.carrying) continue;
        if (UNITS[b.kind].air !== aAir) continue;
        let dx = a.x - b.x;
        if (dx > MAP_W / 2) dx -= MAP_W;
        if (dx < -MAP_W / 2) dx += MAP_W;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        const minD = aR + sepRadius(b.kind);
        if (d >= minD) continue;
        if (d < 1e-4) {
          const ang = slotAngle(a.id + b.id * 3, 16);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const overlap = minD - d;
        const f = (overlap / minD) * 0.55;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        px[i]! += fx;
        py[i]! += fy;
        px[j]! -= fx;
        py[j]! -= fy;
      }
    }

    const pushSpeed = 3.4;
    for (let i = 0; i < n; i++) {
      const ax = px[i]!;
      const ay = py[i]!;
      const len = Math.hypot(ax, ay);
      if (len < 1e-5) continue;
      const u = list[i]!;
      const step = Math.min(len, 1.25) * pushSpeed * dt;
      const nx = u.x + (ax / len) * step;
      const ny = u.y + (ay / len) * step;
      if (UNITS[u.kind].air) {
        u.x = (nx + MAP_W) % MAP_W;
        u.y = clamp(ny, 0.5, MAP_H - 0.5);
      } else {
        // only accept separation if not walking into a rim
        const pos = stepGround(u.x, u.y, nx, ny, step);
        // if stepGround can't move toward push, try direct if open
        if (pos.x === u.x && pos.y === u.y && canGroundOccupy(nx, ny)) {
          u.x = (nx + MAP_W) % MAP_W;
          u.y = clamp(ny, 0.5, MAP_H - 0.5);
        } else {
          u.x = pos.x;
          u.y = pos.y;
        }
      }
    }
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
    if (this.phase === "overtime") {
      const combat0 = this.units.filter((u) => u.owner === 0 && u.kind !== "worker").length;
      const combat1 = this.units.filter((u) => u.owner === 1 && u.kind !== "worker").length;
      if (combat0 === 0 && combat1 === 0) {
        this.phase = "ended";
        this.winner = c0.hp === c1.hp ? null : c0.hp > c1.hp ? 0 : 1;
      }
    }
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
      messages: [...this.messages],
    };
  }

  toJSON() {
    return {
      t: this.t,
      phase: this.phase,
      winner: this.winner,
      nextId,
      players: this.players.map((p) => ({
        id: p.id,
        race: p.race,
        energy: p.energy,
        income: p.income,
        alive: p.alive,
        workerCap: p.workerCap,
        vision: Array.from(p.vision),
      })),
      buildings: this.buildings,
      units: this.units,
      minerals: this.minerals,
      projectiles: this.projectiles,
      messages: this.messages,
    };
  }

  static fromJSON(data: ReturnType<GameSim["toJSON"]>): GameSim {
    const sim = new GameSim(data.players[0]!.race, data.players[1]!.race);
    sim.t = data.t;
    sim.phase = data.phase;
    sim.winner = data.winner;
    nextId = data.nextId;
    sim.buildings = data.buildings.map((b) => ({
      ...b,
      linkedMineralId: b.linkedMineralId ?? null,
    }));
    sim.units = data.units.map((u) => ({
      ...u,
      mineMineralId: (u as Unit).mineMineralId ?? null,
      carrying: (u as Unit).carrying ?? false,
      mineProgress: (u as Unit).mineProgress ?? 0,
    }));
    sim.minerals = data.minerals.map((m) => ({ ...m }));
    sim.projectiles = (data.projectiles ?? []).map((p) => ({ ...p }));
    sim.messages = data.messages;
    sim.occupied.clear();
    for (const b of sim.buildings) sim.markOcc(b.x, b.y, true);
    sim.players = data.players.map((p) => ({
      id: p.id as PlayerId,
      race: p.race,
      energy: p.energy,
      income: p.income,
      alive: p.alive,
      workerCap: p.workerCap ?? CORE_WORKER_CAP,
      vision: Uint8Array.from(p.vision),
    }));
    return sim;
  }
}
