/**
 * CRT stage for Construction lab — scaffold + kit assemble, or producer egress.
 * Same chrome family as Mesh lab (black hull + phosphor wire).
 */
import * as THREE from "three";
import { makeBuildingGeos, SCOUT_PAD } from "@game/render/buildingGeos";
import {
  BOMBER_RIG,
  INTERCEPTOR_RIG,
  makePlumeGeo,
  SCOUT_RIG,
  type PlumeRig,
} from "@game/render/entityPlumes";
import {
  BOMBER_PIVOT_Y,
  INTERCEPTOR_PIVOT_Y,
  makeBomberGeo,
  makeInterceptorGeo,
  makeRaiderGeo,
  makeScoutGeo,
  makeWorkerOpsGeo,
  makeWorkerOpsTurretGeo,
  ROVER_TURRET_PIVOT,
  SCOUT_PIVOT_Y,
} from "@game/render/unitGeos";
import type { BuildingKind, UnitKind } from "@game/sim/types";
import type { CardMode, ConstructionCard } from "./catalog";
import { cardPlayable, launchKeyFor } from "./catalog";
import {
  DEFAULT_CONSTRUCT,
  evalConstruct,
  type ConstructFrame,
  type ConstructTuning,
} from "./construct";
import {
  DEFAULT_TUNING,
  evalDispatchLaunch,
  evalScoutLaunch,
  type LaunchPose,
  type LaunchTuning,
} from "./launch";

const BG = 0x02040a;
const GROUND = 0x0a2218;
const B_SCALE = SCOUT_PAD.buildScale;
/** Deck top elevation on flat stage (scaffold deck thickness 0.12). */
const DECK_TOP = 0.12;
const SCAFFOLD_HALF = 0.78;

function unitPivotY(product: UnitKind | undefined): number {
  if (product === "scout") return SCOUT_PIVOT_Y;
  if (product === "interceptor") return INTERCEPTOR_PIVOT_Y;
  if (product === "bomber") return BOMBER_PIVOT_Y;
  return 0;
}

function plumeRigFor(product: UnitKind | undefined): PlumeRig | null {
  if (product === "scout") return SCOUT_RIG;
  if (product === "interceptor") return INTERCEPTOR_RIG;
  if (product === "bomber") return BOMBER_RIG;
  return null;
}

/** Match planetEntities.buildingGeo aliases. */
function solidForBuilding(
  b: ReturnType<typeof makeBuildingGeos>,
  kind: BuildingKind,
): THREE.BufferGeometry {
  if (kind === "extractor") return b.extractor;
  if (kind === "depot") return b.depot;
  if (kind === "refinery") return b.refinery;
  if (kind === "dome") return b.dome;
  if (kind === "command") return b.command;
  if (kind === "barracks") return b.barracks;
  if (kind === "turret") return b.turret;
  if (kind === "aa") return b.aa;
  if (kind === "factory") return b.factory;
  if (kind === "airpad") return b.airpad;
  if (kind === "scout") return b.scoutPad;
  if (kind === "logistics") return b.factory;
  if (kind === "em_array") return b.aa;
  if (kind === "strike_dock") return b.airpad;
  if (kind === "null_lattice") return b.dome;
  if (kind === "bomber_works") return b.airpad;
  if (kind === "capacitor") return b.depot;
  if (kind === "artillery") return b.turret;
  return b.extractor;
}

function kitKeyFor(def: ConstructionCard): string | null {
  if (!def.kitKey) return null;
  if (def.kitKey === "scout") return "scout";
  return def.kitKey;
}

export type ConstructionViewerOpts = {
  container: HTMLElement;
};

type StagePack = {
  buildings: ReturnType<typeof makeBuildingGeos>;
  scout: THREE.BufferGeometry;
  scoutEdge: THREE.BufferGeometry;
  worker: THREE.BufferGeometry;
  workerEdge: THREE.BufferGeometry;
  workerTurret: THREE.BufferGeometry;
  workerTurretEdge: THREE.BufferGeometry;
  raider: THREE.BufferGeometry;
  raiderEdge: THREE.BufferGeometry;
  interceptor: THREE.BufferGeometry;
  interceptorEdge: THREE.BufferGeometry;
  bomber: THREE.BufferGeometry;
  bomberEdge: THREE.BufferGeometry;
  plume: THREE.BufferGeometry;
};

type KitPartMeshes = {
  group: THREE.Group;
  hull: THREE.Mesh;
  wire: THREE.LineSegments;
};

