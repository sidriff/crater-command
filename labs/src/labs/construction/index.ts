/**
 * Construction lab — building CRT assemble + unit egress.
 *
 * Layout: left catalog (thumbs) · full stage · right levers/feedback.
 *
 *   /?lab=construction&card=b:depot
 *   /?lab=construction&card=u:scout
 *   Legacy: /?lab=dispatch&dispatch=scout_works
 *
 *   ccLabs.openConstruction("b:depot") · openConstruction("u:scout")
 *   ccLabs.constructionFeedback()
 */
import * as THREE from "three";
import { RACES } from "@game/sim/defs";
import type { RaceId } from "@game/sim/types";
import { copyText, flashButton } from "../../copy";
import type { Lab, LabContext } from "../../lab";
import type { LeverDef } from "../../levers";
import { readLabQuery, writeLabQuery } from "../../query";
import {
  CARDS,
  cardById,
  cardPlayable,
  cardsBySection,
  launchKeyFor,
  listConstructionCatalog,
  resolveCardId,
  type CardMode,
  type ConstructionCard,
} from "./catalog";
import { DEFAULT_CONSTRUCT, constructWindowSec } from "./construct";
import { DEFAULT_TUNING, launchWindowSecFor } from "./launch";
import { bakeConstructionThumbs, type ConstructionThumbMap } from "./thumbs";
import { ConstructionViewer } from "./viewer";

const RACE_IDS: RaceId[] = ["operators", "blight", "mandate"];
const STORAGE_KEY = "crater-labs:construction";
const LEGACY_STORAGE_KEY = "crater-labs:dispatch";
const DEFAULT_ID = "u:scout";

export type ConstructionVerdict = "keep" | "revise" | "reject" | "";

type CardFeedback = {
  verdict: ConstructionVerdict;
  notes: string;
};

type ConstructionLabState = {
  card: string;
  globalNotes: string;
  cards: Record<string, CardFeedback>;
  levers?: Record<string, number>;
};

export type ConstructionLabHandle = {
  load(raw: string): boolean;
  current(): string;
  mode(): CardMode;
  replay(): void;
  list(): ReturnType<typeof listConstructionCatalog>;
  exportFeedback(): string;
};

let liveHandle: ConstructionLabHandle | null = null;

export function getConstructionLabHandle(): ConstructionLabHandle | null {
  return liveHandle;
}

/** @deprecated */
export function getDispatchLabHandle(): ConstructionLabHandle | null {
  return liveHandle;
}

export {
  listConstructionCatalog,
  listDispatchCatalog,
  resolveCardId,
  resolveDispatchId,
  CARDS,
  DISPATCHES,
} from "./catalog";

const TIMING_LEVER_IDS = [
  "auto_loop",
  "play_rate",
  "hold_before",
  "hold_after",
  "construct_dur",
  "crt_seed",
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
    tradesAgainst: "Off = one-shot then hold end pose.",
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
    value: 0.8,
    min: 0,
    max: 6,
    step: 0.05,
    unit: "s",
    section: "Playback",
    tradesAgainst: "Scaffold-only / parked product before work starts.",
  },
  {
    id: "hold_after",
    label: "Hold after",
    kind: "range",
    value: 1.2,
    min: 0,
    max: 8,
    step: 0.05,
    unit: "s",
    section: "Playback",
    tradesAgainst: "Finished building / free-flight tail before loop.",
  },
  {
    id: "construct_dur",
    label: "Construct dur",
    kind: "range",
    value: DEFAULT_CONSTRUCT.constructDur,
    min: 0.5,
    max: 40,
    step: 0.1,
    unit: "s",
    section: "Construct",
    tradesAgainst: "Buildings only. Progress 0→1. Match buildTime is a good start.",
  },
  {
    id: "crt_seed",
    label: "CRT seed",
    kind: "range",
    value: DEFAULT_CONSTRUCT.seed,
    min: 0,
    max: 20,
    step: 0.1,
    section: "Construct",
    tradesAgainst: "Flicker seed (deterministic scrub).",
  },
  {
    id: "show_scaffold",
    label: "Scaffold",
    kind: "toggle",
    value: 1,
    section: "Construct",
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
    section: "Egress",
    tradesAgainst: "Units only: locked to cradle / roll / lift.",
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
    section: "Egress",
    tradesAgainst: "Units only: loft / settle / push after tip.",
  },
  {
    id: "slide_dist",
    label: "Slide dist",
    kind: "range",
    value: DEFAULT_TUNING.slideDist,
    min: 0.3,
    max: 4,
    step: 0.05,
    section: "Egress",
  },
  {
    id: "free_speed",
    label: "Free speed",
    kind: "range",
    value: DEFAULT_TUNING.freeSpeed,
    min: 0.4,
    max: 5,
    step: 0.05,
    section: "Egress",
  },
  {
    id: "cruise_y",
    label: "Cruise height",
    kind: "range",
    value: DEFAULT_TUNING.cruiseY,
    min: 0.5,
    max: 8,
    step: 0.05,
    section: "Egress",
  },
  {
    id: "cam_el_deg",
    label: "Camera elev",
    kind: "range",
    value: 28,
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
    label: "Plumes",
    kind: "toggle",
    value: 1,
    section: "Chrome",
  },
];

