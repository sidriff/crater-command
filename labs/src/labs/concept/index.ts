/**
 * Concept lab — generated wireframe art for Operators units/buildings.
 * Feedback: per-card verdict + notes, JSON export for agent handoff.
 *
 * Deep links: /?lab=concept&concept=rover
 * API: window.ccLabs.openConcept("rover")
 */
import { copyText, flashButton } from "../../copy";
import type { Lab, LabContext } from "../../lab";
import type { LeverDef } from "../../levers";
import { readLabQuery, writeLabQuery } from "../../query";
import {
  BRANCH_LABELS,
  OPERATORS_CONCEPTS,
  ROSTER_NOTES,
  TECH_LABELS,
  conceptById,
  conceptsByTech,
  operatorUnits,
  productionBuildingsFor,
  resolveConceptId,
  reviewQueue,
  reviewTally,
  rosterNotesFor,
  isActiveConcept,
  t2DoctrineGroups,
  techBadge,
  unusedConcepts,
  type ConceptDef,
  type ConceptVerdict as ReviewVerdict,
  type TechTier,
} from "./catalog";

const STORAGE_KEY = "crater-labs:concept";
const DEFAULT_ID = "rover";
const TIERS: TechTier[] = [0, 1, 2, 3];

/** The human's own per-card call — "" means untouched. Distinct from `review`. */
export type ConceptVerdict = ReviewVerdict | "";

type CardFeedback = {
  verdict: ConceptVerdict;
  notes: string;
};

type ConceptState = {
  activeId: string;
  globalNotes: string;
  cards: Record<string, CardFeedback>;
  /**
   * Preferred plate per concept. Keys are concept ids; values are iteration
   * keys (`current` or a history stem like `36`). Gallery + detail honor this
   * so you can browse older gens without overwriting the main file.
   */
  pins: Record<string, string>;
  /** Lever id → value (toggle 0/1). Restored on setup so filters survive refresh. */
  levers?: Record<string, number>;
};

/** Live controller while Concept lab is mounted. */
export type ConceptLabHandle = {
  load(raw: string): boolean;
  current(): string;
  exportFeedback(): string;
};

let liveHandle: ConceptLabHandle | null = null;

export function getConceptLabHandle(): ConceptLabHandle | null {
  return liveHandle;
}

export { OPERATORS_CONCEPTS, resolveConceptId, conceptById };

