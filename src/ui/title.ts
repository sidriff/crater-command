/**
 * CRT title / faction pick — pure DOM, no React.
 * Boot: type CRATER COMMAND (stable layout) → rapid staggered phosphor flicker on
 * HUD jargon → load bar → zoom + approach line → staggered button wink-in.
 * Exit: staggered phosphor wink-out, then banner pick.
 */
import { RACES } from "../game/sim/defs";
import type { RaceId } from "../game/sim/types";
import { ensureMusicFromGesture, startMusic, unlockAudio } from "../game/audio/music";
import { sfxClick, sfxConfirm, sfxOpen, sfxTick } from "../game/audio/sfx";
import { typewrite } from "./typewriter";
import { mountTitleGlobe, type TitleGlobeHandle } from "./titleGlobe";

const TITLE_L1 = "CRATER";
const TITLE_L2 = "COMMAND";
/** Loading bar duration — keep in sync with .boot-progress-fill animation */
const BAR_MS = 1350;
const ZOOM_MS = 1600;
const APPROACH_LINE = "// APPROACH VECTOR LOCKED · HIGH ORBIT";

const TICKER = [
  "BREAKING: BLIGHT FRONT 4.68 AU · TROJAN CLOUD CONSOLIDATING",
  "DAY 14 // BELT SURVEY AUTHORITY · UNCLASSIFIED",
  "CARRIER OK · LAT 47ms · CRC OK · LINK GREEN",
  "MINERS REPORT LIGHTS AT THE RIM · COMMS DRIFT REGION 7",
  "LLOYD'S QUIETLY REVISES TROJAN HAULAGE PREMIUMS",
  "OPS LIVE · PRIORITY ROCKS MARKED · DEPLOY WHEN READY",
];

const ADVISORS: Record<
  RaceId,
  { video: string; poster: string; call: string; line: string }
> = {
  operators: {
    video: "/advisor/operators_idle.mp4?v=1",
    poster: "/advisor/operators.jpg?v=3",
    call: "OPERATORS // OPEN CHANNEL",
    line: "Stay light. Hit first.",
  },
  blight: {
    video: "/advisor/blight_idle.mp4?v=1",
    poster: "/advisor/blight.jpg?v=1",
    call: "OVERLORD // HATCH",
    line: "Expand. Feed. Spread.",
  },
  mandate: {
    video: "/advisor/mandate_idle.mp4?v=1",
    poster: "/advisor/mandate.jpg",
    call: "MANDATE // COMMAND",
    line: "Fortify. Bank. Erase.",
  },
};

export type TitleCallbacks = {
  muted: boolean;
  getMuted: () => boolean;
  onToggleMute: () => void;
  onCommit: (mode: "bot" | "match", race: RaceId) => void;
  onEngage?: () => void;
};

export type TitleHandle = {
  dispose: () => void;
  setMuted: (m: boolean) => void;
};

