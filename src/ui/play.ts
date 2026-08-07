import { resetCombatSfx, tickCombatSfx } from "../game/audio/combatSfx";
import {
  ensureMusicFromGesture,
  isMusicMuted,
  setMusicMuted,
  startMusic,
  unlockAudio,
} from "../game/audio/music";
import {
  sfxBlip,
  sfxClick,
  sfxClose,
  sfxConfirm,
  sfxDeny,
  sfxOpen,
  sfxPlace,
  sfxTick,
} from "../game/audio/sfx";
import { GameSession } from "../game/net/session";
import {
  ENERGY_TICK,
  cardOf,
  isOperation,
  type CardId,
} from "../game/sim/deck";
import { MATCH_SECONDS, RACES, unitCapCost } from "../game/sim/defs";
import type { BuildingKind, RaceId, SimSnapshot } from "../game/sim/types";
import { bakeMeshIcons, iconUrl, type MeshIconMap } from "../game/render/meshIcons";
import { PlanetView } from "../game/render/planetView";
import { ADVISOR_LINES, mountAdvisor } from "./advisor";

export type PlayConfig = {
  localRace: RaceId;
  enemyRace: RaceId;
};

export type PlayCallbacks = {
  onExit: () => void;
  getMuted: () => boolean;
  onMutedChange: (m: boolean) => void;
  linkOverlay?: HTMLElement;
  onLinkDismiss?: () => void;
};

export type PlayHandle = {
  dispose: () => void;
};

