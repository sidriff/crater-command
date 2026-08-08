/**
 * Flat-stage launch / egress poses for Construction lab (dispatch mode).
 *
 * Scout Works is the gold-standard path-follow grammar. Other producers use
 * draft stubs so scrub / loop / feedback work while real egress is authored.
 *
 * Pure functions of time. Coordinates: +Y up, +Z model-forward, +X right.
 * Park coords are building model space × SCOUT_PAD.buildScale (same as match).
 */
import { PRODUCT_PARK, SCOUT_PAD } from "@game/render/buildingGeos";
import { SCOUT_VENTRAL_Y } from "@game/render/unitGeos";
import type { BuildingKind } from "@game/sim/types";

/** Match scout cruise altitude (entityUnits.SCOUT_CRUISE) — kept local to avoid sim graph. */
const SCOUT_CRUISE = 2.5;
/** Match flyer / interceptor cruise (entityUnits.AIR_CRUISE). */
const AIR_CRUISE = 1.7;

export type LaunchTuning = {
  /** Seconds locked to the rail / depart window. */
  railSec: number;
  /** Seconds after tip for loft / settle. */
  climbSec: number;
  /** Free-flight cruise height (air). Ground egress ignores this. */
  cruiseY: number;
  /** World-unit depart distance along +Z (or lift use-scale for VTOL). */
  slideDist: number;
  /** Steady free forward speed after climb. */
  freeSpeed: number;
};

export type LaunchPhase =
  | "park"
  | "rail"
  | "roll"
  | "lift"
  | "climb"
  | "push"
  | "free";

export type LaunchPose = {
  x: number;
  y: number;
  z: number;
  /** Nose heading (0 = +Z). */
  yaw: number;
  /** Nose-up positive (radians). */
  pitch: number;
  bank: number;
  scale: number;
  throttle: number;
  rcsL: number;
  rcsR: number;
  /**
   * 0 = pure depart, 1 = fully free.
   * Ramps across the climb/push window (not a height lerp weight for scout).
   */
  freeBlend: number;
  phase: LaunchPhase;
};

const SCALE_BASE = 1.05;
const BUILD = SCOUT_PAD.buildScale;

/** Match-derived defaults: railEnd×launchDur / remainder. */
export const DEFAULT_TUNING: LaunchTuning = {
  railSec: SCOUT_PAD.launchDur * SCOUT_PAD.railEnd,
  climbSec: SCOUT_PAD.launchDur * (1 - SCOUT_PAD.railEnd),
  cruiseY: SCOUT_CRUISE,
  slideDist: 1.15,
  freeSpeed: 1.65,
};

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

function smoothstep(x: number) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** Cubic Hermite: u∈[0,1], m0/m1 = dy/du at endpoints. */
function hermite(u: number, p0: number, p1: number, m0: number, m1: number) {
  const t = clamp01(u);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1
  );
}

/** d(hermite)/du at u (for pitch / path tangent). */
function hermiteDu(u: number, p0: number, p1: number, m0: number, m1: number) {
  const t = clamp01(u);
  const t2 = t * t;
  return (
    (6 * t2 - 6 * t) * p0 +
    (3 * t2 - 4 * t + 1) * m0 +
    (-6 * t2 + 6 * t) * p1 +
    (3 * t2 - 2 * t) * m1
  );
}

/** Park scale at launch start (match: scaleBase * SCOUT_PAD.parkScale). */
function parkUnitScale() {
  return SCALE_BASE * SCOUT_PAD.parkScale;
}

/** Unit origin Y so ventral rests on the rail at given unit scale. */
function parkElev(unitScale: number) {
  return SCOUT_PAD.parkY * BUILD - SCOUT_VENTRAL_Y * unitScale;
}

/** Nose-up rail attitude (match placeOnSurface pitch). */
function railPitch() {
  return -SCOUT_PAD.railTilt;
}

/**
 * Rail progress s(u) and ds/du with ease-in (catapult: slow load, hard fling).
 * u = t / railSec ∈ [0,1].
 */
function railProgress(u: number) {
  const t = clamp01(u);
  return { s: t * t, dsDu: 2 * t };
}

