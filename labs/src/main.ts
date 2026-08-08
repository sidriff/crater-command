/**
 * Lab shell — picker, generated levers, stats.
 * Labs own their update loop content; shell only calls tick + renders UI chrome.
 *
 * Deep links (model-friendly):
 *   /?lab=mesh&mesh=u:scout
 *   /?lab=construction&card=u:scout
 *   /?lab=destruction&destruction=u:scout
 *   /?lab=concept&concept=rover
 *   Legacy: /?lab=death&death=u:scout · /?lab=dispatch&dispatch=scout_works
 *
 * Runtime API: window.ccLabs.openMesh · openConstruction · openDestruction ·
 *   openConcept · openDeath (alias) · openDispatch (alias)
 */
import type { Lab, LabContext } from "./lab";
import { LeverRegistry, mountLeverPanel } from "./levers";
import {
  getConceptLabHandle,
  makeConceptLab,
  resolveConceptId,
} from "./labs/concept/index";
import {
  getConstructionLabHandle,
  listConstructionCatalog,
  makeConstructionLab,
  resolveCardId,
} from "./labs/construction/index";
import {
  getDestructionLabHandle,
  listDestructionCatalog,
  makeDestructionLab,
  resolveDestructionId,
} from "./labs/destruction/index";
import {
  getMeshLabHandle,
  listMeshCatalog,
  makeMeshLab,
  resolveMeshId,
} from "./labs/mesh/index";
import { makeReadabilityLab } from "./labs/readability/index";
import { readLabQuery, writeLabQuery } from "./query";
import "./styles.css";

/** Picker order: Construction then Destruction (right of Construction). */
const LAB_FACTORIES: Array<() => Lab> = [
  makeReadabilityLab,
  makeMeshLab,
  makeConceptLab,
  makeConstructionLab,
  makeDestructionLab,
];
const ACTIVE_KEY = "crater-labs:active";

