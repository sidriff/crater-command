/**
 * Dispatch lab — preview producer → product launch / egress animations.
 * Scout Works is the gold standard; other cards park-only until authored.
 *
 * Feedback: per-card keep / revise / reject + notes, JSON handoff for agents.
 *
 *   /?lab=dispatch&dispatch=scout_works
 *   ccLabs.openDispatch("scout_works")
 *   ccLabs.dispatchFeedback()
 */
import * as THREE from "three";
import { RACES } from "@game/sim/defs";
import type { RaceId } from "@game/sim/types";
import { copyText, flashButton } from "../../copy";
import type { Lab, LabContext } from "../../lab";
import type { LeverDef } from "../../levers";
import { readLabQuery, writeLabQuery } from "../../query";
import {
  DISPATCHES,
  dispatchById,
  dispatchPlayable,
  listDispatchCatalog,
  resolveDispatchId,
} from "./catalog";
import { DEFAULT_TUNING, launchWindowSecFor } from "./launch";
import { DispatchViewer } from "./viewer";

const RACE_IDS: RaceId[] = ["operators", "blight", "mandate"];
const STORAGE_KEY = "crater-labs:dispatch";
const DEFAULT_ID = "scout_works";

/** Human mesh-direction call — same channel shape as mesh / concept lab. */
export type DispatchVerdict = "keep" | "revise" | "reject" | "";

type DispatchCardFeedback = {
  verdict: DispatchVerdict;
  notes: string;
};

type DispatchLabState = {
  dispatch: string;
  globalNotes: string;
  /** Per dispatch id → verdict + notes. */
  cards: Record<string, DispatchCardFeedback>;
  levers?: Record<string, number>;
};

export type DispatchLabHandle = {
  load(raw: string): boolean;
  current(): string;
  replay(): void;
  list(): { id: string; label: string; status: string }[];
  exportFeedback(): string;
};

let liveHandle: DispatchLabHandle | null = null;

export function getDispatchLabHandle(): DispatchLabHandle | null {
  return liveHandle;
}

export { listDispatchCatalog, resolveDispatchId, DISPATCHES };

/** Playback + launch timing — shipped in feedback JSON when changed from default. */
const TIMING_LEVER_IDS = [
  "auto_loop",
  "play_rate",
  "hold_before",
  "hold_after",
  "rail_sec",
  "climb_sec",
  "slide_dist",
  "free_speed",
  "cruise_y",
] as const;

