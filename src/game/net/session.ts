import { P2PRoom } from "@/lib/multiplayer";
import { BotAI } from "../bot/ai";
import { TICK_DT } from "../sim/defs";
import { GameSim } from "../sim/engine";
import type { BuildingKind, Intent, PlayerId, RaceId, SimSnapshot } from "../sim/types";

export type SessionMode = "bot" | "host" | "guest";

export interface SessionConfig {
  mode: SessionMode;
  localPlayer: PlayerId;
  localRace: RaceId;
  enemyRace: RaceId;
  roomId?: string;
  peerId?: string;
  playerName?: string;
}

type Listener = (snap: SimSnapshot) => void;

export class GameSession {
  sim: GameSim;
  mode: SessionMode;
  localPlayer: PlayerId;
  private bot: BotAI | null = null;
  private p2p: P2PRoom | null = null;
  private acc = 0;
  private listeners = new Set<Listener>();
  private running = false;
  private raf = 0;
  private last = 0;
  private enemyPeerId: string | null = null;
  connected = false;
  status = "";

  constructor(cfg: SessionConfig) {
    this.mode = cfg.mode;
    this.localPlayer = cfg.localPlayer;
    if (cfg.mode === "guest") {
      this.sim = new GameSim(cfg.enemyRace, cfg.localRace);
      this.localPlayer = 1;
    } else if (cfg.mode === "host") {
      this.sim = new GameSim(cfg.localRace, cfg.enemyRace);
      this.localPlayer = 0;
    } else {
      this.sim = new GameSim(cfg.localRace, cfg.enemyRace);
      this.localPlayer = 0;
      this.bot = new BotAI(1, cfg.enemyRace);
    }

    if ((cfg.mode === "host" || cfg.mode === "guest") && cfg.roomId && cfg.peerId) {
      this.status = "Connecting…";
      this.p2p = new P2PRoom({
        room: cfg.roomId,
        selfId: cfg.peerId,
        name: cfg.playerName ?? cfg.peerId,
        onConnected: () => {
          this.connected = true;
          this.status = cfg.mode === "host" ? "Waiting for opponent link…" : "Linked";
        },
        onPeersChanged: (peers) => {
          const remote = peers.find((p) => p.connectionState === "connected");
          if (remote) {
            this.enemyPeerId = remote.id;
            this.status = "Live";
            if (cfg.mode === "host") {
              this.p2p?.send({ type: "snap", data: this.sim.toJSON() }, remote.id);
            }
          } else if (peers.some((p) => p.connectionState === "failed")) {
            this.status = "Peer failed — check network";
          }
        },
        onMessage: (from, data) => {
          this.onNet(from, data);
        },
      });
      void this.p2p.join();
    }
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
        this.tick(TICK_DT);
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
    this.p2p?.close();
    this.p2p = null;
  }

  private tick(dt: number) {
    if (this.mode === "guest") return;
    if (this.bot) this.bot.update(this.sim, dt);
    this.sim.step(dt);
    if (this.mode === "host" && this.enemyPeerId && this.p2p) {
      if (Math.floor(this.sim.t * 10) !== Math.floor((this.sim.t - dt) * 10)) {
        this.p2p.broadcast({ type: "snap", data: this.sim.toJSON() });
      }
    }
  }

  place(kind: BuildingKind, x: number, y: number): boolean {
    if (this.mode === "guest") {
      this.p2p?.send({
        type: "intent",
        intent: { type: "place", player: 1, kind, x, y } satisfies Intent,
      });
      return true;
    }
    return this.sim.tryPlace(this.localPlayer, kind, x, y);
  }

  private onNet(_from: string, data: unknown) {
    if (!data || typeof data !== "object") return;
    const msg = data as { type?: string; data?: ReturnType<GameSim["toJSON"]>; intent?: Intent };
    if (msg.type === "snap" && msg.data && this.mode === "guest") {
      try {
        this.sim = GameSim.fromJSON(msg.data);
      } catch {
        /* ignore */
      }
      return;
    }
    if (msg.type === "intent" && msg.intent && this.mode === "host") {
      this.sim.applyIntent(msg.intent);
    }
  }
}
