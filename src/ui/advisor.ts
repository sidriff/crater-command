import type { RaceId } from "../game/sim/types";
import { typewrite } from "./typewriter";

export type AdvisorLine = {
  id: string;
  text: string;
  cps?: number;
  race?: RaceId;
};

type Skin = {
  video: string;
  poster: string;
  label: string;
  accent: string;
  border: string;
  glow: string;
  labelColor: string;
  cursor: string;
  pulse: string;
};

const SKINS: Record<RaceId | "default", Skin> = {
  default: {
    video: "/advisor/blight.mp4?v=1",
    poster: "/advisor/blight.jpg?v=1",
    label: "OVERLORD // LINK",
    accent: "#ff2a2a",
    border: "rgba(255,42,42,0.35)",
    glow: "rgba(255,40,40,0.18)",
    labelColor: "#f87171",
    cursor: "rgba(248,113,113,0.9)",
    pulse: "#ff2a2a",
  },
  blight: {
    video: "/advisor/blight.mp4?v=1",
    poster: "/advisor/blight.jpg?v=1",
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
  operators: {
    video: "/advisor/operators.mp4?v=3",
    poster: "/advisor/operators.jpg?v=3",
    label: "OPERATORS // OPEN CHANNEL",
    accent: "#2dff8c",
    border: "rgba(45,255,140,0.4)",
    glow: "rgba(45,255,140,0.18)",
    labelColor: "#6effb0",
    cursor: "rgba(110,255,176,0.95)",
    pulse: "#2dff8c",
  },
};

export const ADVISOR_LINES = {
  matchStart:
    "Asteroid secure. Expand the claim, seed extractors, and crush the opposition. No mercy on the belt.",
  matchStartMandate:
    "Charter acknowledges claim. Fortify the perimeter, bank the yield, and erase unauthorized operations. By authority of the Surface Mandate.",
  matchStartOperators:
    "Belt crew online. Grab crystals early, stay light, hit them before the paper-pushers dig in. Make it messy.",
} as const;

export function mountAdvisor(
  host: HTMLElement,
  line: AdvisorLine,
  race?: RaceId,
): () => void {
  const skinKey = line.race ?? race ?? "default";
  const skin = SKINS[skinKey] ?? SKINS.default;

  host.innerHTML = "";
  const root = document.createElement("div");
  root.className = "advisor";
  root.dataset.ui = "";
  root.style.borderColor = skin.border;
  root.style.boxShadow = `0 0 24px ${skin.glow}`;

  root.innerHTML = `
    <div class="advisor-scan" aria-hidden="true"></div>
    <div class="advisor-row">
      <div class="advisor-vid" style="border-color:${skin.border}">
        <video src="${skin.video}" poster="${skin.poster}" autoplay muted loop playsinline preload="auto"></video>
      </div>
      <div class="advisor-body">
        <div class="advisor-label">
          <span style="color:${skin.labelColor}">${skin.label}</span>
          <i class="advisor-dot" style="background:${skin.pulse};box-shadow:0 0 6px ${skin.pulse}"></i>
        </div>
        <p class="advisor-text"><span class="advisor-typed"></span><span class="advisor-cursor" style="background:${skin.cursor}">&nbsp;</span></p>
      </div>
    </div>
  `;
  host.append(root);
  const typed = root.querySelector(".advisor-typed") as HTMLElement;
  const tw = typewrite(typed, line.text, line.cps ?? 30);
  return () => {
    tw.stop();
    host.replaceChildren();
  };
}
