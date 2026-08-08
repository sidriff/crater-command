import * as THREE from "three";
import { MAP_H, MAP_W, RACES } from "../sim/defs";
import type { BuildingKind, PlayerId, RaceId, SimSnapshot, UnitKind } from "../sim/types";
import { syncBuildZaps, syncCombatProjectiles, syncMineBeams } from "./entityBeams";
import { syncBuildings } from "./entityBuildings";
import { syncMinerals } from "./entityMinerals";
import {
  DUST_MAX,
  type DustPuff,
  type UnitSmooth,
  type WireEntity,
} from "./entityTypes";
import { recycleOpNode, syncOps } from "./entityOps";
import { makePlumeGeo, type PlumeMesh } from "./entityPlumes";
import { syncUnits, updateDust } from "./entityUnits";
import { syncDeaths, type UnitDeathPose } from "./entityDeaths";
import {
  disposeScars,
  makeScarFillGeo,
  makeScarRingGeo,
  updateScars,
  type Scar,
} from "./entityScars";
import { makeBuildingGeos } from "./buildingGeos";
import { makeUnitGeos } from "./unitGeos";
import { PlanetFloaterLayer } from "./planetFloaters";

/** Minerals, buildings, units, projectiles, dust, mine lasers. */
export class PlanetEntityLayer {
  viewer: PlayerId;
  private snap: SimSnapshot | null = null;
  entityRoot: THREE.Group;
  projectileRoot: THREE.Group;
  dustRoot = new THREE.Group();
  /** Death theater + wire shards — not recycled with live entities each frame. */
  deathRoot = new THREE.Group();
  shardRoot = new THREE.Group();
  scarRoot = new THREE.Group();
  private scene: THREE.Scene;

  unitGeos = makeUnitGeos();
  bGeos = makeBuildingGeos();
  unitEdges: Record<string, THREE.EdgesGeometry>;
  bEdges: Record<string, THREE.EdgesGeometry>;
  hullMat: THREE.MeshBasicMaterial;
  edgeMats: Record<string, THREE.LineBasicMaterial> = {};
  beamMats: Record<string, THREE.MeshBasicMaterial> = {};
  skyHard: Record<string, THREE.MeshBasicMaterial> = {};
  skySoft: Record<string, THREE.MeshBasicMaterial> = {};
  crystalMat: THREE.MeshStandardMaterial;
  padMat: THREE.MeshBasicMaterial;
  dustMat: THREE.MeshBasicMaterial;
  dustGeo: THREE.BufferGeometry;
  plumeMat: THREE.MeshBasicMaterial;
  plumeGeo: THREE.BufferGeometry;

  unitPool: THREE.Object3D[] = [];
  turretPool: THREE.Object3D[] = [];
  buildingPool: THREE.Object3D[] = [];
  padPool: THREE.Mesh[] = [];
  scaffoldPool: THREE.Object3D[] = [];
  beamPool: THREE.Mesh[] = [];
  skyPool: THREE.Mesh[] = [];
  crystalPool: THREE.Mesh[] = [];
  dustPool: DustPuff[] = [];
  plumePool: THREE.Object3D[] = [];
  dustActive = 0;
  unitSmooth = new Map<number, UnitSmooth>();
  buildFirstSeen = new Map<number, number>();
  unitFirstSeen = new Map<number, number>();
  mineralMemory = new Map<number, { x: number; y: number; yield: number; maxYield: number }>();
  /** Last rendered pose per unit id — consumed by death theater when id vanishes. */
  deathPoses = new Map<number, UnitDeathPose>();
  /** Last rendered pose per building id — planted death theater. */
  buildingDeathPoses = new Map<number, import("./entityDeaths").BuildingDeathPose>();
  deathPool: THREE.Object3D[] = [];
  deathActors: import("./entityDeaths").DeathHost["deathActors"] = [];
  buildingDeathActors: import("./entityDeaths").DeathHost["buildingDeathActors"] = [];
  shardPool: import("./entityDeaths").DeathHost["shardPool"] = [];
  shardActive = 0;
  scarPool: Scar[] = [];
  scarActive = 0;
  scarRingGeo = makeScarRingGeo();
  scarFillGeo = makeScarFillGeo();
  scarMatTemplates: Record<
    string,
    { ring: THREE.LineBasicMaterial; fill: THREE.MeshBasicMaterial }
  > = {};
  private floaters: PlanetFloaterLayer;

  _tip = new THREE.Vector3();
  _east = new THREE.Vector3();
  _north = new THREE.Vector3();
  _n = new THREE.Vector3();
  _p = new THREE.Vector3();

