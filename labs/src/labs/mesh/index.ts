import * as THREE from "three";
import { DEFAULT_DIST } from "@game/render/planetMath";
import { PlanetView } from "@game/render/planetView";
import { RACES } from "@game/sim/defs";
import type { RaceId } from "@game/sim/types";
import { copyText, flashButton } from "../../copy";
import type { Lab, LabContext } from "../../lab";
import type { LeverDef } from "../../levers";
import { readLabQuery, writeLabQuery } from "../../query";
import { buildBoard } from "../readability/boards";
import {
  MESHES,
  createPacks,
  disposePacks,
  listMeshCatalog,
  meshById,
  resolveMeshId,
  factionMeshesGrouped,
  type MeshPacks,
} from "./catalog";
import { meshIdentityFocus } from "./focus";
import { bakeMeshThumbs, type MeshThumbMap } from "./thumbs";
import { MeshViewer } from "./viewer";

const RACE_IDS: RaceId[] = ["operators", "blight", "mandate"];
const STORAGE_KEY = "crater-labs:mesh";
const DEFAULT_MESH = "u:scout";

/** Human mesh-direction call — same channel shape as concept lab. */
export type MeshVerdict = "keep" | "revise" | "reject" | "";

type MeshCardFeedback = {
  verdict: MeshVerdict;
  notes: string;
};

type MeshLabState = {
  mesh: string;
  globalNotes: string;
  /** Per mesh id → verdict + notes. */
  cards: Record<string, MeshCardFeedback>;
  /** Lever id → value (range or 0/1 toggle). */
  levers?: Record<string, number>;
};

/** Live controller while Mesh lab is mounted — used by shell / window.ccLabs. */
export type MeshLabHandle = {
  load(raw: string): boolean;
  current(): string;
  exportFeedback(): string;
};

let liveHandle: MeshLabHandle | null = null;

export function getMeshLabHandle(): MeshLabHandle | null {
  return liveHandle;
}

export { listMeshCatalog, resolveMeshId, MESHES };

// Concept lab plates — mesh↔art comparison (basename without ext)
const conceptUrls = import.meta.glob(
  "../concept/assets/operators/*.{jpg,jpeg,png,webp}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
) as Record<string, string>;

function conceptImageUrl(conceptId: string): string | null {
  const keys = Object.keys(conceptUrls);
  const hit = keys.find((k) => {
    const base = k.split("/").pop() ?? "";
    return (
      base === `${conceptId}.jpg` ||
      base === `${conceptId}.png` ||
      base === `${conceptId}.webp` ||
      base === `${conceptId}.jpeg`
    );
  });
  return hit ? conceptUrls[hit]! : null;
}

const LEVERS: LeverDef[] = [
  {
    id: "auto_spin",
    label: "Auto spin",
    kind: "toggle",
    value: 1,
    section: "Camera",
    tradesAgainst: "Off = scrub with drag only.",
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
    tradesAgainst: "Match-ish tactical sits ~40–55°. Lower = silhouette mass.",
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
    tradesAgainst: "0 Operators · 1 Blight · 2 Mandate — match edge mats.",
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
    id: "crease",
    label: "Edge crease",
    kind: "range",
    value: 0,
    min: 0,
    max: 45,
    step: 1,
    unit: "°",
    section: "Chrome",
    tradesAgainst: "0 = mesh default (units 22 / buildings 18). Else rebuild EdgesGeometry.",
  },
];

function emptyState(): MeshLabState {
  return { mesh: DEFAULT_MESH, globalNotes: "", cards: {} };
}

function loadState(): MeshLabState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<MeshLabState>;
    const mesh =
      parsed.mesh && MESHES.some((m) => m.id === parsed.mesh)
        ? parsed.mesh
        : DEFAULT_MESH;
    const levers =
      parsed.levers && typeof parsed.levers === "object" ? parsed.levers : undefined;
    return {
      mesh,
      globalNotes: parsed.globalNotes ?? "",
      cards: parsed.cards ?? {},
      levers,
    };
  } catch {
    return emptyState();
  }
}

