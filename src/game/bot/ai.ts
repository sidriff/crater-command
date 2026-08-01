import { BUILDINGS, EXTRACTOR_LINK_RANGE, MAP_H, MAP_W, PLACEABLE, RACES } from "../sim/defs";
import type { GameSim } from "../sim/engine";
import type { BuildingKind, PlayerId, RaceId, StratTag } from "../sim/types";

export class BotAI {
  private cooldown = 1.5;
  private readonly player: PlayerId;
  private readonly race: RaceId;

  constructor(player: PlayerId, race: RaceId) {
    this.player = player;
    this.race = race;
  }

  update(sim: GameSim, dt: number) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    if (sim.phase !== "playing") return;

    const lean = RACES[this.race].botLean;
    const plan = this.pickKind(sim, lean);
    if (!plan) {
      this.cooldown = 1.2;
      return;
    }
    const pos = this.pickSite(sim, plan);
    if (!pos) {
      this.cooldown = 0.8;
      return;
    }
    const ok = sim.tryPlace(this.player, plan, pos.x, pos.y);
    this.cooldown = ok ? 2.2 + Math.random() * 1.5 : 0.7;
  }

  private count(sim: GameSim, kind: BuildingKind) {
    return sim.buildings.filter((b) => b.owner === this.player && b.kind === kind).length;
  }

  private seenEnemy(sim: GameSim): { rush: number; air: number; expand: number } {
    let rush = 0;
    let air = 0;
    let expand = 0;
    for (const b of sim.buildings) {
      if (b.owner === this.player) continue;
      if (!sim.canSee(this.player, b.x, b.y)) continue;
      if (b.kind === "barracks" || b.kind === "factory") rush++;
      if (b.kind === "airpad") air++;
      if (b.kind === "extractor") expand++;
    }
    for (const u of sim.units) {
      if (u.owner === this.player) continue;
      if (!sim.canSee(this.player, u.x, u.y)) continue;
      if (u.kind === "flyer" || u.kind === "scout") air++;
      if (u.kind === "raider" || u.kind === "tank") rush++;
    }
    return { rush, air, expand };
  }

  private freeMinerals(sim: GameSim) {
    return sim.minerals.filter(
      (m) =>
        !sim.buildings.some((b) => b.kind === "extractor" && b.linkedMineralId === m.id),
    );
  }

  private pickKind(sim: GameSim, lean: StratTag): BuildingKind | null {
    const p = sim.players[this.player]!;
    const energy = p.energy;
    const scouted = this.seenEnemy(sim);
    const extractors = this.count(sim, "extractor");
    const barracks = this.count(sim, "barracks");
    const turrets = this.count(sim, "turret");
    const aa = this.count(sim, "aa");
    const factory = this.count(sim, "factory");
    const airpad = this.count(sim, "airpad");
    const scouts = this.count(sim, "scout");
    const free = this.freeMinerals(sim);

    if (scouted.air > 0 && aa < Math.min(3, 1 + scouted.air) && energy >= BUILDINGS.aa.cost * 0.9) {
      return "aa";
    }
    if (scouted.rush >= 2 && turrets < 3 && energy >= BUILDINGS.turret.cost) {
      return "turret";
    }

    // Priority: grab nearby free crystal early
    if (extractors < 2 && free.length > 0 && energy >= BUILDINGS.extractor.cost) {
      return "extractor";
    }
    if (scouts < 1 && sim.t > 14 && energy >= BUILDINGS.scout.cost) return "scout";

    const tryOrder = (kinds: BuildingKind[]): BuildingKind | null => {
      for (const k of kinds) {
        if (!PLACEABLE.includes(k)) continue;
        const def = BUILDINGS[k];
        if (energy < def.cost) continue;
        if (k === "extractor") {
          if (free.length === 0 || extractors >= 4) continue;
        }
        if (k === "barracks" && barracks >= 3) continue;
        if (k === "turret" && turrets >= 4) continue;
        if (k === "aa" && aa >= 3) continue;
        if (k === "factory" && factory >= 2) continue;
        if (k === "airpad" && airpad >= 2) continue;
        if (k === "scout" && scouts >= 2) continue;
        return k;
      }
      return null;
    };

    if (scouted.expand >= 2 && lean !== "defend") {
      const rush = tryOrder(["barracks", "factory", "extractor"]);
      if (rush) return rush;
    }
    if (scouted.rush >= 1) {
      const def = tryOrder(["turret", "aa", "barracks"]);
      if (def) return def;
    }

    if (lean === "rush") {
      return tryOrder(
        extractors < 2
          ? ["extractor", "barracks", "scout", "factory", "turret"]
          : ["barracks", "factory", "extractor", "airpad", "scout", "turret"],
      );
    }
    if (lean === "defend") {
      return tryOrder(
        turrets < 2
          ? ["turret", "extractor", "aa", "factory", "barracks", "scout"]
          : ["factory", "turret", "aa", "extractor", "barracks", "scout"],
      );
    }
    return tryOrder(
      extractors < 3
        ? ["extractor", "scout", "airpad", "barracks", "aa", "turret"]
        : ["airpad", "extractor", "scout", "aa", "factory", "turret"],
    );
  }

  private pickSite(sim: GameSim, kind: BuildingKind): { x: number; y: number } | null {
    const core = sim.buildings.find((b) => b.owner === this.player && b.kind === "core");
    if (!core) return null;

    if (kind === "extractor") {
      const free = this.freeMinerals(sim)
        .map((m) => ({ m, d: Math.hypot(m.x - core.x, m.y - core.y) }))
        .sort((a, b) => a.d - b.d);
      for (const { m } of free) {
        for (let i = 0; i < 12; i++) {
          const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.2;
          const r = 1.6 + Math.random() * (EXTRACTOR_LINK_RANGE - 1.7);
          const x = m.x + Math.cos(ang) * r;
          const y = m.y + Math.sin(ang) * r;
          if (this.clear(sim, x, y)) return { x, y };
        }
      }
      return null;
    }

    const forward = this.player === 0 ? 1 : -1;
    const isForward =
      kind === "barracks" ||
      kind === "factory" ||
      kind === "airpad" ||
      kind === "turret" ||
      kind === "aa";
    let baseY = core.y + (isForward ? forward * (3 + Math.random() * 5) : forward * 1.5);
    if (kind === "scout") baseY = core.y + forward * 6;

    for (let i = 0; i < 20; i++) {
      const x = core.x + (Math.random() - 0.5) * 10;
      const y = baseY + (Math.random() - 0.5) * 4;
      const nx = Math.max(2, Math.min(MAP_W - 2, x));
      const ny = Math.max(2, Math.min(MAP_H - 2, y));
      if (this.clear(sim, nx, ny)) return { x: nx, y: ny };
    }
    return null;
  }

  private clear(sim: GameSim, x: number, y: number) {
    if (x < 2 || y < 2 || x > MAP_W - 2 || y > MAP_H - 2) return false;
    for (const b of sim.buildings) {
      if (Math.hypot(b.x - x, b.y - y) < 1.8) return false;
    }
    for (const m of sim.minerals) {
      if (Math.hypot(m.x - x, m.y - y) < 1.15) return false;
    }
    return true;
  }
}
