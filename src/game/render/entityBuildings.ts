import * as THREE from "three";
import type { BuildingKind, PlayerId, RaceId, SimSnapshot } from "../sim/types";
import { crtResolveOn, crtWinkIn, partPhase } from "./entityCrt";
import type { WireEntity } from "./entityTypes";
import { placeOnSurface, scaffoldFootprint } from "./planetMath";

export type BuildingsHost = {
  viewer: PlayerId;
  entityRoot: THREE.Group;
  buildFirstSeen: Map<number, number>;
  buildingPool: THREE.Object3D[];
  padPool: THREE.Mesh[];
  scaffoldPool: THREE.Object3D[];
  skyPool: THREE.Mesh[];
  bGeos: any;
  bEdges: Record<string, THREE.EdgesGeometry>;
  hullMat: THREE.MeshBasicMaterial;
  edgeMats: Record<string, THREE.LineBasicMaterial>;
  skyHard: Record<string, THREE.MeshBasicMaterial>;
  skySoft: Record<string, THREE.MeshBasicMaterial>;
  padMat: THREE.MeshBasicMaterial;
  raceOf: (owner: PlayerId) => RaceId;
  isVisible: (x: number, y: number) => boolean;
  coreGeoFor: (race: RaceId) => THREE.BufferGeometry;
  coreEdgeFor: (race: RaceId) => THREE.EdgesGeometry | THREE.BufferGeometry;
  buildingGeo: (kind: BuildingKind) => THREE.BufferGeometry;
  buildingEdge: (kind: BuildingKind) => THREE.EdgesGeometry | THREE.BufferGeometry;
  buildingKit: (kind: BuildingKind) => any;
  acquireWire: (
    pool: THREE.Object3D[],
    solidGeo: THREE.BufferGeometry,
    edgeGeo: THREE.EdgesGeometry | THREE.BufferGeometry,
    race: RaceId,
    poolTag: string,
    opts?: { hull?: boolean; wireBright?: boolean },
  ) => WireEntity;
};