/** Ease-in depart progress (ground / soft VTOL). */
function departProgress(u: number) {
  const t = clamp01(u);
  // Mild crawl then accelerate — readable roll-out without scout snap
  const s = t * t * (0.35 + 0.65 * t); // ≈ 0.35 t² + 0.65 t³
  const dsDu = 0.7 * t + 1.95 * t * t;
  return { s, dsDu };
}

// ─── Scout Works (gold) ─────────────────────────────────────────────────────

/**
 * Evaluate scout pose at absolute time since launch start.
 * t < 0 → parked; [0, railSec] rail; (railSec, railSec+climbSec] climb; after → free.
 */
export function evalScoutLaunch(tSec: number, tuning: LaunchTuning): LaunchPose {
  const railSec = Math.max(0.05, tuning.railSec);
  const climbSec = Math.max(0.05, tuning.climbSec);
  const cruiseY = tuning.cruiseY;
  const slideDist = Math.max(0.05, tuning.slideDist);
  const freeSpeed = Math.max(0.1, tuning.freeSpeed);

  const scPark = parkUnitScale();
  const yPark = parkElev(scPark);
  const zPark = SCOUT_PAD.parkZ * BUILD;
  const pitch0 = railPitch();
  const yTip = yPark + slideDist * Math.tan(pitch0);
  const zTip = zPark + slideDist;

  if (tSec <= 0) {
    return {
      x: 0,
      y: yPark,
      z: zPark,
      yaw: 0,
      pitch: pitch0,
      bank: 0,
      scale: scPark,
      throttle: 0.35,
      rcsL: 0.08,
      rcsR: 0.08,
      freeBlend: 0,
      phase: "park",
    };
  }

  if (tSec <= railSec) {
    const u = tSec / railSec;
    const { s } = railProgress(u);
    const z = zPark + s * slideDist;
    const y = yPark + s * (yTip - yPark);
    const scale = scPark + (SCALE_BASE - scPark) * s;
    const thr = 0.55 + 0.45 * s;
    const rcs = 0.08 + 0.1 * (1 - s);

    return {
      x: 0,
      y,
      z,
      yaw: 0,
      pitch: pitch0,
      bank: 0,
      scale,
      throttle: thr,
      rcsL: rcs,
      rcsR: rcs,
      freeBlend: 0,
      phase: u < 0.02 ? "park" : "rail",
    };
  }

  const { dsDu: dsDuTip } = railProgress(1);
  const dsDtTip = dsDuTip / railSec;
  const tipVz = dsDtTip * slideDist;
  const tipVy = dsDtTip * (yTip - yPark);
  const tau = tSec - railSec;

  if (tau <= climbSec) {
    const u = tau / climbSec;
    const rise = cruiseY - yTip;
    const m0Raw = tipVy * climbSec;
    const m0 =
      rise >= 0
        ? Math.min(m0Raw, Math.max(0, 2.5 * rise))
        : Math.max(m0Raw, Math.min(0, 2.5 * rise));
    const m1 = 0;
    const y = hermite(u, yTip, cruiseY, m0, m1);
    const dyDu = hermiteDu(u, yTip, cruiseY, m0, m1);
    const vy = dyDu / climbSec;

    const sm = smoothstep(u);
    const intSm = u * u * u - 0.5 * u * u * u * u;
    const z =
      zTip + climbSec * (tipVz * u + (freeSpeed - tipVz) * intSm);
    const vz = tipVz + (freeSpeed - tipVz) * sm;

    const pitch = Math.atan2(vy, Math.max(0.05, vz));
    const freeBlend = sm;
    const thrFree = 0.35 + Math.min(0.45, freeSpeed * 0.2);
    const throttle = 1 * (1 - sm) + thrFree * sm;
    const rcs = 0.06 * (1 - sm) + 0.04 * sm;

    return {
      x: 0,
      y,
      z,
      yaw: 0,
      pitch,
      bank: 0,
      scale: SCALE_BASE,
      throttle,
      rcsL: rcs,
      rcsR: rcs,
      freeBlend,
      phase: freeBlend > 0.98 ? "free" : "climb",
    };
  }

  const freeExtra = tau - climbSec;
  const zClimbEnd =
    zTip + climbSec * (tipVz * 1 + (freeSpeed - tipVz) * 0.5);
  const z = zClimbEnd + freeExtra * freeSpeed;
  const y = cruiseY + Math.sin(Math.min(1, freeExtra) * Math.PI) * 0.04;
  const thrFree = 0.35 + Math.min(0.45, freeSpeed * 0.2);
  const pitch = 0.08 * Math.exp(-freeExtra * 2.4);

  return {
    x: 0,
    y,
    z,
    yaw: 0,
    pitch,
    bank: 0,
    scale: SCALE_BASE,
    throttle: thrFree,
    rcsL: 0.04,
    rcsR: 0.04,
    freeBlend: 1,
    phase: "free",
  };
}

