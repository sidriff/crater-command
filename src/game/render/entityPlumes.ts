/**
 * Thruster plumes for vacuum craft.
 *
 * Vacuum, so no smoke and no billow: a plume is a hard-edged expanding frustum
 * that exists only while the thruster is lit. Plumes parent to the unit shell so
 * they inherit bank / roll for free — a barrel roll drags its exhaust around with
 * it. Pooled and re-parented every frame, same contract as the rover turret.
 */
import * as THREE from "three";
import type { RaceId } from "../sim/types";
import type { UnitSmooth } from "./entityTypes";
import {
  BOMBER_BELLS,
  BOMBER_RCS,
  FLYER_BELLS,
  FLYER_RCS,
  INTERCEPTOR_BELLS,
  INTERCEPTOR_RCS,
  SCOUT_BELLS,
  SCOUT_RCS,
} from "./unitGeos";

export type PlumeMesh = THREE.Mesh & { userData: { pool: string } };

export type PlumeMount = { readonly x: number; readonly y: number; readonly z: number };

/** Per-craft nozzle layout and plume proportions (model space). */
export type PlumeRig = {
  bells: readonly PlumeMount[];
  rcs: readonly PlumeMount[];
  /** Main: throat radius, idle length, extra length at full throttle. */
  bellW: number;
  bellLen: number;
  bellGain: number;
  /** RCS: throat radius, min length, extra length at full demand. */
  rcsW: number;
  rcsLen: number;
  rcsGain: number;
};

export const SCOUT_RIG: PlumeRig = {
  bells: SCOUT_BELLS,
  rcs: SCOUT_RCS,
  bellW: 0.048,
  bellLen: 0.17,
  bellGain: 0.38,
  rcsW: 0.026,
  rcsLen: 0.09,
  rcsGain: 0.17,
};

/** Flyer runs a hotter, shorter main — it's a gunship, not a sprinter. */
export const FLYER_RIG: PlumeRig = {
  bells: FLYER_BELLS,
  rcs: FLYER_RCS,
  bellW: 0.052,
  bellLen: 0.14,
  bellGain: 0.3,
  rcsW: 0.024,
  rcsLen: 0.07,
  rcsGain: 0.13,
};

/** Interceptor — compact fighter; mains match the twin aft bells. */
export const INTERCEPTOR_RIG: PlumeRig = {
  bells: INTERCEPTOR_BELLS,
  rcs: INTERCEPTOR_RCS,
  bellW: 0.05,
  bellLen: 0.15,
  bellGain: 0.32,
  rcsW: 0.024,
  rcsLen: 0.07,
  rcsGain: 0.14,
};

/** Bomber — heavier pods, slightly fatter plumes. */
export const BOMBER_RIG: PlumeRig = {
  bells: BOMBER_BELLS,
  rcs: BOMBER_RCS,
  bellW: 0.062,
  bellLen: 0.16,
  bellGain: 0.28,
  rcsW: 0.026,
  rcsLen: 0.08,
  rcsGain: 0.12,
};

/**
 * Open frustum: throat radius 1 at z=0, mouth radius 1.8 at z=-1. Scale x/y for
 * throat width and z for length. Starting at a throat rather than a point means
 * it reads as continuous with the bell instead of a spike taped to it.
 */
export function makePlumeGeo() {
  const g = new THREE.CylinderGeometry(1, 1.8, 1, 6, 1, true);
  g.translate(0, -0.5, 0);
  g.rotateX(Math.PI / 2);
  return g;
}

export type PlumeHost = {
  acquirePlume: (race: RaceId) => PlumeMesh;
};

/** Deterministic per-unit flicker — no Math.random, so it doesn't crawl. */
function flicker(t: number, id: number, rate: number) {
  return 0.88 + Math.sin(t * rate + id * 2.39) * 0.08 + Math.sin(t * rate * 2.7 + id) * 0.04;
}

export function attachPlumes(
  host: PlumeHost,
  shell: THREE.Object3D,
  rig: PlumeRig,
  s: UnitSmooth,
  race: RaceId,
  t: number,
  id: number,
) {
  // Mains: never fully off — it's hovering, so it's always fighting the rock —
  // but they punch out under acceleration and through the roll.
  const mainLen = (rig.bellLen + s.throttle * rig.bellGain) * flicker(t, id, 41);
  for (const b of rig.bells) {
    const p = host.acquirePlume(race);
    shell.add(p);
    p.position.set(b.x, b.y, b.z);
    p.rotation.set(0, 0, 0);
    p.scale.set(rig.bellW, rig.bellW, mainLen);
    (p.material as THREE.MeshBasicMaterial).opacity = 0.12 + s.throttle * 0.3;
  }

  // Wingtip RCS: short downward jets, only while actually torquing.
  const rcs = [s.rcsR, s.rcsL];
  for (let i = 0; i < rig.rcs.length; i++) {
    const level = rcs[i] ?? 0;
    if (level < 0.06) continue;
    const port = rig.rcs[i]!;
    const p = host.acquirePlume(race);
    shell.add(p);
    p.position.set(port.x, port.y, port.z);
    p.rotation.set(-Math.PI / 2, 0, 0); // aim the mouth at -Y
    const len = (rig.rcsLen + level * rig.rcsGain) * flicker(t, id + i * 7, 63);
    p.scale.set(rig.rcsW, rig.rcsW, len);
    (p.material as THREE.MeshBasicMaterial).opacity = 0.16 + level * 0.34;
  }
}