export function syncBuildings(host: BuildingsHost, snap: SimSnapshot) {
    const tSec = snap.t;
    for (const b of snap.buildings) {
      const race = host.raceOf(b.owner);
      const prog = b.done ? 1 : Math.max(0, b.progress);
      const syCore = 2.05 * (b.done ? 1 : Math.max(0.15, prog));

      if (b.kind === "core") {
        const topLocal = race === "mandate" ? 4.35 : race === "blight" ? 4.75 : 3.65;
        const topElev = topLocal * syCore;
        const pulse = 0.94 + 0.06 * Math.sin(snap.t * 2.2 + b.id);
        const h = 26 * pulse;
        let hard = host.skyPool.pop();
        if (!hard) {
          hard = new THREE.Mesh(host.bGeos.coreBeam, host.skyHard[race]!);
          hard.userData.pool = "sky";
        }
        hard.geometry = host.bGeos.coreBeam;
        hard.material = host.skyHard[race]!;
        hard.userData.pool = "sky";
        hard.visible = true;
        placeOnSurface(hard, b.x, b.y, topElev + h * 0.5, 0, 0, 0, 0.55, h, 0.55, 0);
        host.entityRoot.add(hard);
        let soft = host.skyPool.pop();
        if (!soft) {
          soft = new THREE.Mesh(host.bGeos.coreBeamSoft, host.skySoft[race]!);
          soft.userData.pool = "sky";
        }
        soft.geometry = host.bGeos.coreBeamSoft;
        soft.material = host.skySoft[race]!;
        soft.userData.pool = "sky";
        soft.visible = true;
        placeOnSurface(soft, b.x, b.y, topElev + h * 0.5, 0, 0, 0, 0.85, h * 0.98, 0.85, 0);
        host.entityRoot.add(soft);
      }

      if (b.owner !== host.viewer && !host.isVisible(b.x, b.y)) continue;
      const geo = b.kind === "core" ? host.coreGeoFor(race) : host.buildingGeo(b.kind);
      const edge = b.kind === "core" ? host.coreEdgeFor(race) : host.buildingEdge(b.kind);
      const yaw = 0;
      const sx = b.kind === "core" ? 1.85 : 1.15;
      const sy = b.kind === "core" ? syCore : 1.15;

      // Empty scaffold / pad until a worker actually starts construction
      const constructionStarted = b.done || b.progress > 0.001;
      if (!host.buildFirstSeen.has(b.id)) host.buildFirstSeen.set(b.id, performance.now());
      const born = host.buildFirstSeen.get(b.id)!;
      const age = (performance.now() - born) / 1000;
      const scafVis = constructionStarted ? 1 : crtWinkIn(age);

      let buildElev = 0;
      if (race === "operators" && b.kind !== "core") {
        const half = 0.78;
        const scaf = scaffoldFootprint(b.x, b.y, half, yaw, 0.1, 0.45);
        const deckTop = scaf.deckElev + 0.12;
        buildElev = deckTop;
        if (scafVis >= 0.05) {
          const deck = host.acquireWire(
            host.scaffoldPool,
            host.bGeos.scaffoldDeck,
            host.bEdges.scaffoldDeck!,
            race,
            "scaffold",
          );
          placeOnSurface(deck, b.x, b.y, scaf.deckElev, 0, 0, 0, 1, 1, 1, yaw);
          deck.visible = scafVis > 0.5;
          if (deck.visible) host.entityRoot.add(deck);

          for (const corner of scaf.corners) {
            if (scafVis <= 0.5) break;
            const leg = host.acquireWire(
              host.scaffoldPool,
              host.bGeos.scaffoldLeg,
              host.bEdges.scaffoldLeg!,
              race,
              "scaffold",
            );
            placeOnSurface(
              leg,
              b.x,
              b.y,
              scaf.deckElev,
              corner.ox,
              0,
              corner.oz,
              1,
              corner.legLen,
              1,
              yaw,
            );
            host.entityRoot.add(leg);
          }
        }
      }

      // ── Construction: CRT part resolve (not scale-up) ─────────────────
      if (b.kind === "core") {
        const shell = host.acquireWire(host.buildingPool, geo, edge, race, "building");
        placeOnSurface(shell, b.x, b.y, buildElev, 0, 0, 0, sx, sy, sx, yaw);
        host.entityRoot.add(shell);
      } else if (constructionStarted) {
        const kit = host.buildingKit(b.kind);
        if (b.done || !kit) {
          // Finished (or no kit): solid locked mesh
          const shell = host.acquireWire(host.buildingPool, geo, edge, race, "building");
          placeOnSurface(shell, b.x, b.y, buildElev, 0, 0, 0, sx, sy, sx, yaw);
          host.entityRoot.add(shell);
        } else {
          const n = kit.parts.length;
          const seed = b.id * 0.17;
          for (let i = 0; i < n; i++) {
            const phase = partPhase(prog, i, n, tSec, seed);
            if (phase === 0) continue;
            const pGeo = kit.parts[i]!;
            const pEdge = kit.edges[i]!;
            // resolving = wire only; locked = hull + wire
            const shell = host.acquireWire(
              host.buildingPool,
              pGeo,
              pEdge,
              race,
              "building",
              { hull: phase === 2 },
            );
            placeOnSurface(shell, b.x, b.y, buildElev, 0, 0, 0, sx, sy, sx, yaw);
            host.entityRoot.add(shell);
          }
        }
      }

      // Non-Ops flat pad; Ops use scaffold instead
      if (b.kind !== "core" && race !== "operators") {
        let pad = host.padPool.pop();
        if (!pad) {
          pad = new THREE.Mesh(host.bGeos.pad, host.padMat);
          pad.userData.pool = "pad";
        }
        pad.geometry = host.bGeos.pad;
        pad.material = host.padMat;
        pad.userData.pool = "pad";
        pad.visible = scafVis > 0.5;
        if (pad.visible) {
          placeOnSurface(pad, b.x, b.y, 0.02, 0, 0, 0, 1.3, 1, 1.3, yaw);
          host.entityRoot.add(pad);
        }
      }
    }

    if (host.buildFirstSeen.size > snap.buildings.length + 8) {
      const live = new Set(snap.buildings.map((bb) => bb.id));
      for (const id of host.buildFirstSeen.keys()) {
        if (!live.has(id)) host.buildFirstSeen.delete(id);
      }
    }
  }