/** Prefer ?mesh=…, then last session, then scout. */
export function initialMeshId(): string {
  const fromUrl = resolveMeshId(readLabQuery().mesh);
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

function ensureCard(s: MeshLabState, id: string): MeshCardFeedback {
  if (!s.cards[id]) s.cards[id] = { verdict: "", notes: "" };
  return s.cards[id]!;
}

function feedbackTally(s: MeshLabState): Record<"keep" | "revise" | "reject", number> {
  const t = { keep: 0, revise: 0, reject: 0 };
  for (const c of Object.values(s.cards)) {
    if (c.verdict === "keep" || c.verdict === "revise" || c.verdict === "reject") {
      t[c.verdict]++;
    }
  }
  return t;
}

export function makeMeshLab(): Lab {
  let view: MeshViewer | null = null;
  let readView: PlanetView | null = null;
  let packs: MeshPacks | null = null;
  let state = loadState();
  let meshId = initialMeshId();
  let unsub: (() => void) | null = null;
  let uiRoot: HTMLElement | null = null;
  let noteEl: HTMLElement | null = null;
  let idEl: HTMLElement | null = null;
  let labCtx: LabContext | null = null;
  let shellEl: HTMLElement | null = null;
  let navEl: HTMLElement | null = null;
  let quadsEl: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let conceptPaneEl: HTMLElement | null = null;
  let conceptImgEl: HTMLImageElement | null = null;
  let conceptCapEl: HTMLElement | null = null;
  let conceptMissEl: HTMLElement | null = null;
  let readabilityHostEl: HTMLElement | null = null;
  let readabilityCapEl: HTMLElement | null = null;
  let verdictPaneEl: HTMLElement | null = null;
  let feedbackHost: HTMLElement | null = null;
  let exportEl: HTMLPreElement | null = null;
  let globalNotesEl: HTMLTextAreaElement | null = null;
  /** Catalog card thumbs — baked once per lab open from live packs. */
  let thumbs: MeshThumbMap = {};

  const raceOf = (ctx: LabContext): RaceId => {
    const i = Math.round(ctx.levers.get("race"));
    return RACE_IDS[Math.min(2, Math.max(0, i))] ?? "operators";
  };

  const creaseFor = (ctx: LabContext, defCrease: number): number | undefined => {
    const v = ctx.levers.get("crease");
    return v > 0.5 ? v : undefined;
  };

  const saveState = (ctx: LabContext) => {
    state.mesh = meshId;
    state.levers = collectLevers(ctx);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    writeLabQuery({ lab: "mesh", mesh: meshId });
  };

  /**
   * Compact handoff dump. Always names the meshes — never a bare count.
   * `todo` = revise/reject or anything with notes; `keep` = silent keeps.
   */
  const buildExport = (): string => {
    const tally = { keep: 0, revise: 0, reject: 0 };
    const todo: Array<{
      id: string;
      label: string;
      verdict: MeshVerdict;
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
        todo.push({
          id: m.id,
          label: m.label,
          verdict: v,
          notes,
        });
      } else if (v === "keep") {
        keep.push({ id: m.id, label: m.label });
      }
    }

    const globalNotes = state.globalNotes.trim();
    const payload = {
      lab: "mesh" as const,
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
      "This solid only. keep / revise / reject + notes — Copy feedback diff to hand off.";
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
    nLabel.textContent = "Notes for this mesh";
    feedbackHost.appendChild(nLabel);

    const ta = document.createElement("textarea");
    ta.className = "mesh-notes";
    ta.rows = 4;
    ta.placeholder =
      "Too many verts / crease too soft / silhouette twins X — agent will read this.";
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
    ctx.stat(
      "feedback",
      `${tally.reject}✗ ${tally.revise}~ ${tally.keep}✓`,
    );
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

  const updateConceptPane = (ctx: LabContext) => {
    if (!conceptPaneEl || !conceptImgEl || !conceptCapEl || !conceptMissEl) return;
    const def = meshById(meshId);
    const cid = def.concept;
    const url = cid ? conceptImageUrl(cid) : null;
    if (url && cid) {
      conceptImgEl.src = url;
      conceptImgEl.alt = `${cid} concept`;
      conceptImgEl.hidden = false;
      conceptMissEl.hidden = true;
      conceptCapEl.textContent = `Concept · ${cid}`;
      ctx.stat("art", cid);
    } else {
      conceptImgEl.removeAttribute("src");
      conceptImgEl.hidden = true;
      conceptMissEl.hidden = false;
      conceptMissEl.textContent = cid
        ? `No plate for ${cid}`
        : "No concept mapping for this mesh";
      conceptCapEl.textContent = "Concept · —";
      ctx.stat("art", "none");
    }
  };

  /** Ring + camera on the identity board for the selected mesh. */
  const focusReadability = (ctx: LabContext, immediate = false) => {
    if (!readView) return;
    const hit = meshIdentityFocus(meshId);
    if (!hit) {
      readView.setSurfaceMarker(null, null);
      if (readabilityCapEl) {
        readabilityCapEl.textContent = "Readability · no map target";
      }
      ctx.stat("map", "—");
      return;
    }
    readView.setSurfaceMarker(hit.x, hit.y);
    readView.focusMap(hit.x, hit.y);
    readView.setCameraTargets({
      el: THREE.MathUtils.degToRad(48),
      dist: Math.min(DEFAULT_DIST * 0.55, 38),
      immediate,
    });
    if (readabilityCapEl) {
      readabilityCapEl.textContent = `Readability · ${hit.label}`;
    }
    ctx.stat("map", hit.label);
  };

  const loadMesh = (ctx: LabContext, id: string) => {
    if (!view || !packs) return;
    meshId = id;
    const def = meshById(id);
    const crease = creaseFor(ctx, def.crease);
    const stats = view.setMesh(def, packs, crease);
    if (noteEl) {
      noteEl.textContent = def.note
        ? `${def.label} — ${def.note}`
        : `${def.label} · crease ${crease ?? def.crease}°`;
    }
    if (idEl) idEl.textContent = `id ${def.id}`;
    updateConceptPane(ctx);
    focusReadability(ctx);
    paintMeshButtons();
    paintFeedback(ctx);
    writeExport();
    ctx.stat("mesh", def.label);
    ctx.stat("id", def.id);
    ctx.stat("verts", stats.verts);
    ctx.stat("faces", stats.faces);
    ctx.stat("parts", stats.parts);
    ctx.stat("crease", `${crease ?? def.crease}°`);
    saveState(ctx);
  };

  /** Resolve + load; returns false if the param doesn't match a catalog entry. */
  const loadFromParam = (ctx: LabContext, raw: string): boolean => {
    const id = resolveMeshId(raw);
    if (!id) {
      ctx.stat("mesh", `unknown:${raw}`);
      return false;
    }
    loadMesh(ctx, id);
    return true;
  };

  /** Left catalog — faction → tier cards (name + keep/revise/reject only). */
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
      "Faction → tier. Thumbs bake from live geos on open. Name + verdict.";
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

  /** Right shell panel — capture only (levers host above). */
  const mountUi = (ctx: LabContext) => {
    ctx.panel.replaceChildren();
    uiRoot = document.createElement("div");
    ctx.panel.appendChild(uiRoot);

    const hint = document.createElement("p");
    hint.className = "lab-hint";
    hint.textContent =
      "Deep link: ?lab=mesh&mesh=u:scout · bare slug mesh=scout · window.ccLabs.openMesh(id).";
    uiRoot.appendChild(hint);

    const cap = document.createElement("div");
    cap.className = "lab-section-title";
    cap.textContent = "Capture";
    uiRoot.appendChild(cap);

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
      a.download = `mesh-${safe}-${Date.now()}.png`;
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
      url.searchParams.set("lab", "mesh");
      url.searchParams.set("mesh", meshId);
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
    uiRoot.appendChild(act);
  };

  /** Bottom-right quadrant: per-mesh verdict + session notes + handoff. */
  const mountVerdictUi = (ctx: LabContext) => {
    if (!verdictPaneEl) return;
    verdictPaneEl.replaceChildren();

    const head = document.createElement("div");
    head.className = "mesh-quad-head";
    head.textContent = "Verdict";
    verdictPaneEl.appendChild(head);

    const sessHint = document.createElement("p");
    sessHint.className = "lab-hint";
    sessHint.textContent =
      "keep / revise / reject for this solid. Copy feedback diff → paste in chat.";
    verdictPaneEl.appendChild(sessHint);

    feedbackHost = document.createElement("div");
    feedbackHost.className = "mesh-feedback";
    verdictPaneEl.appendChild(feedbackHost);

    const sessTitle = document.createElement("div");
    sessTitle.className = "lab-section-title";
    sessTitle.textContent = "Session notes";
    verdictPaneEl.appendChild(sessTitle);

    globalNotesEl = document.createElement("textarea");
    globalNotesEl.className = "mesh-notes";
    globalNotesEl.rows = 2;
    globalNotesEl.placeholder = "Crease defaults, silhouette rules, staging notes…";
    globalNotesEl.value = state.globalNotes;
    globalNotesEl.addEventListener("input", () => {
      state.globalNotes = globalNotesEl!.value;
      saveState(ctx);
      writeExport();
    });
    verdictPaneEl.appendChild(globalNotesEl);

    const handTitle = document.createElement("div");
    handTitle.className = "lab-section-title";
    handTitle.textContent = "Handoff";
    verdictPaneEl.appendChild(handTitle);

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
    verdictPaneEl.appendChild(handRow);

    exportEl = document.createElement("pre");
    exportEl.className = "mesh-export";
    verdictPaneEl.appendChild(exportEl);
  };

  return {
    id: "mesh",
    title: "Mesh",
    blurb:
      "Left catalog · mesh · concept · readability focus · verdict. Identity board rings the selected solid.",
    levers: LEVERS,
    setup(ctx) {
      labCtx = ctx;
      state = loadState();
      meshId = initialMeshId();
      applyStoredLevers(ctx, state.levers);
      packs = createPacks();
      // Catalog thumbs from current packs (no on-disk pipeline — re-bake each open).
      thumbs = bakeMeshThumbs(packs);
      ctx.stat("thumbs", `${Object.keys(thumbs).length}`);

      ctx.viewport.replaceChildren();
      shellEl = document.createElement("div");
      shellEl.className = "mesh-shell";

      // Left — unit/building catalog
      navEl = document.createElement("nav");
      navEl.className = "mesh-nav";
      navEl.setAttribute("aria-label", "Mesh catalog");

      // Right — 2×2 quads
      quadsEl = document.createElement("div");
      quadsEl.className = "mesh-quads";

      // TL — isolated mesh
      stageEl = document.createElement("div");
      stageEl.className = "mesh-stage";

      // TR — concept plate (always on)
      conceptPaneEl = document.createElement("aside");
      conceptPaneEl.className = "mesh-concept-pane";
      conceptPaneEl.setAttribute("aria-label", "Concept art");
      const conceptHead = document.createElement("div");
      conceptHead.className = "mesh-concept-head";
      conceptCapEl = document.createElement("span");
      conceptCapEl.textContent = "Concept";
      conceptHead.appendChild(conceptCapEl);
      conceptPaneEl.appendChild(conceptHead);
      conceptImgEl = document.createElement("img");
      conceptImgEl.className = "mesh-concept-img";
      conceptImgEl.alt = "";
      conceptImgEl.hidden = true;
      conceptPaneEl.appendChild(conceptImgEl);
      conceptMissEl = document.createElement("div");
      conceptMissEl.className = "mesh-concept-miss";
      conceptMissEl.hidden = true;
      conceptPaneEl.appendChild(conceptMissEl);

      // BL — readability identity board
      const readPane = document.createElement("div");
      readPane.className = "mesh-readability-pane";
      readabilityCapEl = document.createElement("div");
      readabilityCapEl.className = "mesh-quad-head";
      readabilityCapEl.textContent = "Readability";
      readPane.appendChild(readabilityCapEl);
      readabilityHostEl = document.createElement("div");
      readabilityHostEl.className = "mesh-readability-host";
      readPane.appendChild(readabilityHostEl);

      // BR — verdict workflow
      verdictPaneEl = document.createElement("div");
      verdictPaneEl.className = "mesh-verdict-pane";
      verdictPaneEl.setAttribute("aria-label", "Mesh verdict");

      quadsEl.append(stageEl, conceptPaneEl, readPane, verdictPaneEl);
      shellEl.append(navEl, quadsEl);
      ctx.viewport.appendChild(shellEl);

      view = new MeshViewer({ container: stageEl });
      mountNav(ctx);
      mountUi(ctx);
      mountVerdictUi(ctx);
      applyChrome(ctx);

      readView = new PlanetView({
        container: readabilityHostEl,
        viewer: 0,
        onPlace: () => {},
        preserveDrawingBuffer: true,
        flatTerrain: true,
        onGlobeReady: () => {
          if (!readView || !labCtx) return;
          readView.setSnapshot(buildBoard("identity", "operators"));
          focusReadability(labCtx, true);
          labCtx.stat("globe", "ready");
        },
      });
      readView.setSnapshot(buildBoard("blank", "operators"));

      loadMesh(ctx, meshId);

      liveHandle = {
        load: (raw) => (labCtx ? loadFromParam(labCtx, raw) : false),
        current: () => meshId,
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
        if (id === "crease") {
          loadMesh(ctx, meshId);
        } else {
          saveState(ctx);
        }
      });

      ctx.stat("lab", "mesh");
      ctx.stat("layout", "2×2");
    },
    tick(dt, ctx) {
      view?.tick(dt);
      // PlanetView runs its own rAF; no tick hook required.
      if (view) {
        ctx.stat(
          "cam",
          `${THREE.MathUtils.radToDeg(view.getElev()).toFixed(0)}° / ${view.getDist().toFixed(1)}`,
        );
      }
    },
    teardown(ctx) {
      liveHandle = null;
      labCtx = null;
      unsub?.();
      unsub = null;
      view?.dispose();
      view = null;
      readView?.dispose();
      readView = null;
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
      uiRoot = null;
      noteEl = null;
      idEl = null;
      shellEl = null;
      navEl = null;
      quadsEl = null;
      stageEl = null;
      conceptPaneEl = null;
      conceptImgEl = null;
      conceptCapEl = null;
      conceptMissEl = null;
      readabilityHostEl = null;
      readabilityCapEl = null;
      verdictPaneEl = null;
      feedbackHost = null;
      exportEl = null;
      globalNotesEl = null;
      ctx.panel.replaceChildren();
      ctx.viewport.replaceChildren();
    },
  };
}
