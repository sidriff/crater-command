/**
 * Drive combat + construction SFX from snapshot diffs (keeps sim free of audio).
 * Tracks projectiles / units / buildings between frames; positions feed spatial mix.
 */
import {
  sfxBuildComplete,
  sfxBuildStart,
  sfxBuildZap,
  sfxBuildingDeath,
  sfxHit,
  sfxUnitDeath,
  sfxUnitSpawn,
  sfxWeaponFire,
} from "./sfx";
import type { MapPos } from "./spatial";
import { mapDist } from "./spatial";
import { UNITS } from "../sim/defs";
import type { Projectile, SimSnapshot } from "../sim/types";

type TrackedShot = {
  style: Projectile["style"];
  targetIsBuilding: boolean;
  damage: number;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
};

/** Erratic zap pattern: burst of ticks → pause (mirrors build beam visuals). */
type ZapPhase = "burst" | "gap" | "pause";

let primed = false;
let unitIds = new Set<number>();
let unitAir = new Map<number, boolean>();
let unitPos = new Map<number, MapPos>();
let buildingIds = new Set<number>();
let buildingCore = new Map<number, boolean>();
let buildingDone = new Map<number, boolean>();
let buildingProgress = new Map<number, number>();
let buildingPos = new Map<number, MapPos>();
let shots = new Map<number, TrackedShot>();

// Construction zap state machine (wall-clock)
let zapPhase: ZapPhase = "pause";
let zapUntil = 0;
let zapBurstLeft = 0;
let zapPos: MapPos | null = null;

/** Call when leaving a match so the next game re-baselines. */
export function resetCombatSfx() {
  primed = false;
  unitIds = new Set();
  unitAir = new Map();
  unitPos = new Map();
  buildingIds = new Set();
  buildingCore = new Map();
  buildingDone = new Map();
  buildingProgress = new Map();
  buildingPos = new Map();
  shots = new Map();
  zapPhase = "pause";
  zapUntil = 0;
  zapBurstLeft = 0;
  zapPos = null;
}

function baseline(snap: SimSnapshot) {
  unitIds = new Set(snap.units.map((u) => u.id));
  unitAir = new Map(snap.units.map((u) => [u.id, UNITS[u.kind].air]));
  unitPos = new Map(snap.units.map((u) => [u.id, { x: u.x, y: u.y }]));
  buildingIds = new Set(snap.buildings.map((b) => b.id));
  buildingCore = new Map(snap.buildings.map((b) => [b.id, b.kind === "core"]));
  buildingDone = new Map(snap.buildings.map((b) => [b.id, b.done]));
  buildingProgress = new Map(snap.buildings.map((b) => [b.id, b.progress]));
  buildingPos = new Map(snap.buildings.map((b) => [b.id, { x: b.x, y: b.y }]));
  shots = new Map();
  for (const p of snap.projectiles) {
    if (p.style === "mine" || p.targetIsMineral) continue;
    shots.set(p.id, {
      style: p.style,
      targetIsBuilding: p.targetIsBuilding,
      damage: p.damage,
      ox: p.ox,
      oy: p.oy,
      tx: p.tx,
      ty: p.ty,
    });
  }
  primed = true;
}

/** Nearest active construction site (worker in range of unfinished pad). */
function nearestBuildSite(snap: SimSnapshot, listen: MapPos | null): { pos: MapPos; n: number } | null {
  const sites = new Map<number, MapPos>();
  let n = 0;
  for (const u of snap.units) {
    if (u.kind !== "worker" || u.buildTargetId == null) continue;
    const b = snap.buildings.find((x) => x.id === u.buildTargetId);
    if (!b || b.done) continue;
    const d = mapDist(u.x, u.y, b.x, b.y);
    if (d > 0.65) continue;
    n++;
    sites.set(b.id, { x: b.x, y: b.y });
  }
  if (n === 0 || sites.size === 0) return null;

  let best: MapPos | null = null;
  let bestD = Infinity;
  const lx = listen?.x ?? 0;
  const ly = listen?.y ?? 0;
  for (const pos of sites.values()) {
    const d = listen ? mapDist(lx, ly, pos.x, pos.y) : 0;
    if (d < bestD) {
      bestD = d;
      best = pos;
    }
  }
  return best ? { pos: best, n } : null;
}