function leverDefault(id: string): number {
  return LEVERS.find((d) => d.id === id)?.value ?? 0;
}

function collectLevers(ctx: LabContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of LEVERS) out[d.id] = ctx.levers.get(d.id);
  return out;
}

function applyStoredLevers(ctx: LabContext, stored?: Record<string, number>) {
  if (!stored) return;
  for (const [id, v] of Object.entries(stored)) {
    if (id === "mode") continue; // retired
    if (typeof v === "number" && Number.isFinite(v)) {
      try {
        ctx.levers.set(id, v, true);
      } catch {
        /* unknown lever */
      }
    }
  }
  ctx.refreshPanel();
}

function emptyState(): ConstructionLabState {
  return { card: DEFAULT_ID, globalNotes: "", cards: {} };
}

function loadState(): ConstructionLabState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ConstructionLabState> & {
      dispatch?: string;
    };
    const idRaw = parsed.card ?? parsed.dispatch;
    const resolved = idRaw ? resolveCardId(idRaw) : null;
    const id =
      resolved && CARDS.some((d) => d.id === resolved) ? resolved : DEFAULT_ID;
    return {
      card: id,
      globalNotes: typeof parsed.globalNotes === "string" ? parsed.globalNotes : "",
      cards: parsed.cards && typeof parsed.cards === "object" ? parsed.cards : {},
      levers: parsed.levers,
    };
  } catch {
    return emptyState();
  }
}

export function initialCardId(): string {
  const q = readLabQuery();
  const fromUrl = resolveCardId(q.card ?? q.dispatch);
  if (fromUrl) return fromUrl;
  return loadState().card;
}

function ensureCard(s: ConstructionLabState, id: string): CardFeedback {
  if (!s.cards[id]) s.cards[id] = { verdict: "", notes: "" };
  return s.cards[id]!;
}

function feedbackTally(s: ConstructionLabState) {
  const tally = { keep: 0, revise: 0, reject: 0 };
  for (const fb of Object.values(s.cards)) {
    if (fb.verdict === "keep" || fb.verdict === "revise" || fb.verdict === "reject") {
      tally[fb.verdict]++;
    }
  }
  return tally;
}

function collectTimingDiff(
  get: (id: string) => number,
): Record<string, { value: number; default: number; unit?: string }> | null {
  const out: Record<string, { value: number; default: number; unit?: string }> = {};
  for (const id of TIMING_LEVER_IDS) {
    const def = LEVERS.find((d) => d.id === id);
    if (!def) continue;
    const value = get(id);
    const baseline = def.value;
    if (Math.abs(value - baseline) < 1e-6) continue;
    out[id] = {
      value,
      default: baseline,
      ...(def.unit ? { unit: def.unit } : {}),
    };
  }
  return Object.keys(out).length ? out : null;
}