const LEVERS: LeverDef[] = [
  {
    id: "auto_loop",
    label: "Auto loop",
    kind: "toggle",
    value: 1,
    section: "Playback",
    tradesAgainst: "Off = one-shot then hold free flight.",
  },
  {
    id: "play_rate",
    label: "Play rate",
    kind: "range",
    value: 1,
    min: 0.25,
    max: 2,
    step: 0.05,
    unit: "×",
    section: "Playback",
  },
  {
    id: "hold_before",
    label: "Hold before",
    kind: "range",
    value: 1.2,
    min: 0,
    max: 6,
    step: 0.05,
    unit: "s",
    section: "Playback",
    tradesAgainst: "Parked on the pad before launch / loop restart — look at the staged vehicle.",
  },
  {
    id: "hold_after",
    label: "Hold after",
    kind: "range",
    value: 1.8,
    min: 0,
    max: 8,
    step: 0.05,
    unit: "s",
    section: "Playback",
    tradesAgainst: "Free-flight tail before loop restarts.",
  },
  {
    id: "rail_sec",
    label: "Rail time",
    kind: "range",
    value: DEFAULT_TUNING.railSec,
    min: 0.1,
    max: 4,
    step: 0.01,
    unit: "s",
    section: "Timing",
    tradesAgainst: "Locked to cradle (ease-in fling). Independent of climb.",
  },
  {
    id: "climb_sec",
    label: "Climb time",
    kind: "range",
    value: DEFAULT_TUNING.climbSec,
    min: 0.1,
    max: 4,
    step: 0.01,
    unit: "s",
    section: "Timing",
    tradesAgainst: "Post-tip loft to cruise (Hermite, path pitch). Independent of rail.",
  },
  {
    id: "slide_dist",
    label: "Slide dist",
    kind: "range",
    value: DEFAULT_TUNING.slideDist,
    min: 0.3,
    max: 4,
    step: 0.05,
    section: "Timing",
    tradesAgainst: "Park → tip along +Z. Longer = more readable rail run.",
  },
  {
    id: "free_speed",
    label: "Free speed",
    kind: "range",
    value: DEFAULT_TUNING.freeSpeed,
    min: 0.4,
    max: 5,
    step: 0.05,
    section: "Timing",
    tradesAgainst: "Steady +Z speed after climb.",
  },
  {
    id: "cruise_y",
    label: "Cruise height",
    kind: "range",
    value: DEFAULT_TUNING.cruiseY,
    min: 0.5,
    max: 8,
    step: 0.05,
    section: "Timing",
    tradesAgainst: "Match scout cruise ≈ 2.5.",
  },
  {
    id: "cam_el_deg",
    label: "Camera elev",
    kind: "range",
    value: 24,
    min: 4,
    max: 72,
    step: 1,
    unit: "°",
    section: "Camera",
  },
  {
    id: "cam_dist",
    label: "Camera dist",
    kind: "range",
    value: 9,
    min: 3,
    max: 28,
    step: 0.1,
    section: "Camera",
  },
  {
    id: "race",
    label: "Wire tint",
    kind: "range",
    value: 0,
    min: 0,
    max: 2,
    step: 1,
    section: "Chrome",
    tradesAgainst: "0 Operators · 1 Blight · 2 Mandate",
  },
  {
    id: "show_hull",
    label: "Black hull",
    kind: "toggle",
    value: 1,
    section: "Chrome",
  },
  {
    id: "show_wire",
    label: "Phosphor wire",
    kind: "toggle",
    value: 1,
    section: "Chrome",
  },
  {
    id: "show_ground",
    label: "Ground grid",
    kind: "toggle",
    value: 1,
    section: "Chrome",
  },
  {
    id: "show_plumes",
    label: "Thruster plumes",
    kind: "toggle",
    value: 1,
    section: "Chrome",
  },
];

function emptyState(): DispatchLabState {
  return { dispatch: DEFAULT_ID, globalNotes: "", cards: {} };
}

function loadState(): DispatchLabState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<DispatchLabState>;
    const id =
      parsed.dispatch && DISPATCHES.some((d) => d.id === parsed.dispatch)
        ? parsed.dispatch
        : DEFAULT_ID;
    return {
      dispatch: id,
      globalNotes: parsed.globalNotes ?? "",
      cards: parsed.cards ?? {},
      levers:
        parsed.levers && typeof parsed.levers === "object" ? parsed.levers : undefined,
    };
  } catch {
    return emptyState();
  }
}

export function initialDispatchId(): string {
  const fromUrl = resolveDispatchId(readLabQuery().dispatch);
  if (fromUrl) return fromUrl;
  return loadState().dispatch;
}

function collectLevers(ctx: LabContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of LEVERS) out[d.id] = ctx.levers.get(d.id);
  return out;
}

function applyStoredLevers(ctx: LabContext, stored?: Record<string, number>) {
  if (!stored) return;
  for (const d of LEVERS) {
    const v = stored[d.id];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    ctx.levers.set(d.id, v, true);
  }
  ctx.refreshPanel();
}

function ensureCard(s: DispatchLabState, id: string): DispatchCardFeedback {
  if (!s.cards[id]) s.cards[id] = { verdict: "", notes: "" };
  return s.cards[id]!;
}

