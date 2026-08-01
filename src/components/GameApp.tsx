import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Home, Radar, Shield, Swords, Trees, Volume2, VolumeX, Zap } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { TitleBoot } from "@/components/TitleBoot";
import { AdvisorFeed, ADVISOR_LINES, type AdvisorLine } from "@/components/AdvisorFeed";
// PlanetScene is NOT imported here — it pulls Three + the whole globe bake.
// Play view loads it via dynamic import so the title typewriter stays free.
import {
  ensureMusicFromGesture,
  isMusicMuted,
  setMusicMuted,
  startMusic,
  unlockAudio,
} from "@/game/audio/music";
import { GameSession, type SessionMode } from "@/game/net/session";
import { BUILDINGS, MATCH_SECONDS, PLACEABLE, RACES } from "@/game/sim/defs";
import type { BuildingKind, RaceId, SimSnapshot } from "@/game/sim/types";

type Screen = "menu" | "pick" | "match" | "play";

const RACE_LIST = Object.values(RACES);

function warmPlanet() {
  return import("@/game/render/PlanetScene").then((m) => m.warmPlanetGeometry());
}

function fmtTime(t: number) {
  const left = Math.max(0, MATCH_SECONDS - t);
  if (t >= MATCH_SECONDS) {
    const ot = t - MATCH_SECONDS;
    return `OT ${Math.floor(ot / 60)}:${String(Math.floor(ot % 60)).padStart(2, "0")}`;
  }
  const m = Math.floor(left / 60);
  const s = Math.floor(left % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function tagIcon(tag: string) {
  if (tag === "rush") return Swords;
  if (tag === "defend") return Shield;
  if (tag === "expand") return Trees;
  if (tag === "scout") return Radar;
  return Zap;
}

function randomRace(): RaceId {
  return RACE_LIST[Math.floor(Math.random() * RACE_LIST.length)]!.id;
}

function playerId() {
  const k = "cc-pid";
  let id = sessionStorage.getItem(k);
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(k, id);
  }
  return id;
}

function kickMusic() {
  unlockAudio();
  startMusic();
}

export function GameApp() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [intent, setIntent] = useState<"bot" | "match">("bot");
  const [matchStatus, setMatchStatus] = useState("Finding…");
  const [muted, setMuted] = useState(false);
  const [sessionCfg, setSessionCfg] = useState<{
    mode: SessionMode;
    localRace: RaceId;
    enemyRace: RaceId;
    roomId?: string;
    peerId?: string;
  } | null>(null);

  useEffect(() => {
    setMuted(isMusicMuted());
  }, []);

  // Defer mesh bake — never on first paint with the title typewriter
  useEffect(() => {
    const t = window.setTimeout(() => {
      void warmPlanet().catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  const commitFromTitle = (mode: "bot" | "match", r: RaceId) => {
    setIntent(mode);
    kickMusic();
    void warmPlanet().catch(() => {});
    if (mode === "bot") {
      setSessionCfg({ mode: "bot", localRace: r, enemyRace: randomRace() });
      setScreen("play");
    } else {
      setScreen("match");
      void runMatch(r);
    }
  };

  const toggleMute = () => {
    ensureMusicFromGesture();
    const next = !isMusicMuted();
    setMusicMuted(next);
    setMuted(next);
  };

  const runMatch = async (r: RaceId) => {
    const pid = playerId();
    setMatchStatus("Searching for opponent…");
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "find", playerId: pid, race: r }),
      });
      const data = (await res.json()) as {
        status: string;
        roomId: string;
        hostRace?: string;
        guestRace?: string;
        waitMs?: number;
      };
      if (data.status === "join") {
        setSessionCfg({
          mode: "guest",
          localRace: r,
          enemyRace: (data.hostRace as RaceId) ?? "mandate",
          roomId: data.roomId,
          peerId: pid,
        });
        setScreen("play");
        return;
      }
      const roomId = data.roomId;
      setMatchStatus(`Hosting… ${Math.ceil((data.waitMs ?? 10000) / 1000)}s`);
      const started = Date.now();
      const poll = async () => {
        const q = await fetch(
          `/api/match?room=${encodeURIComponent(roomId)}&player=${encodeURIComponent(pid)}`,
        );
        const st = (await q.json()) as {
          status: string;
          guestRace?: string;
          waitMs?: number;
        };
        if (st.status === "matched") {
          setSessionCfg({
            mode: "host",
            localRace: r,
            enemyRace: (st.guestRace as RaceId) ?? randomRace(),
            roomId,
            peerId: pid,
          });
          setScreen("play");
          return;
        }
        if (st.status === "bot" || Date.now() - started >= 10500) {
          if (st.status !== "bot") {
            await fetch("/api/match", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                op: "bot_now",
                playerId: pid,
                race: r,
                roomId,
              }),
            });
          }
          setSessionCfg({ mode: "bot", localRace: r, enemyRace: randomRace() });
          setScreen("play");
          return;
        }
        setMatchStatus(`Waiting for challenger… ${Math.ceil((st.waitMs ?? 0) / 1000)}s`);
        setTimeout(poll, 400);
      };
      setTimeout(poll, 400);
    } catch {
      setMatchStatus("Match service unavailable — bot fallback");
      setTimeout(() => {
        setSessionCfg({ mode: "bot", localRace: r, enemyRace: randomRace() });
        setScreen("play");
      }, 600);
    }
  };

  const backMenu = () => {
    setSessionCfg(null);
    setScreen("menu");
  };

  if (screen === "menu" || screen === "pick") {
    return (
      <PhoneShell>
        <TitleBoot
          muted={muted}
          onToggleMute={toggleMute}
          onCommit={commitFromTitle}
          onEngage={() => {
            kickMusic();
            void warmPlanet().catch(() => {});
          }}
        />
      </PhoneShell>
    );
  }

  if (screen === "match") {
    return (
      <PhoneShell>
        <div className="flex h-full flex-col items-center justify-center bg-bg px-6 text-fg">
          <div className="w-full max-w-sm space-y-4">
            <AdvisorFeed
              line={{ id: "mm", text: ADVISOR_LINES.matchmaking, cps: 34 }}
            />
            <div className="space-y-3 text-center">
              <div className="mx-auto size-12 animate-pulse rounded-full border-2 border-primary/40 border-t-primary" />
              <h2 className="font-display text-xl font-semibold">Matchmaking</h2>
              <p className="text-sm text-muted">{matchStatus}</p>
              <p className="text-xs text-muted">No challenger in 10s → bot with race personality.</p>
              <button type="button" onClick={backMenu} className="text-sm text-primary hover:underline">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </PhoneShell>
    );
  }

  if (!sessionCfg) return null;
  return (
    <PlayScreen
      cfg={sessionCfg}
      onExit={backMenu}
      muted={muted}
      onToggleMute={toggleMute}
    />
  );
}

