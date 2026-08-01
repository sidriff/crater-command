/**
 * Lightweight title / faction shell — NO three.js or PlanetScene imports.
 * 3D scene is dynamic-imported only after the title typewriter completes.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { RACES } from "@/game/sim/defs";
import type { RaceId } from "@/game/sim/types";
import { useTypewriter } from "@/components/boot/useTypewriter";

const TITLE = "CRATER COMMAND";
const TICKER = [
  "BREAKING: BLIGHT FRONT 4.68 AU · TROJAN CLOUD CONSOLIDATING",
  "DAY 14 // BELT SURVEY AUTHORITY · UNCLASSIFIED",
  "CARRIER OK · LAT 47ms · CRC OK · LINK GREEN",
  "MINERS REPORT LIGHTS AT THE RIM · COMMS DRIFT REGION 7",
  "LLOYD'S QUIETLY REVISES TROJAN HAULAGE PREMIUMS",
  "OPS LIVE · PRIORITY ROCKS MARKED · DEPLOY WHEN READY",
];

type Mode = "bot" | "match";
type Panel = "title" | "cut" | "pick";

const ADVISORS: Record<
  RaceId,
  { video: string; poster: string; call: string; line: string }
> = {
  operators: {
    video: "/advisor/operators.mp4?v=2",
    poster: "/advisor/operators.jpg",
    call: "OPS // OPEN CHANNEL",
    line: "Stay light. Hit first.",
  },
  blight: {
    video: "/advisor/overlord.mp4?v=2",
    poster: "/advisor/overlord.jpg",
    call: "OVERLORD // HATCH",
    line: "Expand. Feed. Spread.",
  },
  mandate: {
    video: "/advisor/mandate.mp4?v=2",
    poster: "/advisor/mandate.jpg",
    call: "MANDATE // COMMAND",
    line: "Fortify. Bank. Erase.",
  },
};

function CssStarfield() {
  const stars = useMemo(() => {
    const out: { left: string; top: string; s: number; o: number }[] = [];
    for (let i = 0; i < 90; i++) {
      out.push({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        s: Math.random() < 0.15 ? 2 : 1,
        o: 0.25 + Math.random() * 0.65,
      });
    }
    return out;
  }, []);
  return (
    <div className="absolute inset-0 bg-[#020806]" aria-hidden>
      {stars.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[#c8ffe8]"
          style={{
            left: st.left,
            top: st.top,
            width: st.s,
            height: st.s,
            opacity: st.o,
            boxShadow: st.s > 1 ? "0 0 4px rgba(0,255,170,0.5)" : undefined,
          }}
        />
      ))}
    </div>
  );
}

function FactionCard({
  race,
  onPick,
  visible,
  delayMs,
}: {
  race: RaceId | "random";
  onPick: () => void;
  visible: boolean;
  delayMs: number;
}) {
  const isRandom = race === "random";
  const tint = isRandom ? "#00ffaa" : RACES[race].tint;
  const name = isRandom ? "RANDOM" : RACES[race].name;
  const short = isRandom ? "???" : RACES[race].short;
  const blurb = isRandom
    ? "Blind dice. Any banner. No take-backs."
    : RACES[race].blurb;
  const call = isRandom ? "CHANNEL // STATIC" : ADVISORS[race].call;
  const line = isRandom ? "Signal unknown." : ADVISORS[race].line;
  const video = isRandom ? "/advisor/overlord.mp4?v=2" : ADVISORS[race].video;
  const poster = isRandom ? "/advisor/overlord.jpg" : ADVISORS[race].poster;

  return (
    <button
      type="button"
      onClick={onPick}
      className={`faction-card phos-btn group relative flex flex-col overflow-hidden border bg-black/55 text-left transition ${
        visible ? "faction-card-on" : "opacity-0"
      }`}
      style={{
        borderColor: `${tint}66`,
        boxShadow: visible ? `0 0 18px ${tint}22, inset 0 0 0 1px ${tint}18` : undefined,
        animationDelay: `${delayMs}ms`,
        color: tint,
      }}
    >
      <div
        className="relative aspect-[5/3] w-full overflow-hidden border-b bg-black"
        style={{ borderColor: `${tint}33` }}
      >
        {isRandom ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#020806]">
            <video
              className="h-full w-full scale-110 object-cover opacity-40 contrast-125 saturate-50"
              src={video}
              poster={poster}
              autoPlay
              muted
              loop
              playsInline
              preload="none"
            />
            <div
              className="absolute inset-0 opacity-40"
              style={{
                background:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.5) 2px, rgba(0,0,0,0.5) 3px)",
              }}
            />
            <span
              className="relative font-mono text-3xl font-bold tracking-[0.3em]"
              style={{ textShadow: `0 0 12px ${tint}` }}
            >
              ???
            </span>
          </div>
        ) : (
          <>
            <video
              className="h-full w-full object-cover"
              src={video}
              poster={poster}
              autoPlay
              muted
              loop
              playsInline
              preload="none"
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(180deg, ${tint}18, transparent 40%, rgba(0,0,0,0.55))`,
                boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
              }}
            />
          </>
        )}
        <div className="absolute left-1.5 top-1.5 font-mono text-[8px] tracking-[0.18em] opacity-90">
          {call}
        </div>
        <div
          className="absolute bottom-1.5 right-1.5 size-1.5 animate-pulse rounded-full"
          style={{ background: tint, boxShadow: `0 0 6px ${tint}` }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        <div className="flex items-baseline justify-between gap-1">
          <span className="font-mono text-[10px] font-bold tracking-[0.14em]">{short}</span>
          <span className="font-mono text-[8px] opacity-55">▸ SELECT</span>
        </div>
        <div
          className="font-mono text-[11px] font-bold leading-tight tracking-wide"
          style={{ color: tint }}
        >
          {name}
        </div>
        <p className="mt-0.5 font-mono text-[9px] leading-snug text-[#00ffaa]/70">{blurb}</p>
        <p className="mt-auto pt-1 font-mono text-[8px] tracking-wide opacity-60">{line}</p>
      </div>
    </button>
  );
}

type SceneComp = ComponentType<{ zoom: number }>;

export function TitleBoot({
  muted,
  onToggleMute,
  onCommit,
  onEngage,
}: {
  muted: boolean;
  onToggleMute: () => void;
  onCommit: (mode: Mode, race: RaceId) => void;
  onEngage?: () => void;
}) {
  const [bootT, setBootT] = useState(0);
  const [meshReady, setMeshReady] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [showUi, setShowUi] = useState(false);
  const [blinkOn, setBlinkOn] = useState(false);
  const [panel, setPanel] = useState<Panel>("title");
  const [intent, setIntent] = useState<Mode>("bot");
  const [pickBlink, setPickBlink] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [tickerI, setTickerI] = useState(0);
  const [Scene, setScene] = useState<SceneComp | null>(null);
  const zoomStarted = useRef(false);
  const sceneLoadStarted = useRef(false);

  // Pure rAF typewriter — no Three on this module's import graph
  const title = useTypewriter(TITLE, 16, true);
  const loadLine = useTypewriter("// APPROACH VECTOR LOCKED · HIGH ORBIT", 42, title.done);
  const pickLine = useTypewriter(
    "// BLIND PICK · OPPONENT SEES NOTHING · CHARTER LOCKS ON CONFIRM",
    38,
    panel === "pick" && pickBlink,
  );

  // After title: dynamic-import 3D (and PlanetScene) then zoom the rock
  useEffect(() => {
    if (!title.done || zoomStarted.current) return;
    zoomStarted.current = true;

    if (!sceneLoadStarted.current) {
      sceneLoadStarted.current = true;
      void import("@/components/boot/TitleScene")
        .then((m) => {
          setScene(() => m.TitleScene);
          // mesh status — poll after chunk lands
          void import("@/game/render/PlanetScene").then((ps) => {
            if (ps.isPlanetGeometryReady()) setMeshReady(true);
            else {
              void ps.warmPlanetGeometry().then(() => setMeshReady(true));
              const id = window.setInterval(() => {
                if (ps.isPlanetGeometryReady()) {
                  setMeshReady(true);
                  window.clearInterval(id);
                }
              }, 500);
            }
          });
        })
        .catch(() => {
          // still run zoom UI even if GL fails
        });
    }

    const startAt = performance.now() + 100;
    const DUR = 3200;
    let raf = 0;
    const run = (now: number) => {
      if (now < startAt) {
        raf = requestAnimationFrame(run);
        return;
      }
      const u = Math.min(1, (now - startAt) / DUR);
      const e = 1 - Math.pow(1 - u, 3);
      setZoom(e);
      if (u < 1) raf = requestAnimationFrame(run);
      else {
        setShowUi(true);
        setTimeout(() => setBlinkOn(true), 80);
        setTimeout(() => setBlinkOn(false), 140);
        setTimeout(() => setBlinkOn(true), 220);
        setTimeout(() => setBlinkOn(false), 280);
        setTimeout(() => setBlinkOn(true), 380);
      }
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [title.done]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTickerI((i) => (i + 1) % TICKER.length), 4200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setBootT((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const goPick = (mode: Mode) => {
    onEngage?.();
    setIntent(mode);
    setPanel("cut");
    window.setTimeout(() => {
      setPanel("pick");
      setPickBlink(false);
      setTimeout(() => setPickBlink(true), 60);
      setTimeout(() => setPickBlink(false), 110);
      setTimeout(() => setPickBlink(true), 180);
      setTimeout(() => setPickBlink(false), 230);
      setTimeout(() => setPickBlink(true), 320);
    }, 420);
  };

  const pickRace = (race: RaceId | "random") => {
    const races = Object.keys(RACES) as RaceId[];
    const chosen = race === "random" ? races[Math.floor(Math.random() * races.length)]! : race;
    onCommit(intent, chosen);
  };

  const zulu = clock.toISOString().slice(11, 19) + " Z";
  const titleLive = panel === "title" && showUi && blinkOn;
  const titleCutting = panel === "cut";

  return (
    <div className="crt-stage relative h-full w-full overflow-hidden bg-black text-[#00ffaa]">
      <CssStarfield />

      {Scene && <Scene zoom={zoom} />}

      <div className="crt-scanlines pointer-events-none absolute inset-0 z-20" aria-hidden />
      <div className="crt-vignette pointer-events-none absolute inset-0 z-20" aria-hidden />

      <div className="pointer-events-none absolute inset-0 z-30 flex flex-col font-mono">
        <div className="flex items-start justify-between gap-2 px-3 pt-[max(0.6rem,env(safe-area-inset-top))] text-[9px] leading-tight tracking-wide text-[#00ffaa]/90 sm:px-4">
          <div className="space-y-0.5">
            <div className="text-[11px] font-bold tracking-[0.18em] text-[#00ffaa]">
              ORBITAL-SLOP // CRATER
            </div>
            <div className="text-[#00ffaa]/70">// CARRIER OK · LAT — · CRC OK</div>
            <div className="text-[#00ffaa]/70">
              // LINK {showUi ? (meshReady ? "GREEN" : "AMBER") : "AMBER"} · RX {zulu}
            </div>
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-[#ff5533]">// BLIGHT FRONT 4.68 AU</div>
            <div className="text-[#00ffaa]/70">// DAY 14 · BSA</div>
            <div className="text-[#00ffaa]/55">
              {panel === "pick" ? "// BLIND PICK" : "// UNCLASSIFIED"}
            </div>
          </div>
        </div>

        {(panel === "title" || panel === "cut") && (
          <div className={`flex flex-1 flex-col ${titleCutting ? "crt-power-cut" : ""}`}>
            <div className="flex flex-1 flex-col items-center justify-center px-4">
              <div className="w-full max-w-md text-center">
                <p className="mb-2 text-[9px] tracking-[0.35em] text-[#00ffaa]/65">
                  BELT SURVEY AUTHORITY
                </p>
                <div className="relative mx-auto inline-flex items-baseline justify-center">
                  <h1
                    className="font-mono text-[clamp(1.6rem,7vw,2.35rem)] font-bold tracking-[0.08em] text-[#00ffaa]"
                    style={{
                      textShadow: "0 0 12px rgba(0,255,170,0.45), 0 0 32px rgba(0,255,170,0.15)",
                    }}
                  >
                    {title.visible}
                  </h1>
                  <span
                    className="ml-0.5 inline-block h-[0.95em] w-[0.55ch] translate-y-[0.08em] animate-pulse bg-[#00ffaa]"
                    style={{ boxShadow: "0 0 8px #00ffaa" }}
                    aria-hidden
                  />
                </div>
                <div className="mt-3 min-h-[1.25rem] text-[11px] tracking-wide text-[#00ffaa]/80">
                  {title.done && (
                    <>
                      {loadLine.visible}
                      {!loadLine.done && (
                        <span className="ml-0.5 inline-block h-3 w-[0.45ch] animate-pulse bg-[#00ffaa]/80 align-middle" />
                      )}
                    </>
                  )}
                </div>
                {title.done && !showUi && (
                  <div className="mx-auto mt-4 h-1 w-40 overflow-hidden rounded-sm border border-[#00ffaa]/35 bg-black/50">
                    <div className="boot-progress-fill h-full bg-[#00ffaa]/85" />
                  </div>
                )}
              </div>
            </div>

            <div
              className={`pointer-events-auto mx-auto w-full max-w-md space-y-2 px-4 pb-2 transition-opacity duration-150 ${
                titleLive ? "opacity-100" : titleCutting ? "opacity-100" : "opacity-0"
              }`}
            >
              <button
                type="button"
                onClick={() => goPick("match")}
                className="phos-btn group flex w-full items-center justify-between border border-[#00ffaa]/55 bg-[#00ffaa]/08 px-3 py-3 text-left text-[#00ffaa] transition hover:bg-[#00ffaa]/16"
              >
                <span className="text-[10px] tracking-[0.2em]">// DEPLOY</span>
                <span className="text-sm font-bold tracking-wide">FIND 1V1</span>
                <span className="text-[10px] text-[#00ffaa]/60">▸</span>
              </button>
              <button
                type="button"
                onClick={() => goPick("bot")}
                className="phos-btn flex w-full items-center justify-between border border-[#00ffaa]/35 bg-black/40 px-3 py-3 text-left text-[#00ffaa]/90 transition hover:border-[#00ffaa]/55 hover:bg-[#00ffaa]/10"
              >
                <span className="text-[10px] tracking-[0.2em]">// SIM</span>
                <span className="text-sm font-bold tracking-wide">PRACTICE VS BOT</span>
                <span className="text-[10px] text-[#00ffaa]/50">▸</span>
              </button>
              <button
                type="button"
                onClick={onToggleMute}
                className="phos-btn flex w-full items-center justify-between border border-[#00ffaa]/25 bg-black/30 px-3 py-2 text-[11px] text-[#00ffaa]/75 transition hover:border-[#00ffaa]/45"
              >
                <span className="tracking-[0.15em]">// AUDIO</span>
                <span className="font-bold tracking-wide">{muted ? "MUTED" : "LIVE"}</span>
              </button>
            </div>
          </div>
        )}

        {panel === "pick" && (
          <div className="flex flex-1 flex-col px-3 pb-1 pt-2 sm:px-4">
            <div className="mb-2 text-center">
              <p className="font-mono text-[10px] tracking-[0.28em] text-[#00ffaa]/70">
                // SELECT BANNER
              </p>
              <p className="mt-1 min-h-[1rem] font-mono text-[9px] tracking-wide text-[#00ffaa]/80">
                {pickLine.visible}
                {pickBlink && !pickLine.done && (
                  <span className="ml-0.5 inline-block h-2.5 w-[0.4ch] animate-pulse bg-[#00ffaa]/80 align-middle" />
                )}
              </p>
              <p className="mt-0.5 font-mono text-[8px] text-[#00ffaa]/45">
                {intent === "match" ? "MODE // 1V1 MATCH" : "MODE // BOT SIM"}
              </p>
            </div>
            <div
              className={`pointer-events-auto mx-auto grid w-full max-w-md flex-1 grid-cols-2 grid-rows-2 gap-2 content-start ${
                pickBlink ? "" : "opacity-0"
              }`}
            >
              <FactionCard race="operators" onPick={() => pickRace("operators")} visible={pickBlink} delayMs={0} />
              <FactionCard race="blight" onPick={() => pickRace("blight")} visible={pickBlink} delayMs={70} />
              <FactionCard race="mandate" onPick={() => pickRace("mandate")} visible={pickBlink} delayMs={140} />
              <FactionCard race="random" onPick={() => pickRace("random")} visible={pickBlink} delayMs={210} />
            </div>
            <button
              type="button"
              onClick={() => {
                setPanel("title");
                setBlinkOn(true);
              }}
              className={`pointer-events-auto mx-auto mt-2 font-mono text-[10px] tracking-[0.2em] text-[#00ffaa]/55 transition hover:text-[#00ffaa] ${
                pickBlink ? "opacity-100" : "opacity-0"
              }`}
            >
              ← // ABORT TO ORBIT
            </button>
          </div>
        )}

        <div className="mt-auto space-y-1 px-0 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2">
          <div className="overflow-hidden border-y border-[#00ffaa]/25 bg-black/55 py-1">
            <div
              key={tickerI}
              className="animate-ticker whitespace-nowrap px-3 text-[10px] tracking-wide text-[#00ffaa]/85"
            >
              {TICKER[tickerI]} · {TICKER[(tickerI + 1) % TICKER.length]}
            </div>
          </div>
          <div className="flex justify-between px-3 text-[8px] tracking-wider text-[#00ffaa]/45">
            <span>
              // T+{String(bootT).padStart(4, "0")}S · MESH{" "}
              {meshReady ? "OK" : Scene ? "STREAM" : "IDLE"}
            </span>
            <span>// FCC ID OS-CRATER · SIG</span>
          </div>
        </div>
      </div>
    </div>
  );
}
