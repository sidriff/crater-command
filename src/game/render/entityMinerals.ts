import * as THREE from "three";
import { placeOnSurface } from "./planetMath";
import type { SimSnapshot } from "../sim/types";

export type MineralsHost = {
  isVisible: (x: number, y: number) => boolean;
  mineralMemory: Map<number, { x: number; y: number; yield: number; maxYield: number }>;
  crystalPool: THREE.Mesh[];
  crystalMat: THREE.MeshStandardMaterial;
  bGeos: {
    crystalSpikeTall: THREE.BufferGeometry;
    crystalSpike: THREE.BufferGeometry;
    crystalSpikeSm: THREE.BufferGeometry;
  };
  entityRoot: THREE.Group;
};

export function syncMinerals(host: MineralsHost, snap: SimSnapshot) {
    const live = new Map(snap.minerals.map((m) => [m.id, m]));
    const drawn = new Set<number>();

    // 1) Live crystals currently in vision — refresh memory + draw true state
    for (const m of snap.minerals) {
      if (m.yield <= 0) continue;
      if (!host.isVisible(m.x, m.y)) continue;
      host.mineralMemory.set(m.id, {
        x: m.x,
        y: m.y,
        yield: m.yield,
        maxYield: m.maxYield || m.yield,
      });
      drawCrystal(host, m.x, m.y, m.yield, m.maxYield || m.yield);
      drawn.add(m.id);
    }

    // 2) Memory ghosts: spotted before, now in FOW (or depleted off-screen)
    for (const [id, mem] of host.mineralMemory) {
      if (drawn.has(id)) continue;
      const cur = live.get(id);
      if (cur) {
        // Still exists but FOW — draw frozen last-seen stock, keep position
        if (host.isVisible(mem.x, mem.y)) {
          // Vision returned; should have been handled above — refresh anyway
          host.mineralMemory.set(id, {
            x: cur.x,
            y: cur.y,
            yield: cur.yield,
            maxYield: cur.maxYield || cur.yield,
          });
          drawCrystal(host, cur.x, cur.y, cur.yield, cur.maxYield || cur.yield);
        } else {
          drawCrystal(host, mem.x, mem.y, mem.yield, mem.maxYield);
        }
        drawn.add(id);
      } else {
        // Gone from sim: only forget once we can see the site again
        if (host.isVisible(mem.x, mem.y)) {
          host.mineralMemory.delete(id);
        } else {
          // Still fogged — leave last-known crystal silhouette
          drawCrystal(host, mem.x, mem.y, mem.yield, mem.maxYield);
        }
      }
    }
  }

export function drawCrystal(host: MineralsHost, x: number, y: number, yieldLeft: number, maxYield: number) {
    if (yieldLeft <= 0) return;
    const maxY = Math.max(20, maxYield || yieldLeft);
    const frac = Math.max(0.14, yieldLeft / maxY);
    // Stock → size (stout, not towering)
    const sizeT = (maxY - 20) / 80;
    const hScale = (0.42 + sizeT * 0.38) * (0.5 + 0.5 * frac);
    const rScale = (0.55 + sizeT * 0.4) * (0.55 + 0.45 * frac);
    const seed = x * 12.9898 + y * 78.233;
    // One solid shard per mineral node (fields are multiple nodes)
    // Plant base slightly into the rock so it never floats
    const geo =
      maxY >= 70
        ? host.bGeos.crystalSpikeTall
        : maxY >= 40
          ? host.bGeos.crystalSpike
          : host.bGeos.crystalSpikeSm;
    let mesh = host.crystalPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(geo, host.crystalMat);
      mesh.userData.pool = "crystal";
    }
    mesh.geometry = geo;
    mesh.material = host.crystalMat;
    mesh.userData.pool = "crystal";
    mesh.visible = true;
    // elev ~0 with geometry base at y=0; tiny negative embed + no lateral offset
    // (lateral offsets were floating crystals off the curved surface)
    placeOnSurface(
      mesh,
      x,
      y,
      0,
      0,
      0,
      0,
      rScale,
      hScale,
      rScale,
      seed,
    );
    host.entityRoot.add(mesh);
  }

