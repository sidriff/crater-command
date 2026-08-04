/**
 * Lab shell — picker, generated levers, stats.
 * Labs own their update loop content; shell only calls tick + renders UI chrome.
 */
import type { Lab, LabContext } from "./lab";
import { LeverRegistry, mountLeverPanel } from "./levers";
import { makeReadabilityLab } from "./labs/readability/index";
import "./styles.css";

const LAB_FACTORIES: Array<() => Lab> = [makeReadabilityLab];
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

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  active?.tick(dt, ctx);
  raf = requestAnimationFrame(loop);
}

const want = rememberedId();
const start =
  LAB_FACTORIES.find((f) => f().id === want) ?? LAB_FACTORIES[0]!;
activate(start);
raf = requestAnimationFrame(loop);

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(raf);
  active?.teardown(ctx);
});