  constructor(scene: THREE.Scene, entityRoot: THREE.Group, projectileRoot: THREE.Group, viewer: PlayerId) {
    this.scene = scene;
    this.entityRoot = entityRoot;
    this.projectileRoot = projectileRoot;
    this.viewer = viewer;
    this.scene.add(this.dustRoot);
    this.scene.add(this.deathRoot);
    this.scene.add(this.shardRoot);
    this.scene.add(this.scarRoot);
    this.floaters = new PlanetFloaterLayer(scene);

    this.hullMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    for (const r of Object.values(RACES)) {
      this.edgeMats[r.id] = new THREE.LineBasicMaterial({
        color: r.tint,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
      });
      this.beamMats[r.id] = new THREE.MeshBasicMaterial({
        color: r.tint,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      });
      this.skyHard[r.id] = new THREE.MeshBasicMaterial({
        color: r.tint,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.skySoft[r.id] = new THREE.MeshBasicMaterial({
        color: r.tint,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    }
    this.beamMats.shell = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.beamMats.laser = new THREE.MeshBasicMaterial({
      color: 0x66ffcc,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    });
    this.beamMats.mine = new THREE.MeshBasicMaterial({
      color: 0x22e0ff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.beamMats.mineCore = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // Construction zaps — thin, hot, short
    this.beamMats.build = new THREE.MeshBasicMaterial({
      color: 0x88ffee,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.beamMats.buildCore = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: 0x66eeff,
      emissive: 0x2288aa,
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.4,
      flatShading: true,
    });
    this.padMat = new THREE.MeshBasicMaterial({
      color: 0x0a1014,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    // scaffold hull uses shared black hullMat + race edge mats via acquireWire
    this.dustMat = new THREE.MeshBasicMaterial({
      color: 0xc4b896,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.dustGeo = new THREE.BufferGeometry();
    {
      const verts = new Float32Array([0, 0.01, 0, 0.07, 0, 0.025, -0.045, 0, 0.055]);
      this.dustGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      this.dustGeo.computeVertexNormals();
    }

    // Thruster plumes — additive, no depth write, tinted per race on acquire
    this.plumeGeo = makePlumeGeo();
    this.plumeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const unitEdge = (g: THREE.BufferGeometry) => new THREE.EdgesGeometry(g, 22);
    this.unitEdges = {
      worker: unitEdge(this.unitGeos.worker),
      workerOps: unitEdge(this.unitGeos.workerOps),
      workerOpsTurret: unitEdge(this.unitGeos.workerOpsTurret),
      raider: unitEdge(this.unitGeos.raider),
      tank: unitEdge(this.unitGeos.tank),
      flyer: unitEdge(this.unitGeos.flyer),
      interceptor: unitEdge(this.unitGeos.interceptor),
      bomber: unitEdge(this.unitGeos.bomber),
      scout: unitEdge(this.unitGeos.scout),
    };
    const bEdge = (g: THREE.BufferGeometry) => new THREE.EdgesGeometry(g, 18);
    this.bEdges = {
      coreStation: bEdge(this.bGeos.coreStation),
      coreHive: bEdge(this.bGeos.coreHive),
      coreRocket: bEdge(this.bGeos.coreRocket),
      extractor: bEdge(this.bGeos.extractor),
      depot: bEdge(this.bGeos.depot),
      refinery: bEdge(this.bGeos.refinery),
      dome: bEdge(this.bGeos.dome),
      command: bEdge(this.bGeos.command),
      barracks: bEdge(this.bGeos.barracks),
      turret: bEdge(this.bGeos.turret),
      aa: bEdge(this.bGeos.aa),
      factory: bEdge(this.bGeos.factory),
      airpad: bEdge(this.bGeos.airpad),
      scoutPad: bEdge(this.bGeos.scoutPad),
      scaffoldDeck: bEdge(this.bGeos.scaffoldDeck),
      scaffoldLeg: bEdge(this.bGeos.scaffoldLeg),
    };
  }

  setViewer(v: PlayerId) {
    this.viewer = v;
  }

  setSnapshot(snap: SimSnapshot) {
    this.snap = snap;
  }

  /** Ghost placement tint helper. */
  ghostTint(): number | string {
    if (!this.snap) return 0x2dff8c;
    return RACES[this.snap.players[this.viewer]!.race].tint;
  }

  sync(dt: number) {
    const snap = this.snap;
    if (!snap) return;
    this.recycleAll();
    syncMinerals(this, snap);
    syncBuildings(this, snap);
    syncUnits(this, snap, dt);
    // Pose handoff recorded during syncUnits; theater owns the corpse after
    syncDeaths(this, snap, dt);
    updateScars(this, dt);
    updateDust(this, dt);
    syncMineBeams(this, snap);
    syncBuildZaps(this, snap, dt);
    syncCombatProjectiles(this, snap);
    syncOps(this, snap, snap.t);
    this.floaters.sync(snap, this.viewer, (x, y) => this.isVisible(x, y));
  }

  raceOf(owner: PlayerId): RaceId {
    return this.snap?.players[owner]?.race ?? "operators";
  }

  isVisible(x: number, y: number): boolean {
    if (!this.snap) return true;
    const vis = this.snap.players[this.viewer]?.vision;
    if (!vis) return true;
    const cx = Math.max(0, Math.min(MAP_W - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(MAP_H - 1, Math.floor(y)));
    return vis[cy * MAP_W + cx] === 1;
  }

  coreGeoFor(race: RaceId) {
    if (race === "blight") return this.bGeos.coreHive;
    if (race === "mandate") return this.bGeos.coreRocket;
    return this.bGeos.coreStation;
  }

  coreEdgeFor(race: RaceId) {
    if (race === "blight") return this.bEdges.coreHive!;
    if (race === "mandate") return this.bEdges.coreRocket!;
    return this.bEdges.coreStation!;
  }

  buildingGeo(kind: BuildingKind) {
    if (kind === "extractor") return this.bGeos.extractor;
    if (kind === "depot") return this.bGeos.depot;
    if (kind === "refinery") return this.bGeos.refinery;
    if (kind === "dome") return this.bGeos.dome;
    if (kind === "command") return this.bGeos.command;
    if (kind === "barracks") return this.bGeos.barracks;
    if (kind === "turret") return this.bGeos.turret;
    if (kind === "aa") return this.bGeos.aa;
    if (kind === "factory") return this.bGeos.factory;
    if (kind === "airpad") return this.bGeos.airpad;
    if (kind === "scout") return this.bGeos.scoutPad;
    // Tech-tree aliases (reuse existing meshes until unique geos land)
    if (kind === "logistics") return this.bGeos.factory;
    if (kind === "em_array") return this.bGeos.aa;
    if (kind === "strike_dock") return this.bGeos.airpad;
    if (kind === "null_lattice") return this.bGeos.dome;
    if (kind === "bomber_works") return this.bGeos.airpad;
    if (kind === "capacitor") return this.bGeos.depot;
    if (kind === "artillery") return this.bGeos.turret;
    return this.bGeos.extractor;
  }

  buildingEdge(kind: BuildingKind) {
    if (kind === "extractor") return this.bEdges.extractor!;
    if (kind === "depot") return this.bEdges.depot!;
    if (kind === "refinery") return this.bEdges.refinery!;
    if (kind === "dome") return this.bEdges.dome!;
    if (kind === "command") return this.bEdges.command!;
    if (kind === "barracks") return this.bEdges.barracks!;
    if (kind === "turret") return this.bEdges.turret!;
    if (kind === "aa") return this.bEdges.aa!;
    if (kind === "factory") return this.bEdges.factory!;
    if (kind === "airpad") return this.bEdges.airpad!;
    if (kind === "scout") return this.bEdges.scoutPad!;
    if (kind === "logistics") return this.bEdges.factory!;
    if (kind === "em_array") return this.bEdges.aa!;
    if (kind === "strike_dock") return this.bEdges.airpad!;
    if (kind === "null_lattice") return this.bEdges.dome!;
    if (kind === "bomber_works") return this.bEdges.airpad!;
    if (kind === "capacitor") return this.bEdges.depot!;
    if (kind === "artillery") return this.bEdges.turret!;
    return this.bEdges.extractor!;
  }


  unitGeo(kind: UnitKind, race: RaceId = "operators") {
    if (kind === "worker" && race === "operators") return this.unitGeos.workerOps;
    return this.unitGeos[kind] ?? this.unitGeos.worker;
  }

  unitEdge(kind: UnitKind, race: RaceId = "operators") {
    if (kind === "worker" && race === "operators") return this.unitEdges.workerOps!;
    return this.unitEdges[kind] ?? this.unitEdges.worker!;
  }

  acquireWire(
    pool: THREE.Object3D[],
    solidGeo: THREE.BufferGeometry,
    edgeGeo: THREE.EdgesGeometry | THREE.BufferGeometry,
    race: RaceId,
    poolTag: string,
    opts?: { hull?: boolean; wireBright?: boolean },
  ): WireEntity {
    const useHull = opts?.hull !== false;
    let g = pool.pop() as WireEntity | undefined;
    if (!g || !g.userData?.wireEntity) {
      const hull = new THREE.Mesh(solidGeo, this.hullMat);
      hull.scale.setScalar(0.96);
      const wire = new THREE.LineSegments(edgeGeo, this.edgeMats[race]!);
      g = new THREE.Group() as WireEntity;
      g.add(hull);
      g.add(wire);
      g.userData = { pool: poolTag, wireEntity: true, hull, wire };
    } else {
      const hull = g.userData.hull;
      const wire = g.userData.wire;
      hull.geometry = solidGeo;
      hull.material = this.hullMat;
      hull.scale.setScalar(0.96);
      wire.geometry = edgeGeo;
      wire.material = this.edgeMats[race]!;
      g.userData.pool = poolTag;
    }
    g.userData.hull.visible = useHull;
    g.userData.hull.scale.setScalar(useHull ? 0.96 : 0.001);
    // resolving parts: full wire; locked: normal
    g.visible = true;
    return g;
  }

  acquirePlume(race: RaceId): PlumeMesh {
    let m = this.plumePool.pop() as PlumeMesh | undefined;
    if (!m) {
      const mesh = new THREE.Mesh(this.plumeGeo, this.plumeMat.clone());
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      mesh.userData = { pool: "plume" };
      m = mesh as unknown as PlumeMesh;
    }
    (m.material as THREE.MeshBasicMaterial).color.set(RACES[race].tint);
    m.visible = true;
    return m;
  }

  buildingKit(kind: BuildingKind) {
    const kits = this.bGeos.kits;
    if (!kits) return null;
    return kits[kind] ?? kits[kind === "scout" ? "scoutPad" : kind] ?? null;
  }

  recycleAll() {
    while (this.entityRoot.children.length) {
      const c = this.entityRoot.children.pop()!;
      // Rover turrets and thruster plumes ride under the shell — detach first
      for (let i = c.children.length - 1; i >= 0; i--) {
        const ch = c.children[i]!;
        const chTag = ch.userData?.pool;
        if (chTag !== "turret" && chTag !== "plume") continue;
        c.remove(ch);
        ch.visible = false;
        ch.position.set(0, 0, 0);
        ch.rotation.set(0, 0, 0);
        ch.scale.set(1, 1, 1);
        if (chTag === "plume") this.plumePool.push(ch);
        else this.turretPool.push(ch);
      }
      c.visible = false;
      const tag = c.userData?.pool as string | undefined;
      if (tag === "crystal") this.crystalPool.push(c as THREE.Mesh);
      else if (tag === "building") this.buildingPool.push(c);
      else if (tag === "pad") this.padPool.push(c as THREE.Mesh);
      else if (tag === "scaffold") this.scaffoldPool.push(c);
      else if (tag === "sky") this.skyPool.push(c as THREE.Mesh);
      else if (tag === "turret") this.turretPool.push(c);
      else if (tag === "death") this.deathPool.push(c);
      else if (tag === "op-radio" || tag === "op-link") {
        if (!recycleOpNode(c)) c.removeFromParent?.();
      }
      else this.unitPool.push(c);
    }
    while (this.projectileRoot.children.length) {
      const c = this.projectileRoot.children.pop()! as THREE.Mesh;
      c.visible = false;
      this.beamPool.push(c);
    }
  }

  dispose() {
    this.hullMat.dispose();
    Object.values(this.edgeMats).forEach((m) => m.dispose());
    Object.values(this.beamMats).forEach((m) => m.dispose());
    Object.values(this.skyHard).forEach((m) => m.dispose());
    Object.values(this.skySoft).forEach((m) => m.dispose());
    this.crystalMat.dispose();
    this.padMat.dispose();
    this.dustMat.dispose();
    this.dustGeo.dispose();
    this.plumeMat.dispose();
    this.plumeGeo.dispose();
    for (const p of this.dustPool) {
      (p.mesh.material as THREE.Material).dispose();
    }
    for (const p of this.plumePool) {
      const m = (p as THREE.Mesh).material as THREE.Material | undefined;
      m?.dispose();
    }
    Object.values(this.unitGeos).forEach((g) => g.dispose());
    Object.values(this.unitEdges).forEach((g) => g.dispose());
    Object.values(this.bEdges).forEach((g) => g.dispose());
    Object.values(this.bGeos).forEach((g) => {
      if (g && typeof (g as THREE.BufferGeometry).dispose === "function")
        (g as THREE.BufferGeometry).dispose();
    });
    this.scene.remove(this.dustRoot);
    this.scene.remove(this.deathRoot);
    this.scene.remove(this.shardRoot);
    this.scene.remove(this.scarRoot);
    disposeScars(this);
    for (const s of this.shardPool) {
      (s.line.material as THREE.Material).dispose();
      s.line.geometry.dispose();
    }
    this.shardPool.length = 0;
    this.floaters.dispose();
  }
}