function edgeOf(g: THREE.BufferGeometry, crease: number) {
  return new THREE.EdgesGeometry(g, crease);
}

function makePacks(): StagePack {
  const buildings = makeBuildingGeos();
  const scout = makeScoutGeo();
  const worker = makeWorkerOpsGeo();
  const workerTurret = makeWorkerOpsTurretGeo();
  const raider = makeRaiderGeo();
  const interceptor = makeInterceptorGeo();
  const bomber = makeBomberGeo();
  return {
    buildings,
    scout,
    scoutEdge: edgeOf(scout, 22),
    worker,
    workerEdge: edgeOf(worker, 22),
    workerTurret,
    workerTurretEdge: edgeOf(workerTurret, 22),
    raider,
    raiderEdge: edgeOf(raider, 22),
    interceptor,
    interceptorEdge: edgeOf(interceptor, 22),
    bomber,
    bomberEdge: edgeOf(bomber, 22),
    plume: makePlumeGeo(),
  };
}

export class ConstructionViewer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private stageRoot = new THREE.Group();
  private scaffoldRoot = new THREE.Group();
  private buildingRoot = new THREE.Group();
  private unitRoot = new THREE.Group();
  private unitMesh: THREE.Group | null = null;
  private ground: THREE.Group;
  private hullMat: THREE.MeshBasicMaterial;
  private wireMat: THREE.LineBasicMaterial;
  private groundMat: THREE.MeshBasicMaterial;
  private gridMat: THREE.LineBasicMaterial;
  private plumeMat: THREE.MeshBasicMaterial;

  private packs: StagePack;
  private ownedEdges: THREE.BufferGeometry[] = [];
  private unitHull: THREE.Mesh | null = null;
  private unitWire: THREE.LineSegments | null = null;
  private turretGroup: THREE.Group | null = null;
  private plumes: THREE.Mesh[] = [];

  /** Per-kit-part mesh pairs for construct mode. */
  private kitParts: KitPartMeshes[] = [];
  private solidGroup: THREE.Group | null = null;
  private solidHull: THREE.Mesh | null = null;
  private solidWire: THREE.LineSegments | null = null;

  private az = 0.85;
  private el = 0.42;
  private dist = 8;
  private lookY = 0.9;
  private lookZ = 0.4;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private ro: ResizeObserver | null = null;
  private unbind: (() => void) | null = null;
  private disposed = false;

  private showHull = true;
  private showWire = true;
  private showPlumes = true;
  private showScaffold = true;
  private def: ConstructionCard | null = null;
  private mode: CardMode = "construct";
  private launchTuning: LaunchTuning = { ...DEFAULT_TUNING };
  private constructTuning: ConstructTuning = { ...DEFAULT_CONSTRUCT };
  private lastPose: LaunchPose | null = null;
  private lastConstruct: ConstructFrame | null = null;

  constructor(opts: ConstructionViewerOpts) {
    this.container = opts.container;
    this.scene.background = new THREE.Color(BG);
    this.packs = makePacks();

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(BG, 1);
    this.container.appendChild(this.renderer.domElement);

    this.hullMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.wireMat = new THREE.LineBasicMaterial({
      color: 0x2dff8c,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.groundMat = new THREE.MeshBasicMaterial({
      color: GROUND,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.gridMat = new THREE.LineBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      toneMapped: false,
    });
    this.plumeMat = new THREE.MeshBasicMaterial({
      color: 0x66ffcc,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.ground = this.makeGround();
    this.root.add(this.ground);
    this.stageRoot.add(this.scaffoldRoot);
    this.stageRoot.add(this.buildingRoot);
    this.stageRoot.add(this.unitRoot);
    this.root.add(this.stageRoot);
    this.scene.add(this.root);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    this.bindInput();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.container);
    this.onResize();
    this.applyCamera();
  }

  private makeGround(): THREE.Group {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 48), this.groundMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.001;
    g.add(disc);

    const grid = new THREE.GridHelper(10, 20, 0x00ffaa, 0x0d3a28);
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const m of mats) {
      const lm = m as THREE.LineBasicMaterial;
      lm.transparent = true;
      lm.opacity = 0.28;
      lm.depthWrite = false;
      lm.toneMapped = false;
    }
    g.add(grid);

    const axis = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0, 0.02, 2.2),
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(1.4, 0.02, 0),
    ]);
    g.add(new THREE.LineSegments(axis, this.gridMat));
    return g;
  }

  private bindInput() {
    const el = this.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.az -= dx * 0.007;
      this.el = THREE.MathUtils.clamp(this.el + dy * 0.007, 0.05, 1.45);
      this.applyCamera();
    };
    const onUp = (e: PointerEvent) => {
      this.dragging = false;
      try {
        el.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const n = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 80 : 1;
      this.dist = THREE.MathUtils.clamp(
        this.dist * Math.exp(e.deltaY * n * 0.0012),
        2,
        40,
      );
      this.applyCamera();
    };
    const onCtx = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onCtx);
    this.unbind = () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onCtx);
    };
  }

  private onResize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private applyCamera() {
    const x = Math.cos(this.el) * Math.sin(this.az) * this.dist;
    const y = Math.sin(this.el) * this.dist;
    const z = Math.cos(this.el) * Math.cos(this.az) * this.dist;
    this.camera.position.set(x, y + this.lookY * 0.15, z + this.lookZ * 0.2);
    this.camera.lookAt(0, this.lookY, this.lookZ);
  }

  setTint(hex: string) {
    this.wireMat.color.set(hex);
    this.gridMat.color.set(hex);
    this.plumeMat.color.set(hex);
  }

  setShowHull(on: boolean) {
    this.showHull = on;
    this.stageRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") {
        // Kit parts manage own hull visibility via phase
        if (o.userData.kitPart) return;
        o.visible = on;
      }
    });
  }

  setShowWire(on: boolean) {
    this.showWire = on;
    this.stageRoot.traverse((o) => {
      if (
        (o as THREE.LineSegments).isLineSegments &&
        o.userData.kind === "wire"
      ) {
        if (o.userData.kitPart) return;
        o.visible = on;
      }
    });
  }

  setShowGround(on: boolean) {
    this.ground.visible = on;
  }

  setShowPlumes(on: boolean) {
    this.showPlumes = on;
    for (const p of this.plumes) {
      if (!on) p.visible = false;
    }
  }

  setShowScaffold(on: boolean) {
    this.showScaffold = on;
    this.scaffoldRoot.visible = on;
  }

  setElev(rad: number) {
    this.el = THREE.MathUtils.clamp(rad, 0.05, 1.45);
    this.applyCamera();
  }

  setDist(d: number) {
    this.dist = THREE.MathUtils.clamp(d, 2, 40);
    this.applyCamera();
  }

  /**
   * Frame stage contents for catalog thumbs — three-quarter pose, bbox dist.
   */
  fitFraming() {
    const box = new THREE.Box3().setFromObject(this.stageRoot);
    if (box.isEmpty()) {
      this.lookY = 0.7;
      this.lookZ = 0.15;
      this.dist = 7;
      this.az = 0.75;
      this.el = 0.42;
      this.applyCamera();
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.lookY = center.y;
    this.lookZ = center.z;
    const maxDim = Math.max(size.x, size.y, size.z, 0.4);
    this.dist = THREE.MathUtils.clamp(maxDim * 2.35, 2.2, 28);
    this.az = 0.75;
    this.el = 0.42;
    this.applyCamera();
  }

  /** One-shot square PNG (preserveDrawingBuffer is on). */
  snapshotDataUrl(px = 144): string {
    const w = Math.max(32, Math.round(px));
    const prevAspect = this.camera.aspect;
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, w, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.onResize();
    return url;
  }

  setLaunchTuning(t: Partial<LaunchTuning>) {
    this.launchTuning = { ...this.launchTuning, ...t };
  }

  setConstructTuning(t: Partial<ConstructTuning>) {
    this.constructTuning = { ...this.constructTuning, ...t };
  }

  getLastPose(): LaunchPose | null {
    return this.lastPose;
  }

  getLastConstruct(): ConstructFrame | null {
    return this.lastConstruct;
  }

  getMode(): CardMode {
    return this.mode;
  }

  private clearGroup(g: THREE.Group) {
    while (g.children.length) {
      const c = g.children[0]!;
      g.remove(c);
    }
  }

  private disposeOwnedEdges() {
    for (const e of this.ownedEdges) e.dispose();
    this.ownedEdges = [];
  }

  private addHullWire(
    parent: THREE.Object3D,
    solid: THREE.BufferGeometry,
    crease: number,
    scale = 1,
    opts?: { kitPart?: boolean; useKitEdges?: THREE.BufferGeometry },
  ): KitPartMeshes {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    const hull = new THREE.Mesh(solid, this.hullMat);
    hull.userData.kind = "hull";
    hull.userData.kitPart = !!opts?.kitPart;
    hull.visible = this.showHull;
    group.add(hull);
    let edges: THREE.BufferGeometry;
    if (opts?.useKitEdges) {
      edges = opts.useKitEdges;
    } else {
      edges = new THREE.EdgesGeometry(solid, crease);
      this.ownedEdges.push(edges);
    }
    const wire = new THREE.LineSegments(edges, this.wireMat);
    wire.userData.kind = "wire";
    wire.userData.kitPart = !!opts?.kitPart;
    wire.visible = this.showWire;
    group.add(wire);
    parent.add(group);
    return { group, hull, wire };
  }

  private buildScaffold() {
    this.clearGroup(this.scaffoldRoot);
    const b = this.packs.buildings;
    // Deck sits with top at DECK_TOP (geo top is 0.12)
    const deck = this.addHullWire(this.scaffoldRoot, b.scaffoldDeck, 18, 1);
    deck.group.position.y = 0;
    // Four corner legs under the deck
    const inset = SCAFFOLD_HALF * 0.92;
    const legLen = 0.45;
    for (const [ox, oz] of [
      [-inset, -inset],
      [inset, -inset],
      [-inset, inset],
      [inset, inset],
    ] as const) {
      const leg = this.addHullWire(this.scaffoldRoot, b.scaffoldLeg, 18, 1);
      leg.group.position.set(ox, 0, oz);
      leg.group.scale.set(1, legLen, 1);
    }
  }

  /** Load a catalog card. Mode is fixed by section (buildings=construct, units=dispatch). */
  setCard(def: ConstructionCard, mode?: CardMode) {
    this.def = def;
    this.mode = mode ?? def.mode;
    this.clearGroup(this.scaffoldRoot);
    this.clearGroup(this.buildingRoot);
    this.clearGroup(this.unitRoot);
    this.disposeOwnedEdges();
    this.kitParts = [];
    this.solidGroup = null;
    this.solidHull = null;
    this.solidWire = null;
    this.unitHull = null;
    this.unitWire = null;
    this.unitMesh = null;
    this.turretGroup = null;
    for (const p of this.plumes) {
      (p.material as THREE.Material).dispose();
    }
    this.plumes = [];
    this.lastPose = null;
    this.lastConstruct = null;

    const b = this.packs.buildings;
    const solid = solidForBuilding(b, def.building);

    if (this.mode === "construct") {
      this.buildScaffold();
      this.scaffoldRoot.visible = this.showScaffold;

      const key = kitKeyFor(def);
      const kit = key ? b.kits?.[key] ?? b.kits?.[key === "scout" ? "scoutPad" : key] : null;

      if (kit?.parts?.length) {
        for (let i = 0; i < kit.parts.length; i++) {
          const pGeo = kit.parts[i]!;
          const pEdge = kit.edges[i];
          const part = this.addHullWire(this.buildingRoot, pGeo, 18, B_SCALE, {
            kitPart: true,
            useKitEdges: pEdge,
          });
          part.group.position.y = DECK_TOP;
          part.hull.visible = false;
          part.wire.visible = false;
          this.kitParts.push(part);
        }
      } else {
        // Solid-only path (no kit)
        const s = this.addHullWire(this.buildingRoot, solid, 18, B_SCALE, {
          kitPart: true,
        });
        s.group.position.y = DECK_TOP;
        s.hull.visible = false;
        s.wire.visible = false;
        this.solidGroup = s.group;
        this.solidHull = s.hull;
        this.solidWire = s.wire;
      }

      this.unitRoot.visible = false;
      this.lookY = 0.7;
      this.lookZ = 0.1;
      this.dist = 8;
    } else {
      // Dispatch: finished building + product
      this.scaffoldRoot.visible = false;
      const shell = this.addHullWire(this.buildingRoot, solid, 18, B_SCALE);
      shell.group.position.y = DECK_TOP;

      if (def.product) {
        let unitGeo: THREE.BufferGeometry = this.packs.scout;
        let unitEdge: THREE.BufferGeometry = this.packs.scoutEdge;
        if (def.product === "worker") {
          unitGeo = this.packs.worker;
          unitEdge = this.packs.workerEdge;
        } else if (def.product === "raider") {
          unitGeo = this.packs.raider;
          unitEdge = this.packs.raiderEdge;
        } else if (def.product === "interceptor") {
          unitGeo = this.packs.interceptor;
          unitEdge = this.packs.interceptorEdge;
        } else if (def.product === "bomber") {
          unitGeo = this.packs.bomber;
          unitEdge = this.packs.bomberEdge;
        }

        const uGroup = new THREE.Group();
        uGroup.userData.kind = "unitMesh";
        const hull = new THREE.Mesh(unitGeo, this.hullMat);
        hull.userData.kind = "hull";
        hull.visible = this.showHull;
        uGroup.add(hull);
        const wire = new THREE.LineSegments(unitEdge, this.wireMat);
        wire.userData.kind = "wire";
        wire.visible = this.showWire;
        uGroup.add(wire);
        this.unitHull = hull;
        this.unitWire = wire;
        this.unitMesh = uGroup;

        if (def.product === "worker") {
          const tg = new THREE.Group();
          tg.position.set(
            ROVER_TURRET_PIVOT.x,
            ROVER_TURRET_PIVOT.y,
            ROVER_TURRET_PIVOT.z,
          );
          const th = new THREE.Mesh(this.packs.workerTurret, this.hullMat);
          th.userData.kind = "hull";
          th.visible = this.showHull;
          tg.add(th);
          const tw = new THREE.LineSegments(
            this.packs.workerTurretEdge,
            this.wireMat,
          );
          tw.userData.kind = "wire";
          tw.visible = this.showWire;
          tg.add(tw);
          uGroup.add(tg);
          this.turretGroup = tg;
        }

        this.unitRoot.add(uGroup);

        const rig = plumeRigFor(def.product);
        if (rig) {
          const n = rig.bells.length + rig.rcs.length;
          for (let i = 0; i < n; i++) {
            const m = new THREE.Mesh(this.packs.plume, this.plumeMat.clone());
            m.visible = false;
            uGroup.add(m);
            this.plumes.push(m);
          }
        }
      }

      this.unitRoot.visible = true;
      this.lookY = 0.85;
      this.lookZ = 0.35;
      this.dist = cardPlayable(def) ? 9 : 7;
    }

    this.applyCamera();
    this.applyTime(0);
  }

  /** Seek absolute time since work/launch start (seconds). Negative = hold-before. */
  applyTime(tSec: number): { pose?: LaunchPose; construct?: ConstructFrame } {
    if (!this.def) {
      const pose = evalScoutLaunch(0, this.launchTuning);
      this.lastPose = pose;
      return { pose };
    }

    if (this.mode === "construct") {
      const frame = evalConstruct(
        tSec,
        this.constructTuning,
        this.kitParts.length,
      );
      this.lastConstruct = frame;
      this.lastPose = null;
      this.applyConstructFrame(frame);
      return { construct: frame };
    }

    // Dispatch / unit egress
    const launchId = launchKeyFor(this.def);
    const pose = cardPlayable(this.def)
      ? evalDispatchLaunch(launchId, tSec, this.launchTuning)
      : evalDispatchLaunch(launchId, 0, this.launchTuning);
    this.lastPose = pose;
    this.lastConstruct = null;
    this.applyPose(pose);
    return { pose };
  }

  private applyConstructFrame(frame: ConstructFrame) {
    this.scaffoldRoot.visible = this.showScaffold && frame.scaffoldVis > 0.5;
    // Soft opacity on scaffold during wink
    this.scaffoldRoot.traverse((o) => {
      if ((o as THREE.LineSegments).isLineSegments) {
        const m = (o as THREE.LineSegments).material as THREE.LineBasicMaterial;
        if (m && m !== this.wireMat) return;
      }
    });
    // Use wireMat opacity globally — keep scaffold fully on when visible
    if (this.kitParts.length) {
      for (let i = 0; i < this.kitParts.length; i++) {
        const part = this.kitParts[i]!;
        const phase = frame.parts[i]?.phase ?? 0;
        if (phase === 0) {
          part.group.visible = false;
        } else if (phase === 1) {
          part.group.visible = true;
          part.hull.visible = false;
          part.wire.visible = this.showWire;
        } else {
          part.group.visible = true;
          part.hull.visible = this.showHull;
          part.wire.visible = this.showWire;
        }
      }
      if (this.solidGroup) this.solidGroup.visible = false;
    } else if (this.solidHull && this.solidWire && this.solidGroup) {
      const phase = frame.solidPhase;
      if (phase === 0) {
        this.solidGroup.visible = false;
      } else if (phase === 1) {
        this.solidGroup.visible = true;
        this.solidHull.visible = false;
        this.solidWire.visible = this.showWire;
      } else {
        this.solidGroup.visible = true;
        this.solidHull.visible = this.showHull;
        this.solidWire.visible = this.showWire;
      }
    }
  }

  private applyPose(pose: LaunchPose) {
    const pivotLocal = unitPivotY(this.def?.product);
    const pivotY = pivotLocal * pose.scale;

    this.unitRoot.position.set(pose.x, pose.y + pivotY + DECK_TOP, pose.z);
    this.unitRoot.rotation.order = "YXZ";
    this.unitRoot.rotation.y = pose.yaw;
    this.unitRoot.rotation.x = -pose.pitch;
    this.unitRoot.rotation.z = pose.bank;
    this.unitRoot.scale.setScalar(pose.scale);

    if (this.unitMesh) {
      this.unitMesh.position.set(0, pivotLocal ? -pivotLocal : 0, 0);
    }

    this.updatePlumes(pose);
  }

  private updatePlumes(pose: LaunchPose) {
    const product = this.def?.product;
    const rig = product ? plumeRigFor(product) : null;
    if (!rig || !this.showPlumes || this.mode !== "dispatch") {
      for (const p of this.plumes) p.visible = false;
      return;
    }
    let i = 0;
    const flicker = 0.9 + Math.sin(performance.now() * 0.04) * 0.08;
    const mainLen = (rig.bellLen + pose.throttle * rig.bellGain) * flicker;
    for (const b of rig.bells) {
      const p = this.plumes[i++];
      if (!p) break;
      p.visible = pose.throttle > 0.08;
      p.position.set(b.x, b.y, b.z);
      p.rotation.set(0, 0, 0);
      p.scale.set(rig.bellW, rig.bellW, mainLen);
      (p.material as THREE.MeshBasicMaterial).opacity = 0.12 + pose.throttle * 0.3;
    }
    const rcsLevels = [pose.rcsR, pose.rcsL];
    for (let r = 0; r < rig.rcs.length; r++) {
      const level = rcsLevels[r] ?? 0;
      const p = this.plumes[i++];
      if (!p) break;
      if (level < 0.06) {
        p.visible = false;
        continue;
      }
      const port = rig.rcs[r]!;
      p.visible = true;
      p.position.set(port.x, port.y, port.z);
      p.rotation.set(-Math.PI / 2, 0, 0);
      const len = (rig.rcsLen + level * rig.rcsGain) * flicker;
      p.scale.set(rig.rcsW, rig.rcsW, len);
      (p.material as THREE.MeshBasicMaterial).opacity = 0.16 + level * 0.34;
    }
    while (i < this.plumes.length) {
      this.plumes[i++]!.visible = false;
    }
  }

  tick(_dt: number) {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.unbind?.();
    this.unbind = null;
    this.ro?.disconnect();
    this.ro = null;
    this.clearGroup(this.scaffoldRoot);
    this.clearGroup(this.buildingRoot);
    this.clearGroup(this.unitRoot);
    this.disposeOwnedEdges();
    for (const p of this.plumes) {
      (p.material as THREE.Material).dispose();
    }
    this.plumes = [];
    const p = this.packs;
    for (const g of [
      p.scout,
      p.scoutEdge,
      p.worker,
      p.workerEdge,
      p.workerTurret,
      p.workerTurretEdge,
      p.raider,
      p.raiderEdge,
      p.interceptor,
      p.interceptorEdge,
      p.bomber,
      p.bomberEdge,
      p.plume,
    ]) {
      g.dispose();
    }
    // Building geos owned by packs — dispose top-level solids (kits share)
    const b = p.buildings;
    for (const g of [
      b.pad,
      b.padLg,
      b.scaffoldDeck,
      b.scaffoldLeg,
      b.extractor,
      b.depot,
      b.refinery,
      b.dome,
      b.barracks,
      b.turret,
      b.aa,
      b.factory,
      b.airpad,
      b.scoutPad,
      b.command,
    ]) {
      g.dispose();
    }
    for (const kit of Object.values(b.kits ?? {})) {
      for (const g of kit.parts) g.dispose();
      for (const g of kit.edges) g.dispose();
    }
    this.hullMat.dispose();
    this.wireMat.dispose();
    this.groundMat.dispose();
    this.gridMat.dispose();
    this.plumeMat.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

/** @deprecated */
export { ConstructionViewer as DispatchViewer };
