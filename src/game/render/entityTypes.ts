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
export const ROVER_SCALE = 0.57;
export const ROVER_FOOT_HX = 0.32;
export const ROVER_FOOT_HY = 0.32;
export const GROUND_FOOT_HX = 0.28;
export const GROUND_FOOT_HY = 0.28;