// Vite: current plates at assets/operators/<id>.jpg
const assetUrls = import.meta.glob("./assets/operators/*.{jpg,jpeg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

// Prior iterations: assets/operators/history/<id>/<label>.jpg
const historyUrls = import.meta.glob(
  "./assets/operators/history/**/*.{jpg,jpeg,png,webp}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
) as Record<string, string>;

export type ConceptIteration = {
  /** `current` or history stem (e.g. session `36`) */
  key: string;
  label: string;
  url: string;
  /** true for the on-disk main plate */
  isCurrent: boolean;
};

function mainImageUrl(id: string): string | null {
  const keys = Object.keys(assetUrls);
  const hit = keys.find((k) => {
    const base = k.split("/").pop() ?? "";
    return base === `${id}.jpg` || base === `${id}.png` || base === `${id}.webp`;
  });
  return hit ? assetUrls[hit]! : null;
}

/** All known plates for a concept: current first, then history by label. */
export function iterationsFor(id: string): ConceptIteration[] {
  const out: ConceptIteration[] = [];
  const main = mainImageUrl(id);
  if (main) {
    out.push({ key: "current", label: "current", url: main, isCurrent: true });
  }
  const prefix = `/history/${id}/`;
  const hist: ConceptIteration[] = [];
  for (const [path, url] of Object.entries(historyUrls)) {
    const norm = path.replace(/\\/g, "/");
    const i = norm.lastIndexOf(prefix);
    if (i < 0) continue;
    const file = norm.slice(i + prefix.length);
    const stem = file.replace(/\.(jpe?g|png|webp)$/i, "");
    if (!stem) continue;
    hist.push({
      key: stem,
      label: stem,
      url,
      isCurrent: false,
    });
  }
  hist.sort((a, b) => {
    const na = Number(a.key);
    const nb = Number(b.key);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.key.localeCompare(b.key);
  });
  out.push(...hist);
  return out;
}

/**
 * URL shown for a concept. Honors a local pin to a history iteration so you
 * can flip between gens without rewriting files.
 */
function imageUrlFor(id: string, pins?: Record<string, string>): string | null {
  const iters = iterationsFor(id);
  if (!iters.length) return null;
  const pin = pins?.[id];
  if (pin) {
    const hit = iters.find((it) => it.key === pin);
    if (hit) return hit.url;
  }
  return iters.find((it) => it.isCurrent)?.url ?? iters[0]!.url;
}

function activeIterKey(id: string, pins?: Record<string, string>): string {
  const pin = pins?.[id];
  if (pin && iterationsFor(id).some((it) => it.key === pin)) return pin;
  return "current";
}

const LEVERS: LeverDef[] = [
  {
    id: "group_by_tier",
    label: "Group by tech tier",
    kind: "toggle",
    value: 1,
    section: "Layout",
    tradesAgainst: "Off = flat grid (catalog order). On = T0→T3 sections.",
  },
  {
    id: "production_map",
    label: "Production map",
    kind: "toggle",
    value: 0,
    section: "Layout",
    tradesAgainst: "List each unit → which building trains it (no art grid).",
  },
  {
    id: "show_units",
    label: "Units",
    kind: "toggle",
    value: 1,
    section: "Filter",
    tradesAgainst: "Gallery only — ignored in production map.",
  },
  {
    id: "show_buildings",
    label: "Buildings",
    kind: "toggle",
    value: 1,
    section: "Filter",
    tradesAgainst: "Gallery only — ignored in production map.",
  },
  {
    id: "show_missing",
    label: "Show missing art",
    kind: "toggle",
    value: 1,
    section: "Filter",
    tradesAgainst: "Off hides gallery slots with no image yet.",
  },
  {
    id: "show_review",
    label: "Agent review",
    kind: "toggle",
    value: 1,
    section: "Filter",
    tradesAgainst:
      "Standing art-direction pass from catalog.ts. Off = your own verdicts only.",
  },
  {
    id: "show_unused",
    label: "Unused / retired",
    kind: "toggle",
    value: 1,
    section: "Filter",
    tradesAgainst:
      "Retired cards (e.g. Capacitor). Off hides the Unused section.",
  },
];

function emptyState(): ConceptState {
  return { activeId: DEFAULT_ID, globalNotes: "", cards: {}, pins: {} };
}

function loadState(): ConceptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const p = JSON.parse(raw) as Partial<ConceptState>;
    const levers =
      p.levers && typeof p.levers === "object" ? p.levers : undefined;
    return {
      activeId: p.activeId ?? DEFAULT_ID,
      globalNotes: p.globalNotes ?? "",
      cards: p.cards ?? {},
      pins: p.pins ?? {},
      levers,
    };
  } catch {
    return emptyState();
  }
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

/** Optional live ctx so any saveState() can snapshot lever values too. */
let leverCtx: LabContext | null = null;

function saveState(s: ConceptState) {
  if (leverCtx) s.levers = collectLevers(leverCtx);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function ensureCard(s: ConceptState, id: string): CardFeedback {
  if (!s.cards[id]) s.cards[id] = { verdict: "", notes: "" };
  return s.cards[id]!;
}

function passesFilters(
  ctx: LabContext,
  c: ConceptDef,
  pins?: Record<string, string>,
  opts?: { allowUnused?: boolean },
): boolean {
  if (!opts?.allowUnused && !isActiveConcept(c)) return false;
  if (opts?.allowUnused && isActiveConcept(c)) return false;
  if (c.kind === "unit" && !ctx.levers.bool("show_units")) return false;
  if (c.kind === "building" && !ctx.levers.bool("show_buildings")) return false;
  if (!ctx.levers.bool("show_missing") && !imageUrlFor(c.id, pins)) return false;
  return true;
}

function flatList(ctx: LabContext, pins?: Record<string, string>): ConceptDef[] {
  return OPERATORS_CONCEPTS.filter((c) => passesFilters(ctx, c, pins));
}

function appendCard(
  host: HTMLElement,
  c: ConceptDef,
  state: ConceptState,
  ctx: LabContext,
  paintGrid: (ctx: LabContext) => void,
  paintDetail: (ctx: LabContext) => void,
  writeExport: () => void,
) {
  const fb = state.cards[c.id];
  const url = imageUrlFor(c.id, state.pins);
  const showReview = ctx.levers.bool("show_review");
  const card = document.createElement("button");
  card.type = "button";
  card.className =
    "concept-card" +
    (c.id === state.activeId ? " is-active" : "") +
    (fb?.verdict ? ` is-${fb.verdict}` : "") +
    (showReview && c.review ? ` has-review is-review-${c.review.verdict}` : "") +
    (!isActiveConcept(c) ? " is-unused" : "");
  card.dataset.concept = c.id;
  card.title = showReview && c.review ? `${c.review.verdict.toUpperCase()} — ${c.review.keeps}` : c.detail;

  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = c.label;
    img.loading = "lazy";
    card.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "concept-card-ph";
    ph.textContent = "—";
    card.appendChild(ph);
  }

  const body = document.createElement("div");
  body.className = "concept-card-body";

  const cap = document.createElement("span");
  cap.className = "concept-card-label";
  cap.textContent = c.label;
  body.appendChild(cap);

  const tier = document.createElement("span");
  tier.className = "concept-card-tier";
  tier.textContent = techBadge(c);
  body.appendChild(tier);

  const blurb = document.createElement("span");
  blurb.className = "concept-card-blurb";
  blurb.textContent = c.blurb;
  body.appendChild(blurb);

  card.appendChild(body);

  if (fb?.verdict) {
    const badge = document.createElement("span");
    badge.className = "concept-card-badge";
    badge.textContent = fb.verdict[0]!.toUpperCase();
    card.appendChild(badge);
  }
  if (fb?.notes?.trim()) {
    const dot = document.createElement("span");
    dot.className = "concept-card-dot";
    dot.title = "Has notes";
    card.appendChild(dot);
  }
  if (showReview && c.review) {
    const rib = document.createElement("span");
    rib.className = `concept-card-review is-${c.review.verdict}`;
    rib.textContent = c.review.verdict;
    card.appendChild(rib);
  }

  card.addEventListener("click", () => {
    state.activeId = c.id;
    saveState(state);
    paintGrid(ctx);
    paintDetail(ctx);
    writeExport();
  });
  host.appendChild(card);
}

