import * as THREE from "three";
import { MAP_W, UNITS } from "../sim/defs";
import type { PlayerId, RaceId, SimSnapshot, UnitKind } from "../sim/types";
import { SCOUT_PAD } from "./buildingGeos";
import { crtWinkIn } from "./entityCrt";
import { FLYER_RIG, SCOUT_RIG, attachPlumes, type PlumeHost } from "./entityPlumes";
import {
  DIVE_DUR,
  DUST_MAX,
  GROUND_FOOT_HX,
  GROUND_FOOT_HY,
  ROLL_DUR,
  ROVER_FOOT_HX,
  ROVER_FOOT_HY,
  ROVER_SCALE,
  type DustPuff,
  type UnitSmooth,
  type WireEntity,
} from "./entityTypes";
import {
  UNIT_SMOOTH,
  footprintClearanceElev,
  mapToWorld,
  placeOnSurface,
  scaffoldFootprint,
  smoothToward,
} from "./planetMath";
import {
  FLYER_PIVOT_Y,
  ROVER_TURRET_PIVOT,
  ROVER_TURRET_TIP,
  SCOUT_PIVOT_Y,
  SCOUT_VENTRAL_Y,
} from "./unitGeos";

export type UnitsHost = PlumeHost & {
  viewer: PlayerId;
  entityRoot: THREE.Group;
  unitSmooth: Map<number, UnitSmooth>;
  unitFirstSeen: Map<number, number>;
  unitPool: THREE.Object3D[];
  turretPool: THREE.Object3D[];
  unitGeos: ReturnType<typeof import("./unitGeos").makeUnitGeos>;
  unitEdges: Record<string, THREE.EdgesGeometry>;
  dustPool: DustPuff[];
  dustActive: number;
  dustGeo: THREE.BufferGeometry;
  dustMat: THREE.MeshBasicMaterial;
  dustRoot: THREE.Group;
  _tip: THREE.Vector3;
  _east: THREE.Vector3;
  _north: THREE.Vector3;
  _n: THREE.Vector3;
  _p: THREE.Vector3;
  raceOf: (owner: PlayerId) => RaceId;
  isVisible: (x: number, y: number) => boolean;
  unitGeo: (kind: UnitKind, race?: RaceId) => THREE.BufferGeometry;
  unitEdge: (kind: UnitKind, race?: RaceId) => THREE.EdgesGeometry | THREE.BufferGeometry;
  acquireWire: (
    pool: THREE.Object3D[],
    solidGeo: THREE.BufferGeometry,
    edgeGeo: THREE.EdgesGeometry | THREE.BufferGeometry,
    race: RaceId,
    poolTag: string,
    opts?: { hull?: boolean; wireBright?: boolean },
  ) => WireEntity;
};

/** Cruise altitudes — scout sits high enough to read apart from the flyer. */
export const AIR_CRUISE = 1.7;
export const SCOUT_CRUISE = 2.5;
/** How far the scout drops out of transit for a low pass. */
export const SCOUT_DIVE_DEPTH = 1.4;

/** Nearest finished Scout Works for this owner within ~1.2 map units. */
function nearestScoutPad(
  snap: SimSnapshot,
  owner: PlayerId,
  x: number,
  y: number,
): { id: number; x: number; y: number; buildElevHint: number } | null {
  let best: { id: number; x: number; y: number; buildElevHint: number } | null = null;
  let bestD = 1.2;
  for (const b of snap.buildings) {
    if (b.owner !== owner || b.kind !== "scout" || !b.done) continue;
    let dx = b.x - x;
    if (dx > MAP_W * 0.5) dx -= MAP_W;
    if (dx < -MAP_W * 0.5) dx += MAP_W;
    const dy = b.y - y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      // Operators sit on scaffold; non-Ops on rock. Match entityBuildings.
      best = { id: b.id, x: b.x, y: b.y, buildElevHint: 0 };
    }
  }
  return best;
}

/** World elev of ventral-on-rails for a unit-scale scout at this pad. */
function scoutParkElev(buildElev: number, unitScale: number): number {
  return buildElev + SCOUT_PAD.parkY * SCOUT_PAD.buildScale - SCOUT_VENTRAL_Y * unitScale;
}

export function turnToward(s: UnitSmooth, targetYaw: number, rate: number, dt: number) {
    let dAng = targetYaw - s.yaw;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    s.yaw += dAng * Math.min(1, rate * dt);
    return dAng;
  }

