import type { Group, LineSegments, Mesh, Vector3 } from "three";

export type UnitSmooth = {
  x: number;
  y: number;
  yaw: number;
  moveYaw: number;
  turretYaw: number;
  speed: number;
  turnRate: number;
  hop: number;
  hopVel: number;
  prevSlope: number;
  bank: number;
  stretch: number;
  dustAcc: number;
  /** Air only — altitude runs as a spring-mass, so it needs a rate of its own. */
  elevSm: number;
  elevVel: number;
  pitchSm: number;
  /** Scout inspection dive: seconds remaining, then cooldown to the next one. */
  diveT: number;
  diveCd: number;
  /** Barrel-roll flourish: current roll angle, remaining time, cooldown, direction. */
  roll: number;
  rollT: number;
  rollCd: number;
  rollDir: number;
  /** Thruster drive: main throttle 0–1, per-wingtip RCS demand 0–1. */
  throttle: number;
  rcsL: number;
  rcsR: number;
  /**
   * Scout rail launch: seconds remaining (0 = free flight).
   * `padId` is the Scout Works that flung it; -1 if none.
   */
  launchT: number;
  padId: number;
  mining: boolean;
  building: boolean;
  tipW: Vector3 | null;
  /** Erratic construction zap state machine */
  zap: {
    mode: "on" | "gap" | "pause";
    timer: number;
    burstLeft: number;
    aimX: number;
    aimY: number;
    aimElev: number;
  };
};

export type DustPuff = {
  mesh: Mesh;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  alive: boolean;
};

export type WireEntity = Group & {
  userData: {
    pool: string;
    wireEntity: true;
    hull: Mesh;
    wire: LineSegments;
  };
};

export const DUST_MAX = 16;
/** Seconds for one full 2π barrel roll. */
export const ROLL_DUR = 1.15;
/** Seconds for a scout inspection dive — down, low pass, climb back out. */
export const DIVE_DUR = 2.2;
export const ROVER_SCALE = 0.57;
export const ROVER_FOOT_HX = 0.32;
export const ROVER_FOOT_HY = 0.32;
export const GROUND_FOOT_HX = 0.28;
export const GROUND_FOOT_HY = 0.28;
