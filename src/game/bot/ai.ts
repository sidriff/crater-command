import { BUILDINGS, EXTRACTOR_LINK_RANGE, MAP_H, MAP_W } from "../sim/defs";
import { cardOf, type CardId } from "../sim/deck";
import type { GameSim } from "../sim/engine";
import type { BuildingKind, PlayerId, RaceId } from "../sim/types";

/** Simple deck-aware bot: plays first affordable hand card near core / crystals. */
export class BotAI {
  private cooldown = 2.0;
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

    const p = sim.players[this.player]!;

    // Pick first affordable hand card (prefer non-tech early, then any)
    let handIndex = -1;
    let kind: BuildingKind | null = null;
    for (let i = 0; i < p.hand.length; i++) {
      const card = cardOf(p.hand[i] as CardId);
      if (p.energy < card.cost) continue;
      if (card.operation) continue;
      if (handIndex < 0 || !card.tech) {
        handIndex = i;
        kind = card.building;
        if (!card.tech) break;
      }
    }
    if (handIndex < 0 || !kind) {
      this.cooldown = 1.4;
      return;
    }


    const pos = this.pickSite(sim, kind);
    if (!pos) {
      this.cooldown = 0.9;
      return;
    }
    const ok = sim.tryPlace(this.player, kind, pos.x, pos.y, handIndex);
    this.cooldown = ok ? 2.4 + Math.random() * 1.2 : 0.8;
  }

  private pickSite(sim: GameSim, kind: BuildingKind): { x: number; y: number } | null {
    const core = sim.buildings.find((b) => b.owner === this.player && b.kind === "core");
    if (!core) return null;

    if (kind === "extractor") {
      for (const m of sim.minerals) {
        const taken = sim.buildings.some(
          (b) => b.kind === "extractor" && b.linkedMineralId === m.id,
        );
        if (taken) continue;
        for (let t = 0; t < 10; t++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.9 + Math.random() * (EXTRACTOR_LINK_RANGE - 1);
          const x = m.x + Math.cos(a) * r;
          const y = m.y + Math.sin(a) * r;
          const prev = sim.canPlacePreview(this.player, kind, x, y);
          if (prev.ok) return { x, y };
        }
      }
    }

    for (let t = 0; t < 24; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.4 + Math.random() * 3.2;
      const x = ((core.x + Math.cos(a) * r) % MAP_W + MAP_W) % MAP_W;
      const y = Math.max(1.2, Math.min(MAP_H - 1.2, core.y + Math.sin(a) * r));
      if (sim.canPlacePreview(this.player, kind, x, y).ok) return { x, y };
    }
    return null;
  }
}