function paintProductionMap(
  host: HTMLElement,
  state: ConceptState,
  ctx: LabContext,
  paintGrid: (ctx: LabContext) => void,
  paintDetail: (ctx: LabContext) => void,
  writeExport: () => void,
) {
  const intro = document.createElement("header");
  intro.className = "concept-tier-head";
  const h = document.createElement("h2");
  h.textContent = "Unit → production building";
  intro.appendChild(h);
  const n = document.createElement("span");
  n.textContent = `${operatorUnits().length} units`;
  intro.appendChild(n);
  host.appendChild(intro);

  const table = document.createElement("div");
  table.className = "concept-prod-table";

  for (const unit of operatorUnits()) {
    const buildings = productionBuildingsFor(unit);
    const row = document.createElement("div");
    row.className =
      "concept-prod-row" + (unit.id === state.activeId ? " is-active" : "");

    const unitBtn = document.createElement("button");
    unitBtn.type = "button";
    unitBtn.className = "concept-prod-unit";
    const uUrl = imageUrlFor(unit.id, state.pins);
    if (uUrl) {
      const img = document.createElement("img");
      img.src = uUrl;
      img.alt = "";
      unitBtn.appendChild(img);
    }
    const uMeta = document.createElement("div");
    uMeta.className = "concept-prod-meta";
    const uName = document.createElement("strong");
    uName.textContent = unit.label;
    uMeta.appendChild(uName);
    const uTier = document.createElement("span");
    uTier.textContent = techBadge(unit);
    uMeta.appendChild(uTier);
    const uBlurb = document.createElement("em");
    uBlurb.textContent = unit.blurb;
    uMeta.appendChild(uBlurb);
    unitBtn.appendChild(uMeta);
    unitBtn.addEventListener("click", () => {
      state.activeId = unit.id;
      saveState(state);
      paintGrid(ctx);
      paintDetail(ctx);
      writeExport();
    });
    row.appendChild(unitBtn);

    const arrow = document.createElement("div");
    arrow.className = "concept-prod-arrow";
    arrow.textContent = "←";
    arrow.title = "trained at";
    row.appendChild(arrow);

    const builders = document.createElement("div");
    builders.className = "concept-prod-builders";
    if (!buildings.length) {
      const none = document.createElement("span");
      none.className = "concept-prod-none";
      none.textContent =
        unit.trainedAt && unit.trainedAt.length === 0
          ? "Not in Operators deck"
          : "No producer linked";
      builders.appendChild(none);
    } else {
      for (const b of buildings) {
        const bBtn = document.createElement("button");
        bBtn.type = "button";
        bBtn.className =
          "concept-prod-building" + (b.id === state.activeId ? " is-active" : "");
        const bUrl = imageUrlFor(b.id, state.pins);
        if (bUrl) {
          const img = document.createElement("img");
          img.src = bUrl;
          img.alt = "";
          bBtn.appendChild(img);
        }
        const bMeta = document.createElement("div");
        bMeta.className = "concept-prod-meta";
        const bName = document.createElement("strong");
        bName.textContent = b.label;
        bMeta.appendChild(bName);
        const bTier = document.createElement("span");
        bTier.textContent = techBadge(b);
        bMeta.appendChild(bTier);
        if (b.produces) {
          const bProd = document.createElement("em");
          bProd.textContent = `produces ${b.produces}`;
          bMeta.appendChild(bProd);
        }
        bBtn.appendChild(bMeta);
        bBtn.addEventListener("click", () => {
          state.activeId = b.id;
          saveState(state);
          paintGrid(ctx);
          paintDetail(ctx);
          writeExport();
        });
        builders.appendChild(bBtn);
      }
    }
    row.appendChild(builders);
    table.appendChild(row);
  }

  host.appendChild(table);
}

