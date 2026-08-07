/**
 * Lab shell — picker, generated levers, stats.
 * Labs own their update loop content; shell only calls tick + renders UI chrome.
 *
 * Deep links (model-friendly):
 *   /?lab=mesh&mesh=u:scout
 *   /?lab=mesh&mesh=scout
 *   /?lab=readability
 *   /?lab=concept&concept=rover
 *   /?lab=dispatch&dispatch=scout_works
 *
 * Runtime API: window.ccLabs.openMesh("u:scout") · openConcept("rover") ·
 *   openDispatch("scout_works") · openLab("dispatch")
 */
import type { Lab, LabContext } from "./lab";
import { LeverRegistry, mountLeverPanel } from "./levers";
import {
  getConceptLabHandle,
  makeConceptLab,
  resolveConceptId,
} from "./labs/concept/index";
import {
  getDispatchLabHandle,
  listDispatchCatalog,
  makeDispatchLab,
  resolveDispatchId,
} from "./labs/dispatch/index";
import {
  getMeshLabHandle,
  listMeshCatalog,
  makeMeshLab,
  resolveMeshId,
} from "./labs/mesh/index";
import { makeReadabilityLab } from "./labs/readability/index";
import { readLabQuery, writeLabQuery } from "./query";
import "./styles.css";

const LAB_FACTORIES: Array<() => Lab> = [
  makeReadabilityLab,
  makeMeshLab,
  makeConceptLab,
  makeDispatchLab,
];
const ACTIVE_KEY = "crater-labs:active";

function rememberedId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
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
const stats = new Map<string, string>();
let panelCtl: { destroy(): void; refresh(): void } | null = null;
let active: Lab | null = null;
let last = performance.now();
let raf = 0;

const ctx: LabContext = {
  viewport,
  panel,
  levers,
  stat(key, value) {
    stats.set(key, String(value));
    renderStats();
  },
  refreshPanel() {
    panelCtl?.refresh();
  },
};

function renderStats() {
  statsEl.replaceChildren();
  for (const [k, v] of stats) {
    const span = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = k;
    span.append(b, document.createTextNode(v));
    statsEl.appendChild(span);
  }
}

function activate(factory: () => Lab) {
  if (active) {
    active.teardown(ctx);
    active = null;
  }
  stats.clear();
  levers.clear();
  panelCtl?.destroy();
  panelCtl = null;
  leverHost.replaceChildren();
  panel.replaceChildren();
  viewport.replaceChildren();

  const lab = factory();
  active = lab;
  remember(lab.id);
  const prev = readLabQuery();
  writeLabQuery({
    lab: lab.id,
    // keep deep-link params only for the lab that owns them
    mesh: lab.id === "mesh" ? prev.mesh : null,
    concept: lab.id === "concept" ? prev.concept : null,
    board: lab.id === "readability" ? prev.board : null,
    dispatch: lab.id === "dispatch" ? prev.dispatch : null,
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
  if (active?.id === id) return true;
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

function openDispatch(raw: string): boolean {
  const id = resolveDispatchId(raw);
  if (!id) return false;
  writeLabQuery({ lab: "dispatch", dispatch: id });
  if (active?.id !== "dispatch") {
    activate(makeDispatchLab);
    return getDispatchLabHandle()?.current() === id;
  }
  return getDispatchLabHandle()?.load(id) ?? false;
}

/** Public API for agents / console — no UI clicking required. */
window.ccLabs = {
  lab: () => active?.id ?? null,
  openLab,
  openMesh,
  openConcept,
  openDispatch,
  listMeshes: () => listMeshCatalog(),
  listDispatches: () => listDispatchCatalog(),
  listLabs: () => LAB_FACTORIES.map((f) => f().id),
  mesh: () => getMeshLabHandle()?.current() ?? null,
  meshFeedback: () => getMeshLabHandle()?.exportFeedback() ?? null,
  concept: () => getConceptLabHandle()?.current() ?? null,
  conceptFeedback: () => getConceptLabHandle()?.exportFeedback() ?? null,
  dispatch: () => getDispatchLabHandle()?.current() ?? null,
  dispatchFeedback: () => getDispatchLabHandle()?.exportFeedback() ?? null,
  replayDispatch: () => getDispatchLabHandle()?.replay(),
};

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  active?.tick(dt, ctx);
  raf = requestAnimationFrame(loop);
}

// Boot: URL beats localStorage. ?mesh= alone implies mesh lab; ?concept= → concept.
const q = readLabQuery();
const fromUrl =
  q.lab && factoryById(q.lab)
    ? q.lab
    : q.mesh && resolveMeshId(q.mesh)
      ? "mesh"
      : q.concept && resolveConceptId(q.concept)
        ? "concept"
        : q.dispatch && resolveDispatchId(q.dispatch)
          ? "dispatch"
          : null;
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
  const labId =
    nq.lab && factoryById(nq.lab)
      ? nq.lab
      : nq.mesh && resolveMeshId(nq.mesh)
        ? "mesh"
        : nq.concept && resolveConceptId(nq.concept)
          ? "concept"
          : nq.dispatch && resolveDispatchId(nq.dispatch)
            ? "dispatch"
            : active?.id;
  if (labId && labId !== active?.id) {
    const f = factoryById(labId);
    if (f) activate(f);
    return;
  }
  if (active?.id === "mesh" && nq.mesh) {
    getMeshLabHandle()?.load(nq.mesh);
  }
  if (active?.id === "concept" && nq.concept) {
    getConceptLabHandle()?.load(nq.concept);
  }
  if (active?.id === "dispatch" && nq.dispatch) {
    getDispatchLabHandle()?.load(nq.dispatch);
  }
});

declare global {
  interface Window {
    ccLabs: {
      lab(): string | null;
      openLab(id: string): boolean;
      openMesh(raw: string): boolean;
      openConcept(raw: string): boolean;
      openDispatch(raw: string): boolean;
      listMeshes(): { id: string; label: string; section: string }[];
      listDispatches(): { id: string; label: string; status: string }[];
      listLabs(): string[];
      mesh(): string | null;
      meshFeedback(): string | null;
      concept(): string | null;
      conceptFeedback(): string | null;
      dispatch(): string | null;
      dispatchFeedback(): string | null;
      replayDispatch(): void;
    };
  }
}
