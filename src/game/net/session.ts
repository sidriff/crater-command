import { BotAI } from "../bot/ai";
import { TICK_DT } from "../sim/defs";
import { GameSim } from "../sim/engine";
import type { BuildingKind, PlayerId, RaceId, SimSnapshot } from "../sim/types";

export type SessionMode = "bot";

export interface SessionConfig {
  mode: SessionMode;
  localPlayer: PlayerId;
  localRace: RaceId;
  enemyRace: RaceId;
}

type Listener = (snap: SimSnapshot) => void;

/** Local bot match — no React, no P2P. */
export class GameSession {
  sim: GameSim;
  mode: SessionMode;
  localPlayer: PlayerId;
  private bot: BotAI;
  private acc = 0;
  private listeners = new Set<Listener>();
  private running = false;
  private raf = 0;
  private last = 0;
  status = "vs Bot";

  constructor(cfg: SessionConfig) {
    this.mode = "bot";
    this.localPlayer = 0;
    this.sim = new GameSim(cfg.localRace, cfg.enemyRace);
    this.bot = new BotAI(1, cfg.enemyRace);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snap = this.sim.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const raw = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += raw;
      while (this.acc >= TICK_DT) {
        this.bot.update(this.sim, TICK_DT);
        this.sim.step(TICK_DT);
        this.acc -= TICK_DT;
      }
      this.emit();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  place(kind: BuildingKind, x: number, y: number, handIndex?: number): boolean {
    return this.sim.tryPlace(this.localPlayer, kind, x, y, handIndex);
  }

  castOp(handIndex: number, x: number, y: number): boolean {
    return this.sim.castOp(this.localPlayer, handIndex, x, y);
  }

  cancelOp(opId?: number): boolean {
    return this.sim.cancelOp(this.localPlayer, opId);
  }

  listOps() {
    return this.sim.ops.filter((o) => o.owner === this.localPlayer);
  }

  recomp(): boolean {
    return this.sim.recomp(this.localPlayer);
  }

  trash(handIndex: number): boolean {
    return this.sim.trashCard(this.localPlayer, handIndex);
  }

  canPlacePreview(kind: BuildingKind, x: number, y: number, handIndex?: number) {
    return this.sim.canPlacePreview(this.localPlayer, kind, x, y, handIndex);
  }
}
