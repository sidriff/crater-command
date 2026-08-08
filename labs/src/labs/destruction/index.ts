/**
 * Destruction lab — combat death theater on isolated catalog meshes.
 * Pipeline: wound (micro pops + 1–2 solid chips) → boom → wire shatter + scar.
 *
 * Deep links:
 *   /?lab=destruction&destruction=u:scout
 *   /?lab=destruction&destruction=scout
 *   Legacy: /?lab=death&death=u:scout
 *   ccLabs.openDestruction("u:scout") · destructionFeedback()
 *   Aliases: openDeath · deathFeedback
 */
import * as THREE from "three";
import { RACES } from "@game/sim/defs";
import type { RaceId } from "@game/sim/types";
import { copyText, flashButton } from "../../copy";
import type { Lab, LabContext } from "../../lab";
import type { LeverDef } from "../../levers";
import { readLabQuery, writeLabQuery } from "../../query";
import {
  MESHES,
  createPacks,
  disposePacks,
  listMeshCatalog,
  meshById,
  resolveMeshId,
  factionMeshesGrouped,
  type MeshPacks,
} from "../mesh/catalog";
import { bakeMeshThumbs, type MeshThumbMap } from "../mesh/thumbs";
import { MeshViewer } from "../mesh/viewer";

const RACE_IDS: RaceId[] = ["operators", "blight", "mandate"];
const STORAGE_KEY = "crater-labs:destruction";
const LEGACY_STORAGE_KEY = "crater-labs:death";
const DEFAULT_MESH = "u:scout";

export type DestructionVerdict = "keep" | "revise" | "reject" | "";

type DestructionCardFeedback = {
  verdict: DestructionVerdict;
  notes: string;
};

type DestructionLabState = {
  mesh: string;
  globalNotes: string;
  cards: Record<string, DestructionCardFeedback>;
  levers?: Record<string, number>;
};

export type DestructionLabHandle = {
  load(raw: string): boolean;
  current(): string;
  play(): void;
  stop(): void;
  exportFeedback(): string;
};

let liveHandle: DestructionLabHandle | null = null;

export function getDestructionLabHandle(): DestructionLabHandle | null {
  return liveHandle;
}

export {
  listMeshCatalog as listDestructionCatalog,
  listMeshCatalog as listDeathCatalog,
  resolveMeshId as resolveDestructionId,
  resolveMeshId as resolveDeathId,
};

const AIR_MESH_IDS = new Set([
  "u:scout",
  "u:flyer",
  "u:interceptor",
  "u:bomber",
]);

const LEVERS: LeverDef[] = [
  {
    id: "death_air",
    label: "Air tumble",
    kind: "toggle",
    value: 0,
    section: "Destruction",
    tradesAgainst: "ON = vacuum tumble during wound. Auto-on for air unit ids.",
  },
  {
    id: "death_tier",
    label: "Tier",
    kind: "range",
    value: 1,
    min: 0,
    max: 2,
    step: 1,
    section: "Destruction",
    tradesAgainst: "0 light · 1 medium · 2 heavy (timing + shard count).",
  },
  {
    id: "death_speed",
    label: "Speed",
    kind: "range",
    value: 1,
    min: 0.25,
    max: 2.5,
    step: 0.05,
    unit: "×",
    section: "Destruction",
  },
  {
    id: "death_loop",
    label: "Loop",
    kind: "toggle",
    value: 0,
    section: "Destruction",
    tradesAgainst: "Replay after scar hold. Off = restore mesh once.",
  },
  {
    id: "auto_spin",
    label: "Auto spin",
    kind: "toggle",
    value: 1,
    section: "Camera",
    tradesAgainst: "Off while scrubbing silhouette; death always freezes spin.",
  },
  {
    id: "spin_rate",
    label: "Spin rate",
    kind: "range",
    value: 20,
    min: 0,
    max: 90,
    step: 1,
    unit: "°/s",
    section: "Camera",
  },
  {
    id: "cam_el_deg",
    label: "Camera elev",
    kind: "range",
    value: 28,
    min: 4,
    max: 82,
    step: 1,
    unit: "°",
    section: "Camera",
  },
  {
    id: "cam_dist",
    label: "Camera dist",
    kind: "range",
    value: 6,
    min: 1.5,
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
];

function deathTierOf(v: number): "light" | "medium" | "heavy" {
  if (v <= 0) return "light";
  if (v >= 2) return "heavy";
  return "medium";
}

function defaultDeathAir(meshId: string): boolean {
  return AIR_MESH_IDS.has(meshId);
}

function emptyState(): DestructionLabState {
  return { mesh: DEFAULT_MESH, globalNotes: "", cards: {} };
}

function loadState(): DestructionLabState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<DestructionLabState>;
    const mesh =
      parsed.mesh && MESHES.some((m) => m.id === parsed.mesh)
        ? parsed.mesh
        : DEFAULT_MESH;
    return {
      mesh,
      globalNotes: parsed.globalNotes ?? "",
      cards: parsed.cards ?? {},
      levers:
        parsed.levers && typeof parsed.levers === "object" ? parsed.levers : undefined,
    };
  } catch {
    return emptyState();
  }
}