/**
 * Beam origin without walking the scene graph — the shell-parented path in
 * `syncUnits` is authoritative; this is for callers that only have sim state.
 * Needs both yaws: the mast stands forward of the chassis origin, so the pivot
 * swings with the *body* while the aperture swings with the turret.
 */
export function roverTipWorld(host: UnitsHost,
    x: number,
    y: number,
    elev: number,
    scale: number,
    bodyYaw: number,
    turretYaw: number,
    out: THREE.Vector3,
  ) {
    mapToWorld(x, y, host._p);
    if (host._p.lengthSq() < 1e-12) host._n.set(0, 1, 0);
    else host._n.copy(host._p).normalize();
    const eps = 0.08;
    mapToWorld(x + eps, y, host._east);
    mapToWorld(x, y + eps, host._north);
    host._east.sub(host._p).addScaledVector(host._n, -host._east.dot(host._n));
    if (host._east.lengthSq() < 1e-12) {
      host._east.set(0, 1, 0).cross(host._n);
      if (host._east.lengthSq() < 1e-8) host._east.set(1, 0, 0).cross(host._n);
    }
    host._east.normalize();
    host._north.sub(host._p).addScaledVector(host._n, -host._north.dot(host._n));
    if (host._north.lengthSq() < 1e-12) host._north.copy(host._n).cross(host._east);
    host._north.normalize();
    host._north.addScaledVector(host._east, -host._north.dot(host._east));
    if (host._north.lengthSq() < 1e-12) host._north.copy(host._n).cross(host._east);
    host._north.normalize();
    if (host._east.clone().cross(host._north).dot(host._n) < 0) host._north.negate();

    // Model +Z runs east at yaw 0, model +X runs north — same basis placeOnSurface
    // uses. Pivot offset rotates by bodyYaw, aperture offset by turretYaw.
    const mast = ROVER_TURRET_PIVOT.z;
    const reach = ROVER_TURRET_TIP.z;
    const east = (mast * Math.cos(bodyYaw) + reach * Math.cos(turretYaw)) * scale;
    const north = (mast * Math.sin(bodyYaw) + reach * Math.sin(turretYaw)) * scale;
    const tipY = (ROVER_TURRET_PIVOT.y + ROVER_TURRET_TIP.y) * scale;
    out
      .copy(host._p)
      .addScaledVector(host._n, elev + tipY)
      .addScaledVector(host._east, east)
      .addScaledVector(host._north, north);
    return out;
  }

export function spawnDust(host: UnitsHost, 
    x: number,
    y: number,
    elev: number,
    ox: number,
    oz: number,
    yaw: number,
    speed: number,
  ) {
    if (host.dustActive >= DUST_MAX) return;
    let puff: DustPuff | undefined;
    for (const p of host.dustPool) {
      if (!p.alive) {
        puff = p;
        break;
      }
    }
    if (!puff) {
      const mesh = new THREE.Mesh(host.dustGeo, host.dustMat.clone());
      mesh.frustumCulled = true;
      mesh.renderOrder = 4;
      puff = { mesh, age: 0, life: 0.45, vx: 0, vy: 0, vz: 0, alive: false };
      host.dustPool.push(puff);
      host.dustRoot.add(mesh);
    }
    puff.alive = true;
    puff.age = 0;
    puff.life = 0.18 + Math.random() * 0.14;
    const side = Math.random() > 0.5 ? 1 : -1;
    const back = yaw + Math.PI + (Math.random() - 0.5) * 0.8;
    const kick = 0.35 + speed * 0.55 + Math.random() * 0.35;
    const sc0 = 0.22 + Math.random() * 0.18;
    placeOnSurface(
      puff.mesh,
      x,
      y,
      elev + 0.04 + Math.random() * 0.03,
      ox,
      0,
      oz,
      sc0,
      sc0,
      sc0,
      yaw + (Math.random() - 0.5) * 2,
    );
    const n = puff.mesh.position.clone().normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(n);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0).cross(n);
    east.normalize();
    const north = n.clone().cross(east).normalize();
    const fx = Math.cos(back);
    const fz = Math.sin(back);
    const lateral = east.clone().multiplyScalar(fx).addScaledVector(north, fz);
    lateral.multiplyScalar(kick * 0.4 * side);
    const upKick = n.clone().multiplyScalar(0.45 + Math.random() * 0.55);
    const backKick = east
      .clone()
      .multiplyScalar(Math.cos(yaw + Math.PI) * kick * 0.25)
      .addScaledVector(north, Math.sin(yaw + Math.PI) * kick * 0.25);
    const vel = lateral.add(upKick).add(backKick);
    puff.vx = vel.x;
    puff.vy = vel.y;
    puff.vz = vel.z;
    puff.mesh.visible = true;
    (puff.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55;
    host.dustActive++;
  }