function fmtTime(t: number) {
  const left = Math.max(0, MATCH_SECONDS - t);
  const m = Math.floor(left / 60);
  const s = Math.floor(left % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const HOME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z"/></svg>`;
const VOL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 5a9 9 0 0 1 0 14"/></svg>`;
const MUTE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`;
const CAP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z"/></svg>`;
const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

export function mountPlay(stage: HTMLElement, cfg: PlayConfig, cb: PlayCallbacks): PlayHandle {
  const preservedLink = cb.linkOverlay ?? null;
  stage.replaceChildren();

  unlockAudio();
  startMusic();

  const root = document.createElement("div");
  root.className = "play-root";

  const canvasHost = document.createElement("div");
  canvasHost.className = "play-canvas";

  const loading = document.createElement("div");
  loading.className = "play-loading";
  loading.innerHTML = `<p>// LINKING COMBAT MESH…</p>`;

  const globeLoad = document.createElement("div");
  globeLoad.className = "globe-loading hidden";
  globeLoad.innerHTML = `<p>Forging asteroid…</p><p class="sub">First load bakes the globe — next match is instant</p>`;

  const hudTop = document.createElement("div");
  hudTop.className = "hud-top hud-boot-off";
  hudTop.dataset.ui = "";
  hudTop.innerHTML = `
    <div class="hud-bar" data-ui>
      <button type="button" class="hud-icon-btn" data-act="home" aria-label="Menu" data-ui>${HOME_SVG}</button>
      <button type="button" class="hud-icon-btn" data-act="mute" aria-label="Mute" data-ui>${cb.getMuted() ? MUTE_SVG : VOL_SVG}</button>
      <div class="hud-chip hud-chip-cap" data-ui title="Capacity">
        <span class="hud-chip-ico" aria-hidden="true">${CAP_SVG}</span>
        <span class="hud-chip-val" id="hud-cap">2/5</span>
      </div>
      <div class="hud-chip hud-chip-time" data-ui title="Match clock">
        <span class="hud-chip-val hud-time" id="hud-time">10:00</span>
      </div>
    </div>
    <div class="advisor-wrap" id="advisor-host"></div>
    <p class="hud-msg hidden" id="hud-msg"></p>
  `;
  const timeEl = hudTop.querySelector("#hud-time") as HTMLElement;
  const capEl = hudTop.querySelector("#hud-cap") as HTMLElement;
  const msgEl = hudTop.querySelector("#hud-msg") as HTMLElement;
  const advisorHost = hudTop.querySelector("#advisor-host") as HTMLElement;
  const muteBtn = hudTop.querySelector('[data-act="mute"]') as HTMLButtonElement;

  // Deck hand chrome
  const hudBottom = document.createElement("div");
  hudBottom.className = "hud-bottom hud-boot-off";
  hudBottom.dataset.ui = "";
  hudBottom.innerHTML = `
    <div class="deck-panel" data-ui>
      <div class="energy-bar-wrap" data-ui title="Energy">
        <div class="energy-bar-track">
          <div class="energy-bar-fill" id="energy-fill"></div>
          <div class="energy-bar-ticks" id="energy-ticks"></div>
        </div>
        <span class="energy-bar-num" id="energy-num">200</span>
      </div>
      <div class="next-card-slot" id="next-card-slot" data-ui title="Next card">
        <span class="next-card-tag">// NEXT</span>
        <div class="next-card empty" id="next-card">
          <span class="next-card-name">—</span>
          <span class="next-card-cost"></span>
        </div>
      </div>
      <div class="hand-row" id="hand-row" data-ui></div>
    </div>
  `;
  const handRow = hudBottom.querySelector("#hand-row") as HTMLElement;
  const energyFill = hudBottom.querySelector("#energy-fill") as HTMLElement;
  const energyNum = hudBottom.querySelector("#energy-num") as HTMLElement;
  const energyTicks = hudBottom.querySelector("#energy-ticks") as HTMLElement;
  const nextCardEl = hudBottom.querySelector("#next-card") as HTMLElement;

  // Placement mode
  const placeMode = document.createElement("div");
  placeMode.className = "place-mode hidden";
  placeMode.dataset.ui = "";
  placeMode.innerHTML = `
    <div class="place-desc" data-ui>
      <p class="place-desc-name" id="place-desc-name">—</p>
      <p class="place-desc-blurb" id="place-desc-blurb"></p>
      <p class="place-desc-tag hidden" id="place-desc-tag">TECH BUILDING</p>
    </div>
    <div class="place-bar" data-ui>
      <button type="button" class="place-act place-cancel" data-act="place-cancel" aria-label="Cancel" data-ui>
        <span class="place-act-ico">✕</span>
        <span class="place-act-lbl">Cancel</span>
      </button>
      <button type="button" class="place-act place-trash" data-act="place-trash" aria-label="Trash card" data-ui>
        <span class="place-act-ico place-trash-ico">${TRASH_SVG}</span>
        <span class="place-act-lbl">Trash</span>
      </button>
      <button type="button" class="place-act place-confirm" data-act="place-confirm" aria-label="Confirm" data-ui>
        <span class="place-act-ico">✓</span>
        <span class="place-act-lbl">Place</span>
      </button>
    </div>
    <div class="place-status place-status-float" data-ui>
      <p class="place-kind" id="place-kind">—</p>
      <p class="place-reason" id="place-reason">Pan to aim</p>
    </div>
  `;
  const placeKindEl = placeMode.querySelector("#place-kind") as HTMLElement;
  const placeReasonEl = placeMode.querySelector("#place-reason") as HTMLElement;
  const placeConfirmBtn = placeMode.querySelector('[data-act="place-confirm"]') as HTMLButtonElement;
  const placeCancelBtn = placeMode.querySelector('[data-act="place-cancel"]') as HTMLButtonElement;
  const placeTrashBtn = placeMode.querySelector('[data-act="place-trash"]') as HTMLButtonElement;
  const placeDescName = placeMode.querySelector("#place-desc-name") as HTMLElement;
  const placeDescBlurb = placeMode.querySelector("#place-desc-blurb") as HTMLElement;
  const placeDescTag = placeMode.querySelector("#place-desc-tag") as HTMLElement;

  const endOverlay = document.createElement("div");
  endOverlay.className = "end-overlay hidden";
  endOverlay.dataset.ui = "";
  endOverlay.innerHTML = `
    <div class="end-card" data-ui>
      <h2 id="end-title">Victory</h2>
      <p id="end-body"></p>
      <button type="button" data-act="exit">Back to menu</button>
    </div>
  `;
  const endTitle = endOverlay.querySelector("#end-title") as HTMLElement;
  const endBody = endOverlay.querySelector("#end-body") as HTMLElement;

  root.append(canvasHost, loading, globeLoad, hudTop, hudBottom, placeMode, endOverlay);
  stage.append(root);
  if (preservedLink) stage.append(preservedLink);

  let disposed = false;
  let placeKind: BuildingKind | null = null;
  let placeHandIndex: number | null = null;
  let placeCardId: CardId | null = null;
  let placeIsOp = false;
  /** aim = cast targeting · manage = active op panel (Focus / Abort / Back) */
  let placeOpPhase: "aim" | "manage" | null = null;
  let placeManagedOpId: number | null = null;
  let view: PlanetView | null = null;
  let session: GameSession | null = null;
  let unsub: (() => void) | null = null;
  let unAdvisor: (() => void) | null = null;
  let lastHud = 0;
  let didAdvisor = false;
  let energy = 200;
  let energyMax = 400;
  let phase = "playing";
  let placePreviewOk = false;
  let placeCommitting = false;
  let placeCommitTimer: number | null = null;
  let lastMsgText = "";
  let lastMsgAt = 0;
  let lastHandKey = "";

  // Phosphor mesh thumbs (labs-style) for deck cards — bake once per match.
  let meshIcons: MeshIconMap = {};
  try {
    meshIcons = bakeMeshIcons(cfg.localRace);
  } catch (e) {
    console.warn("mesh icon bake failed", e);
  }

  const exitPlaceMode = () => {
    if (placeCommitTimer != null) {
      window.clearTimeout(placeCommitTimer);
      placeCommitTimer = null;
    }
    placeCommitting = false;
    placeKind = null;
    placeHandIndex = null;
    placeCardId = null;
    placeIsOp = false;
    placeOpPhase = null;
    placeManagedOpId = null;
    placePreviewOk = false;
    view?.setPlaceKind(null);
    view?.setOpAim(null);
    placeTrashBtn.classList.add("hidden");
    const confLbl = placeConfirmBtn.querySelector(".place-act-lbl");

    if (confLbl) confLbl.textContent = "Place";
    const trashLbl = placeTrashBtn.querySelector(".place-act-lbl");
    if (trashLbl) trashLbl.textContent = "Trash";
    const canLbl = placeCancelBtn.querySelector(".place-act-lbl");
    if (canLbl) canLbl.textContent = "Cancel";
    placeMode.classList.add("hidden");
    placeMode.classList.remove("place-committed");
    placeCancelBtn.classList.remove("wink-out");
    placeConfirmBtn.classList.remove("linger");
    placeConfirmBtn.disabled = false;
    hudBottom.classList.remove("hidden");
    hudTop.classList.remove("place-dim");
    advisorHost.classList.remove("hidden");
  };

  const confLblEl = () => placeConfirmBtn.querySelector(".place-act-lbl") as HTMLElement | null;
  const trashLblEl = () => placeTrashBtn.querySelector(".place-act-lbl") as HTMLElement | null;
  const canLblEl = () => placeCancelBtn.querySelector(".place-act-lbl") as HTMLElement | null;

  const showPlaceChrome = () => {
    placeMode.classList.remove("hidden");
    placeMode.classList.remove("place-committed");
    placeCancelBtn.classList.remove("wink-out");
    placeConfirmBtn.classList.remove("linger");
    hudBottom.classList.add("hidden");
    hudTop.classList.add("place-dim");
    advisorHost.classList.add("hidden");
  };

  const enterOpManage = (handIndex: number, cardId: CardId) => {
    if (placeCommitting || !session) return;
    const card = cardOf(cardId);
    const mine = session.listOps().filter((o) => o.cardId === cardId);
    if (!mine.length) return false;
    sfxOpen();
    placeHandIndex = handIndex;
    placeCardId = cardId;
    placeIsOp = true;
    placeOpPhase = "manage";
    placeKind = null;
    placeManagedOpId = mine[mine.length - 1]!.id; // most recent
    view?.setPlaceKind(null);
    view?.setOpAim(null);
    showPlaceChrome();
    placeKindEl.textContent = card.name.toUpperCase();
    placeReasonEl.textContent = "Active — Focus camera or Abort";
    placeDescName.textContent = card.name.toUpperCase();
    placeDescBlurb.textContent = card.blurb + " Live mark on the rock.";
    placeDescTag.classList.remove("hidden");
    placeDescTag.textContent = "OPERATION · ACTIVE";
    confLblEl()!.textContent = "Focus";
    placeTrashBtn.classList.remove("hidden");
    trashLblEl()!.textContent = "Abort";
    canLblEl()!.textContent = "Back";
    placeTrashBtn.classList.remove("hidden");
    placeConfirmBtn.disabled = false;
    placeConfirmBtn.classList.add("ok");
    placePreviewOk = true;
    return true;
  };

  const enterOpAim = (handIndex: number, cardId: CardId) => {
    if (placeCommitting) return;
    const card = cardOf(cardId);
    sfxOpen();
    placeHandIndex = handIndex;
    placeCardId = cardId;
    placeIsOp = true;
    placeOpPhase = "aim";
    placeManagedOpId = null;
    placeKind = null;
    view?.setPlaceKind(null);
    view?.setOpAim(card.opRadius ?? 1.35);
    showPlaceChrome();
    placeKindEl.textContent = card.name.toUpperCase();
    placeReasonEl.textContent = "Pan to aim · Place mark";
    placeDescName.textContent = card.name.toUpperCase();
    placeDescBlurb.textContent = card.blurb;
    placeDescTag.classList.remove("hidden");
    placeDescTag.textContent = "OPERATION";
    confLblEl()!.textContent = "Place";
    canLblEl()!.textContent = "Cancel";
    placeTrashBtn.classList.add("hidden"); // no trash / no abort while aiming
    placeConfirmBtn.disabled = true;
    placeConfirmBtn.classList.remove("ok");
    placePreviewOk = false;
  };

  const enterPlaceMode = (handIndex: number, cardId: CardId) => {
    if (placeCommitting) return;
    const card = cardOf(cardId);
    // Operations: manage existing, else aim to place
    if (card.operation) {
      if (session && session.listOps().some((o) => o.cardId === cardId)) {
        enterOpManage(handIndex, cardId);
        return;
      }
      enterOpAim(handIndex, cardId);
      return;
    }
    sfxOpen();
    placeHandIndex = handIndex;
    placeCardId = cardId;
    placeIsOp = false;
    placeOpPhase = null;
    placeManagedOpId = null;
    placeKind = card.building;
    view?.setOpAim(null);
    if (card.building) view?.setPlaceKind(card.building);
    showPlaceChrome();
    placeKindEl.textContent = card.name.toUpperCase();
    placeReasonEl.textContent = "Pan to aim";
    placeDescName.textContent = card.name.toUpperCase();
    placeDescBlurb.textContent = card.blurb;
    placeDescTag.classList.toggle("hidden", !card.tech);
    placeDescTag.textContent = "TECH BUILDING";
    confLblEl()!.textContent = "Place";
    canLblEl()!.textContent = "Cancel";
    trashLblEl()!.textContent = "Trash";
    placeTrashBtn.classList.add("hidden"); // discard hidden — CR cycle
    placeConfirmBtn.disabled = true;

    placeConfirmBtn.classList.remove("ok");
  };

  const cardIconHtml = (card: ReturnType<typeof cardOf>, size: "hand" | "next") => {
    const src = iconUrl(meshIcons, card, cfg.localRace);
    if (!src) return "";
    const cls = size === "hand" ? "hand-icon" : "next-card-icon";
    return `<img class="${cls}" src="${src}" alt="" draggable="false" />`;
  };

  const renderNextCard = (nextId: string | null, en: number) => {
    if (!nextId) {
      nextCardEl.className = "next-card empty";
      nextCardEl.innerHTML = `<span class="next-card-name">—</span><span class="next-card-cost"></span>`;
      return;
    }
    const card = cardOf(nextId as CardId);
    nextCardEl.className =
      "next-card" +
      (card.tech ? " is-tech" : "") +
      (card.operation ? " is-op" : "") +
      (en < card.cost ? " cant-afford" : "");
    nextCardEl.innerHTML = `
      ${card.tech ? `<span class="next-tech">TECH</span>` : ""}
      ${card.operation ? `<span class="next-tech next-op">OP</span>` : ""}
      ${cardIconHtml(card, "next")}
      <span class="next-card-name">${card.short}</span>
      <span class="next-card-cost">${card.cost}</span>
    `;
  };

  const renderHand = (hand: string[], en: number) => {
    const key = hand.join("|") + `@${Math.floor(en)}`;
    if (key === lastHandKey && handRow.childElementCount === hand.length) {
      // still refresh afford state
      [...handRow.children].forEach((el, i) => {
        const cid = hand[i] as CardId;
        if (!cid) return;
        const card = cardOf(cid);
        const afford = en >= card.cost && phase === "playing";
        (el as HTMLElement).classList.toggle("cant-afford", !afford);
        (el as HTMLElement).classList.toggle("is-tech", card.tech);
        (el as HTMLElement).classList.toggle("is-op", card.operation);
      });
      return;
    }
    lastHandKey = key;
    handRow.replaceChildren();
    hand.forEach((cid, i) => {
      const card = cardOf(cid as CardId);
      const btn = document.createElement("button");
      btn.type = "button";
      const hasIcon = !!iconUrl(meshIcons, card, cfg.localRace);
      btn.className =
        "hand-card" +
        (card.tech ? " is-tech" : "") +
        (card.operation ? " is-op" : "") +
        (hasIcon ? " has-icon" : "");
      btn.dataset.ui = "";
      btn.dataset.idx = String(i);
      if (en < card.cost || phase !== "playing") btn.classList.add("cant-afford");
      btn.innerHTML = `
        ${card.tech ? `<span class="hand-tech">TECH</span>` : ""}
        ${card.operation ? `<span class="hand-tech hand-op">OP</span>` : ""}
        ${cardIconHtml(card, "hand")}
        <span class="hand-name">${card.short}</span>
        <span class="hand-cost">${card.cost}</span>
      `;
      btn.addEventListener("click", () => {
        if (phase !== "playing") return;
        if (placeHandIndex === i) {
          // toggle closed — never cancels an active op
          sfxClose();
          exitPlaceMode();
          return;
        }
        const hasActiveOp =
          card.operation && !!session?.listOps().some((o) => o.cardId === cid);
        if (!hasActiveOp && en < card.cost) {
          sfxDeny();
          return;
        }
        enterPlaceMode(i, cid as CardId);
      });
      handRow.append(btn);
    });
    // pad empty slots for layout stability
    for (let i = hand.length; i < 4; i++) {
      const slot = document.createElement("div");
      slot.className = "hand-card hand-empty";
      slot.dataset.ui = "";
      slot.innerHTML = `<span class="hand-name">—</span>`;
      handRow.append(slot);
    }
  };

  const refreshEnergyBar = (en: number, max: number) => {
    const pct = Math.max(0, Math.min(1, en / Math.max(1, max))) * 100;
    energyFill.style.width = `${pct}%`;
    energyNum.textContent = String(Math.floor(en));
    // ticks every 100
    const n = Math.floor(max / ENERGY_TICK);
    if (energyTicks.childElementCount !== n) {
      energyTicks.replaceChildren();
      for (let i = 1; i < n; i++) {
        const t = document.createElement("span");
        t.className = "energy-tick";
        t.style.left = `${(i / n) * 100}%`;
        energyTicks.append(t);
      }
    }
  };

  const onPlace = (x: number, y: number) => {
    if (placeHandIndex == null || !session || placeCommitting) return;
    // manage mode never places
    if (placeOpPhase === "manage") return;
    if (!placeIsOp && placeKind == null) return;
    if (placeIsOp && placeOpPhase !== "aim") return;
    const kind = placeKind;
    const idx = placeHandIndex;
    const cardId = placeCardId;
    const wasOp = placeIsOp;
    const ok = wasOp
      ? session.castOp(idx, x, y)
      : kind
        ? session.place(kind, x, y, idx)
        : false;
    if (!ok) {
      sfxDeny();
      return;
    }
    sfxPlace();
    placeCommitting = true;
    placeMode.classList.add("place-committed");
    placeCancelBtn.classList.add("wink-out");
    placeConfirmBtn.classList.add("linger");
    placeConfirmBtn.disabled = true;
    placeReasonEl.textContent = wasOp ? "Mark placed" : "Scaffold locked";
    if (cardId) placeKindEl.textContent = cardOf(cardId).name.toUpperCase();
    view?.setPlaceKind(null);
    view?.setOpAim(null);
    placeKind = null;
    placeHandIndex = null;
    placeCardId = null;
    placeIsOp = false;
    placeOpPhase = null;
    placeManagedOpId = null;
    lastHandKey = "";

    if (placeCommitTimer != null) window.clearTimeout(placeCommitTimer);
    placeCommitTimer = window.setTimeout(() => {
      placeCommitTimer = null;
      exitPlaceMode();
    }, wasOp ? 280 : 720);
  };

  const cascadeHudIn = () => {
    hudTop.classList.remove("hud-boot-off");
    hudBottom.classList.remove("hud-boot-off");
    const topBar = hudTop.querySelector(".hud-bar") as HTMLElement | null;
    if (topBar) {
      topBar.classList.add("hud-cascade-in");
      topBar.style.setProperty("--wink-d", "0ms");
    }
    advisorHost.classList.add("hud-cascade-in");
    advisorHost.style.setProperty("--wink-d", "120ms");
    const deck = hudBottom.querySelector(".deck-panel") as HTMLElement | null;
    if (deck) {
      deck.classList.add("hud-cascade-in");
      deck.style.setProperty("--wink-d", "180ms");
    }
    sfxBlip();
    sfxTick();
  };

  session = new GameSession({
    mode: "bot",
    localPlayer: 0,
    localRace: cfg.localRace,
    enemyRace: cfg.enemyRace,
  });

  try {
    view = new PlanetView({
      container: canvasHost,
      viewer: 0,
      onPlace,
      onGlobeReady: () => {
        if (disposed) return;
        globeLoad.classList.add("hidden");
        if (cb.linkOverlay) {
          cb.linkOverlay.classList.add("link-overlay-out");
          window.setTimeout(() => {
            cb.onLinkDismiss?.();
            if (!disposed) cascadeHudIn();
          }, 280);
        } else {
          cascadeHudIn();
        }
      },
      onPlacePreview: (info) => {
        const aiming = !!placeKind || (placeIsOp && placeOpPhase === "aim");
        if (!aiming || !info) return;
        placePreviewOk = info.ok;
        placeReasonEl.textContent = info.reason;
        placeReasonEl.classList.toggle("bad", !info.ok);
        placeReasonEl.classList.toggle("ok", info.ok);
        placeConfirmBtn.disabled = !info.ok;
        placeConfirmBtn.classList.toggle("ok", info.ok);
      },
    });
    view.setPlaceValidator((kind, x, y) =>
      session!.canPlacePreview(kind, x, y, placeHandIndex ?? undefined),
    );
    globeLoad.classList.remove("hidden");
  } catch (e) {
    console.error(e);
    loading.innerHTML = `<p>// GL FAILED — CHECK CONSOLE</p>`;
  }

  unsub = session.on((snap: SimSnapshot) => {
    if (disposed) return;
    view?.setSnapshot(snap);
    tickCombatSfx(snap);
    loading.classList.add("hidden");

    if (!didAdvisor) {
      didAdvisor = true;
      const text =
        cfg.localRace === "mandate"
          ? ADVISOR_LINES.matchStartMandate
          : cfg.localRace === "operators"
            ? ADVISOR_LINES.matchStartOperators
            : ADVISOR_LINES.matchStart;
      unAdvisor = mountAdvisor(
        advisorHost,
        { id: "start", text, cps: 30, race: cfg.localRace },
        cfg.localRace,
      );
      window.setTimeout(() => {
        unAdvisor?.();
        unAdvisor = null;
      }, 12000);
    }

    const now = performance.now();
    if (now - lastHud < 100) return;
    lastHud = now;
    const me = snap.players[0]!;
    energy = me.energy;
    energyMax = me.energyMax ?? 400;
    phase = snap.phase;
    const capUsed = snap.units
      .filter((u) => u.owner === 0)
      .reduce((s, u) => s + unitCapCost(u.kind), 0);
    timeEl.textContent = fmtTime(snap.t);
    capEl.textContent = `${capUsed}/${me.capMax}`;
    capEl.classList.toggle("cap-tight", capUsed >= me.capMax);
    capEl.parentElement?.classList.toggle("cap-tight", capUsed >= me.capMax);

    refreshEnergyBar(me.energy, energyMax);
    renderHand(me.hand ?? [], me.energy);
    renderNextCard(me.next ?? null, me.energy);

    if (snap.messages.length) {
      const m = snap.messages.at(-1)!;
      if (m !== lastMsgText) {
        lastMsgText = m;
        lastMsgAt = performance.now();
      }
    }
    if (lastMsgText && performance.now() - lastMsgAt < 2600) {
      msgEl.textContent = lastMsgText;
      msgEl.classList.remove("hidden");
    } else {
      msgEl.classList.add("hidden");
    }

    if (snap.phase === "ended") {
      endOverlay.classList.remove("hidden");
      exitPlaceMode();
      const win = snap.winner;
      if (win === null) {
        endTitle.textContent = "Draw";
        endBody.textContent = "Both cores cracked the same tick.";
      } else if (win === 0) {
        endTitle.textContent = "Victory";
        endBody.textContent = "Core secured. The globe is yours.";
      } else {
        endTitle.textContent = "Defeat";
        endBody.textContent = "Your core is slag. Rebuild smarter.";
      }
    }
  });

  session.start();

  hudTop.querySelector('[data-act="home"]')!.addEventListener("click", () => {
    sfxClick();
    cb.onExit();
  });
  muteBtn.addEventListener("click", () => {
    ensureMusicFromGesture();
    const next = !isMusicMuted();
    setMusicMuted(next);
    cb.onMutedChange(next);
    muteBtn.innerHTML = next ? MUTE_SVG : VOL_SVG;
    sfxClick();
  });
  endOverlay.querySelector('[data-act="exit"]')!.addEventListener("click", () => {
    sfxClick();
    cb.onExit();
  });

  placeMode.querySelector('[data-act="place-cancel"]')!.addEventListener("click", () => {
    // Cancel / Back — close chrome only, leave ops running
    sfxClose();
    exitPlaceMode();
  });
  placeTrashBtn.addEventListener("click", () => {
    if (!session || placeCommitting) return;
    if (placeOpPhase === "manage") {
      // Abort active operation only
      sfxClose();
      session.cancelOp(placeManagedOpId ?? undefined);
      lastHandKey = "";
      exitPlaceMode();
      return;
    }
    if (placeHandIndex == null) return;
    sfxClose();
    session.trash(placeHandIndex);
    lastHandKey = "";
    exitPlaceMode();
  });
  placeConfirmBtn.addEventListener("click", () => {
    if (!view) return;
    if (placeOpPhase === "manage") {
      // Focus camera on active mark
      const op =
        session?.listOps().find((o) => o.id === placeManagedOpId) ??
        session?.listOps().find((o) => o.cardId === placeCardId);
      if (!op) {
        sfxDeny();
        return;
      }
      sfxConfirm();
      view.focusMap(op.x, op.y);
      placeReasonEl.textContent = "Camera locked on mark";
      return;
    }
    if (!placeKind && !(placeIsOp && placeOpPhase === "aim")) return;
    if (!placePreviewOk) {
      sfxDeny();
      return;
    }
    sfxConfirm();
    view.confirmPlace();
  });

  return {
    dispose() {
      disposed = true;
      unsub?.();
      unAdvisor?.();
      session?.stop();
      view?.dispose();
      resetCombatSfx();
      stage.replaceChildren();
    },
  };
}