// ─── Ground drive-off (Depot rover, Bay raider) ─────────────────────────────

type GroundOpts = {
  /** Multiplier on slideDist (raider bay is shorter / tighter). */
  slideScale?: number;
  /** Multiplier on freeSpeed once clear. */
  speedScale?: number;
};

/**
 * Draft: park → roll along +Z (follow park pitch as ramp slope) → level → drive.
 * Uses railSec as roll-out, climbSec as pitch settle. cruiseY ignored.
 */
export function evalGroundEgress(
  tSec: number,
  tuning: LaunchTuning,
  building: BuildingKind,
  opts: GroundOpts = {},
): LaunchPose {
  const park = PRODUCT_PARK[building];
  if (!park) return evalScoutLaunch(0, tuning);

  const railSec = Math.max(0.05, tuning.railSec);
  const climbSec = Math.max(0.05, tuning.climbSec);
  const slideDist = Math.max(0.05, tuning.slideDist) * (opts.slideScale ?? 1);
  const freeSpeed = Math.max(0.1, tuning.freeSpeed) * (opts.speedScale ?? 0.55);

  const x0 = park.x * BUILD;
  const y0 = park.y * BUILD;
  const z0 = park.z * BUILD;
  const sc = park.scale * BUILD;
  const pitch0 = park.pitch ?? 0;
  // End of ramp / hardstand: follow slope for slideDist
  const yTip = y0 + slideDist * Math.tan(pitch0);
  const zTip = z0 + slideDist;
  // Flat deck after tip — slight drop if we came off a nose-down ramp
  const yFlat = Math.min(y0, yTip);

  if (tSec <= 0) {
    return {
      x: x0,
      y: y0,
      z: z0,
      yaw: park.yaw,
      pitch: pitch0,
      bank: 0,
      scale: sc,
      throttle: 0,
      rcsL: 0,
      rcsR: 0,
      freeBlend: 0,
      phase: "park",
    };
  }

  // Roll-out
  if (tSec <= railSec) {
    const u = tSec / railSec;
    const { s } = departProgress(u);
    const z = z0 + s * slideDist;
    const y = y0 + s * (yTip - y0);
    const pitch = pitch0; // stay on deck attitude
    const thr = 0.25 + 0.55 * s;

    return {
      x: x0,
      y,
      z,
      yaw: park.yaw,
      pitch,
      bank: 0,
      scale: sc,
      throttle: thr,
      rcsL: 0,
      rcsR: 0,
      freeBlend: 0,
      phase: u < 0.02 ? "park" : "roll",
    };
  }

  const { dsDu } = departProgress(1);
  const tipVz = (dsDu / railSec) * slideDist;
  const tau = tSec - railSec;

  // Pitch settle + speed blend to free
  if (tau <= climbSec) {
    const u = tau / climbSec;
    const sm = smoothstep(u);
    const pitch = pitch0 * (1 - sm);
    const y = yTip + (yFlat - yTip) * sm;
    const intSm = u * u * u - 0.5 * u * u * u * u;
    const z =
      zTip + climbSec * (tipVz * u + (freeSpeed - tipVz) * intSm);
    const thr = 0.7 * (1 - sm) + 0.4 * sm;

    return {
      x: x0,
      y,
      z,
      yaw: park.yaw,
      pitch,
      bank: 0,
      scale: sc,
      throttle: thr,
      rcsL: 0,
      rcsR: 0,
      freeBlend: sm,
      phase: sm > 0.98 ? "free" : "climb",
    };
  }

  const freeExtra = tau - climbSec;
  const zEnd = zTip + climbSec * (tipVz + (freeSpeed - tipVz) * 0.5);
  return {
    x: x0,
    y: yFlat,
    z: zEnd + freeExtra * freeSpeed,
    yaw: park.yaw,
    pitch: 0,
    bank: 0,
    scale: sc,
    throttle: 0.4,
    rcsL: 0,
    rcsR: 0,
    freeBlend: 1,
    phase: "free",
  };
}