export function updateDust(host: UnitsHost, dt: number) {
    if (host.dustActive <= 0) return;
    let live = 0;
    for (const p of host.dustPool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        p.mesh.visible = false;
        continue;
      }
      live++;
      const t = p.age / p.life;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const n = p.mesh.position;
      const len = n.length() || 1;
      p.vx += (-n.x / len) * 9 * dt;
      p.vy += (-n.y / len) * 9 * dt;
      p.vz += (-n.z / len) * 9 * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
      p.vz *= 1 - 2.2 * dt;
      p.mesh.scale.setScalar(Math.max(0.04, (0.35 + t * 0.35) * (1 - t * t)));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
    }
    host.dustActive = live;
  }

export function syncUnits(host: UnitsHost, snap: SimSnapshot, dt: number) {
    const kSmooth = 1 - Math.exp(-UNIT_SMOOTH * dt);
    const kRover = 1 - Math.exp(-UNIT_SMOOTH * 0.72 * dt);
    // Air chases its sim position lazily so waypoint corners round into arcs
    const kAir = 1 - Math.exp(-UNIT_SMOOTH * 0.3 * dt);

    for (const u of snap.units) {
      if (u.owner !== host.viewer && !host.isVisible(u.x, u.y)) continue;
      const race = host.raceOf(u.owner);
      const isOperatorsRover = u.kind === "worker" && race === "operators";
      const air = UNITS[u.kind].air;
      const isScout = u.kind === "scout";
      const isMining =
        u.kind === "worker" &&
        !u.carrying &&
        u.mineMineralId != null &&
        u.mineProgress > 0.001 &&
        u.buildTargetId == null;

      let isBuilding = false;
      let buildB: (typeof snap.buildings)[0] | null = null;
      if (u.kind === "worker" && u.buildTargetId != null) {
        buildB = snap.buildings.find((bb) => bb.id === u.buildTargetId) ?? null;
        if (buildB && !buildB.done) {
          const d = Math.hypot(u.x - buildB.x, u.y - buildB.y);
          isBuilding = d <= 0.65;
        }
      }
      const isStationed = isMining || isBuilding;

      let s = host.unitSmooth.get(u.id);
      if (!s) {
        // Scout Works fling: appear on the rail of the nearest pad (no CRT wink).
        const pad = isScout ? nearestScoutPad(snap, u.owner, u.x, u.y) : null;
        const launch = isScout && pad != null;
        const unitScale0 = 1.05;
        let buildElev = 0;
        if (launch && pad && race === "operators") {
          const scaf = scaffoldFootprint(pad.x, pad.y, 0.78, 0, 0.1, 0.45);
          buildElev = scaf.deckElev + 0.12;
        }
        const parkElev = launch
          ? scoutParkElev(buildElev, unitScale0 * SCOUT_PAD.parkScale)
          : isScout
            ? SCOUT_CRUISE
            : air
              ? AIR_CRUISE
              : 0.14;
        s = {
          x: pad?.x ?? u.x,
          y: pad?.y ?? u.y,
          yaw: 0,
          moveYaw: 0,
          turretYaw: 0,
          speed: launch ? 0.55 : 0,
          turnRate: 0,
          hop: 0,
          hopVel: 0,
          prevSlope: 0,
          bank: 0,
          stretch: 1,
          dustAcc: 0,
          elevSm: parkElev,
          elevVel: 0,
          pitchSm: launch ? -SCOUT_PAD.railTilt : 0,
          // First dive well after the launch arc has settled
          diveT: 0,
          diveCd: 7 + (u.id % 5),
          roll: 0,
          rollT: 0,
          // stagger first rolls so a scouting pair doesn't sync up
          rollCd: launch ? SCOUT_PAD.launchDur + 2 + (u.id % 5) : 3 + (u.id % 9),
          rollDir: u.id % 2 === 0 ? 1 : -1,
          throttle: launch ? 1 : 0.2,
          rcsL: 0,
          rcsR: 0,
          launchT: launch ? SCOUT_PAD.launchDur : 0,
          padId: pad?.id ?? -1,
          mining: false,
          building: false,
          tipW: null,
          zap: {
            mode: "pause",
            timer: 0.05 + Math.random() * 0.15,
            burstLeft: 0,
            aimX: u.x,
            aimY: u.y,
            aimElev: 0.45,
          },
        };
        host.unitSmooth.set(u.id, s);
        // Continuous rail motion — skip phosphor wink so it doesn't blink off the pad
        if (launch) host.unitFirstSeen.set(u.id, performance.now() - 2000);
        else if (!host.unitFirstSeen.has(u.id)) host.unitFirstSeen.set(u.id, performance.now());
      }
      if (!host.unitFirstSeen.has(u.id)) host.unitFirstSeen.set(u.id, performance.now());
      // CRT phosphor spawn wink — hard on/off frames, then solid
      const spawnAge = (performance.now() - host.unitFirstSeen.get(u.id)!) / 1000;
      const spawnVis = crtWinkIn(spawnAge);
      // Keep sim lock while winking so they don't slide before the first solid frame
      s.mining = isMining;
      s.building = isBuilding;
      s.tipW = null;
      if (spawnVis < 0.5) {
        s.x = u.x;
        s.y = u.y;
        continue;
      }

      if (isScout && s.launchT > 0) s.launchT = Math.max(0, s.launchT - dt);
      const launching = isScout && s.padId >= 0 && s.launchT > 0;
      const launchFrac = launching ? 1 - s.launchT / SCOUT_PAD.launchDur : 1;
      // 0 = pure rail, 1 = fully free-flight controls (smoothstep across railEnd→1)
      const freeBlend = launching
        ? (() => {
            const t = (launchFrac - SCOUT_PAD.railEnd) / Math.max(1e-4, 1 - SCOUT_PAD.railEnd);
            const x = THREE.MathUtils.clamp(t, 0, 1);
            return x * x * (3 - 2 * x);
          })()
        : 1;
      const railBlend = 1 - freeBlend;

      const px = s.x;
      const py = s.y;
      if (isStationed) {
        s.x = u.x;
        s.y = u.y;
        s.speed = 0;
      } else if (launching) {
        // Early: ride the rail east. Late: hand position to the same kAir chase
        // free flight uses, so release doesn't yank toward the sim waypoint.
        const chaseK = kAir * (0.12 + 0.88 * freeBlend);
        smoothToward(s, u.x, u.y, Math.min(1, chaseK));
        if (railBlend > 0.04) {
          s.x = (s.x + railBlend * 1.15 * dt + MAP_W) % MAP_W;
        }
      } else {
        smoothToward(s, u.x, u.y, air ? kAir : isOperatorsRover ? kRover : kSmooth);
      }
      let mdx = s.x - px;
      if (mdx > MAP_W * 0.5) mdx -= MAP_W;
      if (mdx < -MAP_W * 0.5) mdx += MAP_W;
      const mdy = s.y - py;
      const distStep = Math.hypot(mdx, mdy);
      const instSpeed = dt > 1e-6 ? distStep / dt : 0;
      // Soft-start speed during launch so free flight doesn't inherit a spike
      const speedK = launching ? 6 + freeBlend * 6 : 10;
      s.speed += (instSpeed - s.speed) * Math.min(1, speedK * dt);

      let moveYaw = s.moveYaw;
      const moved = !isStationed && distStep > 1e-5;
      let drift = 0;
      if (launching) {
        const railYaw = 0; // pad faces east
        let freeYaw = railYaw;
        if (moved) freeYaw = Math.atan2(mdy, mdx);
        else {
          let tx = u.x - s.x;
          if (tx > MAP_W * 0.5) tx -= MAP_W;
          if (tx < -MAP_W * 0.5) tx += MAP_W;
          const ty = u.y - s.y;
          if (tx * tx + ty * ty > 1e-6) freeYaw = Math.atan2(ty, tx);
        }
        // Nose stays on the rail early, then arcs into free-flight heading
        // (same turn family as cruise — no snap on release).
        let dFree = freeYaw - railYaw;
        while (dFree > Math.PI) dFree -= Math.PI * 2;
        while (dFree < -Math.PI) dFree += Math.PI * 2;
        const targetYaw = railYaw + dFree * freeBlend;
        s.moveYaw = targetYaw;
        turnToward(s, targetYaw, 1.2 + freeBlend * 2.0, dt);
        s.turnRate *= Math.max(0, 1 - 4 * dt * railBlend);
        drift = s.moveYaw - s.yaw;
        while (drift > Math.PI) drift -= Math.PI * 2;
        while (drift < -Math.PI) drift += Math.PI * 2;
      } else if (moved) {
        moveYaw = Math.atan2(mdy, mdx);
        let dPath = moveYaw - s.moveYaw;
        while (dPath > Math.PI) dPath -= Math.PI * 2;
        while (dPath < -Math.PI) dPath += Math.PI * 2;
        s.turnRate += (dPath / Math.max(dt, 1e-4) - s.turnRate) * Math.min(1, 10 * dt);
        s.moveYaw = moveYaw;
        // Slow the nose down for air so it arcs — and crabs a little mid-turn,
        // which is exactly what a craft with no airframe to align would do.
        const yawRate = isOperatorsRover ? 3.2 : isScout ? 2.6 : air ? 6 : 14;
        turnToward(s, moveYaw, yawRate, dt);
        drift = moveYaw - s.yaw;
        while (drift > Math.PI) drift -= Math.PI * 2;
        while (drift < -Math.PI) drift += Math.PI * 2;
      } else if (!isStationed && u.targetId != null) {
        const tgt = u.targetIsBuilding
          ? snap.buildings.find((b) => b.id === u.targetId)
          : snap.units.find((uu) => uu.id === u.targetId);
        if (tgt) {
          let tx = tgt.x - s.x;
          if (tx > MAP_W * 0.5) tx -= MAP_W;
          if (tx < -MAP_W * 0.5) tx += MAP_W;
          const ty = tgt.y - s.y;
          if (tx * tx + ty * ty > 1e-6) turnToward(s, Math.atan2(ty, tx), 10, dt);
        }
        s.turnRate *= Math.max(0, 1 - 8 * dt);
      } else {
        s.turnRate *= Math.max(0, 1 - 8 * dt);
      }

      let turretTarget = s.yaw;
      if (isMining && u.mineMineralId != null) {
        const min = snap.minerals.find((mm) => mm.id === u.mineMineralId);
        if (min) {
          let tx = min.x - s.x;
          if (tx > MAP_W * 0.5) tx -= MAP_W;
          if (tx < -MAP_W * 0.5) tx += MAP_W;
          const ty = min.y - s.y;
          if (tx * tx + ty * ty > 1e-8) turretTarget = Math.atan2(ty, tx);
        }
      } else if (isBuilding) {
        let tx = s.zap.aimX - s.x;
        if (tx > MAP_W * 0.5) tx -= MAP_W;
        if (tx < -MAP_W * 0.5) tx += MAP_W;
        const ty = s.zap.aimY - s.y;
        if (tx * tx + ty * ty > 1e-8) turretTarget = Math.atan2(ty, tx);
      }
      {
        let dT = turretTarget - s.turretYaw;
        while (dT > Math.PI) dT -= Math.PI * 2;
        while (dT < -Math.PI) dT += Math.PI * 2;
        s.turretYaw += dT * Math.min(1, (isStationed ? 14 : 5) * dt);
      }

      const geo = host.unitGeo(u.kind, race);
      const edge = host.unitEdge(u.kind, race);
      const scaleBase =
        u.kind === "tank" ? 1.15 : isOperatorsRover ? ROVER_SCALE : u.kind === "worker" ? 0.95 : 1.05;

      let elev = air ? s.elevSm : 0.14;
      let bank = 0;
      let pitch = 0;
      let sx = scaleBase;
      let sy = scaleBase;
      let sz = scaleBase;

      if (!air) {
        const hx = isOperatorsRover ? ROVER_FOOT_HX : GROUND_FOOT_HX;
        const hy = isOperatorsRover ? ROVER_FOOT_HY : GROUND_FOOT_HY;
        const base = isOperatorsRover ? 0.18 : 0.14;
        const clear = footprintClearanceElev(s.x, s.y, hx, hy, base);
        elev = clear.elev;

        if (isOperatorsRover) {
          if (isStationed) {
            s.hop = 0;
            s.hopVel = 0;
            s.bank *= Math.max(0, 1 - 12 * dt);
            s.stretch += (1 - s.stretch) * Math.min(1, 12 * dt);
            s.dustAcc = 0;
            bank = s.bank;
            pitch = 0;
            sx = sy = sz = scaleBase;
            s.prevSlope = clear.slope;
          } else {
            const slopeDelta = clear.slope - s.prevSlope;
            s.prevSlope = clear.slope;
            const hardTurn = Math.abs(s.turnRate) > 1.4 && s.speed > 0.2;
            const rampHit = slopeDelta > 0.1 && s.speed > 0.15;
            if ((hardTurn || rampHit) && s.hop < 0.02) {
              s.hopVel = hardTurn ? 1.4 + Math.min(0.8, s.speed * 0.6) : 1.1 + slopeDelta * 1.5;
            }
            s.hopVel -= 18 * dt;
            s.hop += s.hopVel * dt;
            if (s.hop < 0) {
              s.hop = 0;
              s.hopVel = 0;
            }
            s.hop = Math.min(s.hop, 0.14);
            elev += s.hop;

            const bankT = THREE.MathUtils.clamp(-drift * 0.35 - s.turnRate * 0.06, -0.18, 0.18);
            s.bank += (bankT - s.bank) * Math.min(1, 10 * dt);
            bank = s.bank;
            pitch = THREE.MathUtils.clamp(s.hopVel * 0.02 + s.hop * 0.2, -0.12, 0.22);

            const stretchT =
              s.speed > 0.08
                ? 1 + Math.min(0.08, s.speed * 0.1)
                : 1 - Math.min(0.05, (0.08 - s.speed) * 0.4);
            s.stretch += (stretchT - s.stretch) * Math.min(1, 8 * dt);
            sx = scaleBase * (2 - s.stretch);
            sz = scaleBase * s.stretch;
            sy = scaleBase * (1 + s.hop * 0.08);

            if (s.speed > 0.08 && host.isVisible(s.x, s.y)) {
              s.dustAcc += dt * (0.45 + s.speed * 1.1 + Math.abs(s.turnRate) * 0.25);
              const interval = 0.2;
              while (s.dustAcc >= interval) {
                s.dustAcc -= interval;
                const wheels = [
                  { ox: 0.24, oz: 0.22 },
                  { ox: -0.24, oz: 0.22 },
                  { ox: 0.24, oz: -0.22 },
                  { ox: -0.24, oz: -0.22 },
                ];
                const w0 = wheels[(Math.random() * 4) | 0]!;
                spawnDust(host, s.x, s.y, elev, w0.ox, w0.oz, s.moveYaw, s.speed);
              }
            } else {
              s.dustAcc = 0;
            }
          }
        } else {
          s.prevSlope = clear.slope;
        }
      } else {
        // ── Vacuum flight (+ optional Scout Works launch blend) ────────
        // Scouts cruise well above the flyer: altitude alone tells the two air
        // units apart before you can resolve either silhouette.
        const cruise = isScout ? SCOUT_CRUISE : AIR_CRUISE;
        const elevPrev = s.elevSm;

        // Inspection dive — suppressed while leaving the pad so we don't dive
        // straight off the rail into the rock.
        if (isScout && !launching) {
          if (s.diveT > 0) {
            s.diveT = Math.max(0, s.diveT - dt);
          } else {
            s.diveCd -= dt;
            // never stack a dive on a roll — one flourish at a time
            if (s.diveCd <= 0 && s.rollT <= 0 && s.speed > 0.18) {
              s.diveT = DIVE_DUR;
              s.diveCd = 11 + (u.id % 6);
            }
          }
        }
        // Flat-bottomed dip: down quick, hold the pass, climb back out.
        const diveP = s.diveT > 0 ? 1 - s.diveT / DIVE_DUR : 0;
        const diveDrop =
          diveP > 0 ? Math.pow(Math.sin(diveP * Math.PI), 0.6) * SCOUT_DIVE_DEPTH : 0;

        // Terrain look-ahead: sample a box around the craft so it lofts over a
        // rim rather than discovering it. Doubles as the floor below.
        const lift = footprintClearanceElev(s.x, s.y, 0.55, 0.55, 0).elev;

        const elevTFree =
          cruise +
          lift -
          diveDrop -
          // Banking tips the thrust vector off vertical, so a hard turn sinks and
          // the recovery climbs back out. The opposite of a held hover height.
          Math.abs(s.bank) * 0.55 +
          Math.sin(snap.t * (isScout ? 0.55 : 0.8) + u.id) * (isScout ? 0.2 : 0.3);

        // Rail elev: climb from park pose into the *same* free target (cruise+lift)
        // so release already sits on the free-flight set-point — no spring snap.
        let elevT = elevTFree;
        let parkScale = scaleBase;
        if (launching) {
          const padB = snap.buildings.find((bb) => bb.id === s.padId);
          const padX = padB?.x ?? s.x;
          const padY = padB?.y ?? s.y;
          let buildElev = 0;
          if (race === "operators") {
            const scaf = scaffoldFootprint(padX, padY, 0.78, 0, 0.1, 0.45);
            buildElev = scaf.deckElev + 0.12;
          }
          parkScale = scaleBase * SCOUT_PAD.parkScale;
          const parkElev = scoutParkElev(buildElev, parkScale);
          const pRail = launchFrac * launchFrac * (3 - 2 * launchFrac);
          const elevTRail =
            parkElev + pRail * (elevTFree - parkElev) + Math.sin(pRail * Math.PI) * 0.28;
          elevT = elevTRail * railBlend + elevTFree * freeBlend;
        }

        // Spring-mass, deliberately underdamped (ζ≈0.55). During early rail we
        // track elevT tightly and seed elevVel from the climb so the handoff
        // into free spring doesn't zero-out momentum.
        const kSpring = isScout ? 9 : 12;
        const cDamp = isScout ? 3.9 : 5;
        if (launching && railBlend > 0.55) {
          const next = s.elevSm + (elevT - s.elevSm) * Math.min(1, 14 * dt);
          s.elevVel = dt > 1e-5 ? (next - s.elevSm) / dt : 0;
          s.elevSm = next;
        } else {
          // Slightly stiffer while still blending so we settle onto free elev
          const k = kSpring * (launching ? 1 + railBlend * 0.6 : 1);
          const c = cDamp * (launching ? 1 + railBlend * 0.4 : 1);
          s.elevVel += ((elevT - s.elevSm) * k - s.elevVel * c) * dt;
          s.elevSm += s.elevVel * dt;
        }

        // Backstop so a dive over rising ground can never reach the rock.
        const floor = lift + 0.5;
        if (s.elevSm < floor) {
          s.elevSm = floor;
          if (s.elevVel < 0) s.elevVel = 0;
        }

        // Rolls carry a lazy climb over the top so they read as a maneuver
        // rather than the craft spinning on a spit.
        const rollArc = s.rollT > 0 ? Math.sin((1 - s.rollT / ROLL_DUR) * Math.PI) * 0.4 : 0;
        elev = s.elevSm + rollArc;

        // Coordinated bank — gated by freeBlend so the rail exit isn't a hard roll-in.
        const maxBank = isScout ? 1.0 : 0.55;
        const bankT =
          THREE.MathUtils.clamp(
            -s.turnRate * (isScout ? 0.45 : 0.3) - drift * 0.3,
            -maxBank,
            maxBank,
          ) * freeBlend;
        s.bank += (bankT - s.bank) * Math.min(1, (isScout ? 4.5 : 7) * dt);

        // Barrel roll: free in vacuum — not during/right after pad launch.
        const rollPrev = s.roll;
        if (isScout && !launching) {
          if (s.rollT > 0) {
            s.rollT = Math.max(0, s.rollT - dt);
          } else {
            s.rollCd -= dt;
            if (s.rollCd <= 0 && s.speed > 0.22) {
              const provoked = Math.abs(s.turnRate) > 0.8;
              s.rollT = ROLL_DUR;
              s.rollDir = provoked ? (s.turnRate > 0 ? 1 : -1) : s.rollDir;
              s.rollCd = (provoked ? 5 : 9) + (u.id % 7);
            }
          }
          const p = s.rollT > 0 ? 1 - s.rollT / ROLL_DUR : 0;
          // smoothstep so it eases in and out rather than snapping to rate
          s.roll = p > 0 ? s.rollDir * Math.PI * 2 * (p * p * (3 - 2 * p)) : 0;
        } else if (launching) {
          s.roll = 0;
          s.rollT = 0;
        }
        const rollRate = dt > 1e-5 ? (s.roll - rollPrev) / dt : 0;
        bank = s.bank + s.roll;

        // Nose: rail pitch early → path-follow pitch late (same climb signal free flight uses).
        const climb = dt > 1e-5 ? (elev - elevPrev) / dt : 0;
        const pitchFree =
          THREE.MathUtils.clamp(climb * 0.3, -0.5, 0.5) + (s.rollT > 0 ? 0.1 : 0);
        const pitchRail = -SCOUT_PAD.railTilt * (1 - launchFrac * 0.75);
        const pitchT = launching ? pitchRail * railBlend + pitchFree * freeBlend : pitchFree;
        // Match free-flight pitch lag so we don't suddenly re-smooth on release
        s.pitchSm += (pitchT - s.pitchSm) * Math.min(1, (launching ? 10 : 6) * dt);
        pitch = s.pitchSm;

        // Mains: pinned hot on the rail, ease into cruise throttle curve.
        const thrFree = Math.min(
          1,
          0.18 +
            Math.min(1, s.speed / 0.6) * 0.6 +
            Math.min(0.3, Math.abs(s.turnRate) * 0.14) +
            // Climbing costs thrust; a dive is a coast, so the mains ease off
            THREE.MathUtils.clamp(climb * 0.3, -0.16, 0.3) +
            (s.rollT > 0 ? 0.2 : 0),
        );
        const thrT = launching ? 1 * railBlend + thrFree * freeBlend : thrFree;
        s.throttle += (thrT - s.throttle) * Math.min(1, (launching ? 10 : 6) * dt);

        // Wingtip RCS does the torquing: both fire through a roll, and the tip on
        // the outside of a yaw turn fires to push the nose around. The ports aim
        // down, so they also carry the pull-out at the bottom of a dive.
        const rollPart = Math.min(1, Math.abs(rollRate) * 0.2);
        const yawPart = Math.min(0.8, Math.abs(s.turnRate) * 0.45);
        const liftPart = Math.min(0.55, Math.max(0, climb) * 0.4);
        const rcsRail = 0.12 * railBlend;
        s.rcsL = Math.min(1, rcsRail + rollPart + liftPart + (s.turnRate > 0 ? yawPart : 0));
        s.rcsR = Math.min(1, rcsRail + rollPart + liftPart + (s.turnRate < 0 ? yawPart : 0));

        if (launching) {
          const sc =
            parkScale +
            (scaleBase - parkScale) *
              Math.min(1, launchFrac / Math.max(0.2, SCOUT_PAD.railEnd));
          sx = sy = sz = sc;
        }
      }

      const shell = host.acquireWire(host.unitPool, geo, edge, race, "unit");
      // Rail park slightly aft of pad center; fling slides +east, ox fades out
      // with freeBlend so release doesn't teleport the origin.
      const ox = launching
        ? (SCOUT_PAD.parkZ * SCOUT_PAD.buildScale +
            Math.min(1, launchFrac / Math.max(0.2, SCOUT_PAD.railEnd)) * 1.15) *
          railBlend
        : 0;
      // Aircraft roll about their own spine; ground kit rolls about its wheels.
      const pivotY = air ? (isScout ? SCOUT_PIVOT_Y : FLYER_PIVOT_Y) : 0;
      placeOnSurface(shell, s.x, s.y, elev, ox, 0, 0, sx, sy, sz, s.yaw, bank, pitch, pivotY);
      host.entityRoot.add(shell);

      if (air) attachPlumes(host, shell, isScout ? SCOUT_RIG : FLYER_RIG, s, race, snap.t, u.id);

      if (isOperatorsRover) {
        const turret = host.acquireWire(
          host.turretPool,
          host.unitGeos.workerOpsTurret,
          host.unitEdges.workerOpsTurret!,
          race,
          "turret",
        );
        // Parent to chassis so bank / pitch / hop / stretch never leave the gun behind
        if (turret.parent) turret.parent.remove(turret);
        shell.add(turret);
        let rel = s.turretYaw - s.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        // Model-space pivot (parent non-uniform scale applies)
        turret.position.set(
          ROVER_TURRET_PIVOT.x,
          ROVER_TURRET_PIVOT.y,
          ROVER_TURRET_PIVOT.z,
        );
        turret.rotation.set(0, rel, 0);
        // Counter-stretch so the gun stays rigid while the hull squash/stretches
        const invSx = sx !== 0 ? scaleBase / sx : 1;
        const invSy = sy !== 0 ? scaleBase / sy : 1;
        const invSz = sz !== 0 ? scaleBase / sz : 1;
        turret.scale.set(invSx, invSy, invSz);

        if (isMining || isBuilding) {
          shell.updateMatrixWorld(true);
          host._tip.set(0, 0, ROVER_TURRET_TIP.z);
          turret.localToWorld(host._tip);
          s.tipW = host._tip.clone();
        }
      }
    }

    if (host.unitSmooth.size > snap.units.length + 20) {
      const live = new Set(snap.units.map((uu) => uu.id));
      for (const id of host.unitSmooth.keys()) {
        if (!live.has(id)) host.unitSmooth.delete(id);
      }
      for (const id of host.unitFirstSeen.keys()) {
        if (!live.has(id)) host.unitFirstSeen.delete(id);
      }
    }
  }

