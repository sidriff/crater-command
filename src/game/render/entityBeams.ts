import * as THREE from "three";
import { mineLaserPower } from "../sim/defs";
import type { BuildingKind, PlayerId, RaceId, SimSnapshot } from "../sim/types";
import type { UnitSmooth } from "./entityTypes";
import { mapToWorld } from "./planetMath";

export type BeamsHost = {
  viewer: PlayerId;
  unitSmooth: Map<number, UnitSmooth>;
  beamPool: THREE.Mesh[];
  beamMats: Record<string, THREE.MeshBasicMaterial>;
  projectileRoot: THREE.Group;
  raceOf: (owner: PlayerId) => RaceId;
  isVisible: (x: number, y: number) => boolean;
};

export function syncMineBeams(host: BeamsHost, snap: SimSnapshot) {
    for (const u of snap.units) {
      if (u.kind !== "worker" || u.carrying || u.mineMineralId == null) continue;
      if (u.mineProgress <= 0.001) continue;
      if (u.owner !== host.viewer && !host.isVisible(u.x, u.y)) continue;
      const m = snap.minerals.find((mm) => mm.id === u.mineMineralId);
      if (!m) continue;
      const power = mineLaserPower(u.mineProgress);
      if (power < 0.02) continue;

      const s = host.unitSmooth.get(u.id);
      const race = host.raceOf(u.owner);
      if (race === "operators" && s?.tipW) {
        const b = new THREE.Vector3();
        mapToWorld(m.x, m.y, b);
        b.addScaledVector(b.clone().normalize(), 0.55);
        drawMineLaserWorld(host, s.tipW, b, power);
      } else {
        drawMineLaserMap(host, u.x, u.y, m.x, m.y, 0.55, 0.55, power);
      }
    }
  }

export function syncCombatProjectiles(host: BeamsHost, snap: SimSnapshot) {
    // fromAir ≤0.5 ground; 1 ≈ flyer; >1 lifts toward scout cruise (~2.5)
    const elev = (air: number) =>
      air > 0.5 ? 1.5 + Math.max(0, air - 1) * 2.0 : 0.4;
    for (const p of snap.projectiles) {
      if (p.style === "mine" || p.targetIsMineral) continue;
      if (!host.isVisible(p.x, p.y) && !host.isVisible(p.tx, p.ty) && !host.isVisible(p.ox, p.oy))
        continue;
      const race = host.raceOf(p.owner);
      let mat = host.beamMats[race]!;
      if (p.style === "shell") mat = host.beamMats.shell!;
      else if (p.style === "laser") mat = host.beamMats.laser!;

      let mesh = host.beamPool.pop();
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true), mat);
      }
      // Light path lasers (scout) read thinner / dimmer than flyer AA beams
      const lightLaser = p.style === "laser" && p.damage > 0 && p.damage <= 7;
      mat.opacity = lightLaser ? 0.72 : 0.9;
      mesh.material = mat;
      mesh.visible = true;

      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      mapToWorld(p.ox, p.oy, a);
      mapToWorld(p.x, p.y, b);
      a.addScaledVector(a.clone().normalize(), elev(p.fromAir));
      b.addScaledVector(b.clone().normalize(), elev(p.toAir));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = Math.max(0.15, dir.length());
      mesh.position.copy(mid);
      const rScale = p.style === "shell" ? 1.4 : lightLaser ? 0.48 : p.style === "laser" ? 0.8 : 1;
      mesh.scale.set(rScale, len, rScale);
      if (dir.lengthSq() > 1e-10) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      host.projectileRoot.add(mesh);
    }
  }

export function drawMineLaserMap(host: BeamsHost, 
    ax: number,
    ay: number,
    bx: number,
    by: number,
    fromAir: number,
    toAir: number,
    power: number,
  ) {
    const elev = (air: number) => (air > 0.5 ? 1.5 : 0.4);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    mapToWorld(ax, ay, a);
    mapToWorld(bx, by, b);
    a.addScaledVector(a.clone().normalize(), elev(fromAir));
    b.addScaledVector(b.clone().normalize(), elev(toAir));
    drawMineLaserWorld(host, a, b, power);
  }