// ─── VTOL pad egress (Airpad interceptor, Bomber Works) ─────────────────────

type VtolOpts = {
  /** Default cruise if lever left at scout height — still overridable via cruiseY. */
  defaultCruise?: number;
  /** Lift is slower / heavier when > 1. */
  heaviness?: number;
  /** Forward push scale on freeSpeed. */
  speedScale?: number;
};

/**
 * Draft: park → vertical lift (railSec) → pitch-over push (climbSec) → free.
 * Y goes park → cruise; Z holds through lift then accelerates.
 */
export function evalVtolEgress(
  tSec: number,
  tuning: LaunchTuning,
  building: BuildingKind,
  opts: VtolOpts = {},
): LaunchPose {
  const park = PRODUCT_PARK[building];
  if (!park) return evalScoutLaunch(0, tuning);

  const heavy = opts.heaviness ?? 1;
  const railSec = Math.max(0.05, tuning.railSec) * heavy;
  const climbSec = Math.max(0.05, tuning.climbSec) * (0.85 + 0.15 * heavy);
  // Prefer lab cruiseY, but if still at scout default and unit is flyer-class, use air cruise
  let cruiseY = tuning.cruiseY;
  if (
    opts.defaultCruise != null &&
    Math.abs(tuning.cruiseY - SCOUT_CRUISE) < 1e-6
  ) {
    cruiseY = opts.defaultCruise;
  }
  const freeSpeed =
    Math.max(0.1, tuning.freeSpeed) * (opts.speedScale ?? 0.9);

  const x0 = park.x * BUILD;
  const y0 = park.y * BUILD;
  const z0 = park.z * BUILD;
  const sc = park.scale * BUILD;
  // Optional small lateral hold; tip Z after push start
  const liftHover = 0.08; // tiny settle before translating

  if (tSec <= 0) {
    return {
      x: x0,
      y: y0,
      z: z0,
      yaw: park.yaw,
      pitch: 0,
      bank: 0,
      scale: sc,
      throttle: 0.15,
      rcsL: 0.05,
      rcsR: 0.05,
      freeBlend: 0,
      phase: "park",
    };
  }

  // Vertical lift — almost pure +Y
  if (tSec <= railSec) {
    const u = tSec / railSec;
    const s = smoothstep(u); // soft spool, no catapult
    const y = y0 + s * (cruiseY - y0);
    const z = z0 + s * liftHover;
    // Slight nose-up as mains light
    const pitch = 0.12 * s;
    const thr = 0.4 + 0.55 * s;
    const rcs = 0.12 * (1 - s) + 0.05;

    return {
      x: x0,
      y,
      z,
      yaw: park.yaw,
      pitch,
      bank: 0,
      scale: sc,
      throttle: thr,
      rcsL: rcs,
      rcsR: rcs,
      freeBlend: 0,
      phase: u < 0.02 ? "park" : "lift",
    };
  }

  const yLift = cruiseY;
  const zLift = z0 + liftHover;
  const tau = tSec - railSec;

  // Pitch-over + forward push
  if (tau <= climbSec) {
    const u = tau / climbSec;
    const sm = smoothstep(u);
    // Ease into freeSpeed along Z
    const intSm = u * u * u - 0.5 * u * u * u * u;
    const z = zLift + climbSec * freeSpeed * intSm * 2; // avg accel feel
    // Tiny bob then settle on cruise
    const y =
      yLift + Math.sin(sm * Math.PI) * 0.1 * (1 - sm * 0.5);
    // Nose dips from lift attitude into shallow cruise
    const pitch = 0.12 * (1 - sm) + (-0.04) * sm;
    const thr = 0.95 * (1 - 0.4 * sm);
    const freeBlend = sm;

    return {
      x: x0,
      y,
      z,
      yaw: park.yaw,
      pitch,
      bank: 0,
      scale: sc,
      throttle: thr,
      rcsL: 0.05,
      rcsR: 0.05,
      freeBlend,
      phase: freeBlend > 0.98 ? "free" : "push",
    };
  }

  const freeExtra = tau - climbSec;
  // z at end of push: intSm(1)=0.5 → climbSec * freeSpeed * 0.5 * 2 = climbSec * freeSpeed
  const zPushEnd = zLift + climbSec * freeSpeed;
  const thrFree = 0.35 + Math.min(0.4, freeSpeed * 0.15);

  return {
    x: x0,
    y: cruiseY + Math.sin(Math.min(1, freeExtra) * Math.PI) * 0.03,
    z: zPushEnd + freeExtra * freeSpeed,
    yaw: park.yaw,
    pitch: -0.04 * Math.exp(-freeExtra * 1.8),
    bank: 0,
    scale: sc,
    throttle: thrFree,
    rcsL: 0.03,
    rcsR: 0.03,
    freeBlend: 1,
    phase: "free",
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export type DispatchLaunchId =
  | "scout_works"
  | "depot"
  | "barracks"
  | "airpad"
  | "bomber_works"
  | "u:scout"
  | "u:worker"
  | "u:raider"
  | "u:interceptor"
  | "u:bomber"
  | string;

/** Normalize catalog / legacy ids to launch family keys. */
function normalizeLaunchId(id: DispatchLaunchId): string {
  if (id === "u:scout" || id === "scout") return "scout_works";
  if (id === "u:worker" || id === "worker" || id === "rover") return "depot";
  if (id === "u:raider" || id === "raider" || id === "bay") return "barracks";
  if (id === "u:interceptor" || id === "interceptor") return "airpad";
  if (id === "u:bomber" || id === "bomber") return "bomber_works";
  return id;
}

/** Pick the right pure-time egress for a catalog card. */
export function evalDispatchLaunch(
  id: DispatchLaunchId,
  tSec: number,
  tuning: LaunchTuning,
): LaunchPose {
  switch (normalizeLaunchId(id)) {
    case "scout_works":
      return evalScoutLaunch(tSec, tuning);
    case "depot":
      return evalGroundEgress(tSec, tuning, "depot", {
        slideScale: 1.1,
        speedScale: 0.5,
      });
    case "barracks":
      return evalGroundEgress(tSec, tuning, "barracks", {
        slideScale: 0.95,
        speedScale: 0.7,
      });
    case "airpad":
      return evalVtolEgress(tSec, tuning, "airpad", {
        defaultCruise: AIR_CRUISE,
        heaviness: 1,
        speedScale: 1.05,
      });
    case "bomber_works":
      return evalVtolEgress(tSec, tuning, "bomber_works", {
        defaultCruise: AIR_CRUISE * 0.95,
        heaviness: 1.35,
        speedScale: 0.75,
      });
    default:
      return evalScoutLaunch(0, tuning);
  }
}

/** Total powered launch window (rail + climb). VTOL heaviness is baked into eval only. */
export function launchWindowSec(t: LaunchTuning): number {
  return Math.max(0.05, t.railSec) + Math.max(0.05, t.climbSec);
}

/**
 * Cycle window for a card. VTOL drafts stretch rail/climb by heaviness so
 * scrub end matches visible motion (bomber lifts longer than airpad).
 */
export function launchWindowSecFor(
  id: DispatchLaunchId,
  t: LaunchTuning,
): number {
  const key = normalizeLaunchId(id);
  if (key === "bomber_works") {
    const heavy = 1.35;
    return (
      Math.max(0.05, t.railSec) * heavy +
      Math.max(0.05, t.climbSec) * (0.85 + 0.15 * heavy)
    );
  }
  return launchWindowSec(t);
}

/** Hold at park (legacy / fallback). */
export function evalParkHold(park: {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  pitch?: number;
}): LaunchPose {
  return {
    x: park.x * BUILD,
    y: park.y * BUILD,
    z: park.z * BUILD,
    yaw: park.yaw,
    pitch: park.pitch ?? 0,
    bank: 0,
    scale: park.scale * BUILD,
    throttle: 0,
    rcsL: 0,
    rcsR: 0,
    freeBlend: 0,
    phase: "park",
  };
}

export { SCOUT_PAD, SCALE_BASE, BUILD, AIR_CRUISE, SCOUT_CRUISE };