function tickConstructionZaps(
  site: { pos: MapPos; n: number } | null,
  now: number,
) {
  if (!site) {
    zapPhase = "pause";
    zapUntil = now + 0.05;
    zapBurstLeft = 0;
    zapPos = null;
    return;
  }
  zapPos = site.pos;

  const dens = Math.min(1.35, 0.85 + site.n * 0.15);
  if (now < zapUntil) return;

  if (zapPhase === "burst") {
    zapBurstLeft -= 1;
    if (zapBurstLeft > 0) {
      zapPhase = "gap";
      zapUntil = now + (0.035 + Math.random() * 0.05) / dens;
    } else {
      zapPhase = "pause";
      zapUntil = now + (0.16 + Math.random() * 0.26) / dens;
    }
    return;
  }

  if (zapPhase === "pause") {
    zapBurstLeft = 2 + ((Math.random() * 2) | 0);
  }
  zapPhase = "burst";
  zapUntil = now + (0.035 + Math.random() * 0.04) / dens;
  sfxBuildZap(zapPos);
}

/**
 * Diff this snapshot against the last and fire rough weapon / spawn / death /
 * construction cues. Safe to call every frame; rate limits live in sfx helpers.
 */
export function tickCombatSfx(snap: SimSnapshot, listen?: MapPos | null) {
  if (!primed) {
    baseline(snap);
    return;
  }

  // ── Projectiles: new = fire, gone = hit ──────────────────────────────────
  const liveShots = new Set<number>();
  for (const p of snap.projectiles) {
    if (p.style === "mine" || p.targetIsMineral) continue;
    liveShots.add(p.id);
    if (!shots.has(p.id)) {
      const light = p.style === "laser" && p.damage > 0 && p.damage <= 7;
      sfxWeaponFire(p.style, light, { x: p.ox, y: p.oy });
      shots.set(p.id, {
        style: p.style,
        targetIsBuilding: p.targetIsBuilding,
        damage: p.damage,
        ox: p.ox,
        oy: p.oy,
        tx: p.tx,
        ty: p.ty,
      });
    } else {
      // track target motion for better hit placement
      const s = shots.get(p.id)!;
      s.tx = p.tx;
      s.ty = p.ty;
    }
  }
  for (const [id, shot] of shots) {
    if (liveShots.has(id)) continue;
    if (shot.damage > 0) sfxHit(shot.style, shot.targetIsBuilding, { x: shot.tx, y: shot.ty });
    shots.delete(id);
  }

  // ── Units: new = spawn, gone = death ─────────────────────────────────────
  const liveUnits = new Set<number>();
  for (const u of snap.units) {
    liveUnits.add(u.id);
    const air = UNITS[u.kind].air;
    const pos = { x: u.x, y: u.y };
    if (!unitIds.has(u.id)) {
      sfxUnitSpawn(air, pos);
      unitIds.add(u.id);
      unitAir.set(u.id, air);
    }
    unitPos.set(u.id, pos);
  }
  for (const id of unitIds) {
    if (liveUnits.has(id)) continue;
    sfxUnitDeath(unitAir.get(id) ?? false, unitPos.get(id) ?? null);
    unitIds.delete(id);
    unitAir.delete(id);
    unitPos.delete(id);
  }

  // ── Buildings: construct / complete / death ──────────────────────────────
  const liveBld = new Set<number>();
  for (const b of snap.buildings) {
    liveBld.add(b.id);
    const pos = { x: b.x, y: b.y };
    const prevDone = buildingDone.get(b.id);
    const prevProg = buildingProgress.get(b.id) ?? 0;

    if (!buildingIds.has(b.id)) {
      buildingIds.add(b.id);
      buildingCore.set(b.id, b.kind === "core");
      buildingDone.set(b.id, b.done);
      buildingProgress.set(b.id, b.progress);
      buildingPos.set(b.id, pos);
      continue;
    }

    if (!b.done && prevProg <= 0.001 && b.progress > 0.001) {
      sfxBuildStart(pos);
    }
    if (b.done && prevDone === false) {
      sfxBuildComplete(pos);
    }

    buildingDone.set(b.id, b.done);
    buildingProgress.set(b.id, b.progress);
    buildingPos.set(b.id, pos);
  }
  for (const id of buildingIds) {
    if (liveBld.has(id)) continue;
    sfxBuildingDeath(buildingCore.get(id) ?? false, buildingPos.get(id) ?? null);
    buildingIds.delete(id);
    buildingCore.delete(id);
    buildingDone.delete(id);
    buildingProgress.delete(id);
    buildingPos.delete(id);
  }

  tickConstructionZaps(nearestBuildSite(snap, listen ?? null), performance.now() / 1000);
}