function rememberedId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id === "dispatch") return "construction";
    if (id === "death") return "destruction";
    return id;
  } catch {
    return null;
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

function factoryById(id: string): (() => Lab) | undefined {
  if (id === "dispatch") id = "construction";
  if (id === "death") id = "destruction";
  return LAB_FACTORIES.find((f) => f().id === id);
}

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <header class="lab-top" data-ui>
    <div class="lab-brand">CC<span>LABS</span></div>
    <nav class="lab-picker" id="lab-picker"></nav>
    <div class="lab-blurb" id="lab-blurb"></div>
  </header>
  <div class="lab-viewport" id="lab-viewport"></div>
  <aside class="lab-side" data-ui>
    <div class="lab-side-scroll">
      <div id="lab-lever-host"></div>
      <div id="lab-panel"></div>
    </div>
  </aside>
  <footer class="lab-stats" id="lab-stats" data-ui></footer>
`;

const viewport = app.querySelector<HTMLElement>("#lab-viewport")!;
const panel = app.querySelector<HTMLElement>("#lab-panel")!;
const leverHost = app.querySelector<HTMLElement>("#lab-lever-host")!;
const picker = app.querySelector<HTMLElement>("#lab-picker")!;
const blurbEl = app.querySelector<HTMLElement>("#lab-blurb")!;
const statsEl = app.querySelector<HTMLElement>("#lab-stats")!;

const levers = new LeverRegistry();
/** key → displayed string */
const stats = new Map<string, string>();
/** key → value text node (stable DOM — no full rebuild each frame) */
const statNodes = new Map<string, Text>();
let panelCtl: { destroy(): void; refresh(): void } | null = null;
let active: Lab | null = null;
let last = performance.now();
let raf = 0;

/** Shell frame budget — always on so any lab can verify hitch. */
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let lastWorkMs = 0;

const ctx: LabContext = {
  viewport,
  panel,
  levers,
  stat(key, value) {
    const s = String(value);
    if (stats.get(key) === s) return;
    stats.set(key, s);
    let node = statNodes.get(key);
    if (!node) {
      const span = document.createElement("span");
      if (key === "fps" || key === "ms" || key === "draw" || key === "tris") {
        span.className = "lab-stat-perf";
        span.dataset.stat = key;
      }
      const b = document.createElement("b");
      b.textContent = key;
      node = document.createTextNode(s);
      span.append(b, node);
      statsEl.appendChild(span);
      statNodes.set(key, node);
    } else {
      node.textContent = s;
    }
  },
  refreshPanel() {
    panelCtl?.refresh();
  },
};

function clearStats() {
  stats.clear();
  statNodes.clear();
  statsEl.replaceChildren();
}

function activate(factory: () => Lab) {
  if (active) {
    active.teardown(ctx);
    active = null;
  }
  clearStats();
  levers.clear();
  panelCtl?.destroy();
  panelCtl = null;
  leverHost.replaceChildren();
  panel.replaceChildren();
  viewport.replaceChildren();
  fpsFrames = 0;
  fpsWindowStart = performance.now();
  lastWorkMs = 0;

  const lab = factory();
  active = lab;
  remember(lab.id);
  const prev = readLabQuery();
  writeLabQuery({
    lab: lab.id,
    // keep deep-link params only for the lab that owns them
    mesh: lab.id === "mesh" ? prev.mesh : null,
    death: null,
    destruction:
      lab.id === "destruction" ? prev.destruction ?? prev.death : null,
    concept: lab.id === "concept" ? prev.concept : null,
    board: lab.id === "readability" ? prev.board : null,
    card: lab.id === "construction" ? prev.card ?? prev.dispatch : null,
    mode: lab.id === "construction" ? prev.mode : null,
    dispatch: null,
  });
  blurbEl.textContent = lab.blurb;
  levers.register(lab.levers);
  panelCtl = mountLeverPanel(leverHost, levers, {
    onChange: () => {
      /* labs listen via levers.onChange */
    },
  });
  lab.setup(ctx);
  paintPicker();
  ctx.stat("lab", lab.title);
}

function paintPicker() {
  picker.replaceChildren();
  for (const factory of LAB_FACTORIES) {
    const lab = factory();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lab-pick" + (active?.id === lab.id ? " is-active" : "");
    btn.textContent = lab.title;
    btn.addEventListener("click", () => activate(factory));
    picker.appendChild(btn);
  }
}

function openLab(id: string): boolean {
  const factory = factoryById(id);
  if (!factory) return false;
  if (active?.id === id || (id === "death" && active?.id === "destruction")) {
    return true;
  }
  activate(factory);
  return true;
}

function openMesh(raw: string): boolean {
  const id = resolveMeshId(raw);
  if (!id) return false;
  writeLabQuery({ lab: "mesh", mesh: id });
  if (active?.id !== "mesh") {
    activate(makeMeshLab);
    return getMeshLabHandle()?.current() === id;
  }
  return getMeshLabHandle()?.load(id) ?? false;
}

function openConcept(raw: string): boolean {
  const id = resolveConceptId(raw);
  if (!id) return false;
  writeLabQuery({ lab: "concept", concept: id });
  if (active?.id !== "concept") {
    activate(makeConceptLab);
    return getConceptLabHandle()?.current() === id;
  }
  return getConceptLabHandle()?.load(id) ?? false;
}

function openConstruction(raw: string, mode?: string): boolean {
  const id = resolveCardId(raw);
  if (!id) return false;
  const m =
    mode === "construct" || mode === "dispatch" ? mode : undefined;
  writeLabQuery({
    lab: "construction",
    card: id,
    mode: m ?? null,
    dispatch: null,
  });
  if (active?.id !== "construction") {
    activate(makeConstructionLab);
    return getConstructionLabHandle()?.current() === id;
  }
  return getConstructionLabHandle()?.load(id) ?? false;
}

/** @deprecated use openConstruction */
function openDispatch(raw: string): boolean {
  return openConstruction(raw, "dispatch");
}

function openDestruction(raw: string): boolean {
  const id = resolveDestructionId(raw);
  if (!id) return false;
  writeLabQuery({
    lab: "destruction",
    destruction: id,
    death: null,
  });
  if (active?.id !== "destruction") {
    activate(makeDestructionLab);
    return getDestructionLabHandle()?.current() === id;
  }
  return getDestructionLabHandle()?.load(id) ?? false;
}

/** @deprecated use openDestruction */
function openDeath(raw: string): boolean {
  return openDestruction(raw);
}

/** Public API for agents / console — no UI clicking required. */
window.ccLabs = {
  lab: () => active?.id ?? null,
  openLab,
  openMesh,
  openDeath,
  openDestruction,
  openConcept,
  openConstruction,
  openDispatch,
  listMeshes: () => listMeshCatalog(),
  listDeaths: () => listDestructionCatalog(),
  listDestruction: () => listDestructionCatalog(),
  listConstruction: () => listConstructionCatalog(),
  listDispatches: () =>
    listConstructionCatalog().filter((c) => c.mode === "dispatch"),
  listLabs: () => LAB_FACTORIES.map((f) => f().id),
  mesh: () => getMeshLabHandle()?.current() ?? null,
  meshFeedback: () => getMeshLabHandle()?.exportFeedback() ?? null,
  death: () => getDestructionLabHandle()?.current() ?? null,
  deathFeedback: () => getDestructionLabHandle()?.exportFeedback() ?? null,
  playDeath: () => getDestructionLabHandle()?.play(),
  stopDeath: () => getDestructionLabHandle()?.stop(),
  destruction: () => getDestructionLabHandle()?.current() ?? null,
  destructionFeedback: () =>
    getDestructionLabHandle()?.exportFeedback() ?? null,
  playDestruction: () => getDestructionLabHandle()?.play(),
  stopDestruction: () => getDestructionLabHandle()?.stop(),
  concept: () => getConceptLabHandle()?.current() ?? null,
  conceptFeedback: () => getConceptLabHandle()?.exportFeedback() ?? null,
  construction: () => getConstructionLabHandle()?.current() ?? null,
  constructionMode: () => getConstructionLabHandle()?.mode() ?? null,
  constructionFeedback: () =>
    getConstructionLabHandle()?.exportFeedback() ?? null,
  replayConstruction: () => getConstructionLabHandle()?.replay(),
  dispatch: () => getConstructionLabHandle()?.current() ?? null,
  dispatchFeedback: () => getConstructionLabHandle()?.exportFeedback() ?? null,
  replayDispatch: () => getConstructionLabHandle()?.replay(),
};

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  active?.tick(dt, ctx);
  lastWorkMs = performance.now() - t0;

  fpsFrames++;
  const windowMs = now - fpsWindowStart;
  if (windowMs >= 250) {
    const fps = (fpsFrames * 1000) / windowMs;
    ctx.stat("fps", fps.toFixed(0));
    ctx.stat("ms", lastWorkMs.toFixed(1));
    // Color hint via data attr for CSS
    const fpsSpan = statsEl.querySelector<HTMLElement>('[data-stat="fps"]');
    if (fpsSpan) {
      fpsSpan.dataset.band = fps >= 50 ? "ok" : fps >= 30 ? "warn" : "bad";
    }
    const msSpan = statsEl.querySelector<HTMLElement>('[data-stat="ms"]');
    if (msSpan) {
      msSpan.dataset.band =
        lastWorkMs <= 12 ? "ok" : lastWorkMs <= 22 ? "warn" : "bad";
    }
    fpsFrames = 0;
    fpsWindowStart = now;
  }

  raf = requestAnimationFrame(loop);
}

function resolveLabFromQuery(q: ReturnType<typeof readLabQuery>): string | null {
  if (q.lab && factoryById(q.lab)) {
    return q.lab === "death" ? "destruction" : q.lab === "dispatch" ? "construction" : q.lab;
  }
  if (q.mesh && resolveMeshId(q.mesh)) return "mesh";
  if ((q.destruction ?? q.death) && resolveDestructionId(q.destruction ?? q.death)) {
    return "destruction";
  }
  if (q.concept && resolveConceptId(q.concept)) return "concept";
  if ((q.card ?? q.dispatch) && resolveCardId(q.card ?? q.dispatch)) {
    return "construction";
  }
  return null;
}

// Boot: URL beats localStorage.
const q = readLabQuery();
const fromUrl = resolveLabFromQuery(q);
const want = fromUrl ?? rememberedId();
const start = (want && factoryById(want)) || LAB_FACTORIES[0]!;
activate(start);
raf = requestAnimationFrame(loop);

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(raf);
  active?.teardown(ctx);
});

// Back/forward on query changes
window.addEventListener("popstate", () => {
  const nq = readLabQuery();
  const labId = resolveLabFromQuery(nq) ?? active?.id;
  if (labId && labId !== active?.id) {
    const f = factoryById(labId);
    if (f) activate(f);
    return;
  }
  if (active?.id === "mesh" && nq.mesh) {
    getMeshLabHandle()?.load(nq.mesh);
  }
  if (active?.id === "destruction") {
    const id = resolveDestructionId(nq.destruction ?? nq.death);
    if (id) getDestructionLabHandle()?.load(id);
  }
  if (active?.id === "concept" && nq.concept) {
    getConceptLabHandle()?.load(nq.concept);
  }
  if (active?.id === "construction") {
    const id = resolveCardId(nq.card ?? nq.dispatch);
    if (id) getConstructionLabHandle()?.load(id);
  }
});

declare global {
  interface Window {
    ccLabs: {
      lab(): string | null;
      openLab(id: string): boolean;
      openMesh(raw: string): boolean;
      openDeath(raw: string): boolean;
      openDestruction(raw: string): boolean;
      openConcept(raw: string): boolean;
      openConstruction(raw: string, mode?: string): boolean;
      openDispatch(raw: string): boolean;
      listMeshes(): { id: string; label: string; section: string }[];
      listDeaths(): { id: string; label: string; section: string }[];
      listDestruction(): { id: string; label: string; section: string }[];
      listConstruction(): {
        id: string;
        label: string;
        status: string;
        section: string;
        mode: string;
      }[];
      listDispatches(): {
        id: string;
        label: string;
        status: string;
        section: string;
        mode: string;
      }[];
      listLabs(): string[];
      mesh(): string | null;
      meshFeedback(): string | null;
      death(): string | null;
      deathFeedback(): string | null;
      playDeath(): void;
      stopDeath(): void;
      destruction(): string | null;
      destructionFeedback(): string | null;
      playDestruction(): void;
      stopDestruction(): void;
      concept(): string | null;
      conceptFeedback(): string | null;
      construction(): string | null;
      constructionMode(): string | null;
      constructionFeedback(): string | null;
      replayConstruction(): void;
      dispatch(): string | null;
      dispatchFeedback(): string | null;
      replayDispatch(): void;
    };
  }
}
