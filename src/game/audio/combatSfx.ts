/**
 * Drive combat SFX from snapshot diffs (keeps sim free of audio).
 * Tracks projectiles / units / buildings between frames.
 */
import {
  sfxBuildingDeath,
  sfxHit,
  sfxUnitDeath,
  sfxUnitSpawn,
  sfxWeaponFire,
} from "./sfx";
import { UNITS } from "../sim/defs";
import type { Projectile, SimSnapshot } from "../sim/types";

type TrackedShot = {
  style: Projectile["style"];
  targetIsBuilding: boolean;
  damage: number;
};

let primed = false;
let unitIds = new Set<number>();
let unitAir = new Map<number, boolean>();
let buildingIds = new Set<number>();
let buildingCore = new Map<number, boolean>();
let shots = new Map<number, TrackedShot>();

/** Call when leaving a match so the next game re-baselines. */
export function resetCombatSfx() {
  primed = false;
  unitIds = new Set();
  unitAir = new Map();
  buildingIds = new Set();
  buildingCore = new Map();
  shots = new Map();
}

function baseline(snap: SimSnapshot) {
  unitIds = new Set(snap.units.map((u) => u.id));
  unitAir = new Map(snap.units.map((u) => [u.id, UNITS[u.kind].air]));
  buildingIds = new Set(snap.buildings.map((b) => b.id));
  buildingCore = new Map(snap.buildings.map((b) => [b.id, b.kind === "core"]));
  shots = new Map();
  for (const p of snap.projectiles) {
    if (p.style === "mine" || p.targetIsMineral) continue;
    shots.set(p.id, {
      style: p.style,
      targetIsBuilding: p.targetIsBuilding,
      damage: p.damage,
    });
  }
  primed = true;
}

/**
 * Diff this snapshot against the last and fire rough weapon / spawn / death cues.
 * Safe to call every frame; rate limits live in sfx helpers.
 */
export function tickCombatSfx(snap: SimSnapshot) {
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
      sfxWeaponFire(p.style, light);
      shots.set(p.id, {
        style: p.style,
        targetIsBuilding: p.targetIsBuilding,
        damage: p.damage,
      });
    }
  }
  for (const [id, shot] of shots) {
    if (liveShots.has(id)) continue;
    if (shot.damage > 0) sfxHit(shot.style, shot.targetIsBuilding);
    shots.delete(id);
  }

  // ── Units: new = spawn, gone = death ─────────────────────────────────────
  const liveUnits = new Set<number>();
  for (const u of snap.units) {
    liveUnits.add(u.id);
    const air = UNITS[u.kind].air;
    if (!unitIds.has(u.id)) {
      sfxUnitSpawn(air);
      unitIds.add(u.id);
      unitAir.set(u.id, air);
    }
  }
  for (const id of unitIds) {
    if (liveUnits.has(id)) continue;
    sfxUnitDeath(unitAir.get(id) ?? false);
    unitIds.delete(id);
    unitAir.delete(id);
  }

  // ── Buildings: gone = death (placements already have UI sfx) ─────────────
  const liveBld = new Set<number>();
  for (const b of snap.buildings) {
    liveBld.add(b.id);
    if (!buildingIds.has(b.id)) {
      buildingIds.add(b.id);
      buildingCore.set(b.id, b.kind === "core");
    }
  }
  for (const id of buildingIds) {
    if (liveBld.has(id)) continue;
    sfxBuildingDeath(buildingCore.get(id) ?? false);
    buildingIds.delete(id);
    buildingCore.delete(id);
  }
}
