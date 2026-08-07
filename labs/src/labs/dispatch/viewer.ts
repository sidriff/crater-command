/**
 * CRT stage for Dispatch lab — building shell + live product, orbit camera.
 * Same chrome family as Mesh lab (black hull + phosphor wire), not PlanetView.
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
import type { DispatchDef } from "./catalog";
import { dispatchPlayable } from "./catalog";
import {
  DEFAULT_TUNING,
  evalDispatchLaunch,
  evalScoutLaunch,
  type LaunchPose,
  type LaunchTuning,
} from "./launch";

function unitPivotY(product: DispatchDef["product"]): number {
  if (product === "scout") return SCOUT_PIVOT_Y;
  if (product === "interceptor") return INTERCEPTOR_PIVOT_Y;
  if (product === "bomber") return BOMBER_PIVOT_Y;
  return 0;
}

function plumeRigFor(product: DispatchDef["product"]): PlumeRig | null {
  if (product === "scout") return SCOUT_RIG;
  if (product === "interceptor") return INTERCEPTOR_RIG;
  if (product === "bomber") return BOMBER_RIG;
  return null;
}

const BG = 0x02040a;
const GROUND = 0x0a2218;

export type DispatchViewerOpts = {
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

export class DispatchViewer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private stageRoot = new THREE.Group();
  private buildingRoot = new THREE.Group();
  private unitRoot = new THREE.Group();
  /** Product mesh group (hull/wire/turret) — plumes parent here. */
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
  private def: DispatchDef | null = null;
  private tuning: LaunchTuning = { ...DEFAULT_TUNING };
  private lastPose: LaunchPose | null = null;

  constructor(opts: DispatchViewerOpts) {
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
    this.stageRoot.add(this.buildingRoot);
    this.stageRoot.add(this.unitRoot);
    this.root.add(this.stageRoot);
    this.scene.add(this.root);

    const amb = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(amb);

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

    // +Z rail / forward tick
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
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * n * 0.0012), 2, 40);
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
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") o.visible = on;
    });
  }

  setShowWire(on: boolean) {
    this.showWire = on;
    this.stageRoot.traverse((o) => {
      if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
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

  setElev(rad: number) {
    this.el = THREE.MathUtils.clamp(rad, 0.05, 1.45);
    this.applyCamera();
  }

  setDist(d: number) {
    this.dist = THREE.MathUtils.clamp(d, 2, 40);
    this.applyCamera();
  }

  setTuning(t: Partial<LaunchTuning>) {
    this.tuning = { ...this.tuning, ...t };
  }

  getTuning(): LaunchTuning {
    return this.tuning;
  }

  getLastPose(): LaunchPose | null {
    return this.lastPose;
  }

  private clearGroup(g: THREE.Group) {
    while (g.children.length) {
      const c = g.children[0]!;
      g.remove(c);
    }
  }

  private addSolid(
    parent: THREE.Object3D,
    solid: THREE.BufferGeometry,
    crease: number,
    scale = 1,
  ) {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    const hull = new THREE.Mesh(solid, this.hullMat);
    hull.userData.kind = "hull";
    hull.visible = this.showHull;
    group.add(hull);
    const edges = new THREE.EdgesGeometry(solid, crease);
    this.ownedEdges.push(edges);
    const wire = new THREE.LineSegments(edges, this.wireMat);
    wire.userData.kind = "wire";
    wire.visible = this.showWire;
    group.add(wire);
    parent.add(group);
    return { group, hull, wire };
  }

  /** Swap producer + product for a catalog card. */
  setDispatch(def: DispatchDef) {
    this.def = def;
    this.clearGroup(this.buildingRoot);
    this.clearGroup(this.unitRoot);
    for (const e of this.ownedEdges) e.dispose();
    this.ownedEdges = [];
    this.unitHull = null;
    this.unitWire = null;
    this.unitMesh = null;
    this.turretGroup = null;
    for (const p of this.plumes) {
      (p.material as THREE.Material).dispose();
    }
    this.plumes = [];

    const b = this.packs.buildings;
    const bScale = SCOUT_PAD.buildScale;

    // Empty producer shell (match draws product live)
    let buildingGeo: THREE.BufferGeometry = b.scoutPad;
    if (def.building === "depot") buildingGeo = b.depot;
    else if (def.building === "barracks") buildingGeo = b.barracks;
    else if (def.building === "airpad" || def.building === "bomber_works") {
      buildingGeo = b.airpad; // bomber works share airpad solid for now
    } else buildingGeo = b.scoutPad;

    this.addSolid(this.buildingRoot, buildingGeo, 18, bScale);

    // Product mesh (animated when ready)
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
      tg.position.set(ROVER_TURRET_PIVOT.x, ROVER_TURRET_PIVOT.y, ROVER_TURRET_PIVOT.z);
      const th = new THREE.Mesh(this.packs.workerTurret, this.hullMat);
      th.userData.kind = "hull";
      th.visible = this.showHull;
      tg.add(th);
      const tw = new THREE.LineSegments(this.packs.workerTurretEdge, this.wireMat);
      tw.userData.kind = "wire";
      tw.visible = this.showWire;
      tg.add(tw);
      uGroup.add(tg);
      this.turretGroup = tg;
    }

    this.unitRoot.add(uGroup);

    // Pre-warm plumes for air products (parented under unit mesh for attitude)
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

    this.lookY = 0.85;
    this.lookZ = 0.35;
    this.dist = dispatchPlayable(def) ? 9 : 7;
    this.applyCamera();
    this.applyTime(0);
  }

  /** Seek absolute time since launch start (seconds). */
  applyTime(tSec: number): LaunchPose {
    const def = this.def;
    let pose: LaunchPose;
    if (!def) {
      pose = evalScoutLaunch(0, this.tuning);
    } else if (dispatchPlayable(def)) {
      pose = evalDispatchLaunch(def.id, tSec, this.tuning);
    } else {
      pose = evalDispatchLaunch(def.id, 0, this.tuning);
    }
    this.lastPose = pose;
    this.applyPose(pose);
    return pose;
  }

  private applyPose(pose: LaunchPose) {
    // unitRoot carries world pose; unitMesh offset so pitch pivots at match belly.
    const pivotLocal = this.def ? unitPivotY(this.def.product) : 0;
    const pivotY = pivotLocal * pose.scale;

    this.unitRoot.position.set(pose.x, pose.y + pivotY, pose.z);
    this.unitRoot.rotation.order = "YXZ";
    this.unitRoot.rotation.y = pose.yaw;
    this.unitRoot.rotation.x = -pose.pitch; // three.js +rx tips nose down for +Z nose
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
    if (!rig || !this.showPlumes) {
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
    this.clearGroup(this.buildingRoot);
    this.clearGroup(this.unitRoot);
    for (const e of this.ownedEdges) e.dispose();
    this.ownedEdges = [];
    // Dispose pack geos
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
    // building geos — leave to GC of many; dispose main ones we hold refs to is hard
    this.hullMat.dispose();
    this.wireMat.dispose();
    this.groundMat.dispose();
    this.gridMat.dispose();
    this.plumeMat.dispose();
    for (const pl of this.plumes) {
      (pl.material as THREE.Material).dispose();
    }
    this.ground.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      if ((o as THREE.LineSegments).isLineSegments) {
        (o as THREE.LineSegments).geometry.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