export function initialDestructionMeshId(): string {
  const q = readLabQuery();
  const fromUrl = resolveMeshId(q.destruction ?? q.death ?? q.mesh);
  if (fromUrl) return fromUrl;
  return loadState().mesh;
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

function ensureCard(s: DestructionLabState, id: string): DestructionCardFeedback {
  if (!s.cards[id]) s.cards[id] = { verdict: "", notes: "" };
  return s.cards[id]!;
}

function feedbackTally(
  s: DestructionLabState,
): Record<"keep" | "revise" | "reject", number> {
  const t = { keep: 0, revise: 0, reject: 0 };
  for (const c of Object.values(s.cards)) {
    if (c.verdict === "keep" || c.verdict === "revise" || c.verdict === "reject") {
      t[c.verdict]++;
    }
  }
  return t;
}

export function makeDestructionLab(): Lab {
  let view: MeshViewer | null = null;
  let packs: MeshPacks | null = null;
  let state = loadState();
  let meshId = initialDestructionMeshId();
  let unsub: (() => void) | null = null;
  let labCtx: LabContext | null = null;
  let shellEl: HTMLElement | null = null;
  let navEl: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let noteEl: HTMLElement | null = null;
  let idEl: HTMLElement | null = null;
  let playBtn: HTMLButtonElement | null = null;
  let feedbackHost: HTMLElement | null = null;
  let exportEl: HTMLPreElement | null = null;
  let globalNotesEl: HTMLTextAreaElement | null = null;
  let thumbs: MeshThumbMap = {};
  let perfHudLines: {
    fps: HTMLElement;
    mesh: HTMLElement;
    death: HTMLElement;
    draw: HTMLElement;
  } | null = null;
  let hudAcc = 0;
  let hudFrames = 0;
  let hudFps = 0;
  let lastDeathPhase = "";

  const raceOf = (ctx: LabContext): RaceId => {
    const i = Math.round(ctx.levers.get("race"));
    return RACE_IDS[Math.min(2, Math.max(0, i))] ?? "operators";
  };

  const saveState = (ctx: LabContext) => {
    state.mesh = meshId;
    state.levers = collectLevers(ctx);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    writeLabQuery({
      lab: "destruction",
      destruction: meshId,
      death: null,
    });
  };

  const buildExport = (): string => {
    const tally = { keep: 0, revise: 0, reject: 0 };
    const todo: Array<{
      id: string;
      label: string;
      verdict: DestructionVerdict;
      notes: string;
    }> = [];
    const keep: Array<{ id: string; label: string }> = [];

    for (const m of MESHES) {
      const fb = state.cards[m.id];
      if (!fb) continue;
      const notes = fb.notes.trim();
      const v = fb.verdict;
      if (!v && !notes) continue;
      if (v === "keep" || v === "revise" || v === "reject") tally[v]++;
      if (v === "revise" || v === "reject" || notes) {
        todo.push({ id: m.id, label: m.label, verdict: v, notes });
      } else if (v === "keep") {
        keep.push({ id: m.id, label: m.label });
      }
    }

    const globalNotes = state.globalNotes.trim();
    const payload = {
      lab: "destruction" as const,
      active: { id: meshId, label: meshById(meshId).label },
      tally,
      ...(globalNotes ? { globalNotes } : {}),
      ...(todo.length ? { todo } : {}),
      ...(keep.length ? { keep } : {}),
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
    view.setAutoSpin(ctx.levers.bool("auto_spin"));
    view.setSpinRate(THREE.MathUtils.degToRad(ctx.levers.get("spin_rate")));
    view.setElev(THREE.MathUtils.degToRad(ctx.levers.get("cam_el_deg")));
    view.setDist(ctx.levers.get("cam_dist"));
    ctx.stat("tint", RACES[race].short);
  };

  const paintMeshButtons = () => {
    if (!navEl) return;
    navEl.querySelectorAll<HTMLButtonElement>("[data-mesh]").forEach((btn) => {
      const id = btn.dataset.mesh ?? "";
      const v = state.cards[id]?.verdict ?? "";
      btn.classList.toggle("is-active", id === meshId);
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

  const paintFeedback = (ctx: LabContext) => {
    if (!feedbackHost) return;
    feedbackHost.replaceChildren();
    const def = meshById(meshId);
    const fb = ensureCard(state, meshId);

    const vLabel = document.createElement("div");
    vLabel.className = "lab-section-title";
    vLabel.textContent = `Your verdict · ${def.label}`;
    feedbackHost.appendChild(vLabel);

    const vHint = document.createElement("p");
    vHint.className = "lab-hint";
    vHint.textContent =
      "Destruction theater for this solid only. keep / revise / reject + notes.";
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
        paintMeshButtons();
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
    nLabel.textContent = "Notes for this destruction";
    feedbackHost.appendChild(nLabel);

    const ta = document.createElement("textarea");
    ta.className = "mesh-notes";
    ta.rows = 4;
    ta.placeholder =
      "Wound too long / chips weak / boom muddled — agent will read this.";
    ta.value = fb.notes;
    ta.addEventListener("input", () => {
      fb.notes = ta.value;
      saveState(ctx);
      writeExport();
      paintMeshButtons();
    });
    feedbackHost.appendChild(ta);

    const tally = feedbackTally(state);
    ctx.stat("verdict", fb.verdict || "—");
    ctx.stat("feedback", `${tally.reject}✗ ${tally.revise}~ ${tally.keep}✓`);
  };

  const syncPlayBtn = () => {
    if (!playBtn) return;
    const on = view?.isDeathPlaying() ?? false;
    playBtn.textContent = on ? "Stop destruction" : "▶ Play destruction";
    playBtn.classList.toggle("is-active", on);
  };

  const isBuildingMesh = (id: string) => id.startsWith("b:");

  /** Always start (or restart) with current levers — used on mesh load + setting changes. */
  const restartDeath = (ctx: LabContext) => {
    if (!view) return;
    if (view.isDeathPlaying()) view.stopDeath(true);
    // Buildings never air-tumble even if the lever is flipped mid-session
    if (isBuildingMesh(meshId) && ctx.levers.bool("death_air")) {
      ctx.levers.set("death_air", 0, true);
      ctx.refreshPanel();
    }
    const air = !isBuildingMesh(meshId) && ctx.levers.bool("death_air");
    const tier = deathTierOf(ctx.levers.get("death_tier"));
    const speed = ctx.levers.get("death_speed");
    const loop = ctx.levers.bool("death_loop");
    view.playDeath({ air, tier, speed, loop });
    ctx.stat("death", `${air ? "air" : "gnd"}·${tier}`);
    syncPlayBtn();
  };

  /** Space / Play button: toggle stop if running, else start. */
  const playDeath = (ctx: LabContext) => {
    if (!view) return;
    if (view.isDeathPlaying()) {
      view.stopDeath();
      ctx.stat("death", "stop");
      syncPlayBtn();
      return;
    }
    restartDeath(ctx);
  };

  const stopDeath = (ctx: LabContext) => {
    view?.stopDeath();
    ctx.stat("death", "stop");
    syncPlayBtn();
  };

  const loadMesh = (ctx: LabContext, id: string) => {
    if (!view || !packs) return;
    meshId = id;
    const def = meshById(id);
    const stats = view.setMesh(def, packs);
    // Catalog defaults — buildings are always planted (never air tumble)
    const airOn = !isBuildingMesh(id) && defaultDeathAir(id);
    ctx.levers.set("death_air", airOn ? 1 : 0, true);
    if (def.unitTier === 3) ctx.levers.set("death_tier", 2, true);
    else if (isBuildingMesh(id) || def.unitTier === 2) ctx.levers.set("death_tier", 1, true);
    else if (def.unitTier === 0 || def.unitTier === 1) ctx.levers.set("death_tier", 0, true);
    else ctx.levers.set("death_tier", 1, true);
    // Buildings default medium+ for a meatier boom read
    if (isBuildingMesh(id) && (def.unitTier ?? 0) >= 1) {
      ctx.levers.set("death_tier", Math.max(1, Math.round(ctx.levers.get("death_tier"))), true);
    }
    ctx.refreshPanel();
    applyChrome(ctx);

    if (noteEl) {
      noteEl.textContent = def.note
        ? `${def.label} — ${def.note}`
        : `${def.label} · crease ${def.crease}°`;
    }
    if (idEl) idEl.textContent = `id ${def.id}`;
    paintMeshButtons();
    paintFeedback(ctx);
    writeExport();
    ctx.stat("mesh", def.label);
    ctx.stat("id", def.id);
    ctx.stat("air", defaultDeathAir(id) ? "air" : "ground");
    ctx.stat("verts", stats.verts);
    ctx.stat("faces", stats.faces);
    ctx.stat("parts", stats.parts);
    saveState(ctx);
    // Auto-play theater on every mesh load
    restartDeath(ctx);
  };

  const loadFromParam = (ctx: LabContext, raw: string): boolean => {
    const id = resolveMeshId(raw);
    if (!id) {
      ctx.stat("mesh", `unknown:${raw}`);
      return false;
    }
    loadMesh(ctx, id);
    return true;
  };

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
      "Same mesh catalog. Loads auto-play destruction. Space / D toggles · Esc stops.";
    navEl.appendChild(hint);

    idEl = document.createElement("p");
    idEl.className = "lab-hint lab-mesh-id";
    navEl.appendChild(idEl);

    noteEl = document.createElement("p");
    noteEl.className = "lab-hint";
    navEl.appendChild(noteEl);

    const appendMeshCard = (host: HTMLElement, m: (typeof MESHES)[number]) => {
      const fb = state.cards[m.id];
      const v = fb?.verdict ?? "";
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "mesh-card" +
        (m.id === meshId ? " is-active" : "") +
        (v ? ` is-${v}` : "");
      card.dataset.mesh = m.id;
      card.title = m.note ? `${m.id} — ${m.note}` : m.id;

      const thumb = thumbs[m.id];
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
      name.textContent = m.label;
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

      card.addEventListener("click", () => loadMesh(ctx, m.id));
      host.appendChild(card);
    };

    for (const group of factionMeshesGrouped()) {
      const fac = document.createElement("div");
      fac.className = "mesh-faction";
      fac.dataset.faction = group.faction;

      const facHead = document.createElement("div");
      facHead.className = "mesh-faction-head";
      facHead.textContent = group.label;
      fac.appendChild(facHead);

      for (const tier of group.tiers) {
        const tierBlock = document.createElement("div");
        tierBlock.className = "mesh-tier";
        const tierHead = document.createElement("div");
        tierHead.className = "mesh-tier-head";
        tierHead.textContent = tier.label;
        tierBlock.appendChild(tierHead);
        const grid = document.createElement("div");
        grid.className = "mesh-card-grid";
        for (const m of tier.meshes) appendMeshCard(grid, m);
        tierBlock.appendChild(grid);
        fac.appendChild(tierBlock);
      }
      navEl.appendChild(fac);
    }
  };

  const mountPanel = (ctx: LabContext) => {
    ctx.panel.replaceChildren();
    const root = document.createElement("div");

    const hint = document.createElement("p");
    hint.className = "lab-hint";
    hint.textContent =
      "Deep link: ?lab=destruction&destruction=u:scout · window.ccLabs.openDestruction(id).";
    root.appendChild(hint);

    const deathCap = document.createElement("div");
    deathCap.className = "lab-section-title";
    deathCap.textContent = "Theater";
    root.appendChild(deathCap);

    const deathHint = document.createElement("p");
    deathHint.className = "lab-hint";
    deathHint.textContent =
      "Auto-plays on load; restarts on lever change. Wound (micros + heavier chips) → solid linger → loud boom + shatter. Buildings stay planted (no sink/spin).";
    root.appendChild(deathHint);

    const deathRow = document.createElement("div");
    deathRow.className = "lab-btn-row";
    playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "lab-btn";
    playBtn.textContent = "▶ Play destruction";
    playBtn.title = "Space / D";
    playBtn.addEventListener("click", () => playDeath(ctx));
    deathRow.appendChild(playBtn);

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "lab-btn";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", () => stopDeath(ctx));
    deathRow.appendChild(stopBtn);
    root.appendChild(deathRow);

    const cap = document.createElement("div");
    cap.className = "lab-section-title";
    cap.textContent = "Capture";
    root.appendChild(cap);

    const act = document.createElement("div");
    act.className = "lab-btn-row";
    const shot = document.createElement("button");
    shot.type = "button";
    shot.className = "lab-btn";
    shot.textContent = "Screenshot";
    shot.addEventListener("click", () => {
      const canvas = view?.getDomElement();
      if (!canvas) return;
      const a = document.createElement("a");
      const safe = meshId.replace(/[^a-z0-9]+/gi, "-");
      a.download = `destruction-${safe}-${Date.now()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      ctx.stat("capture", "png");
    });
    act.appendChild(shot);

    const copyLink = document.createElement("button");
    copyLink.type = "button";
    copyLink.className = "lab-btn";
    copyLink.textContent = "Copy link";
    copyLink.addEventListener("click", async () => {
      const url = new URL(location.href);
      url.searchParams.set("lab", "destruction");
      url.searchParams.set("destruction", meshId);
      url.searchParams.delete("death");
      url.searchParams.delete("mesh");
      const ok = await copyText(url.toString());
      if (ok) {
        flashButton(copyLink, "Copied!");
        ctx.stat("link", "copied");
      } else {
        flashButton(copyLink, "Failed");
        ctx.stat("link", url.search);
      }
    });
    act.appendChild(copyLink);

    const resetCam = document.createElement("button");
    resetCam.type = "button";
    resetCam.className = "lab-btn";
    resetCam.textContent = "Reset cam";
    resetCam.addEventListener("click", () => {
      ctx.levers.set("cam_el_deg", 28);
      ctx.levers.set("cam_dist", 6);
      ctx.refreshPanel();
      applyChrome(ctx);
      saveState(ctx);
    });
    act.appendChild(resetCam);
    root.appendChild(act);

    const vHead = document.createElement("div");
    vHead.className = "lab-section-title";
    vHead.textContent = "Verdict";
    root.appendChild(vHead);

    feedbackHost = document.createElement("div");
    root.appendChild(feedbackHost);

    const sessTitle = document.createElement("div");
    sessTitle.className = "lab-section-title";
    sessTitle.textContent = "Session notes";
    root.appendChild(sessTitle);

    globalNotesEl = document.createElement("textarea");
    globalNotesEl.className = "mesh-notes";
    globalNotesEl.rows = 2;
    globalNotesEl.placeholder = "Tier timing, scar scale, air vs ground feel…";
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
      paintMeshButtons();
      writeExport();
    });
    handRow.appendChild(clearFb);
    root.appendChild(handRow);

    exportEl = document.createElement("pre");
    exportEl.className = "mesh-export";
    root.appendChild(exportEl);

    ctx.panel.appendChild(root);
  };

  return {
    id: "destruction",
    title: "Destruction",
    blurb:
      "Combat destruction — micro wounds, solid chips, then boom + shatter. Same mesh catalog, full-bleed stage.",
    levers: LEVERS,
    setup(ctx) {
      labCtx = ctx;
      state = loadState();
      meshId = initialDestructionMeshId();
      applyStoredLevers(ctx, state.levers);
      packs = createPacks();
      thumbs = bakeMeshThumbs(packs);
      ctx.stat("thumbs", `${Object.keys(thumbs).length}`);

      ctx.viewport.replaceChildren();
      shellEl = document.createElement("div");
      shellEl.className = "destruction-shell";

      navEl = document.createElement("nav");
      navEl.className = "mesh-nav";
      navEl.setAttribute("aria-label", "Destruction mesh catalog");

      stageEl = document.createElement("div");
      stageEl.className = "destruction-stage";

      const perfHudEl = document.createElement("div");
      perfHudEl.className = "mesh-perf-hud";
      perfHudEl.setAttribute("aria-live", "polite");
      const mkLine = (cls: string, label: string) => {
        const row = document.createElement("div");
        row.className = "mesh-perf-row " + cls;
        const k = document.createElement("span");
        k.className = "mesh-perf-k";
        k.textContent = label;
        const v = document.createElement("span");
        v.className = "mesh-perf-v";
        v.textContent = "—";
        row.append(k, v);
        perfHudEl.appendChild(row);
        return v;
      };
      perfHudLines = {
        fps: mkLine("is-fps", "FPS"),
        mesh: mkLine("is-mesh", "MESH"),
        death: mkLine("is-death", "FX"),
        draw: mkLine("is-draw", "DRAW"),
      };
      stageEl.appendChild(perfHudEl);

      shellEl.append(navEl, stageEl);
      ctx.viewport.appendChild(shellEl);

      view = new MeshViewer({ container: stageEl });
      mountNav(ctx);
      mountPanel(ctx);
      applyChrome(ctx);
      loadMesh(ctx, meshId);

      liveHandle = {
        load: (raw) => (labCtx ? loadFromParam(labCtx, raw) : false),
        current: () => meshId,
        play: () => {
          if (labCtx) playDeath(labCtx);
        },
        stop: () => {
          if (labCtx) stopDeath(labCtx);
        },
        exportFeedback: () => buildExport(),
      };

      unsub = ctx.levers.onChange((id) => {
        if (
          id === "auto_spin" ||
          id === "spin_rate" ||
          id === "cam_el_deg" ||
          id === "cam_dist" ||
          id === "race" ||
          id === "show_hull" ||
          id === "show_wire" ||
          id === "show_ground"
        ) {
          applyChrome(ctx);
        }
        // Theater + chrome that paints the mesh: restart so the new setting is visible
        if (
          id === "death_air" ||
          id === "death_tier" ||
          id === "death_speed" ||
          id === "death_loop" ||
          id === "race" ||
          id === "show_hull" ||
          id === "show_wire" ||
          id === "show_ground"
        ) {
          restartDeath(ctx);
        }
        saveState(ctx);
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        ) {
          return;
        }
        if (e.code === "Space" || e.key === "d" || e.key === "D") {
          e.preventDefault();
          playDeath(ctx);
        }
        if (e.key === "Escape") {
          stopDeath(ctx);
        }
      };
      window.addEventListener("keydown", onKey);
      (shellEl as HTMLElement & { _deathKey?: (e: KeyboardEvent) => void })._deathKey =
        onKey;

      ctx.stat("lab", "Destruction");
      ctx.stat("death", "idle");
      ctx.stat("draw", "—");
      ctx.stat("tris", "—");
      ctx.stat("shards", "—");
      hudAcc = 0;
      hudFrames = 0;
      hudFps = 0;
      lastDeathPhase = "";
    },
    tick(dt, ctx) {
      view?.tick(dt);

      hudAcc += dt;
      hudFrames++;
      if (!view) return;

      const phase = view.deathPhase();
      const deathOn = view.isDeathPlaying();
      const phaseChanged = deathOn && phase !== lastDeathPhase;
      if (hudAcc < 0.1 && !phaseChanged) return;

      hudFps = hudFrames / Math.max(1e-4, hudAcc);
      hudAcc = 0;
      hudFrames = 0;
      lastDeathPhase = phase;

      const info = view.lastRenderInfo();
      const meshMs = view.lastFrameMs();
      const live = view.deathShardLive();
      const total = view.deathShardTotal();
      const integ = view.deathIntegrity();

      ctx.stat(
        "cam",
        `${THREE.MathUtils.radToDeg(view.getElev()).toFixed(0)}° / ${view.getDist().toFixed(1)}`,
      );
      ctx.stat("draw", String(info.calls));
      ctx.stat("tris", String(info.triangles));
      if (deathOn) {
        ctx.stat("death", `${phase}${total ? ` · ${live}/${total}` : ""}`);
        ctx.stat("shards", total ? `${live}/${total}` : "0");
        ctx.stat("wound", phase === "wound" ? integ.toFixed(2) : "—");
        ctx.stat("meshMs", meshMs.toFixed(1));
      } else {
        ctx.stat("death", "idle");
        ctx.stat("shards", "—");
        ctx.stat("wound", "—");
        ctx.stat("meshMs", meshMs.toFixed(1));
      }
      syncPlayBtn();

      if (perfHudLines) {
        const fpsBand = hudFps >= 50 ? "ok" : hudFps >= 30 ? "warn" : "bad";
        perfHudLines.fps.textContent = `${hudFps.toFixed(0)}`;
        perfHudLines.fps.dataset.band = fpsBand;
        perfHudLines.mesh.textContent = `${meshMs.toFixed(1)} ms`;
        perfHudLines.mesh.dataset.band =
          meshMs <= 8 ? "ok" : meshMs <= 16 ? "warn" : "bad";
        if (deathOn) {
          const shardBit = total ? `  shards ${live}/${total}` : "";
          const woundBit = phase === "wound" ? `  w=${integ.toFixed(2)}` : "";
          perfHudLines.death.textContent = `${phase}${shardBit}${woundBit}`;
          perfHudLines.death.dataset.band = "warn";
        } else {
          perfHudLines.death.textContent = "idle";
          perfHudLines.death.dataset.band = "";
        }
        perfHudLines.draw.textContent = `${info.calls} draw · ${info.triangles} tri · ${info.lines} line`;
      }
    },
    teardown(ctx) {
      liveHandle = null;
      labCtx = null;
      unsub?.();
      unsub = null;
      if (shellEl) {
        const key = (shellEl as HTMLElement & { _deathKey?: (e: KeyboardEvent) => void })
          ._deathKey;
        if (key) window.removeEventListener("keydown", key);
      }
      view?.dispose();
      view = null;
      if (packs) {
        disposePacks(packs);
        packs = null;
      }
      thumbs = {};
      try {
        saveState(ctx);
      } catch {
        /* ignore */
      }
      shellEl = null;
      navEl = null;
      stageEl = null;
      noteEl = null;
      idEl = null;
      playBtn = null;
      feedbackHost = null;
      exportEl = null;
      globalNotesEl = null;
      perfHudLines = null;
      ctx.panel.replaceChildren();
      ctx.viewport.replaceChildren();
    },
  };
}

/** @deprecated aliases — lab was formerly "Death" */
export const makeDeathLab = makeDestructionLab;
export const getDeathLabHandle = getDestructionLabHandle;
export type DeathLabHandle = DestructionLabHandle;
export type DeathVerdict = DestructionVerdict;
