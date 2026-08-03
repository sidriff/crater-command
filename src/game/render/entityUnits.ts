import * as THREE from "three";
import { MAP_W, UNITS } from "../sim/defs";
import type { PlayerId, RaceId, SimSnapshot, UnitKind } from "../sim/types";
import { crtWinkIn } from "./entityCrt";
import {
  DUST_MAX,
  GROUND_FOOT_HX,
  GROUND_FOOT_HY,
  ROVER_FOOT_HX,
  ROVER_FOOT_HY,
  ROVER_SCALE,
  type DustPuff,
  type UnitSmooth,
  type WireEntity,
} from "./entityTypes";
import {
  ROVER_TURRET_PIVOT,
  ROVER_TURRET_TIP,
  UNIT_SMOOTH,
  footprintClearanceElev,
  mapToWorld,
  placeOnSurface,
  smoothToward,
} from "./planetMath";

export type UnitsHost = {
  viewer: PlayerId;
  entityRoot: THREE.Group;
  unitSmooth: Map<number, UnitSmooth>;
  unitFirstSeen: Map<number, number>;
  unitPool: THREE.Object3D[];
  turretPool: THREE.Object3D[];
  unitGeos: ReturnType<typeof import("./planetMath").makeUnitGeos>;
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

export function turnToward(s: UnitSmooth, targetYaw: number, rate: number, dt: number) {
    let dAng = targetYaw - s.yaw;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    s.yaw += dAng * Math.min(1, rate * dt);
    return dAng;
  }

export function roverTipWorld(host: UnitsHost, 
    x: number,
    y: number,
    elev: number,
    scale: number,
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

    const L = ROVER_TURRET_TIP.z * scale;
    const tipY = ROVER_TURRET_TIP.y * scale;
    const c = Math.cos(turretYaw);
    const sn = Math.sin(turretYaw);
    out
      .copy(host._p)
      .addScaledVector(host._n, elev + tipY)
      .addScaledVector(host._east, L * c)
      .addScaledVector(host._north, L * sn);
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

    for (const u of snap.units) {
      if (u.owner !== host.viewer && !host.isVisible(u.x, u.y)) continue;
      const race = host.raceOf(u.owner);
      const isOpsRover = u.kind === "worker" && race === "operators";
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
        s = {
          x: u.x,
          y: u.y,
          yaw: 0,
          moveYaw: 0,
          turretYaw: 0,
          speed: 0,
          turnRate: 0,
          hop: 0,
          hopVel: 0,
          prevSlope: 0,
          bank: 0,
          stretch: 1,
          dustAcc: 0,
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
        if (!host.unitFirstSeen.has(u.id)) host.unitFirstSeen.set(u.id, performance.now());
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

      const px = s.x;
      const py = s.y;
      if (isStationed) {
        s.x = u.x;
        s.y = u.y;
        s.speed = 0;
      } else {
        smoothToward(s, u.x, u.y, isOpsRover ? kRover : kSmooth);
      }
      let mdx = s.x - px;
      if (mdx > MAP_W * 0.5) mdx -= MAP_W;
      if (mdx < -MAP_W * 0.5) mdx += MAP_W;
      const mdy = s.y - py;
      const distStep = Math.hypot(mdx, mdy);
      const instSpeed = dt > 1e-6 ? distStep / dt : 0;
      s.speed += (instSpeed - s.speed) * Math.min(1, 10 * dt);

      let moveYaw = s.moveYaw;
      const moved = !isStationed && distStep > 1e-5;
      let drift = 0;
      if (moved) {
        moveYaw = Math.atan2(mdy, mdx);
        let dPath = moveYaw - s.moveYaw;
        while (dPath > Math.PI) dPath -= Math.PI * 2;
        while (dPath < -Math.PI) dPath += Math.PI * 2;
        s.turnRate += (dPath / Math.max(dt, 1e-4) - s.turnRate) * Math.min(1, 10 * dt);
        s.moveYaw = moveYaw;
        turnToward(s, moveYaw, isOpsRover ? 3.2 : 14, dt);
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
      const air = UNITS[u.kind].air;
      const scaleBase =
        u.kind === "tank" ? 1.15 : isOpsRover ? ROVER_SCALE : u.kind === "worker" ? 0.95 : 1.05;

      let elev = air ? 1.4 + Math.sin(snap.t * 3 + u.id) * 0.15 : 0.14;
      let bank = 0;
      let pitch = 0;
      let sx = scaleBase;
      let sy = scaleBase;
      let sz = scaleBase;

      if (!air) {
        const hx = isOpsRover ? ROVER_FOOT_HX : GROUND_FOOT_HX;
        const hy = isOpsRover ? ROVER_FOOT_HY : GROUND_FOOT_HY;
        const base = isOpsRover ? 0.18 : 0.14;
        const clear = footprintClearanceElev(s.x, s.y, hx, hy, base);
        elev = clear.elev;

        if (isOpsRover) {
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
      }

      const shell = host.acquireWire(host.unitPool, geo, edge, race, "unit");
      placeOnSurface(shell, s.x, s.y, elev, 0, 0, 0, sx, sy, sz, s.yaw, bank, pitch);
      host.entityRoot.add(shell);

      if (isOpsRover) {
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
        turret.position.set(0, ROVER_TURRET_PIVOT.y, 0);
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