function PlayScreen({
  cfg,
  onExit,
  muted,
  onToggleMute,
}: {
  cfg: {
    mode: SessionMode;
    localRace: RaceId;
    enemyRace: RaceId;
    roomId?: string;
    peerId?: string;
  };
  onExit: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const sessionRef = useRef<GameSession | null>(null);
  const snapRef = useRef<SimSnapshot | null>(null);
  const [booted, setBooted] = useState(false);
  const [globeReady, setGlobeReady] = useState(false);
  const [PlanetCanvas, setPlanetCanvas] = useState<
    null | React.ComponentType<{
      snapRef: MutableRefObject<SimSnapshot>;
      viewer: 0 | 1;
      placeKind: BuildingKind | null;
      onPlace: (x: number, y: number) => void;
      onGlobeReady?: () => void;
    }>
  >(null);
  const [placeKind, setPlaceKind] = useState<BuildingKind | null>(null);
  const [advisor, setAdvisor] = useState<AdvisorLine | null>(null);
  const [status, setStatus] = useState("");
  const [viewer, setViewer] = useState(0 as 0 | 1);
  const [hud, setHud] = useState({
    t: 0,
    energy: 110,
    income: 3,
    phase: "playing" as string,
    msg: "",
    ended: false,
    winner: null as 0 | 1 | null,
    workers: 2,
    workerCap: 3,
  });

  useEffect(() => {
    kickMusic();
    let alive = true;
    // Load Three / planet only once match UI needs it
    void import("@/game/render/PlanetScene").then((m) => {
      if (!alive) return;
      setPlanetCanvas(() => m.PlanetCanvas);
      if (m.isPlanetGeometryReady()) setGlobeReady(true);
      void m.warmPlanetGeometry().catch(() => {});
    });
    const s = new GameSession({
      mode: cfg.mode,
      localPlayer: 0,
      localRace: cfg.localRace,
      enemyRace: cfg.enemyRace,
      roomId: cfg.roomId,
      peerId: cfg.peerId,
    });
    sessionRef.current = s;
    setViewer(s.localPlayer);
    let lastHud = 0;
    let didBoot = false;
    const off = s.on((snapshot) => {
      if (!alive) return;
      snapRef.current = snapshot;
      if (!didBoot) {
        didBoot = true;
        setBooted(true);
        const isMandate = cfg.localRace === "mandate";
        const isOps = cfg.localRace === "operators";
        setAdvisor({
          id: "start",
          text: isMandate
            ? ADVISOR_LINES.matchStartMandate
            : isOps
              ? ADVISOR_LINES.matchStartOps
              : ADVISOR_LINES.matchStart,
          cps: 30,
          race: cfg.localRace,
        });
      }
      const now = performance.now();
      if (now - lastHud > 150) {
        lastHud = now;
        const me = snapshot.players[s.localPlayer]!;
        const workers = snapshot.units.filter(
          (u) => u.owner === s.localPlayer && u.kind === "worker",
        ).length;
        setHud({
          t: snapshot.t,
          energy: me.energy,
          income: me.income,
          phase: snapshot.phase,
          msg: snapshot.messages.at(-1) ?? "",
          ended: snapshot.phase === "ended",
          winner: snapshot.winner,
          workers,
          workerCap: me.workerCap,
        });
      }
    });
    s.start();
    const iv = setInterval(() => {
      if (alive) setStatus(s.status);
    }, 500);
    return () => {
      alive = false;
      off();
      clearInterval(iv);
      s.stop();
      sessionRef.current = null;
    };
  }, [cfg]);

  const onPlace = useCallback((x: number, y: number) => {
    setPlaceKind((kind) => {
      if (kind) sessionRef.current?.place(kind, x, y);
      return null;
    });
  }, []);

  const palette = useMemo(() => PLACEABLE, []);
  const meRace = cfg.localRace;

  if (!booted || !snapRef.current || !PlanetCanvas) {
    return (
      <PhoneShell>
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg text-muted">
          <p className="text-sm font-mono tracking-wide text-primary">// LINKING COMBAT MESH…</p>
        </div>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell>
      <div className="relative h-full w-full overflow-hidden bg-bg text-fg">
        <PlanetCanvas
          snapRef={snapRef as MutableRefObject<SimSnapshot>}
          viewer={viewer}
          placeKind={placeKind}
          onPlace={onPlace}
          onGlobeReady={() => setGlobeReady(true)}
        />

        {!globeReady && (
          <div
            data-ui
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-bg/90 text-fg backdrop-blur-sm"
          >
            <p className="font-display text-lg font-semibold">Forging asteroid…</p>
            <p className="text-xs text-muted">First load bakes the globe — next match is instant</p>
          </div>
        )}

        <div
          data-ui
          className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-7"
        >
          <div className="pointer-events-auto mx-auto flex max-w-lg items-center gap-2 rounded-lg border border-border/80 bg-surface/90 px-3 py-2 backdrop-blur-md">
            <button
              type="button"
              onClick={onExit}
              className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Menu"
            >
              <Home className="size-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate font-display text-sm font-semibold"
                  style={{ color: RACES[meRace].tint }}
                >
                  {RACES[meRace].short}
                </span>
                <span className="font-mono text-sm tabular-nums text-fg">{fmtTime(hud.t)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted">
                <span className="flex items-center gap-1">
                  <Zap className="size-3 text-warn" />
                  {Math.floor(hud.energy)}
                  <span className="text-muted/70">+{hud.income.toFixed(0)}/s</span>
                  <span className="ml-1 text-muted/80">
                    · {hud.workers}/{hud.workerCap} wrk
                  </span>
                </span>
                <span>
                  {hud.phase === "overtime"
                    ? "Overtime"
                    : cfg.mode === "bot"
                      ? "vs Bot"
                      : status || cfg.mode}
                </span>
              </div>
            </div>
          </div>
          {advisor && (
            <div className="pointer-events-none mx-auto mt-2 max-w-lg">
              <AdvisorFeed line={advisor} race={cfg.localRace} compact />
            </div>
          )}
          {hud.msg && (
            <p className="mx-auto mt-2 max-w-lg text-center text-xs text-warn">{hud.msg}</p>
          )}
        </div>

        <div
          data-ui
          className="absolute inset-x-0 bottom-0 z-10 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1"
        >
          <div className="mx-auto max-w-lg">
            {placeKind && (
              <p className="mb-1.5 text-center text-[10px] leading-none text-primary drop-shadow">
                {placeKind === "extractor"
                  ? "Tap beside a crystal"
                  : `Tap to place ${BUILDINGS[placeKind].name}`}
              </p>
            )}
            <div className="grid grid-cols-4 gap-x-2 gap-y-2">
              {palette.map((kind) => {
                const def = BUILDINGS[kind];
                const Icon = tagIcon(def.tag);
                const afford = hud.energy >= def.cost && hud.phase === "playing";
                const active = placeKind === kind;
                const label =
                  kind === "barracks"
                    ? "Bay"
                    : kind === "aa"
                      ? "AA"
                      : kind === "factory"
                        ? "Factory"
                        : kind === "airpad"
                          ? "Air"
                          : kind === "scout"
                            ? "Scout"
                            : kind === "extractor"
                              ? "Mine"
                              : kind === "turret"
                                ? "Turret"
                                : def.name;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={!afford && !active}
                    onClick={() => setPlaceKind(active ? null : kind)}
                    className={`mx-auto flex w-full max-w-[3.25rem] min-w-0 flex-col items-center gap-0 rounded border px-0.5 py-0.5 text-center shadow-sm backdrop-blur-sm transition ${
                      active
                        ? "border-primary bg-primary/20 text-fg"
                        : afford
                          ? "border-border/70 bg-surface/70 text-fg active:border-primary/50"
                          : "border-border/40 bg-bg/50 text-muted opacity-45"
                    }`}
                  >
                    <Icon className="size-3 shrink-0" style={{ color: RACES[meRace].tint }} />
                    <span className="w-full truncate text-[8px] font-medium leading-tight tracking-tight">
                      {label}
                    </span>
                    <span className="font-mono text-[8px] leading-none text-warn">{def.cost}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {hud.ended && (
          <div
            data-ui
            className="absolute inset-0 z-20 flex items-center justify-center bg-bg/75 px-6 backdrop-blur-sm"
          >
            <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6 text-center">
              <h2 className="font-display text-2xl font-bold">
                {hud.winner === null ? "Draw" : hud.winner === viewer ? "Victory" : "Defeat"}
              </h2>
              <p className="text-sm text-muted">
                {hud.winner === viewer
                  ? "Core secured. The globe is yours."
                  : hud.winner === null
                    ? "Both cores cracked the same tick."
                    : "Your core is slag. Rebuild smarter."}
              </p>
              <button
                type="button"
                onClick={onExit}
                className="w-full rounded-lg bg-primary py-3 font-semibold text-bg"
              >
                Back to menu
              </button>
            </div>
          </div>
        )}
      </div>
    </PhoneShell>
  );
}
