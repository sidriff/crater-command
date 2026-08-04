import * as THREE from "three";
import { DEFAULT_DIST } from "@game/render/planetMath";
import { PlanetView } from "@game/render/planetView";
import type { RaceId } from "@game/sim/types";
import type { Lab, LabContext } from "../../lab";
import type { LeverDef } from "../../levers";
import { BOARDS, type BoardId, boardById, buildBoard } from "./boards";

const SCORE_KEYS = [
  { id: "kindId", label: "Kind ID — name buildings without HUD labels" },
  { id: "ownerId", label: "Owner ID — friend vs foe without HP bars" },
  { id: "roleId", label: "Role ID — eco / fight / air / scout from silhouette" },
  { id: "motionId", label: "Motion ID — worker vs raider vs flyer in a short look" },
  { id: "density", label: "Density — pick the core in clutter under 1s" },
  { id: "fow", label: "FOW — last-known enemy ≠ friendly ghost" },
  { id: "faction", label: "Faction — race swap still distinct" },
] as const;

const LEVERS: LeverDef[] = [
  {
    id: "cam_el_deg",
    label: "Camera elev",
    kind: "range",
    value: 48,
    min: 8,
    max: 82,
    step: 1,
    unit: "°",
    section: "Camera",
    tradesAgainst: "Steeper = map-like; flatter = more 3D mass, harder top-down ID.",
  },
  {
    id: "cam_dist",
    label: "Camera dist",
    kind: "range",
    value: DEFAULT_DIST,
    min: 14,
    max: 200,
    step: 1,
    section: "Camera",
    tradesAgainst: "Closer = detail; farther = army blobs and lost kinds.",
  },
  {
    id: "nadir",
    label: "Nadir (diagnostic)",
    kind: "toggle",
    value: 0,
    section: "Camera",
    tradesAgainst: "True top-down helps diagnosis but is not the live tactical pose.",
  },
  {
    id: "race0",
    label: "Viewer race",
    kind: "range",
    value: 0,
    min: 0,
    max: 2,
    step: 1,
    section: "Board",
    tradesAgainst: "0 Ops · 1 Blight · 2 Mandate — same board, different tints/meshes.",
  },
];

const RACES: RaceId[] = ["operators", "blight", "mandate"];

const STORAGE_KEY = "crater-labs:readability";

type ScoreState = Record<string, boolean>;

function loadScores(): { scores: ScoreState; notes: string; board: BoardId } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scores: {}, notes: "", board: "identity" };
    const parsed = JSON.parse(raw) as {
      scores?: ScoreState;
      notes?: string;
      board?: BoardId;
    };
    return {
      scores: parsed.scores ?? {},
      notes: parsed.notes ?? "",
      board: parsed.board ?? "identity",
    };
  } catch {
    return { scores: {}, notes: "", board: "identity" };
  }
}

function saveState(board: BoardId, scores: ScoreState, notes: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ board, scores, notes }));
  } catch {
    /* ignore */
  }
}

