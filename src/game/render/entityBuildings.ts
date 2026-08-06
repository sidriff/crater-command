import * as THREE from "three";
import { BUILDINGS, START_WORKERS, unitCapCost, unitProducedBy } from "../sim/defs";
import type { BuildingKind, PlayerId, RaceId, SimSnapshot, UnitKind } from "../sim/types";
import { PRODUCT_PARK, SCOUT_PAD } from "./buildingGeos";
import { crtResolveOn, crtWinkIn, partPhase } from "./entityCrt";
import type { UnitSmooth, WireEntity } from "./entityTypes";
import { placeOnSurface, scaffoldFootprint } from "./planetMath";
import { ROVER_TURRET_PIVOT, SCOUT_VENTRAL_Y } from "./unitGeos";

export type BuildingsHost = {
  viewer: PlayerId;
  entityRoot: THREE.Group;
  buildFirstSeen: Map<number, number>;
  buildingPool: THREE.Object3D[];
  padPool: THREE.Mesh[];
  scaffoldPool: THREE.Object3D[];
  skyPool: THREE.Mesh[];
  unitPool: THREE.Object3D[];
  turretPool: THREE.Object3D[];
  unitSmooth: Map<number, UnitSmooth>;
  bGeos: any;
  bEdges: Record<string, THREE.EdgesGeometry>;
  unitGeos: ReturnType<typeof import("./unitGeos").makeUnitGeos>;
  unitEdges: Record<string, THREE.EdgesGeometry>;
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

function freeCapSnap(snap: SimSnapshot, owner: PlayerId): number {
  const p = snap.players[owner];
  if (!p) return 0;
  let used = 0;
  for (const u of snap.units) {
    if (u.owner === owner) used += unitCapCost(u.kind);
  }
  return Math.max(0, p.capMax - used);
}

/** Seat count for a unit kind — mirrors production.ts seatsFor. */
function seatsForSnap(snap: SimSnapshot, owner: PlayerId, unitKind: UnitKind): number {
  const race = snap.players[owner]?.race ?? "operators";
  let seats = unitKind === "worker" ? START_WORKERS : 0;
  for (const b of snap.buildings) {
    if (b.owner !== owner || !b.done || b.kind === "core") continue;
    if (unitProducedBy(b.kind, race) !== unitKind) continue;
    const d = BUILDINGS[b.kind];
    seats += d.produceSeats ?? 1;
  }
  return seats;
}

/**
 * True while a live scout is still on / leaving this pad — covers the first
 * frame before unitSmooth.launchT is set (buildings sync runs before units).
 */
function scoutOccupyingPad(snap: SimSnapshot, b: { id: number; owner: PlayerId; x: number; y: number }, host: BuildingsHost): boolean {
  for (const s of host.unitSmooth.values()) {
    if (s.padId === b.id && s.launchT > 0) return true;
  }
  for (const u of snap.units) {
    if (u.kind !== "scout" || u.owner !== b.owner) continue;
    let dx = u.x - b.x;
    if (dx > 24) dx -= 48; // MAP_W=48 wrap; fine at this scale
    if (dx < -24) dx += 48;
    const dy = u.y - b.y;
    if (dx * dx + dy * dy < 0.35 * 0.35) return true;
  }
  return false;
}

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

      // Non-Operators flat pad; Operators use scaffold instead
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

      // Scout Works: product is the CRT drone on the rail. Once the pad is done,
      // keep a staged drone whenever a seat is free but launch is blocked (supply
      // cap) — empty rail only while a live scout is flinging off or already out.
      if (b.kind === "scout" && b.done && (b.owner === host.viewer || host.isVisible(b.x, b.y))) {
        if (!scoutOccupyingPad(snap, b, host)) {
          const needCap = unitCapCost("scout");
          const free = freeCapSnap(snap, b.owner);
          const have = snap.units.filter((u) => u.owner === b.owner && u.kind === "scout").length;
          const seats = seatsForSnap(snap, b.owner, "scout");
          const canSeat = have < seats;
          // produceTime is 0 — no factory queue. Parked = can't go (cap), or the
          // brief seat-retry tick before the next fling.
          const staged = canSeat && (free < needCap || b.produceTimer <= 0.25);
          if (staged) {
            const bScale = SCOUT_PAD.buildScale;
            const uScale = SCOUT_PAD.parkScale * bScale;
            // Ventral sits on the rails: elev accounts for unit geo origin.
            const elev =
              buildElev + SCOUT_PAD.parkY * bScale - SCOUT_VENTRAL_Y * uScale;
            const pitch = -SCOUT_PAD.railTilt;
            const shell = host.acquireWire(
              host.unitPool,
              host.unitGeo("scout", race),
              host.unitEdge("scout", race),
              race,
              "unit",
            );
            // parkZ is model-forward; yaw 0 → east = ox (not oz/north)
            placeOnSurface(
              shell,
              b.x,
              b.y,
              elev,
              SCOUT_PAD.parkZ * bScale,
              0,
              0,
              uScale,
              uScale,
              uScale,
              yaw,
              0,
              pitch,
            );
            host.entityRoot.add(shell);
          }
        }
      }

      // Every other Operators producer stages its product the same way the
      // Scout Works does — the difference is these have a real production
      // clock, so the unit CRT-resolves on the apron as it's built and is gone
      // the frame it drives off. A blocked producer (cap or seat) parks its
      // timer just short of done, which leaves a finished machine sitting
      // there: exactly the read you want for "built, but it can't go yet".
      const park = PRODUCT_PARK[b.kind];
      if (
        park &&
        b.done &&
        race === "operators" &&
        (b.owner === host.viewer || host.isVisible(b.x, b.y))
      ) {
        const total = BUILDINGS[b.kind].produceTime ?? 6;
        const prog =
          total > 0 ? Math.max(0, Math.min(1, 1 - b.produceTimer / total)) : 1;
        // One "part": hidden → phosphor-flickering wire → locked hull + wire.
        const phase = partPhase(prog, 0, 1, tSec, b.id * 0.17 + 0.5);
        if (phase !== 0) {
          const bScale = sx;
          const uScale = park.scale * bScale;
          const isRover = park.unit === "worker";
          const shell = host.acquireWire(
            host.unitPool,
            host.unitGeo(park.unit, race),
            host.unitEdge(park.unit, race),
            race,
            "unit",
            { hull: phase === 2 },
          );
          // Park offsets are building model space: +Z is model-forward, which
          // at yaw 0 runs east (ox); model +X runs north (oz).
          placeOnSurface(
            shell,
            b.x,
            b.y,
            buildElev + park.y * bScale,
            park.z * bScale,
            0,
            park.x * bScale,
            uScale,
            uScale,
            uScale,
            park.yaw,
          );
          host.entityRoot.add(shell);

          // Rover's gun is a separate mesh at runtime — without it the parked
          // one reads as a different, decapitated vehicle.
          if (isRover) {
            const turret = host.acquireWire(
              host.turretPool,
              host.unitGeos.workerOpsTurret,
              host.unitEdges.workerOpsTurret!,
              race,
              "turret",
              { hull: phase === 2 },
            );
            if (turret.parent) turret.parent.remove(turret);
            shell.add(turret);
            turret.position.set(
              ROVER_TURRET_PIVOT.x,
              ROVER_TURRET_PIVOT.y,
              ROVER_TURRET_PIVOT.z,
            );
            // Idle stow: aperture aft, aimed back down the guide rails
            turret.rotation.set(0, Math.PI, 0);
            turret.scale.set(1, 1, 1);
          }
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

