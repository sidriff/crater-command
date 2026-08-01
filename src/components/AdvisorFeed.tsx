import { useEffect, useState } from "react";
import type { RaceId } from "@/game/sim/types";

type AdvisorSkin = {
  video: string;
  poster: string;
  label: string;
  accent: string; // tailwind-ish border/text color class prefix via inline styles
  border: string;
  glow: string;
  labelColor: string;
  cursor: string;
  pulse: string;
};

const SKINS: Record<RaceId | "default", AdvisorSkin> = {
  default: {
    video: "/advisor/overlord.mp4?v=2",

    poster: "/advisor/overlord.jpg",
    label: "OVERLORD // LINK",
    accent: "#ff2a2a",
    border: "rgba(255,42,42,0.35)",
    glow: "rgba(255,40,40,0.18)",
    labelColor: "#f87171",
    cursor: "rgba(248,113,113,0.9)",
    pulse: "#ff2a2a",
  },
  blight: {
    video: "/advisor/overlord.mp4?v=2",

    poster: "/advisor/overlord.jpg",
    label: "OVERLORD // HATCH",
    accent: "#ff2a2a",
    border: "rgba(255,42,42,0.4)",
    glow: "rgba(255,40,40,0.2)",
    labelColor: "#f87171",
    cursor: "rgba(248,113,113,0.9)",
    pulse: "#ff2a2a",
  },
  mandate: {
    video: "/advisor/mandate.mp4?v=2",

    poster: "/advisor/mandate.jpg",
    label: "MANDATE // COMMAND",
    accent: "#3d9bff",
    border: "rgba(61,155,255,0.4)",
    glow: "rgba(61,155,255,0.2)",
    labelColor: "#7db8ff",
    cursor: "rgba(125,184,255,0.95)",
    pulse: "#3d9bff",
  },
  // Operators — belt astronaut on green phosphor CRT
  operators: {
    video: "/advisor/operators.mp4?v=2",

    poster: "/advisor/operators.jpg",
    label: "OPS // OPEN CHANNEL",
    accent: "#2dff8c",
    border: "rgba(45,255,140,0.4)",
    glow: "rgba(45,255,140,0.18)",
    labelColor: "#6effb0",
    cursor: "rgba(110,255,176,0.95)",
    pulse: "#2dff8c",
  },
};

export type AdvisorLine = {
  id: string;
  text: string;
  /** ms per character for typewriter */
  cps?: number;
  race?: RaceId;
};

function useTypewriter(text: string, active: boolean, cps = 28) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (!active) {
      setOut("");
      return;
    }
    setOut("");
    let i = 0;
    const ms = Math.max(12, Math.floor(1000 / cps));
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, ms);
    return () => window.clearInterval(id);
  }, [text, active, cps]);
  return out;
}

/**
 * C&C / StarCraft-style top advisor strip.
 * Portrait loops the Imagine VHS clip; text streams in character-by-character.
 */
export function AdvisorFeed({
  line,
  race,
  compact = false,
  className = "",
}: {
  line: AdvisorLine | null;
  /** Faction skin — Mandate gets her own advisor; others use placeholders */
  race?: RaceId;
  compact?: boolean;
  className?: string;
}) {
  const typed = useTypewriter(line?.text ?? "", !!line, line?.cps ?? 30);
  if (!line) return null;

  const skinKey = line.race ?? race ?? "default";
  const skin = SKINS[skinKey] ?? SKINS.default;

  return (
    <div
      data-ui
      className={`pointer-events-none relative overflow-hidden rounded border bg-black/80 backdrop-blur-sm ${
        compact ? "p-1.5" : "p-2"
      } ${className}`}
      style={{
        borderColor: skin.border,
        boxShadow: `0 0 24px ${skin.glow}`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.55) 2px, rgba(0,0,0,0.55) 3px)",
        }}
      />
      <div className="relative flex items-stretch gap-2">
        <div
          className={`relative shrink-0 overflow-hidden rounded-sm border bg-black ${
            compact ? "h-14 w-14" : "h-[4.5rem] w-[4.5rem]"
          }`}
          style={{ borderColor: skin.border }}
        >
          <video
            key={skin.video}
            className="h-full w-full object-cover"
            src={skin.video}
            poster={skin.poster}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: "inset 0 0 12px rgba(0,0,0,0.65)",
              background: `linear-gradient(180deg, ${skin.accent}22, transparent 40%, rgba(0,0,0,0.25))`,
            }}
          />
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <div className="mb-0.5 flex items-center gap-2">
            <span
              className="font-mono text-[9px] font-bold uppercase tracking-[0.2em]"
              style={{ color: skin.labelColor }}
            >
              {skin.label}
            </span>
            <span
              className="size-1.5 animate-pulse rounded-full"
              style={{
                background: skin.pulse,
                boxShadow: `0 0 6px ${skin.pulse}`,
              }}
            />
          </div>
          <p
            className={`font-mono leading-snug text-white/95 ${
              compact ? "text-[11px]" : "text-xs sm:text-sm"
            }`}
          >
            {typed}
            <span
              className="ml-0.5 inline-block w-[0.5ch] animate-pulse align-middle"
              style={{ background: skin.cursor }}
            >
              &nbsp;
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export const ADVISOR_LINES = {
  factionPick:
    "Choose a banner, commander. Blind pick — the enemy will not see your allegiance until the rock runs red.",
  matchStart:
    "Asteroid secure. Expand the claim, seed extractors, and crush the opposition. No mercy on the belt.",
  matchStartMandate:
    "Charter acknowledges claim. Fortify the perimeter, bank the yield, and erase unauthorized operations. By authority of the Surface Mandate.",
  matchStartOps:
    "Belt crew online. Grab crystals early, stay light, hit them before the paper-pushers dig in. Make it messy.",
  matchmaking: "Hunting a challenger on the open channel… ten seconds, then we drop a bot.",
} as const;