export function makeConceptLab(): Lab {
  let state = loadState();
  let unsubLevers: (() => void) | null = null;
  let gridEl: HTMLElement | null = null;
  let detailEl: HTMLElement | null = null;
  let exportEl: HTMLPreElement | null = null;
  let panelRoot: HTMLElement | null = null;

  /**
   * Compact handoff dump — only human marks that need action or update
   * catalog review. Drops style/roster/production/full card payloads
   * (those live in source); agent re-opens catalog when a todo id hits.
   */
  const buildExport = (): string => {
    const tally = { keep: 0, revise: 0, reject: 0 };
    /** Still needs work: revise / reject, or keep/blank with notes. */
    const todo: Array<{
      id: string;
      label: string;
      verdict: ConceptVerdict;
      notes: string;
      /** Agent review verdict when it differs from human. */
      was?: ReviewVerdict;
    }> = [];
    /** Human keep, no notes — flip agent review to keep if it was revise/reject. */
    const promoted: Array<{ id: string; label: string; was: ReviewVerdict }> =
      [];
    /** Human keep matching agent keep (or no agent review) — listed by id. */
    const keep: Array<{ id: string; label: string }> = [];

    for (const c of OPERATORS_CONCEPTS) {
      const fb = state.cards[c.id];
      if (!fb) continue;
      const notes = fb.notes.trim();
      const v = fb.verdict;
      if (!v && !notes) continue;

      if (v === "keep" || v === "revise" || v === "reject") tally[v]++;

      const agent = c.review?.verdict;
      const was = agent && v && agent !== v ? agent : undefined;

      if (v === "revise" || v === "reject" || notes) {
        todo.push({
          id: c.id,
          label: c.label,
          verdict: v,
          notes,
          ...(was ? { was } : {}),
        });
        continue;
      }

      if (v === "keep") {
        if (agent && agent !== "keep") {
          promoted.push({ id: c.id, label: c.label, was: agent });
        } else {
          keep.push({ id: c.id, label: c.label });
        }
      }
    }

    const globalNotes = state.globalNotes.trim();
    const payload = {
      lab: "concept" as const,
      tally,
      ...(globalNotes ? { globalNotes } : {}),
      ...(todo.length ? { todo } : {}),
      ...(promoted.length ? { promoted } : {}),
      ...(keep.length ? { keep } : {}),
      at: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  };

  const writeExport = () => {
    if (exportEl) exportEl.textContent = buildExport();
  };

  const paintDetail = (ctx: LabContext) => {
    if (!detailEl) return;
    detailEl.replaceChildren();
    const def = conceptById(state.activeId);
    if (!def) {
      detailEl.textContent = "No concept selected.";
      return;
    }
    const fb = ensureCard(state, def.id);
    const iters = iterationsFor(def.id);
    const activeKey = activeIterKey(def.id, state.pins);
    const url = imageUrlFor(def.id, state.pins);

    const head = document.createElement("div");
    head.className = "lab-section-title";
    head.textContent = def.label;
    detailEl.appendChild(head);

    const chips = document.createElement("div");
    chips.className = "concept-chips";
    const chip = (text: string, cls = "") => {
      const s = document.createElement("span");
      s.className = "concept-chip" + (cls ? ` ${cls}` : "");
      s.textContent = text;
      chips.appendChild(s);
    };
    chip(techBadge(def), "is-tech");
    chip(def.kind);
    chip(BRANCH_LABELS[def.branch]);
    if (def.cost != null) chip(`${def.cost} energy`);
    if (def.produces) chip(`→ ${def.produces}`);
    if (def.kind === "unit") {
      const trainers = productionBuildingsFor(def);
      if (trainers.length) {
        chip(`from ${trainers.map((b) => b.label).join(", ")}`);
      } else if (def.trainedAt && def.trainedAt.length === 0) {
        chip("no producer in deck");
      }
    }
    if (def.prereq) chip(`needs ${def.prereq}`);
    if (def.sim) chip(`sim:${def.sim}`);
    if (iters.length > 1) chip(`${iters.length} iters`);
    if (activeKey !== "current") chip(`pin:${activeKey}`);
    if (!isActiveConcept(def)) chip("unused", "is-unused");
    detailEl.appendChild(chips);

    const blurb = document.createElement("p");
    blurb.className = "concept-blurb";
    blurb.textContent = def.blurb;
    detailEl.appendChild(blurb);

    if (url) {
      const img = document.createElement("img");
      img.className = "concept-detail-img";
      img.src = url;
      img.alt = def.label;
      detailEl.appendChild(img);
    } else {
      const miss = document.createElement("div");
      miss.className = "concept-missing";
      miss.textContent = "NO ART YET";
      detailEl.appendChild(miss);
    }

    if (iters.length > 0) {
      const itTitle = document.createElement("div");
      itTitle.className = "lab-section-title";
      itTitle.textContent =
        iters.length > 1
          ? `Iterations — ${activeKey} · click to pin`
          : "Iterations";
      detailEl.appendChild(itTitle);

      const hint = document.createElement("p");
      hint.className = "lab-hint";
      hint.textContent =
        "History lives under assets/operators/history/<id>/. Pin shows in the gallery; main file stays until an agent promotes a pin.";
      detailEl.appendChild(hint);

      const strip = document.createElement("div");
      strip.className = "concept-iters";
      for (const it of iters) {
        const b = document.createElement("button");
        b.type = "button";
        b.className =
          "concept-iter" + (it.key === activeKey ? " is-active" : "");
        b.title =
          it.key === "current"
            ? "Main plate (assets/operators/" + def.id + ".jpg)"
            : `History gen ${it.label}`;
        const thumb = document.createElement("img");
        thumb.src = it.url;
        thumb.alt = it.label;
        thumb.loading = "lazy";
        b.appendChild(thumb);
        const cap = document.createElement("span");
        cap.textContent = it.label;
        b.appendChild(cap);
        b.addEventListener("click", () => {
          if (it.key === "current") {
            delete state.pins[def.id];
          } else {
            state.pins[def.id] = it.key;
          }
          saveState(state);
          paintDetail(ctx);
          paintGrid(ctx);
          writeExport();
          ctx.stat("iter", it.key);
        });
        strip.appendChild(b);
      }
      detailEl.appendChild(strip);

      if (activeKey !== "current") {
        const clearRow = document.createElement("div");
        clearRow.className = "lab-btn-row";
        const clearPin = document.createElement("button");
        clearPin.type = "button";
        clearPin.className = "lab-btn";
        clearPin.textContent = "Use current file";
        clearPin.addEventListener("click", () => {
          delete state.pins[def.id];
          saveState(state);
          paintDetail(ctx);
          paintGrid(ctx);
          writeExport();
          ctx.stat("iter", "current");
        });
        clearRow.appendChild(clearPin);
        detailEl.appendChild(clearRow);
      }
    }

    const how = document.createElement("div");
    how.className = "lab-section-title";
    how.textContent = "What it does";
    detailEl.appendChild(how);

    const detail = document.createElement("p");
    detail.className = "concept-detail-body";
    detail.textContent = def.detail;
    detailEl.appendChild(detail);

    if (def.review && ctx.levers.bool("show_review")) {
      const r = def.review;
      const rTitle = document.createElement("div");
      rTitle.className = "lab-section-title";
      rTitle.textContent = `Agent review — ${r.verdict}`;
      detailEl.appendChild(rTitle);

      const block = document.createElement("div");
      block.className = `concept-review is-${r.verdict}`;

      const keeps = document.createElement("p");
      keeps.className = "concept-review-keeps";
      keeps.textContent = r.keeps;
      block.appendChild(keeps);

      const ul = document.createElement("ul");
      ul.className = "concept-review-fixes";
      for (const f of r.fixes) {
        const li = document.createElement("li");
        li.textContent = f;
        ul.appendChild(li);
      }
      block.appendChild(ul);

      if (r.mesh) {
        const m = document.createElement("p");
        m.className = "concept-review-mesh";
        m.textContent = `Mesh: ${r.mesh}`;
        block.appendChild(m);
      }
      detailEl.appendChild(block);

      const notes = rosterNotesFor(def.id);
      if (notes.length) {
        const nt = document.createElement("div");
        nt.className = "lab-section-title";
        nt.textContent = "Roster notes touching this";
        detailEl.appendChild(nt);
        for (const n of notes) {
          const p = document.createElement("p");
          p.className = "concept-roster-note";
          const b = document.createElement("strong");
          b.textContent = n.title;
          p.appendChild(b);
          p.appendChild(document.createTextNode(` — ${n.body}`));
          detailEl.appendChild(p);
        }
      }
    }

    const vLabel = document.createElement("div");
    vLabel.className = "lab-section-title";
    vLabel.textContent = "Your verdict";
    detailEl.appendChild(vLabel);

    const vRow = document.createElement("div");
    vRow.className = "lab-btn-row";
    for (const v of ["keep", "revise", "reject"] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lab-btn" + (fb.verdict === v ? " is-active" : "");
      btn.textContent = v;
      btn.addEventListener("click", () => {
        fb.verdict = fb.verdict === v ? "" : v;
        saveState(state);
        paintDetail(ctx);
        paintGrid(ctx);
        writeExport();
        ctx.stat("verdict", fb.verdict || "—");
      });
      vRow.appendChild(btn);
    }
    detailEl.appendChild(vRow);

    const nLabel = document.createElement("label");
    nLabel.className = "lab-hint";
    nLabel.style.display = "block";
    nLabel.style.marginTop = "8px";
    nLabel.textContent = "Notes for this concept";
    detailEl.appendChild(nLabel);

    const ta = document.createElement("textarea");
    ta.className = "concept-notes";
    ta.rows = 4;
    ta.placeholder = "Too busy / wrong silhouette / love the turret — agent will read this.";
    ta.value = fb.notes;
    ta.addEventListener("input", () => {
      fb.notes = ta.value;
      saveState(state);
      writeExport();
      paintGrid(ctx);
    });
    detailEl.appendChild(ta);

    ctx.stat("concept", def.id);
    ctx.stat("tier", `T${def.tech}`);
    ctx.stat("art", url ? "yes" : "missing");
    ctx.stat("iter", activeKey);
    writeLabQuery({ lab: "concept", concept: def.id });
  };

  const paintGrid = (ctx: LabContext) => {
    if (!gridEl) return;
    gridEl.replaceChildren();

    if (ctx.levers.bool("production_map")) {
      paintProductionMap(gridEl, state, ctx, paintGrid, paintDetail, writeExport);
      ctx.stat("mode", "production");
      ctx.stat("shown", `${operatorUnits().length}u`);
      return;
    }

    ctx.stat("mode", "gallery");
    const group = ctx.levers.bool("group_by_tier");
    let shown = 0;

    if (group) {
      for (const tech of TIERS) {
        const section = document.createElement("section");
        section.className = "concept-tier";
        section.dataset.tech = String(tech);

        if (tech === 2) {
          // T2: one row per doctrine, tech building always leftmost.
          const groups = t2DoctrineGroups()
            .map((g) => ({
              ...g,
              concepts: g.concepts.filter((c) =>
                passesFilters(ctx, c, state.pins),
              ),
            }))
            .filter((g) => g.concepts.length > 0);
          if (!groups.length) continue;

          const total = groups.reduce((n, g) => n + g.concepts.length, 0);
          const head = document.createElement("header");
          head.className = "concept-tier-head";
          const title = document.createElement("h2");
          title.textContent = TECH_LABELS[tech];
          head.appendChild(title);
          const count = document.createElement("span");
          count.textContent = `${total}`;
          head.appendChild(count);
          section.appendChild(head);

          for (const g of groups) {
            const sub = document.createElement("div");
            sub.className = "concept-doctrine";
            sub.dataset.doctrine = g.id;

            const subHead = document.createElement("header");
            subHead.className = "concept-doctrine-head";
            const subTitle = document.createElement("h3");
            subTitle.textContent = `${g.label} · ${BRANCH_LABELS[g.branch]}`;
            subHead.appendChild(subTitle);
            const subCount = document.createElement("span");
            subCount.textContent = `${g.concepts.length}`;
            subHead.appendChild(subCount);
            sub.appendChild(subHead);

            const row = document.createElement("div");
            row.className = "concept-grid concept-grid-doctrine";
            for (const c of g.concepts) {
              appendCard(row, c, state, ctx, paintGrid, paintDetail, writeExport);
              shown++;
            }
            sub.appendChild(row);
            section.appendChild(sub);
          }
          gridEl.appendChild(section);
          continue;
        }

        const list = conceptsByTech(tech).filter((c) =>
          passesFilters(ctx, c, state.pins),
        );
        if (!list.length) continue;

        const head = document.createElement("header");
        head.className = "concept-tier-head";
        const title = document.createElement("h2");
        title.textContent = TECH_LABELS[tech];
        head.appendChild(title);
        const count = document.createElement("span");
        count.textContent = `${list.length}`;
        head.appendChild(count);
        section.appendChild(head);

        const row = document.createElement("div");
        row.className = "concept-grid";
        for (const c of list) {
          appendCard(row, c, state, ctx, paintGrid, paintDetail, writeExport);
          shown++;
        }
        section.appendChild(row);
        gridEl.appendChild(section);
      }

      if (ctx.levers.bool("show_unused")) {
        const unused = unusedConcepts().filter((c) =>
          passesFilters(ctx, c, state.pins, { allowUnused: true }),
        );
        if (unused.length) {
          const section = document.createElement("section");
          section.className = "concept-tier concept-tier-unused";
          section.dataset.tech = "unused";
          const head = document.createElement("header");
          head.className = "concept-tier-head";
          const title = document.createElement("h2");
          title.textContent = "Unused · Retired";
          head.appendChild(title);
          const count = document.createElement("span");
          count.textContent = `${unused.length}`;
          head.appendChild(count);
          section.appendChild(head);
          const hint = document.createElement("p");
          hint.className = "lab-hint";
          hint.textContent =
            "Not in the live Operators deck. Kept for art comparison.";
          section.appendChild(hint);
          const row = document.createElement("div");
          row.className = "concept-grid";
          for (const c of unused) {
            appendCard(row, c, state, ctx, paintGrid, paintDetail, writeExport);
            shown++;
          }
          section.appendChild(row);
          gridEl.appendChild(section);
        }
      }
    } else {
      const list = flatList(ctx, state.pins);
      const row = document.createElement("div");
      row.className = "concept-grid";
      for (const c of list) {
        appendCard(row, c, state, ctx, paintGrid, paintDetail, writeExport);
        shown++;
      }
      gridEl.appendChild(row);

      if (ctx.levers.bool("show_unused")) {
        const unused = unusedConcepts().filter((c) =>
          passesFilters(ctx, c, state.pins, { allowUnused: true }),
        );
        if (unused.length) {
          const section = document.createElement("section");
          section.className = "concept-tier concept-tier-unused";
          const head = document.createElement("header");
          head.className = "concept-tier-head";
          const title = document.createElement("h2");
          title.textContent = "Unused · Retired";
          head.appendChild(title);
          const count = document.createElement("span");
          count.textContent = `${unused.length}`;
          head.appendChild(count);
          section.appendChild(head);
          const rowU = document.createElement("div");
          rowU.className = "concept-grid";
          for (const c of unused) {
            appendCard(rowU, c, state, ctx, paintGrid, paintDetail, writeExport);
            shown++;
          }
          section.appendChild(rowU);
          gridEl.appendChild(section);
        }
      }
    }

    if (!shown) {
      const empty = document.createElement("p");
      empty.className = "lab-hint";
      empty.textContent = "No concepts match the unit / building filters.";
      gridEl.appendChild(empty);
    }

    const activeN = OPERATORS_CONCEPTS.filter(isActiveConcept).length;
    ctx.stat("shown", `${shown}/${activeN}`);
    const withFb = OPERATORS_CONCEPTS.filter((c) => {
      const f = state.cards[c.id];
      return f && (f.verdict || f.notes.trim());
    }).length;
    ctx.stat("feedback", `${withFb}`);
    const t = reviewTally();
    ctx.stat("review", `${t.reject}✗ ${t.revise}~ ${t.keep}✓`);
  };

  const select = (ctx: LabContext, raw: string): boolean => {
    const id = resolveConceptId(raw);
    if (!id) return false;
    state.activeId = id;
    saveState(state);
    paintGrid(ctx);
    paintDetail(ctx);
    writeExport();
    return true;
  };

  return {
    id: "concept",
    title: "Concept",
    blurb: "Operators wireframe concepts — group by tier, production map, feedback diff.",
    levers: LEVERS,

    setup(ctx) {
      leverCtx = ctx;
      state = loadState();
      applyStoredLevers(ctx, state.levers);
      const q = readLabQuery();
      if (q.concept && resolveConceptId(q.concept)) {
        state.activeId = resolveConceptId(q.concept)!;
      }
      if (!conceptById(state.activeId)) state.activeId = DEFAULT_ID;

      ctx.viewport.replaceChildren();
      const shell = document.createElement("div");
      shell.className = "concept-shell";
      const grid = document.createElement("div");
      grid.className = "concept-gallery";
      gridEl = grid;
      shell.appendChild(grid);
      ctx.viewport.appendChild(shell);

      ctx.panel.replaceChildren();
      panelRoot = document.createElement("div");
      ctx.panel.appendChild(panelRoot);

      detailEl = document.createElement("div");
      detailEl.className = "concept-detail";
      panelRoot.appendChild(detailEl);

      const gTitle = document.createElement("div");
      gTitle.className = "lab-section-title";
      gTitle.textContent = "Session notes";
      panelRoot.appendChild(gTitle);

      const gHint = document.createElement("p");
      gHint.className = "lab-hint";
      gHint.textContent =
        "Overall art direction. Per-card notes above. Copy JSON → paste in chat.";
      panelRoot.appendChild(gHint);

      const gTa = document.createElement("textarea");
      gTa.className = "concept-notes";
      gTa.rows = 3;
      gTa.placeholder = "Faction-wide: silhouette, green weight, scale…";
      gTa.value = state.globalNotes;
      gTa.addEventListener("input", () => {
        state.globalNotes = gTa.value;
        saveState(state);
        writeExport();
      });
      panelRoot.appendChild(gTa);

      const rqTitle = document.createElement("div");
      rqTitle.className = "lab-section-title";
      const tally = reviewTally();
      rqTitle.textContent = `Regen queue — ${tally.reject} reject · ${tally.revise} revise · ${tally.keep} keep`;
      panelRoot.appendChild(rqTitle);

      const rqHint = document.createElement("p");
      rqHint.className = "lab-hint";
      rqHint.textContent =
        "Standing review lives in catalog.ts → ConceptDef.review, so it diffs. Worst first.";
      panelRoot.appendChild(rqHint);

      const rq = document.createElement("div");
      rq.className = "concept-queue";
      for (const c of reviewQueue()) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `concept-queue-row is-${c.review!.verdict}`;
        const v = document.createElement("span");
        v.className = "concept-queue-verdict";
        v.textContent = c.review!.verdict;
        b.appendChild(v);
        const l = document.createElement("span");
        l.textContent = c.label;
        b.appendChild(l);
        b.addEventListener("click", () => select(ctx, c.id));
        rq.appendChild(b);
      }
      panelRoot.appendChild(rq);

      const rnTitle = document.createElement("div");
      rnTitle.className = "lab-section-title";
      rnTitle.textContent = "Roster notes";
      panelRoot.appendChild(rnTitle);

      for (const n of ROSTER_NOTES) {
        const d = document.createElement("details");
        d.className = "concept-roster";
        const s = document.createElement("summary");
        s.textContent = n.title;
        d.appendChild(s);
        const p = document.createElement("p");
        p.textContent = n.body;
        d.appendChild(p);
        panelRoot.appendChild(d);
      }

      const capTitle = document.createElement("div");
      capTitle.className = "lab-section-title";
      capTitle.textContent = "Handoff";
      panelRoot.appendChild(capTitle);

      const actRow = document.createElement("div");
      actRow.className = "lab-btn-row";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "lab-btn";
      copy.textContent = "Copy feedback diff";
      copy.addEventListener("click", async () => {
        const text = buildExport();
        writeExport();
        const ok = await copyText(text);
        if (ok) {
          flashButton(copy, "Copied!");
          ctx.stat("export", "copied");
        } else {
          // Last resort: select the preview so the user can Ctrl/Cmd+C
          if (exportEl) {
            const range = document.createRange();
            range.selectNodeContents(exportEl);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            exportEl.scrollIntoView({ block: "nearest" });
          }
          flashButton(copy, "Select + copy");
          ctx.stat("export", "select+copy");
        }
      });
      actRow.appendChild(copy);

      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "lab-btn";
      clear.textContent = "Clear verdicts";
      clear.addEventListener("click", () => {
        for (const id of Object.keys(state.cards)) {
          state.cards[id] = { verdict: "", notes: state.cards[id]?.notes ?? "" };
        }
        saveState(state);
        paintGrid(ctx);
        paintDetail(ctx);
        writeExport();
      });
      actRow.appendChild(clear);
      panelRoot.appendChild(actRow);

      exportEl = document.createElement("pre");
      exportEl.className = "concept-export";
      panelRoot.appendChild(exportEl);

      unsubLevers = ctx.levers.onChange(() => {
        saveState(state);
        paintGrid(ctx);
        // Detail panel may hide/show agent review when that toggle flips.
        paintDetail(ctx);
      });

      liveHandle = {
        load: (raw) => select(ctx, raw),
        current: () => state.activeId,
        exportFeedback: () => buildExport(),
      };

      paintGrid(ctx);
      paintDetail(ctx);
      writeExport();
      writeLabQuery({ lab: "concept", concept: state.activeId });
      // Snapshot restored levers so a no-touch refresh still round-trips cleanly.
      saveState(state);
      ctx.stat("lab", "Concept");
    },

    tick(_dt, _ctx) {
      /* static gallery */
    },

    teardown(ctx) {
      unsubLevers?.();
      unsubLevers = null;
      liveHandle = null;
      gridEl = null;
      detailEl = null;
      exportEl = null;
      panelRoot = null;
      saveState(state);
      leverCtx = null;
      ctx.viewport.replaceChildren();
      ctx.panel.replaceChildren();
    },
  };
}