export function drawMineLaserWorld(host: BeamsHost, a: THREE.Vector3, b: THREE.Vector3, power: number) {
    const draw = (material: THREE.MeshBasicMaterial, radiusMul: number, opac: number) => {
      let mesh = host.beamPool.pop();
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true),
          material,
        );
      }
      material.opacity = opac;
      mesh.material = material;
      mesh.visible = true;
      mesh.renderOrder = 5;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = Math.max(0.2, dir.length());
      mesh.position.copy(mid);
      // ~50% thinner than prior (was 0.6+1.2*power with mul 1.35/0.55)
      const sc = Math.max(0.28, radiusMul * (0.3 + 0.6 * power));
      mesh.scale.set(sc, len, sc);
      if (dir.lengthSq() > 1e-10) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      host.projectileRoot.add(mesh);
    };
    draw(host.beamMats.mine!, 0.7, 0.4 + 0.5 * power);
    draw(host.beamMats.mineCore!, 0.28, 0.75 + 0.25 * power);
  }

  /**
   * Construction zaps: thin short bursts to random structure points.
   * Pattern: zap,zap[,zap] → pause → repeat (erratic).
   */
export function syncBuildZaps(host: BeamsHost, snap: SimSnapshot, dt: number) {
    for (const u of snap.units) {
      if (u.kind !== "worker" || u.buildTargetId == null) continue;
      if (u.owner !== host.viewer && !host.isVisible(u.x, u.y)) continue;
      const b = snap.buildings.find((bb) => bb.id === u.buildTargetId);
      if (!b || b.done) continue;
      const d = Math.hypot(u.x - b.x, u.y - b.y);
      if (d > 0.65) continue;

      const s = host.unitSmooth.get(u.id);
      if (!s) continue;

      // Advance erratic state machine
      const z = s.zap;
      z.timer -= dt;
      if (z.timer <= 0) {
        if (z.mode === "on") {
          z.burstLeft -= 1;
          if (z.burstLeft > 0) {
            // Same aim through the burst — only re-aim after a pause
            z.mode = "gap";
            z.timer = 0.03 + Math.random() * 0.05;
          } else {
            z.mode = "pause";
            z.timer = 0.18 + Math.random() * 0.28;
          }
        } else if (z.mode === "gap") {
          z.mode = "on";
          z.timer = 0.035 + Math.random() * 0.04;
        } else {
          // pause → new burst; pick a fresh point on the structure once
          z.mode = "on";
          z.burstLeft = 2 + ((Math.random() * 2) | 0); // 2 or 3
          z.timer = 0.04 + Math.random() * 0.045;
          retargetBuildZap(z, b);
        }
      }

      if (z.mode !== "on") continue;

      const tip = s.tipW;
      const target = new THREE.Vector3();
      mapToWorld(z.aimX, z.aimY, target);
      target.addScaledVector(target.clone().normalize(), z.aimElev);

      if (tip) {
        drawBuildZapWorld(host, tip, target);
      } else {
        const origin = new THREE.Vector3();
        mapToWorld(u.x, u.y, origin);
        origin.addScaledVector(origin.clone().normalize(), 0.55);
        drawBuildZapWorld(host, origin, target);
      }
    }
  }

export function retargetBuildZap(
  z: UnitSmooth["zap"],
  b: { x: number; y: number; kind: BuildingKind },
) {
    // Keep hits on the structure: tight radial band + kind-scaled height
    // Map footprint is ~0.4–0.55 units for most placeables (world scale ~1.15)
    const half =
      b.kind === "factory" || b.kind === "airpad" || b.kind === "barracks"
        ? 0.38
        : b.kind === "dome" || b.kind === "depot"
          ? 0.34
          : b.kind === "aa"
            ? 0.28
            : 0.3;
    // Disk sample (not ring) so points land on the body, not outside
    const r = half * Math.sqrt(Math.random()) * 0.85;
    const a = Math.random() * Math.PI * 2;
    z.aimX = b.x + Math.cos(a) * r;
    z.aimY = b.y + Math.sin(a) * r;
    const hMax =
      b.kind === "aa" || b.kind === "factory"
        ? 0.95
        : b.kind === "dome"
          ? 0.85
          : b.kind === "turret"
            ? 0.9
            : 0.75;
    z.aimElev = 0.22 + Math.random() * hMax;
  }

export function drawBuildZapWorld(host: BeamsHost, a: THREE.Vector3, b: THREE.Vector3) {
    const draw = (material: THREE.MeshBasicMaterial, radiusMul: number, opac: number) => {
      let mesh = host.beamPool.pop();
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true),
          material,
        );
      }
      material.opacity = opac;
      mesh.material = material;
      mesh.visible = true;
      mesh.renderOrder = 6;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = Math.max(0.12, dir.length());
      mesh.position.copy(mid);
      // Very thin short construction beams
      const sc = radiusMul;
      mesh.scale.set(sc, len, sc);
      if (dir.lengthSq() > 1e-10) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      host.projectileRoot.add(mesh);
    };
    draw(host.beamMats.build!, 0.22, 0.85);
    draw(host.beamMats.buildCore!, 0.1, 0.95);
  }