function cssStars(host: HTMLElement) {
  for (let i = 0; i < 90; i++) {
    const s = document.createElement("span");
    s.className = "crt-star";
    const size = Math.random() < 0.15 ? 2 : 1;
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 100}%`;
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.opacity = String(0.25 + Math.random() * 0.65);
    if (size > 1) s.style.boxShadow = "0 0 4px rgba(0,255,170,0.5)";
    host.appendChild(s);
  }
}

/** Reserve final line width; cursor rides next to the live fill so it advances per glyph. */
function typeSlot(full: string, id: string, cursorClass: string): string {
  return `<span class="crt-type-slot" data-full="${full}"><span class="crt-type-live"><span class="crt-type-fill" id="${id}"></span><span class="crt-cursor ${cursorClass}" aria-hidden="true"></span></span></span>`;
}

/** Jump into a random phase so same-length loops don't hard-reset in lockstep. */
function desyncLoop(v: HTMLVideoElement) {
  const seek = () => {
    if (!Number.isFinite(v.duration) || v.duration <= 0) return;
    try {
      v.currentTime = Math.random() * v.duration;
    } catch {
      /* ignore seek-before-ready races */
    }
  };
  if (v.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
  else v.addEventListener("loadedmetadata", seek, { once: true });
}

/**
 * Manual loop with a short VHS static hit on the cut.
 * Native `loop` seeks silently — we want the seam to read as a CRT glitch.
 */
function wireVhsLoop(v: HTMLVideoElement, staticEl: HTMLElement) {
  v.loop = false;
  let busy = false;

  const burst = (holdMs: number) => {
    staticEl.classList.add("is-on");
    window.setTimeout(() => staticEl.classList.remove("is-on"), holdMs);
  };

  const restart = () => {
    if (busy) return;
    busy = true;
    // 90–180ms of snow — long enough to hide the seek, short enough to stay lofi
    const hold = 90 + Math.floor(Math.random() * 90);
    burst(hold);
    window.setTimeout(() => {
      try {
        v.currentTime = 0;
      } catch {
        /* ignore */
      }
      void v.play().catch(() => {});
      busy = false;
    }, Math.min(70, hold - 20));
  };

  v.addEventListener("ended", restart);
  desyncLoop(v);
}

function factionCard(race: RaceId | "random", onPick: () => void, delayMs: number) {
  const isRandom = race === "random";
  const tint = isRandom ? "#00ffaa" : RACES[race].tint;
  const name = isRandom ? "RANDOM" : RACES[race].name;
  const short = isRandom ? "???" : RACES[race].short;
  const blurb = isRandom
    ? "Blind dice. Any banner. No take-backs."
    : RACES[race].blurb;
  const call = isRandom ? "CHANNEL // STATIC" : ADVISORS[race].call;
  const line = isRandom ? "Signal unknown." : ADVISORS[race].line;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "faction-card phos-btn" + (isRandom ? " faction-random" : "");
  btn.style.setProperty("--tint", tint);
  btn.style.setProperty("--wink-d", `${delayMs}ms`);
  btn.innerHTML = `
    <div class="fc-media">
      ${
        isRandom
          ? `<div class="fc-static" aria-hidden="true">
               <div class="fc-static-grain"></div>
               <div class="fc-static-snow"></div>
               <div class="fc-static-roll"></div>
               <div class="fc-static-scan"></div>
             </div>
             <span class="fc-q">???</span>`
          : `<video src="${ADVISORS[race].video}" poster="${ADVISORS[race].poster}" autoplay muted playsinline preload="metadata"></video>
             <div class="fc-loop-static" aria-hidden="true">
               <div class="fc-static-grain"></div>
               <div class="fc-static-snow"></div>
               <div class="fc-static-roll"></div>
               <div class="fc-static-scan"></div>
               <div class="fc-loop-tear"></div>
             </div>
             <div class="fc-grad"></div>`
      }
      <div class="fc-call">${call}</div>
      <div class="fc-pulse"></div>
    </div>
    <div class="fc-body">
      <div class="fc-row"><span class="fc-short">${short}</span><span class="fc-sel">▸ SELECT</span></div>
      <div class="fc-name">${name}</div>
      <p class="fc-blurb">${blurb}</p>
      <p class="fc-line">${line}</p>
    </div>
  `;
  const vid = btn.querySelector("video");
  const loopStatic = btn.querySelector(".fc-loop-static") as HTMLElement | null;
  if (vid && loopStatic) wireVhsLoop(vid, loopStatic);
  btn.addEventListener("click", onPick);
  return btn;
}

function winkIn(el: HTMLElement, delayMs: number, durationClass = "phos-wink-in") {
  el.classList.remove("phos-off", "phos-wink-out", "phos-wink-in", "phos-wink-in-fast", "hidden");
  el.style.setProperty("--wink-d", `${delayMs}ms`);
  // retrigger
  void el.offsetWidth;
  el.classList.add(durationClass);
}

function winkOut(el: HTMLElement, delayMs: number) {
  el.classList.remove("phos-wink-in", "phos-wink-in-fast");
  el.style.setProperty("--wink-d", `${delayMs}ms`);
  void el.offsetWidth;
  el.classList.add("phos-wink-out");
}

export function mountTitle(stage: HTMLElement, cb: TitleCallbacks): TitleHandle {
  stage.replaceChildren();

  const root = document.createElement("div");
  root.className = "crt-stage";

  const stars = document.createElement("div");
  stars.className = "crt-stars";
  cssStars(stars);

  const globeHost = document.createElement("div");
  globeHost.className = "crt-globe";

  const scan = document.createElement("div");
  scan.className = "crt-scanlines";
  const vig = document.createElement("div");
  vig.className = "crt-vignette";

  const ui = document.createElement("div");
  ui.className = "crt-ui";

  // HUD jargon — starts dark, phosphor-winks after title
  const top = document.createElement("div");
  top.className = "crt-hud-top";
  top.innerHTML = `
    <div class="hud-col hud-left">
      <div class="dim phos-off" data-wink>// CARRIER OK · LAT — · CRC OK</div>
      <div class="dim link-line phos-off" data-wink>// LINK AMBER · RX —</div>
    </div>
    <div class="right hud-col hud-right">
      <div class="warn phos-off" data-wink>// BLIGHT FRONT 4.68 AU</div>
      <div class="dim phos-off" data-wink>// DAY 14 · BSA</div>
    </div>
  `;
  const linkLine = top.querySelector(".link-line") as HTMLElement;

  const titleBody = document.createElement("div");
  titleBody.className = "crt-title-body";

  const center = document.createElement("div");
  center.className = "crt-center";
  center.innerHTML = `
    <p class="crt-kicker phos-off" data-wink>BELT SURVEY AUTHORITY</p>
    <h1 class="crt-title" aria-label="Crater Command">
      <span class="crt-title-line">
        ${typeSlot(TITLE_L1, "crt-l1", "crt-cur-l1")}
      </span>
      <span class="crt-title-line">
        ${typeSlot(TITLE_L2, "crt-l2", "crt-cur-l2 hidden")}
      </span>
    </h1>
    <div class="crt-loadline">
      <span class="crt-type-slot load-slot" data-full="${APPROACH_LINE}"><span class="crt-type-live"><span class="crt-type-fill" id="crt-load"></span><span class="crt-cursor load-cur hidden" aria-hidden="true"></span></span></span>
    </div>
    <div class="boot-progress hidden" id="boot-bar"><div class="boot-progress-fill"></div></div>
  `;
  const l1El = center.querySelector("#crt-l1") as HTMLElement;
  const l2El = center.querySelector("#crt-l2") as HTMLElement;
  const curL1 = center.querySelector(".crt-cur-l1") as HTMLElement;
  const curL2 = center.querySelector(".crt-cur-l2") as HTMLElement;
  const loadEl = center.querySelector("#crt-load") as HTMLElement;
  const loadCur = center.querySelector(".load-cur") as HTMLElement;
  const bootBar = center.querySelector("#boot-bar") as HTMLElement;
  const kicker = center.querySelector(".crt-kicker") as HTMLElement;

  const actions = document.createElement("div");
  actions.className = "crt-actions";
  actions.innerHTML = `
    <button type="button" class="phos-btn primary phos-off" data-act="match" data-wink>
      <span class="tag">// DEPLOY</span>
      <span class="label">FIND 1V1</span>
      <span class="chev">▸</span>
    </button>
    <button type="button" class="phos-btn phos-off" data-act="bot" data-wink>
      <span class="tag">// SIM</span>
      <span class="label">PRACTICE VS BOT</span>
      <span class="chev">▸</span>
    </button>
    <button type="button" class="phos-btn slim phos-off" data-act="mute" data-wink>
      <span class="tag">// AUDIO</span>
      <span class="label mute-label">${cb.getMuted() ? "MUTED" : "LIVE"}</span>
    </button>
  `;
  const muteLabel = actions.querySelector(".mute-label") as HTMLElement;
  const actionBtns = [...actions.querySelectorAll("button[data-act]")] as HTMLButtonElement[];

  titleBody.append(center, actions);

  const pick = document.createElement("div");
  pick.className = "pick-panel hidden";
  pick.innerHTML = `
    <div class="pick-main">
      <div class="pick-head phos-off">
        <p class="title">// SELECT FACTION</p>
        <p class="mode" id="pick-mode">MODE // BOT SIM</p>
      </div>
      <div class="faction-grid" id="faction-grid"></div>
    </div>
    <button type="button" class="pick-abort phos-off" id="pick-abort">← // ABORT TO ORBIT</button>
  `;
  const pickMode = pick.querySelector("#pick-mode") as HTMLElement;
  const factionGrid = pick.querySelector("#faction-grid") as HTMLElement;
  const pickAbort = pick.querySelector("#pick-abort") as HTMLButtonElement;

  const footer = document.createElement("div");
  footer.className = "crt-footer";
  footer.innerHTML = `
    <div class="ticker-wrap phos-off" data-wink>
      <div class="ticker" id="ticker">
        <span class="ticker-seg" id="ticker-a"></span>
        <span class="ticker-seg" id="ticker-b" aria-hidden="true"></span>
      </div>
    </div>
    <div class="crt-meta phos-off" data-wink>
      <span id="boot-meta">// T+0000S · MESH IDLE</span>
      <span>// FCC ID OS-CRATER · SIG</span>
    </div>
  `;
  const tickerEl = footer.querySelector("#ticker") as HTMLElement;
  const tickerA = footer.querySelector("#ticker-a") as HTMLElement;
  const tickerB = footer.querySelector("#ticker-b") as HTMLElement;
  const bootMeta = footer.querySelector("#boot-meta") as HTMLElement;
  const tickerWrap = footer.querySelector(".ticker-wrap") as HTMLElement;
  const metaEl = footer.querySelector(".crt-meta") as HTMLElement;

  ui.append(top, titleBody, pick, footer);
  root.append(stars, globeHost, scan, vig, ui);
  stage.append(root);

  // Soundtrack on title: unlock + start on first user gesture (autoplay safe)
  const armTitleMusic = () => {
    unlockAudio();
    ensureMusicFromGesture();
    startMusic();
  };
  armTitleMusic(); // try immediately (works if context already running)
  const onFirstGesture = () => {
    armTitleMusic();
    root.removeEventListener("pointerdown", onFirstGesture);
    root.removeEventListener("keydown", onFirstGesture);
  };
  root.addEventListener("pointerdown", onFirstGesture, { passive: true });
  root.addEventListener("keydown", onFirstGesture);

  let disposed = false;
  let intent: "bot" | "match" = "bot";
  let showUi = false;
  let globe: TitleGlobeHandle | null = null;
  let bootT = 0;
  const timers: number[] = [];
  const intervals: number[] = [];

  // Seamless marquee: one continuous string, duplicated for -50% loop (no content swap jumps)
  const tickerCopy = TICKER.map((t) => t).join("   ···   ") + "   ···   ";
  tickerA.textContent = tickerCopy;
  tickerB.textContent = tickerCopy;

  intervals.push(
    window.setInterval(() => {
      bootT += 1;
      const mesh = globe?.meshReady() ? "OK" : globe ? "STREAM" : "IDLE";
      bootMeta.textContent = `// T+${String(bootT).padStart(4, "0")}S · MESH ${mesh}`;
      const zulu = new Date().toISOString().slice(11, 19) + " Z";
      const link = showUi && globe?.meshReady() ? "GREEN" : "AMBER";
      linkLine.textContent = `// LINK ${showUi ? link : "AMBER"} · RX ${zulu}`;
    }, 1000),
  );

  /**
   * System boot cascade after title type-in.
   * BSA first, then left link stack, right threat stack, then footer telemetry.
   * Delays are intentional — reads as subsystems coming online, not a simultaneous flash.
   */
  const winkInJargon = () => {
    const carrier = top.querySelector(".hud-left .dim:not(.link-line)") as HTMLElement | null;
    const blight = top.querySelector(".warn") as HTMLElement | null;
    const day = top.querySelector(".hud-right .dim") as HTMLElement | null;

    // order: agency → carrier → threat → day → link → ticker → mesh meta
    const items: { el: HTMLElement | null; d: number; fast?: boolean }[] = [
      { el: kicker, d: 0, fast: false }, // BELT SURVEY AUTHORITY
      { el: carrier, d: 220, fast: true }, // CARRIER / CRC
      { el: blight, d: 380, fast: false }, // BLIGHT FRONT
      { el: day, d: 520, fast: true }, // DAY 14 · BSA
      { el: linkLine, d: 680, fast: false }, // LINK AMBER
      { el: tickerWrap, d: 860, fast: true }, // news ticker
      { el: metaEl, d: 1040, fast: false }, // T+ / FCC meta
    ];
    for (const { el, d, fast } of items) {
      if (!el) continue;
      winkIn(el, d, fast ? "phos-wink-in-fast" : "phos-wink-in");
    }
  };

  const winkInButtons = () => {
    showUi = true;
    // Deploy → bot → audio, clearly spaced like menu init
    actionBtns.forEach((btn, i) => {
      winkIn(btn, 80 + i * 140, i === 0 ? "phos-wink-in" : "phos-wink-in-fast");
    });
  };

  /** Phase 3: zoom + type approach vector concurrently. */
  const startZoom = () => {
    if (disposed) return;
    bootBar.classList.add("hidden");

    try {
      globe = mountTitleGlobe(globeHost);
    } catch {
      /* GL may fail headless */
    }

    loadCur.classList.remove("hidden");
    typewrite(loadEl, APPROACH_LINE, 42, () => {
      if (!disposed) loadCur.classList.add("hidden");
    });

    const startAt = performance.now() + 40;
    const run = (now: number) => {
      if (disposed) return;
      if (now < startAt) {
        requestAnimationFrame(run);
        return;
      }
      const u = Math.min(1, (now - startAt) / ZOOM_MS);
      const e = 1 - Math.pow(1 - u, 3);
      globe?.setZoom(e);
      if (u < 1) requestAnimationFrame(run);
      else winkInButtons();
    };
    requestAnimationFrame(run);
  };

  const startLoadBar = () => {
    if (disposed) return;
    // Boot sequence: agency kicker first, bar a beat later, rest cascades under bar
    winkIn(kicker, 0, "phos-wink-in");
    timers.push(
      window.setTimeout(() => {
        if (disposed) return;
        const fill = bootBar.querySelector(".boot-progress-fill") as HTMLElement | null;
        if (fill) {
          fill.style.animation = "none";
          void fill.offsetWidth;
          fill.style.animation = "";
        }
        bootBar.classList.remove("hidden");
        // remaining telemetry after BSA is already lit
        const carrier = top.querySelector(".hud-left .dim:not(.link-line)") as HTMLElement | null;
        const blight = top.querySelector(".warn") as HTMLElement | null;
        const day = top.querySelector(".hud-right .dim") as HTMLElement | null;
        const rest: { el: HTMLElement | null; d: number; fast?: boolean }[] = [
          { el: carrier, d: 60, fast: true },
          { el: blight, d: 200, fast: false },
          { el: day, d: 340, fast: true },
          { el: linkLine, d: 500, fast: false },
          { el: tickerWrap, d: 680, fast: true },
          { el: metaEl, d: 860, fast: false },
        ];
        for (const { el, d, fast } of rest) {
          if (!el) continue;
          winkIn(el, d, fast ? "phos-wink-in-fast" : "phos-wink-in");
          timers.push(window.setTimeout(() => sfxTick(), d));
        }
      }, 280),
    );
    timers.push(
      window.setTimeout(() => {
        if (disposed) return;
        startZoom();
      }, 280 + BAR_MS),
    );
  };

  // Phase 1: type CRATER → COMMAND (layout pre-reserved), then bar + jargon
  typewrite(l1El, TITLE_L1, 16, () => {
    if (disposed) return;
    curL1.classList.add("hidden");
    curL2.classList.remove("hidden");
    typewrite(l2El, TITLE_L2, 16, () => {
      if (disposed) return;
      curL2.classList.add("hidden");
      startLoadBar();
    });
  });

  const goPick = (mode: "bot" | "match") => {
    if (leaving) return;
    cb.onEngage?.();
    intent = mode;
    // Reverse boot cascade: buttons first, then title core, then telemetry, corners last
    const carrier = top.querySelector(".hud-left .dim:not(.link-line)") as HTMLElement | null;
    const blight = top.querySelector(".warn") as HTMLElement | null;
    const day = top.querySelector(".hud-right .dim") as HTMLElement | null;
    const titleEl = center.querySelector(".crt-title") as HTMLElement | null;
    const loadline = center.querySelector(".crt-loadline") as HTMLElement | null;

    const outs: { el: HTMLElement | null; d: number }[] = [
      { el: actionBtns[0] ?? null, d: 0 },
      { el: actionBtns[1] ?? null, d: 70 },
      { el: actionBtns[2] ?? null, d: 130 },
      { el: kicker, d: 160 },
      { el: titleEl, d: 220 },
      { el: loadline, d: 280 },
      { el: carrier, d: 300 },
      { el: blight, d: 340 },
      { el: day, d: 380 },
      { el: linkLine, d: 420 },
      { el: tickerWrap, d: 460 },
      { el: metaEl, d: 520 },
    ];
    for (const { el, d } of outs) {
      if (el) winkOut(el, d);
    }
    timers.push(
      window.setTimeout(() => {
        if (disposed) return;
        titleBody.classList.add("hidden");
        top.classList.add("hidden");
        footer.classList.add("hidden");
        for (const btn of actionBtns) {
          btn.classList.remove("phos-wink-out", "phos-wink-in", "phos-wink-in-fast");
          btn.classList.add("phos-off");
        }
        kicker.classList.remove("phos-wink-out");
        kicker.classList.add("phos-off");
        pick.classList.remove("hidden");
        pickMode.textContent = mode === "match" ? "MODE // 1V1 MATCH" : "MODE // BOT SIM";
        factionGrid.replaceChildren();
        const races: (RaceId | "random")[] = ["operators", "blight", "mandate", "random"];
        for (const r of races) {
          const d = 15 + Math.floor(Math.random() * 210);
          const card = factionCard(r, () => pickRace(r), d);
          card.classList.add(Math.random() < 0.55 ? "phos-wink-in-fast" : "phos-wink-in");
          factionGrid.appendChild(card);
        }
        // pick chrome wink-in slightly after cards start
        winkIn(pick.querySelector(".pick-head") as HTMLElement, 40, "phos-wink-in-fast");
        winkIn(pickAbort, 120, "phos-wink-in");
      }, 700),
    );
  };

  let leaving = false;

  const pickRace = (race: RaceId | "random") => {
    if (disposed || leaving) return;
    leaving = true;
    sfxConfirm();
    const races = Object.keys(RACES) as RaceId[];
    const chosen = race === "random" ? races[Math.floor(Math.random() * races.length)]! : race;

    // Cascade faction pick off, then hand off to play
    const cards = [...factionGrid.querySelectorAll(".faction-card")] as HTMLElement[];
    // reverse-ish order with jitter so it doesn't feel uniform
    cards.forEach((card, i) => {
      const d = i * 55 + Math.floor(Math.random() * 40);
      winkOut(card, d);
    });
    const head = pick.querySelector(".pick-head") as HTMLElement | null;
    if (head) winkOut(head, 40);
    winkOut(pickAbort, 100);
    // optional: fade stage phosphor via root class
    root.classList.add("crt-leaving");

    timers.push(
      window.setTimeout(() => {
        if (disposed) return;
        cb.onCommit(intent, chosen);
      }, 520 + cards.length * 40),
    );
  };

  actions.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest("button[data-act]") as HTMLButtonElement | null;
    if (!t || t.classList.contains("phos-off")) return;
    const act = t.dataset.act;
    if (act === "bot") {
      sfxClick();
      goPick("bot");
    } else if (act === "match") {
      sfxClick();
      goPick("match");
    } else if (act === "mute") {
      sfxClick();
      cb.onToggleMute();
      muteLabel.textContent = cb.getMuted() ? "MUTED" : "LIVE";
    }
  });

  pickAbort.addEventListener("click", () => {
    sfxOpen();
    pick.classList.add("hidden");
    titleBody.classList.remove("hidden");
    top.classList.remove("hidden", "phos-wink-out");
    footer.classList.remove("hidden", "phos-wink-out");
    winkInJargon();
    winkInButtons();
    const titleEl = center.querySelector(".crt-title") as HTMLElement;
    const loadline = center.querySelector(".crt-loadline") as HTMLElement;
    titleEl?.classList.remove("phos-wink-out");
    loadline?.classList.remove("phos-wink-out");
    if (titleEl) {
      titleEl.style.opacity = "";
      titleEl.style.filter = "";
    }
    if (loadline) {
      loadline.style.opacity = "";
      loadline.style.filter = "";
    }
  });

  return {
    setMuted(m: boolean) {
      muteLabel.textContent = m ? "MUTED" : "LIVE";
    },
    dispose() {
      disposed = true;
      root.removeEventListener("pointerdown", onFirstGesture);
      root.removeEventListener("keydown", onFirstGesture);
      timers.forEach((t) => clearTimeout(t));
      intervals.forEach((t) => clearInterval(t));
      globe?.dispose();
      stage.replaceChildren();
    },
  };
}