export function makeConstructionLab(): Lab {
  let view: ConstructionViewer | null = null;
  let state = loadState();
  let cardId = initialCardId();
  let unsub: (() => void) | null = null;
  let labCtx: LabContext | null = null;
  let shellEl: HTMLElement | null = null;
  let navEl: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let noteEl: HTMLElement | null = null;
  let idEl: HTMLElement | null = null;
  let phaseEl: HTMLElement | null = null;
  let scrubEl: HTMLInputElement | null = null;
  let scrubNumEl: HTMLInputElement | null = null;
  let scrubLabelEl: HTMLElement | null = null;
  let playBtn: HTMLButtonElement | null = null;
  let feedbackHost: HTMLElement | null = null;
  let exportEl: HTMLPreElement | null = null;
  let globalNotesEl: HTMLTextAreaElement | null = null;
  let thumbs: ConstructionThumbMap = {};

  let tSec = 0;
  let playing = true;
  let scrubbing = false;

  const raceOf = (ctx: LabContext): RaceId => {
    const i = Math.round(ctx.levers.get("race"));
    return RACE_IDS[Math.min(2, Math.max(0, i))] ?? "operators";
  };

  const activeMode = (): CardMode => cardById(cardId).mode;

  const readLaunchTuning = (ctx: LabContext) => ({
    railSec: ctx.levers.get("rail_sec"),
    climbSec: ctx.levers.get("climb_sec"),
    cruiseY: ctx.levers.get("cruise_y"),
    slideDist: ctx.levers.get("slide_dist"),
    freeSpeed: ctx.levers.get("free_speed"),
  });

  const readConstructTuning = (ctx: LabContext) => ({
    constructDur: ctx.levers.get("construct_dur"),
    seed: ctx.levers.get("crt_seed"),
  });

  const workWindow = (ctx: LabContext) => {
    const def = cardById(cardId);
    if (def.mode === "construct") {
      return constructWindowSec(readConstructTuning(ctx));
    }
    return launchWindowSecFor(launchKeyFor(def), readLaunchTuning(ctx));
  };

  const cycleLen = (ctx: LabContext) => {
    const before = Math.max(0, ctx.levers.get("hold_before"));
    const after = Math.max(0, ctx.levers.get("hold_after"));
    return before + workWindow(ctx) + after;
  };

  const workClock = (ctx: LabContext, wallT: number) => {
    const before = Math.max(0, ctx.levers.get("hold_before"));
    return wallT - before;
  };

  const saveState = (ctx: LabContext) => {
    state.card = cardId;
    state.levers = collectLevers(ctx);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    writeLabQuery({
      lab: "construction",
      card: cardId,
      mode: activeMode(),
      dispatch: null,
    });
  };

  const buildExport = (): string => {
    const tally = { keep: 0, revise: 0, reject: 0 };
    const todo: Array<{
      id: string;
      label: string;
      verdict: ConstructionVerdict;
      notes: string;
      status?: string;
      section?: string;
    }> = [];
    const keep: Array<{ id: string; label: string }> = [];

    for (const d of CARDS) {
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
          section: d.section,
          ...(d.status !== "ready" ? { status: d.status } : {}),
        });
      } else if (v === "keep") {
        keep.push({ id: d.id, label: d.label });
      }
    }

    const getTiming = (id: string) => {
      if (labCtx) return labCtx.levers.get(id);
      const stored = state.levers?.[id];
      return typeof stored === "number" ? stored : leverDefault(id);
    };
    const timing = collectTimingDiff(getTiming);
    const timingValues = timing
      ? Object.fromEntries(Object.entries(timing).map(([k, row]) => [k, row.value]))
      : null;

    const globalNotes = state.globalNotes.trim();
    const active = cardById(cardId);
    const payload = {
      lab: "construction" as const,
      active: {
        id: active.id,
        label: active.label,
        section: active.section,
        mode: active.mode,
        building: active.building,
        ...(active.product ? { product: active.product } : {}),
      },
      tally,
      ...(globalNotes ? { globalNotes } : {}),
      ...(todo.length ? { todo } : {}),
      ...(keep.length ? { keep } : {}),
      ...(timingValues
        ? {
            timing: timingValues,
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
    view.setShowScaffold(ctx.levers.bool("show_scaffold"));
    view.setElev(THREE.MathUtils.degToRad(ctx.levers.get("cam_el_deg")));
    view.setDist(ctx.levers.get("cam_dist"));
    view.setLaunchTuning(readLaunchTuning(ctx));
    view.setConstructTuning(readConstructTuning(ctx));
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
      const parkTag = tSec < before ? " · hold" : "";
      scrubLabelEl.textContent = `t ${tSec.toFixed(2)}s / ${len.toFixed(2)}s${parkTag}`;
    }
    const pose = view?.getLastPose();
    const con = view?.getLastConstruct();
    if (phaseEl) {
      if (con) {
        phaseEl.textContent = `phase ${con.phase} · prog ${con.progress.toFixed(2)} · parts ${con.parts.filter((p) => p.phase > 0).length}/${con.parts.length || "solid"}`;
      } else if (pose) {
        phaseEl.textContent = `phase ${pose.phase} · free ${pose.freeBlend.toFixed(2)} · thr ${pose.throttle.toFixed(2)}`;
      } else {
        phaseEl.textContent = "—";
      }
    }
    if (playBtn) {
      playBtn.textContent = playing ? "Pause" : "Play";
      playBtn.classList.toggle("is-active", playing);
    }
    ctx.stat("t", `${tSec.toFixed(2)}s`);
    ctx.stat("phase", con?.phase ?? pose?.phase ?? "—");
    ctx.stat("mode", activeMode());
  };

  const seek = (ctx: LabContext, t: number) => {
    tSec = Math.max(0, t);
    if (!view) return;
    applyChrome(ctx);
    view.applyTime(workClock(ctx, tSec));
    updateScrubUi(ctx);
  };

  const replay = (ctx: LabContext) => {
    playing = true;
    seek(ctx, 0);
  };

  const paintNavActive = () => {
    if (!navEl) return;
    navEl.querySelectorAll<HTMLButtonElement>("[data-card]").forEach((btn) => {
      const id = btn.dataset.card ?? "";
      const v = state.cards[id]?.verdict ?? "";
      btn.classList.toggle("is-active", id === cardId);
      btn.classList.toggle("is-keep", v === "keep");
      btn.classList.toggle("is-revise", v === "revise");
      btn.classList.toggle("is-reject", v === "reject");
      const badge = btn.querySelector<HTMLElement>(".mesh-card-badge");
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
  };

  const paintCardMeta = (ctx: LabContext) => {
    const def = cardById(cardId);
    if (idEl) {
      idEl.textContent = `${def.id} · ${def.section} · ${def.mode}`;
    }
    if (noteEl) {
      const tag =
        def.status === "ready" ? "" : def.status === "draft" ? "DRAFT · " : "STUB · ";
      noteEl.textContent = `${tag}${def.note}`;
    }
    ctx.stat("card", def.label);
    ctx.stat("status", def.status);
    ctx.stat("section", def.section);
  };

  const paintFeedback = (ctx: LabContext) => {
    if (!feedbackHost) return;
    feedbackHost.replaceChildren();
    const def = cardById(cardId);
    const fb = ensureCard(state, cardId);

    const vLabel = document.createElement("div");
    vLabel.className = "lab-section-title";
    vLabel.textContent = `Your verdict · ${def.label}`;
    feedbackHost.appendChild(vLabel);

    const vHint = document.createElement("p");
    vHint.className = "lab-hint";
    vHint.textContent =
      def.mode === "construct"
        ? "Building assemble only. keep / revise / reject + notes."
        : "Unit egress only. keep / revise / reject + notes.";
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
        paintNavActive();
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
    nLabel.textContent = "Notes for this card";
    feedbackHost.appendChild(nLabel);

    const ta = document.createElement("textarea");
    ta.className = "mesh-notes";
    ta.rows = 4;
    ta.placeholder =
      def.mode === "construct"
        ? "Part order wrong / scaffold late / kit flicker harsh…"
        : "Rail soft / free blend pops / park scale off…";
    ta.value = fb.notes;
    ta.addEventListener("input", () => {
      fb.notes = ta.value;
      saveState(ctx);
      writeExport();
      paintNavActive();
    });
    feedbackHost.appendChild(ta);

    const tally = feedbackTally(state);
    ctx.stat("verdict", fb.verdict || "—");
    ctx.stat("feedback", `${tally.reject}✗ ${tally.revise}~ ${tally.keep}✓`);
  };

  const loadCard = (ctx: LabContext, id: string) => {
    cardId = id;
    const def = cardById(id);

    if (def.mode === "construct" && def.buildTime > 0) {
      const curDur = ctx.levers.get("construct_dur");
      if (Math.abs(curDur - DEFAULT_CONSTRUCT.constructDur) < 0.05) {
        ctx.levers.set("construct_dur", def.buildTime, true);
        ctx.refreshPanel();
      }
    }

    view?.setCard(def, def.mode);
    applyChrome(ctx);
    tSec = 0;
    playing = cardPlayable(def);
    if (view) view.applyTime(workClock(ctx, 0));
    paintNavActive();
    paintCardMeta(ctx);
    paintFeedback(ctx);
    saveState(ctx);
    writeExport();
    updateScrubUi(ctx);
  };

  const loadFromParam = (ctx: LabContext, raw: string) => {
    const id = resolveCardId(raw);
    if (!id) return false;
    loadCard(ctx, id);
    return true;
  };

  /** Left catalog — Buildings then Units, mesh-style thumb cards. */
  const mountNav = (ctx: LabContext) => {
    if (!navEl) return;
    navEl.replaceChildren();

    const head = document.createElement("div");
    head.className = "lab-section-title";
    head.textContent = "Catalog";
    navEl.appendChild(head);

    const hint = document.createElement("p");
    hint.className = "lab-hint";
    hint.textContent =
      "Buildings = CRT assemble · Units = egress. Thumbs bake on open.";
    navEl.appendChild(hint);

    idEl = document.createElement("p");
    idEl.className = "lab-hint lab-mesh-id";
    navEl.appendChild(idEl);

    noteEl = document.createElement("p");
    noteEl.className = "lab-hint";
    navEl.appendChild(noteEl);

    const appendCard = (host: HTMLElement, c: ConstructionCard) => {
      const fb = state.cards[c.id];
      const v = fb?.verdict ?? "";
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "mesh-card" +
        (c.id === cardId ? " is-active" : "") +
        (c.status === "draft" || c.status === "stub" ? " is-stub" : "") +
        (v ? ` is-${v}` : "");
      card.dataset.card = c.id;
      card.title = c.note ? `${c.id} — ${c.note}` : c.id;

      const thumb = thumbs[c.id];
      if (thumb) {
        const img = document.createElement("img");
        img.className = "mesh-card-thumb";
        img.src = thumb;
        img.alt = "";
        img.draggable = false;
        card.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "mesh-card-ph";
        ph.textContent = "—";
        card.appendChild(ph);
      }

      const row = document.createElement("div");
      row.className = "mesh-card-row";

      const name = document.createElement("span");
      name.className = "mesh-card-name";
      name.textContent = c.label;
      row.appendChild(name);

      const badge = document.createElement("span");
      badge.className = "mesh-card-badge";
      if (v) {
        badge.textContent = v[0]!.toUpperCase();
        badge.dataset.verdict = v;
      } else {
        badge.hidden = true;
      }
      row.appendChild(badge);
      card.appendChild(row);

      card.addEventListener("click", () => loadCard(ctx, c.id));
      host.appendChild(card);
    };

    for (const group of cardsBySection()) {
      const fac = document.createElement("div");
      fac.className = "mesh-faction";
      fac.dataset.section = group.section;

      const facHead = document.createElement("div");
      facHead.className = "mesh-faction-head";
      facHead.textContent = group.label;
      fac.appendChild(facHead);

      const grid = document.createElement("div");
      grid.className = "mesh-card-grid";
      for (const c of group.cards) appendCard(grid, c);
      fac.appendChild(grid);
      navEl.appendChild(fac);
    }
  };

  /** Right panel — transport + verdict + handoff (levers above in shell). */
  const mountUi = (ctx: LabContext) => {
    ctx.panel.replaceChildren();
    const root = document.createElement("div");
    root.className = "construction-panel";
    ctx.panel.appendChild(root);

    const hint = document.createElement("p");
    hint.className = "lab-hint";
    hint.textContent =
      "Left: buildings (assemble) · units (egress). Scrub + loop. Type exact timing in number boxes.";
    root.appendChild(hint);

    const playHead = document.createElement("div");
    playHead.className = "lab-section-title";
    playHead.textContent = "Transport";
    root.appendChild(playHead);

    const row = document.createElement("div");
    row.className = "lab-btn-row";

    playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "lab-btn is-active";
    playBtn.textContent = "Pause";
    playBtn.addEventListener("click", () => {
      if (!cardPlayable(cardById(cardId))) return;
      playing = !playing;
      updateScrubUi(ctx);
    });
    row.appendChild(playBtn);

    const replayBtn = document.createElement("button");
    replayBtn.type = "button";
    replayBtn.className = "lab-btn";
    replayBtn.textContent = "Replay";
    replayBtn.addEventListener("click", () => {
      if (!cardPlayable(cardById(cardId))) return;
      replay(ctx);
    });
    row.appendChild(replayBtn);
    root.appendChild(row);

    const scrubHead = document.createElement("div");
    scrubHead.className = "construction-scrub-head";
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
      if (!cardPlayable(cardById(cardId))) return;
      const raw = parseFloat(scrubNumEl!.value);
      if (!Number.isFinite(raw)) {
        updateScrubUi(ctx);
        return;
      }
      playing = false;
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
    scrubEl.className = "construction-scrub";
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
      if (!cardPlayable(cardById(cardId))) return;
      seek(ctx, Number(scrubEl!.value) * cycleLen(ctx));
    });
    root.appendChild(scrubEl);

    phaseEl = document.createElement("p");
    phaseEl.className = "lab-hint";
    phaseEl.style.marginTop = "6px";
    root.appendChild(phaseEl);

    feedbackHost = document.createElement("div");
    feedbackHost.className = "construction-feedback";
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
      "Kit order, scaffold timing, egress grammar…";
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
      "Copy feedback diff → paste in chat. Includes timing overrides vs defaults.";
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
        }
        flashButton(copyFb, "Select & copy");
      }
    });
    handRow.appendChild(copyFb);
    root.appendChild(handRow);

    exportEl = document.createElement("pre");
    exportEl.className = "lab-export";
    root.appendChild(exportEl);
  };

  return {
    id: "construction",
    title: "Construction",
    blurb:
      "Left catalog (buildings assemble · units egress) · scrub · feedback JSON.",
    levers: LEVERS,
    setup(ctx) {
      labCtx = ctx;
      state = loadState();
      cardId = initialCardId();
      applyStoredLevers(ctx, state.levers);

      thumbs = bakeConstructionThumbs();
      ctx.stat("thumbs", `${Object.keys(thumbs).length}`);

      ctx.viewport.replaceChildren();
      shellEl = document.createElement("div");
      shellEl.className = "construction-shell";

      navEl = document.createElement("nav");
      navEl.className = "mesh-nav";
      navEl.setAttribute("aria-label", "Construction catalog");

      stageEl = document.createElement("div");
      stageEl.className = "construction-stage";

      shellEl.append(navEl, stageEl);
      ctx.viewport.appendChild(shellEl);

      view = new ConstructionViewer({ container: stageEl });
      mountNav(ctx);
      mountUi(ctx);
      loadCard(ctx, cardId);
      applyChrome(ctx);

      unsub = ctx.levers.onChange((id) => {
        if (!view || !labCtx) return;
        if (
          id === "construct_dur" ||
          id === "crt_seed" ||
          id === "rail_sec" ||
          id === "climb_sec" ||
          id === "slide_dist" ||
          id === "free_speed" ||
          id === "cruise_y" ||
          id === "hold_before" ||
          id === "hold_after" ||
          id === "show_scaffold"
        ) {
          applyChrome(labCtx);
          view.applyTime(workClock(labCtx, tSec));
          updateScrubUi(labCtx);
        } else {
          applyChrome(labCtx);
        }
        saveState(labCtx);
        writeExport();
      });

      liveHandle = {
        load: (raw) => (labCtx ? loadFromParam(labCtx, raw) : false),
        current: () => cardId,
        mode: () => activeMode(),
        replay: () => {
          if (labCtx) replay(labCtx);
        },
        list: () => listConstructionCatalog(),
        exportFeedback: () => buildExport(),
      };

      ctx.stat("lab", "Construction");
    },
    tick(dt, ctx) {
      if (!view) return;
      const def = cardById(cardId);
      if (cardPlayable(def) && playing && !scrubbing) {
        const rate = ctx.levers.get("play_rate");
        tSec += dt * rate;
        const len = cycleLen(ctx);
        if (tSec >= len) {
          if (ctx.levers.bool("auto_loop")) {
            tSec = 0;
          } else {
            tSec = len;
            playing = false;
          }
        }
        view.setLaunchTuning(readLaunchTuning(ctx));
        view.setConstructTuning(readConstructTuning(ctx));
        view.applyTime(workClock(ctx, tSec));
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
      thumbs = {};
      shellEl = null;
      navEl = null;
      stageEl = null;
      noteEl = null;
      idEl = null;
      phaseEl = null;
      scrubEl = null;
      scrubNumEl = null;
      scrubLabelEl = null;
      playBtn = null;
      feedbackHost = null;
      exportEl = null;
      globalNotesEl = null;
      ctx.viewport.replaceChildren();
      ctx.panel.replaceChildren();
    },
  };
}

/** @deprecated alias */
export const makeDispatchLab = makeConstructionLab;