function feedbackTally(
  s: DispatchLabState,
): Record<"keep" | "revise" | "reject", number> {
  const t = { keep: 0, revise: 0, reject: 0 };
  for (const c of Object.values(s.cards)) {
    if (c.verdict === "keep" || c.verdict === "revise" || c.verdict === "reject") {
      t[c.verdict]++;
    }
  }
  return t;
}

function leverDefault(id: string): number {
  return LEVERS.find((d) => d.id === id)?.value ?? 0;
}

/**
 * Timing / playback levers that differ from lab defaults.
 * Values are what the agent should apply; `default` is the shipped baseline.
 */
function collectTimingDiff(
  get: (id: string) => number,
): Record<string, { value: number; default: number; unit?: string }> | null {
  const out: Record<string, { value: number; default: number; unit?: string }> = {};
  for (const id of TIMING_LEVER_IDS) {
    const def = LEVERS.find((d) => d.id === id);
    if (!def) continue;
    const value = get(id);
    const baseline = def.value;
    // tolerant float compare (slider steps)
    if (Math.abs(value - baseline) < 1e-6) continue;
    out[id] = {
      value,
      default: baseline,
      ...(def.unit ? { unit: def.unit } : {}),
    };
  }
  return Object.keys(out).length ? out : null;
}

export function makeDispatchLab(): Lab {
  let view: DispatchViewer | null = null;
  let state = loadState();
  let dispatchId = initialDispatchId();
  let unsub: (() => void) | null = null;
  let labCtx: LabContext | null = null;
  let navEl: HTMLElement | null = null;
  let noteEl: HTMLElement | null = null;
  let phaseEl: HTMLElement | null = null;
  let scrubEl: HTMLInputElement | null = null;
  let scrubNumEl: HTMLInputElement | null = null;
  let scrubLabelEl: HTMLElement | null = null;
  let playBtn: HTMLButtonElement | null = null;
  let feedbackHost: HTMLElement | null = null;
  let exportEl: HTMLPreElement | null = null;
  let globalNotesEl: HTMLTextAreaElement | null = null;

  /** Seconds since launch start. */
  let tSec = 0;
  let playing = true;
  /** User is dragging scrub — don't fight them. */
  let scrubbing = false;

  const raceOf = (ctx: LabContext): RaceId => {
    const i = Math.round(ctx.levers.get("race"));
    return RACE_IDS[Math.min(2, Math.max(0, i))] ?? "operators";
  };

  const readTuning = (ctx: LabContext) => ({
    railSec: ctx.levers.get("rail_sec"),
    climbSec: ctx.levers.get("climb_sec"),
    cruiseY: ctx.levers.get("cruise_y"),
    slideDist: ctx.levers.get("slide_dist"),
    freeSpeed: ctx.levers.get("free_speed"),
  });

  /** Full loop: park hold → rail + climb → free-flight hold. */
  const cycleLen = (ctx: LabContext) => {
    const before = Math.max(0, ctx.levers.get("hold_before"));
    const dur = launchWindowSecFor(dispatchId, readTuning(ctx));
    const after = Math.max(0, ctx.levers.get("hold_after"));
    return before + dur + after;
  };

  /** Time into the launch curve (≤0 = parked). Strips hold_before. */
  const launchClock = (ctx: LabContext, wallT: number) => {
    const before = Math.max(0, ctx.levers.get("hold_before"));
    return wallT - before;
  };

  const saveState = (ctx: LabContext) => {
    state.dispatch = dispatchId;
    state.levers = collectLevers(ctx);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    writeLabQuery({ lab: "dispatch", dispatch: dispatchId });
  };

  /**
   * Compact handoff dump — same shape as mesh lab, plus timing overrides.
   * `todo` = revise/reject or anything with notes; `keep` = silent keeps.
   * `timing` = Playback/Timing levers that differ from lab defaults.
   */
  const buildExport = (): string => {
    const tally = { keep: 0, revise: 0, reject: 0 };
    const todo: Array<{
      id: string;
      label: string;
      verdict: DispatchVerdict;
      notes: string;
      status?: string;
    }> = [];
    const keep: Array<{ id: string; label: string }> = [];

    for (const d of DISPATCHES) {
      const fb = state.cards[d.id];
      if (!fb) continue;
      const notes = fb.notes.trim();
      const v = fb.verdict;
      if (!v && !notes) continue;

      if (v === "keep" || v === "revise" || v === "reject") tally[v]++;

      if (v === "revise" || v === "reject" || notes) {
        todo.push({
          id: d.id,
          label: d.label,
          verdict: v,
          notes,
          ...(d.status !== "ready" ? { status: d.status } : {}),
        });
      } else if (v === "keep") {
        keep.push({ id: d.id, label: d.label });
      }
    }

    // Prefer live lever values; fall back to last saved session levers
    const getTiming = (id: string) => {
      if (labCtx) return labCtx.levers.get(id);
      const stored = state.levers?.[id];
      return typeof stored === "number" ? stored : leverDefault(id);
    };
    const timing = collectTimingDiff(getTiming);
    // Flat map of new values only — easy for agents to apply
    const timingValues = timing
      ? Object.fromEntries(
          Object.entries(timing).map(([k, row]) => [k, row.value]),
        )
      : null;

    const globalNotes = state.globalNotes.trim();
    const active = dispatchById(dispatchId);
    const payload = {
      lab: "dispatch" as const,
      /** Card the session was on when copied — timings usually apply here. */
      active: { id: active.id, label: active.label },
      tally,
      ...(globalNotes ? { globalNotes } : {}),
      ...(todo.length ? { todo } : {}),
      ...(keep.length ? { keep } : {}),
      ...(timingValues
        ? {
            /** Changed Playback/Timing levers only (new values). */
            timing: timingValues,
            /** Same keys with value + default for review. */
            timingDiff: timing,
          }
        : {}),
      at: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  };

  const writeExport = () => {
    if (exportEl) exportEl.textContent = buildExport();
  };

  const applyChrome = (ctx: LabContext) => {
    if (!view) return;
    const race = raceOf(ctx);
    view.setTint(RACES[race].tint);
    view.setShowHull(ctx.levers.bool("show_hull"));
    view.setShowWire(ctx.levers.bool("show_wire"));
    view.setShowGround(ctx.levers.bool("show_ground"));
    view.setShowPlumes(ctx.levers.bool("show_plumes"));
    view.setElev(THREE.MathUtils.degToRad(ctx.levers.get("cam_el_deg")));
    view.setDist(ctx.levers.get("cam_dist"));
    view.setTuning(readTuning(ctx));
    ctx.stat("tint", RACES[race].short);
  };

  const updateScrubUi = (ctx: LabContext) => {
    const len = cycleLen(ctx);
    const before = Math.max(0, ctx.levers.get("hold_before"));
    const frac = len > 1e-6 ? Math.min(1, tSec / len) : 0;
    if (scrubEl && !scrubbing) scrubEl.value = String(frac);
    if (scrubNumEl && document.activeElement !== scrubNumEl) {
      scrubNumEl.value = tSec.toFixed(2);
    }
    if (scrubLabelEl) {
      const parkTag = tSec < before ? " · park hold" : "";
      scrubLabelEl.textContent = `t ${tSec.toFixed(2)}s / ${len.toFixed(2)}s${parkTag}`;
    }
    const pose = view?.getLastPose();
    if (phaseEl) {
      phaseEl.textContent = pose
        ? `phase ${pose.phase} · free ${pose.freeBlend.toFixed(2)} · thr ${pose.throttle.toFixed(2)}`
        : "—";
    }
    if (playBtn) {
      playBtn.textContent = playing ? "Pause" : "Play";
      playBtn.classList.toggle("is-active", playing);
    }
    ctx.stat("t", `${tSec.toFixed(2)}s`);
    ctx.stat("phase", pose?.phase ?? "—");
  };

  const seek = (ctx: LabContext, t: number) => {
    tSec = Math.max(0, t);
    if (!view) return;
    applyChrome(ctx);
    const pose = view.applyTime(launchClock(ctx, tSec));
    updateScrubUi(ctx);
    ctx.stat("z", pose.z.toFixed(2));
  };

  const replay = (ctx: LabContext) => {
    playing = true;
    seek(ctx, 0);
  };

  const paintNav = (ctx: LabContext) => {
    if (!navEl) return;
    navEl.querySelectorAll<HTMLButtonElement>("[data-dispatch]").forEach((btn) => {
      const id = btn.dataset.dispatch ?? "";
      const v = state.cards[id]?.verdict ?? "";
      btn.classList.toggle("is-active", id === dispatchId);
      btn.classList.toggle("is-keep", v === "keep");
      btn.classList.toggle("is-revise", v === "revise");
      btn.classList.toggle("is-reject", v === "reject");
      const badge = btn.querySelector<HTMLElement>(".dispatch-card-badge");
      if (badge) {
        if (v) {
          badge.hidden = false;
          badge.textContent = v[0]!.toUpperCase();
          badge.dataset.verdict = v;
        } else {
          badge.hidden = true;
          badge.textContent = "";
          delete badge.dataset.verdict;
        }
      }
    });
    const def = dispatchById(dispatchId);
    if (noteEl) {
      const tag =
        def.status === "ready" ? "" : def.status === "draft" ? "DRAFT · " : "STUB · ";
      noteEl.textContent = `${tag}${def.note}`;
    }
    ctx.stat("card", def.label);
    ctx.stat("status", def.status);
  };

  const paintFeedback = (ctx: LabContext) => {
    if (!feedbackHost) return;
    feedbackHost.replaceChildren();
    const def = dispatchById(dispatchId);
    const fb = ensureCard(state, dispatchId);

    const vLabel = document.createElement("div");
    vLabel.className = "lab-section-title";
    vLabel.textContent = `Your verdict · ${def.label}`;
    feedbackHost.appendChild(vLabel);

    const vHint = document.createElement("p");
    vHint.className = "lab-hint";
    vHint.textContent =
      "This egress only. keep / revise / reject + notes — Copy feedback diff to hand off.";
    feedbackHost.appendChild(vHint);

    const vRow = document.createElement("div");
    vRow.className = "lab-btn-row";
    for (const v of ["keep", "revise", "reject"] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lab-btn" + (fb.verdict === v ? " is-active" : "");
      btn.textContent = v;
      btn.addEventListener("click", () => {
        fb.verdict = fb.verdict === v ? "" : v;
        saveState(ctx);
        paintFeedback(ctx);
        paintNav(ctx);
        writeExport();
        ctx.stat("verdict", fb.verdict || "—");
      });
      vRow.appendChild(btn);
    }
    feedbackHost.appendChild(vRow);

    const nLabel = document.createElement("label");
    nLabel.className = "lab-hint";
    nLabel.style.display = "block";
    nLabel.style.marginTop = "8px";
    nLabel.textContent = "Notes for this dispatch";
    feedbackHost.appendChild(nLabel);

    const ta = document.createElement("textarea");
    ta.className = "mesh-notes";
    ta.rows = 4;
    ta.placeholder =
      "Rail too soft / free blend pops / park scale off — agent will read this.";
    ta.value = fb.notes;
    ta.addEventListener("input", () => {
      fb.notes = ta.value;
      saveState(ctx);
      writeExport();
      paintNav(ctx);
    });
    feedbackHost.appendChild(ta);

    const tally = feedbackTally(state);
    ctx.stat("verdict", fb.verdict || "—");
    ctx.stat("feedback", `${tally.reject}✗ ${tally.revise}~ ${tally.keep}✓`);
  };

  const loadDispatch = (ctx: LabContext, id: string) => {
    dispatchId = id;
    const def = dispatchById(id);
    view?.setDispatch(def);
    applyChrome(ctx);
    tSec = 0;
    playing = dispatchPlayable(def);
    // Wall t=0 is park hold (launch clock ≤ 0) so staged product is visible first
    if (view) view.applyTime(launchClock(ctx, 0));
    paintNav(ctx);
    paintFeedback(ctx);
    writeExport();
    updateScrubUi(ctx);
    saveState(ctx);
  };

  const loadFromParam = (ctx: LabContext, raw: string): boolean => {
    const id = resolveDispatchId(raw);
    if (!id) {
      ctx.stat("card", `unknown:${raw}`);
      return false;
    }
    loadDispatch(ctx, id);
    return true;
  };

  const mountPanel = (ctx: LabContext) => {
    const root = document.createElement("div");
    root.className = "dispatch-panel";

    const head = document.createElement("div");
    head.className = "lab-section-title";
    head.textContent = "Dispatch";
    root.appendChild(head);

    const hint = document.createElement("p");
    hint.className = "lab-hint";
    hint.textContent =
      "Producer egress. Hold before parks the craft so you can read it; type exact timing in the number boxes.";
    root.appendChild(hint);

    noteEl = document.createElement("p");
    noteEl.className = "lab-hint";
    root.appendChild(noteEl);

    navEl = document.createElement("div");
    navEl.className = "dispatch-nav";
    for (const d of DISPATCHES) {
      const btn = document.createElement("button");
      btn.type = "button";
      const v = state.cards[d.id]?.verdict ?? "";
      btn.className =
        "lab-btn dispatch-card" +
        (d.status === "stub" || d.status === "draft" ? " is-stub" : "") +
        (v ? ` is-${v}` : "");
      btn.dataset.dispatch = d.id;

      const name = document.createElement("span");
      name.className = "dispatch-card-name";
      name.textContent =
        d.status === "ready"
          ? d.label
          : d.status === "draft"
            ? `${d.label} · draft`
            : `${d.label} · stub`;
      btn.appendChild(name);

      const badge = document.createElement("span");
      badge.className = "dispatch-card-badge";
      if (v) {
        badge.textContent = v[0]!.toUpperCase();
        badge.dataset.verdict = v;
      } else {
        badge.hidden = true;
      }
      btn.appendChild(badge);

      btn.addEventListener("click", () => loadDispatch(ctx, d.id));
      navEl.appendChild(btn);
    }
    root.appendChild(navEl);

    const playHead = document.createElement("div");
    playHead.className = "lab-section-title";
    playHead.style.marginTop = "12px";
    playHead.textContent = "Transport";
    root.appendChild(playHead);

    const row = document.createElement("div");
    row.className = "lab-btn-row";

    playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "lab-btn is-active";
    playBtn.textContent = "Pause";
    playBtn.addEventListener("click", () => {
      const def = dispatchById(dispatchId);
      if (!dispatchPlayable(def)) return;
      playing = !playing;
      updateScrubUi(ctx);
    });
    row.appendChild(playBtn);

    const replayBtn = document.createElement("button");
    replayBtn.type = "button";
    replayBtn.className = "lab-btn";
    replayBtn.textContent = "Replay";
    replayBtn.addEventListener("click", () => {
      if (!dispatchPlayable(dispatchById(dispatchId))) return;
      replay(ctx);
    });
    row.appendChild(replayBtn);

    root.appendChild(row);

    const scrubHead = document.createElement("div");
    scrubHead.className = "dispatch-scrub-head";
    scrubHead.style.marginTop = "6px";

    scrubLabelEl = document.createElement("label");
    scrubLabelEl.className = "lab-hint";
    scrubLabelEl.style.margin = "0";
    scrubLabelEl.textContent = "t 0.00s";
    scrubHead.appendChild(scrubLabelEl);

    const scrubNumWrap = document.createElement("span");
    scrubNumWrap.className = "lab-lever-num-wrap";
    scrubNumEl = document.createElement("input");
    scrubNumEl.type = "number";
    scrubNumEl.className = "lab-lever-num";
    scrubNumEl.step = "0.01";
    scrubNumEl.min = "0";
    scrubNumEl.value = "0";
    scrubNumEl.title = "Jump to exact time (seconds)";
    scrubNumEl.addEventListener("change", () => {
      const def = dispatchById(dispatchId);
      if (!dispatchPlayable(def)) return;
      const raw = parseFloat(scrubNumEl!.value);
      if (!Number.isFinite(raw)) {
        updateScrubUi(ctx);
        return;
      }
      playing = false;
      // Allow past cycle end — free-flight keep going for inspection
      seek(ctx, Math.max(0, raw));
    });
    scrubNumEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        scrubNumEl!.dispatchEvent(new Event("change"));
        scrubNumEl!.blur();
      }
    });
    scrubNumWrap.appendChild(scrubNumEl);
    const scrubUnit = document.createElement("span");
    scrubUnit.className = "lab-lever-unit";
    scrubUnit.textContent = "s";
    scrubNumWrap.appendChild(scrubUnit);
    scrubHead.appendChild(scrubNumWrap);
    root.appendChild(scrubHead);

    scrubEl = document.createElement("input");
    scrubEl.type = "range";
    scrubEl.min = "0";
    scrubEl.max = "1";
    scrubEl.step = "0.001";
    scrubEl.value = "0";
    scrubEl.className = "dispatch-scrub";
    scrubEl.addEventListener("pointerdown", () => {
      scrubbing = true;
      playing = false;
    });
    scrubEl.addEventListener("pointerup", () => {
      scrubbing = false;
    });
    scrubEl.addEventListener("pointercancel", () => {
      scrubbing = false;
    });
    scrubEl.addEventListener("input", () => {
      const def = dispatchById(dispatchId);
      if (!dispatchPlayable(def)) return;
      const frac = Number(scrubEl!.value);
      seek(ctx, frac * cycleLen(ctx));
    });
    root.appendChild(scrubEl);

    phaseEl = document.createElement("p");
    phaseEl.className = "lab-hint";
    phaseEl.style.marginTop = "6px";
    root.appendChild(phaseEl);

    // ── Verdict + handoff (same workflow as mesh / concept) ──
    feedbackHost = document.createElement("div");
    feedbackHost.className = "dispatch-feedback";
    feedbackHost.style.marginTop = "12px";
    root.appendChild(feedbackHost);

    const sessTitle = document.createElement("div");
    sessTitle.className = "lab-section-title";
    sessTitle.textContent = "Session notes";
    root.appendChild(sessTitle);

    globalNotesEl = document.createElement("textarea");
    globalNotesEl.className = "mesh-notes";
    globalNotesEl.rows = 2;
    globalNotesEl.placeholder =
      "Rail grammar, free-blend rules, what “good” looks like vs scout…";
    globalNotesEl.value = state.globalNotes;
    globalNotesEl.addEventListener("input", () => {
      state.globalNotes = globalNotesEl!.value;
      saveState(ctx);
      writeExport();
    });
    root.appendChild(globalNotesEl);

    const handTitle = document.createElement("div");
    handTitle.className = "lab-section-title";
    handTitle.textContent = "Handoff";
    root.appendChild(handTitle);

    const handHint = document.createElement("p");
    handHint.className = "lab-hint";
    handHint.textContent =
      "Copy feedback diff → paste in chat. Includes timing overrides (rail_sec, climb_sec, …) vs defaults.";
    root.appendChild(handHint);

    const handRow = document.createElement("div");
    handRow.className = "lab-btn-row";

    const copyFb = document.createElement("button");
    copyFb.type = "button";
    copyFb.className = "lab-btn";
    copyFb.textContent = "Copy feedback diff";
    copyFb.addEventListener("click", async () => {
      const text = buildExport();
      writeExport();
      const ok = await copyText(text);
      if (ok) {
        flashButton(copyFb, "Copied!");
        ctx.stat("export", "copied");
      } else {
        if (exportEl) {
          const range = document.createRange();
          range.selectNodeContents(exportEl);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          exportEl.scrollIntoView({ block: "nearest" });
        }
        flashButton(copyFb, "Select + copy");
        ctx.stat("export", "select+copy");
      }
    });
    handRow.appendChild(copyFb);

    const clearFb = document.createElement("button");
    clearFb.type = "button";
    clearFb.className = "lab-btn";
    clearFb.textContent = "Clear verdicts";
    clearFb.addEventListener("click", () => {
      for (const id of Object.keys(state.cards)) {
        state.cards[id] = {
          verdict: "",
          notes: state.cards[id]?.notes ?? "",
        };
      }
      saveState(ctx);
      paintFeedback(ctx);
      paintNav(ctx);
      writeExport();
    });
    handRow.appendChild(clearFb);
    root.appendChild(handRow);

    exportEl = document.createElement("pre");
    exportEl.className = "lab-export";
    root.appendChild(exportEl);

    ctx.panel.appendChild(root);
  };

  return {
    id: "dispatch",
    title: "Dispatch",
    blurb:
      "Producer launch / egress — Scout Works gold standard, scrub + loop + feedback JSON.",
    levers: LEVERS,
    setup(ctx) {
      labCtx = ctx;
      state = loadState();
      dispatchId = initialDispatchId();
      applyStoredLevers(ctx, state.levers);

      view = new DispatchViewer({ container: ctx.viewport });
      mountPanel(ctx);
      loadDispatch(ctx, dispatchId);
      applyChrome(ctx);

      unsub = ctx.levers.onChange((id) => {
        if (!view || !labCtx) return;
        if (
          id === "rail_sec" ||
          id === "climb_sec" ||
          id === "slide_dist" ||
          id === "free_speed" ||
          id === "cruise_y" ||
          id === "hold_before" ||
          id === "hold_after"
        ) {
          applyChrome(labCtx);
          // Re-eval pose at current wall clock with new timing
          view.applyTime(launchClock(labCtx, tSec));
          updateScrubUi(labCtx);
        } else {
          applyChrome(labCtx);
        }
        saveState(labCtx);
        // Keep handoff JSON live as timing sliders move
        writeExport();
      });

      liveHandle = {
        load: (raw) => (labCtx ? loadFromParam(labCtx, raw) : false),
        current: () => dispatchId,
        replay: () => {
          if (labCtx) replay(labCtx);
        },
        list: () => listDispatchCatalog(),
        exportFeedback: () => buildExport(),
      };

      ctx.stat("lab", "Dispatch");
    },
    tick(dt, ctx) {
      if (!view) return;
      const def = dispatchById(dispatchId);
      if (dispatchPlayable(def) && playing && !scrubbing) {
        const rate = ctx.levers.get("play_rate");
        tSec += dt * rate;
        const len = cycleLen(ctx);
        if (tSec >= len) {
          if (ctx.levers.bool("auto_loop")) {
            // Restart at park hold so you can read the staged vehicle again
            tSec = 0;
          } else {
            tSec = len;
            playing = false;
          }
        }
        view.setTuning(readTuning(ctx));
        view.applyTime(launchClock(ctx, tSec));
        updateScrubUi(ctx);
      }
      view.tick(dt);
    },
    teardown(ctx) {
      unsub?.();
      unsub = null;
      liveHandle = null;
      labCtx = null;
      view?.dispose();
      view = null;
      navEl = null;
      noteEl = null;
      phaseEl = null;
      scrubEl = null;
      scrubNumEl = null;
      scrubLabelEl = null;
      playBtn = null;
      feedbackHost = null;
      exportEl = null;
      globalNotesEl = null;
      ctx.panel.replaceChildren();
      ctx.viewport.replaceChildren();
    },
  };
}