export function makeReadabilityLab(): Lab {
  let view: PlanetView | null = null;
  let boardId: BoardId = "identity";
  let scores: ScoreState = {};
  let notes = "";
  let unsubLevers: (() => void) | null = null;
  let uiRoot: HTMLElement | null = null;
  let exportEl: HTMLPreElement | null = null;
  let blurbEl: HTMLElement | null = null;

  const applyCamera = (ctx: LabContext) => {
    if (!view) return;
    const nadir = ctx.levers.bool("nadir");
    const elDeg = nadir ? 82 : ctx.levers.get("cam_el_deg");
    const dist = ctx.levers.get("cam_dist");
    view.setCameraTargets({
      el: THREE.MathUtils.degToRad(elDeg),
      dist,
      immediate: false,
    });
  };

  const raceFromLever = (ctx: LabContext): RaceId => {
    const i = Math.round(ctx.levers.get("race0"));
    return RACES[Math.min(2, Math.max(0, i))] ?? "operators";
  };

  const refreshBoardButtons = () => {
    if (!uiRoot) return;
    uiRoot.querySelectorAll<HTMLButtonElement>("[data-board]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.board === boardId);
    });
    if (blurbEl) blurbEl.textContent = boardById(boardId).blurb;
  };

  const writeExport = (ctx: LabContext) => {
    if (!exportEl) return;
    const payload = {
      lab: "readability",
      board: boardId,
      camera: {
        elDeg: ctx.levers.bool("nadir") ? 82 : ctx.levers.get("cam_el_deg"),
        dist: ctx.levers.get("cam_dist"),
        nadir: ctx.levers.bool("nadir"),
      },
      race0: raceFromLever(ctx),
      scores,
      notes,
      at: new Date().toISOString(),
    };
    exportEl.textContent = JSON.stringify(payload, null, 2);
  };

  const loadBoard = (ctx: LabContext, id: BoardId, immediateCam = false) => {
    boardId = id;
    const def = boardById(id);
    const snap = buildBoard(id, raceFromLever(ctx));
    view?.setSnapshot(snap);
    view?.focusMap(def.focus.x, def.focus.y);
    applyCamera(ctx);
    if (immediateCam && view) {
      const elDeg = ctx.levers.bool("nadir") ? 82 : ctx.levers.get("cam_el_deg");
      view.setCameraTargets({
        el: THREE.MathUtils.degToRad(elDeg),
        dist: ctx.levers.get("cam_dist"),
        immediate: true,
      });
    }
    ctx.stat("board", def.label);
    ctx.stat("entities", `${snap.buildings.length}b / ${snap.units.length}u`);
    refreshBoardButtons();
    saveState(boardId, scores, notes);
    writeExport(ctx);
  };

  const mountUi = (ctx: LabContext) => {
    ctx.panel.replaceChildren();
    uiRoot = document.createElement("div");
    ctx.panel.appendChild(uiRoot);

    const hint = document.createElement("p");
    hint.className = "lab-hint";
    hint.textContent =
      "Flat globe (no craters / height). Real entity chrome. Boards paint entities only. Drag to pan, scroll to zoom.";
    uiRoot.appendChild(hint);

    const secBoards = document.createElement("div");
    secBoards.className = "lab-section-title";
    secBoards.textContent = "Scenarios";
    uiRoot.appendChild(secBoards);

    const row = document.createElement("div");
    row.className = "lab-btn-row";
    for (const b of BOARDS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lab-btn";
      btn.dataset.board = b.id;
      btn.textContent = b.label;
      btn.title = b.blurb;
      btn.addEventListener("click", () => loadBoard(ctx, b.id));
      row.appendChild(btn);
    }
    uiRoot.appendChild(row);

    blurbEl = document.createElement("p");
    blurbEl.className = "lab-hint";
    uiRoot.appendChild(blurbEl);

    const secAct = document.createElement("div");
    secAct.className = "lab-section-title";
    secAct.textContent = "Capture";
    uiRoot.appendChild(secAct);

    const actRow = document.createElement("div");
    actRow.className = "lab-btn-row";
    const shot = document.createElement("button");
    shot.type = "button";
    shot.className = "lab-btn";
    shot.textContent = "Screenshot";
    shot.addEventListener("click", () => {
      const canvas = view?.getDomElement();
      if (!canvas) return;
      const a = document.createElement("a");
      a.download = `readability-${boardId}-${Date.now()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      ctx.stat("capture", "png");
    });
    actRow.appendChild(shot);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "lab-btn";
    copy.textContent = "Copy JSON";
    copy.addEventListener("click", async () => {
      writeExport(ctx);
      if (!exportEl) return;
      try {
        await navigator.clipboard.writeText(exportEl.textContent ?? "");
        ctx.stat("export", "copied");
      } catch {
        ctx.stat("export", "select+copy");
      }
    });
    actRow.appendChild(copy);
    uiRoot.appendChild(actRow);

    const secScore = document.createElement("div");
    secScore.className = "lab-section-title";
    secScore.textContent = "Scorecard";
    uiRoot.appendChild(secScore);

    const scoreBox = document.createElement("div");
    scoreBox.className = "lab-score";
    for (const s of SCORE_KEYS) {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!scores[s.id];
      cb.addEventListener("change", () => {
        scores[s.id] = cb.checked;
        saveState(boardId, scores, notes);
        writeExport(ctx);
      });
      const span = document.createElement("span");
      span.textContent = s.label;
      lab.append(cb, span);
      scoreBox.appendChild(lab);
    }
    uiRoot.appendChild(scoreBox);

    const notesEl = document.createElement("textarea");
    notesEl.className = "lab-notes";
    notesEl.placeholder = "Notes for model / human pass…";
    notesEl.value = notes;
    notesEl.addEventListener("input", () => {
      notes = notesEl.value;
      saveState(boardId, scores, notes);
      writeExport(ctx);
    });
    uiRoot.appendChild(notesEl);

    exportEl = document.createElement("pre");
    exportEl.className = "lab-export";
    uiRoot.appendChild(exportEl);

    refreshBoardButtons();
    writeExport(ctx);
  };

  return {
    id: "readability",
    title: "Readability",
    blurb:
      "Top-down player eye on a blank globe. Identity, FOW edge, clutter — real entity chrome.",
    levers: LEVERS,
    setup(ctx) {
      const stored = loadScores();
      boardId = stored.board;
      scores = stored.scores;
      notes = stored.notes;

      view = new PlanetView({
        container: ctx.viewport,
        viewer: 0,
        onPlace: () => {},
        preserveDrawingBuffer: true,
        // Smooth sphere: no crater bowls / height noise — readability baseline
        flatTerrain: true,
        onGlobeReady: () => {
          loadBoard(ctx, boardId, true);
        },
      });

      // Immediate empty globe until geometry warms
      view.setSnapshot(buildBoard("blank", raceFromLever(ctx)));

      mountUi(ctx);

      unsubLevers = ctx.levers.onChange((id) => {
        if (id === "cam_el_deg" || id === "cam_dist" || id === "nadir") {
          applyCamera(ctx);
        }
        if (id === "race0") {
          loadBoard(ctx, boardId);
        }
        writeExport(ctx);
      });

      ctx.stat("lab", "readability");
      ctx.stat("globe", "warming…");
    },
    tick(_dt, ctx) {
      if (view) {
        const cam = view.getCameraTargets();
        ctx.stat(
          "cam",
          `${THREE.MathUtils.radToDeg(cam.el).toFixed(0)}° / ${cam.dist.toFixed(0)}`,
        );
        ctx.stat("globe", "live");
      }
    },
    teardown(ctx) {
      unsubLevers?.();
      unsubLevers = null;
      view?.dispose();
      view = null;
      uiRoot = null;
      exportEl = null;
      blurbEl = null;
      ctx.panel.replaceChildren();
      ctx.viewport.replaceChildren();
    },
  };
}
