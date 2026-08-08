/**
 * Isolated CRT mesh stage — black hull + phosphor wire, orbit camera.
 * Not PlanetView: no globe, FOW, or sim. Pure silhouette iteration.
 *
 * Death theater (combat read, not reverse-construction):
 *   wound — micro-explosions on the still-solid hull
 *   chip  — 1–2 construction pieces peel off and tumble
 *   boom  — remaining structure detonates (solid fling → wire shatter + scar)
 * Air units get a light vacuum tumble during wound; ground stays planted.
 */
import * as THREE from "three";
import { ROVER_TURRET_PIVOT } from "@game/render/unitGeos";
import type { MeshDef, MeshPacks } from "./catalog";

const BG = 0x02040a;
const GROUND = 0x0a2218;

export type MeshViewerOpts = {
  container: HTMLElement;
};

export type DeathPreviewOpts = {
  /** Vacuum tumble during wound (air units). */
  air?: boolean;
  /** light | medium | heavy timing + shard density. */
  tier?: "light" | "medium" | "heavy";
  /** Replay after hold. */
  loop?: boolean;
  /** Playback speed (1 = match-ish). */
  speed?: number;
};

type DeathPhase = "wound" | "boom" | "detonate" | "hold";

type DeathShard = {
  line: THREE.LineSegments;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  age: number;
  life: number;
};

/** Solid construction piece in flight (hull + wire still together). */
type FlyingPart = {
  root: THREE.Object3D;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
};

/** Short phosphor pop at a surface point. */
type MicroBurst = {
  root: THREE.Group;
  age: number;
  life: number;
};

type DeathState = {
  phase: DeathPhase;
  age: number;
  woundDur: number;
  boomDur: number;
  holdDur: number;
  air: boolean;
  loop: boolean;
  speed: number;
  tier: "light" | "medium" | "heavy";
  seed: number;
  /** Spin rates — air only; ground is always zero. */
  spinYaw: number;
  spinPitch: number;
  spinRoll: number;
  yaw: number;
  pitch: number;
  roll: number;
  /**
   * Extra height of the mesh centroid above its rest pose (air fall).
   * Rest pose keeps the bbox center at `pivot`.
   */
  elev: number;
  /** Mesh bbox center in meshRoot space — rotation orbits this, not the stage origin. */
  pivot: THREE.Vector3;
  flying: FlyingPart[];
  shards: DeathShard[];
  micros: MicroBurst[];
  /** Absolute wound-time stamps for micro pops. */
  microAt: number[];
  microI: number;
  /** Absolute wound-time stamps for solid piece peels. */
  chipAt: { t: number; partI: number }[];
  chipI: number;
  chipped: boolean[];
  scar: THREE.Group | null;
  savedAutoSpin: boolean;
};

export class MeshViewer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private meshRoot = new THREE.Group();
  private fxRoot = new THREE.Group();
  private ground: THREE.Group;
  private hullMat: THREE.MeshBasicMaterial;
  private wireMat: THREE.LineBasicMaterial;
  private groundMat: THREE.MeshBasicMaterial;
  private gridMat: THREE.LineBasicMaterial;
  private shardMat: THREE.LineBasicMaterial;
  private scarRingMat: THREE.LineBasicMaterial;
  private scarFillMat: THREE.MeshBasicMaterial;

  private ownedEdges: THREE.BufferGeometry[] = [];
  private az = 0.55;
  private el = 0.48;
  private dist = 6;
  /** lookAt height — default stage; fitFraming sets from mesh bbox. */
  private lookY = 0.45;
  private autoSpin = true;
  private spinRate = 0.35; // rad/s
  private showHull = true;
  private showWire = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private ro: ResizeObserver | null = null;
  private unbind: (() => void) | null = null;
  private disposed = false;
  private death: DeathState | null = null;
  private clock = 0;
  private _lastFrameMs = 0;

  constructor(opts: MeshViewerOpts) {
    this.container = opts.container;
    this.scene.background = new THREE.Color(BG);

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

    this.shardMat = new THREE.LineBasicMaterial({
      color: 0x2dff8c,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.scarRingMat = new THREE.LineBasicMaterial({
      color: 0x2dff8c,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      toneMapped: false,
    });
    this.scarFillMat = new THREE.MeshBasicMaterial({
      color: 0x2dff8c,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.ground = this.makeGround();
    this.root.add(this.ground);
    this.root.add(this.meshRoot);
    this.root.add(this.fxRoot);
    this.scene.add(this.root);

    // Soft ambient fill so pure-black hull still reads against wire
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
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), this.groundMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.001;
    g.add(disc);

    const grid = new THREE.GridHelper(6, 12, 0x00ffaa, 0x0d3a28);
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const m of mats) {
      const lm = m as THREE.LineBasicMaterial;
      lm.transparent = true;
      lm.opacity = 0.28;
      lm.depthWrite = false;
      lm.toneMapped = false;
    }
    grid.position.y = 0;
    g.add(grid);

    // Axis ticks — +Z forward (barrel / approach), +X right
    const axis = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0, 0.02, 1.4),
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(1.1, 0.02, 0),
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
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * n * 0.0012), 1.2, 40);
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
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, this.lookY, 0);
  }

  /**
   * Frame the staged mesh for catalog thumbs — fixed three-quarter pose,
   * dist from bbox so silhouettes fill the square.
   */
  fitFraming() {
    const box = new THREE.Box3().setFromObject(this.meshRoot);
    if (box.isEmpty()) {
      this.lookY = 0.45;
      this.dist = 6;
      this.az = 0.55;
      this.el = 0.48;
      this.applyCamera();
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.lookY = center.y;
    const maxDim = Math.max(size.x, size.y, size.z, 0.35);
    this.dist = THREE.MathUtils.clamp(maxDim * 2.15, 1.4, 32);
    this.az = 0.55;
    this.el = 0.48;
    this.applyCamera();
  }

  /** One-shot square PNG (needs preserveDrawingBuffer — already on). */
  snapshotDataUrl(px = 144): string {
    const w = Math.max(32, Math.round(px));
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, w, false);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  setTint(hex: string) {
    this.wireMat.color.set(hex);
    this.gridMat.color.set(hex);
    this.shardMat.color.set(hex);
    this.scarRingMat.color.set(hex);
    this.scarFillMat.color.set(hex);
  }

  setShowHull(on: boolean) {
    this.showHull = on;
    this.meshRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") o.visible = on;
    });
  }

  setShowWire(on: boolean) {
    this.showWire = on;
    this.meshRoot.traverse((o) => {
      if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
        o.visible = on;
      }
    });
  }

  setShowGround(on: boolean) {
    this.ground.visible = on;
  }

  setAutoSpin(on: boolean) {
    this.autoSpin = on;
  }

  setSpinRate(radPerSec: number) {
    this.spinRate = radPerSec;
  }

  setElev(rad: number) {
    this.el = THREE.MathUtils.clamp(rad, 0.05, 1.45);
    this.applyCamera();
  }

  setDist(d: number) {
    this.dist = THREE.MathUtils.clamp(d, 1.2, 40);
    this.applyCamera();
  }

  getDist() {
    return this.dist;
  }

  getElev() {
    return this.el;
  }

  /** Swap the staged mesh from catalog def + packs. */
  setMesh(def: MeshDef, packs: MeshPacks, creaseOverride?: number) {
    this.stopDeath(true);
    this.clearMesh();
    const crease = creaseOverride ?? def.crease;
    const scale = def.scale ?? 1;
    const geos = def.parts(packs);
    const group = new THREE.Group();
    group.scale.setScalar(scale);

    geos.forEach((solid, i) => {
      // Operators turret sits on rover body at pivot
      const part = new THREE.Group();
      part.userData.kind = "deathPart";
      part.userData.partIndex = i;
      if (def.id === "u:rover" && i === 1) {
        part.position.set(ROVER_TURRET_PIVOT.x, ROVER_TURRET_PIVOT.y, ROVER_TURRET_PIVOT.z);
      }

      const hull = new THREE.Mesh(solid, this.hullMat);
      hull.userData.kind = "hull";
      hull.visible = this.showHull;
      part.add(hull);

      const edges = new THREE.EdgesGeometry(solid, crease);
      this.ownedEdges.push(edges);
      const wire = new THREE.LineSegments(edges, this.wireMat);
      wire.userData.kind = "wire";
      wire.visible = this.showWire;
      part.add(wire);

      group.add(part);
    });

    this.meshRoot.add(group);
    return this.meshStats();
  }

  isDeathPlaying(): boolean {
    return this.death != null;
  }

  deathPhase(): string {
    return this.death?.phase ?? "idle";
  }

  /** Live shards still fading (detonate phase). */
  deathShardLive(): number {
    if (!this.death) return 0;
    let n = 0;
    for (const s of this.death.shards) {
      if (s.line.visible && s.age < s.life) n++;
    }
    return n;
  }

  deathShardTotal(): number {
    return this.death?.shards.length ?? 0;
  }

  deathIntegrity(): number {
    // Legacy HUD hook — wound progress as 1→0 during wound, else 0.
    if (!this.death) return 1;
    if (this.death.phase === "wound") {
      return 1 - Math.min(1, this.death.age / Math.max(1e-4, this.death.woundDur));
    }
    return 0;
  }

  /** Last mesh-stage WebGL submit (after render). */
  lastRenderInfo(): { calls: number; triangles: number; lines: number; points: number } {
    const r = this.renderer.info.render;
    return {
      calls: r.calls,
      triangles: r.triangles,
      lines: r.lines,
      points: r.points,
    };
  }

  /** Last frame GPU/CPU wall for this viewer's render only (ms). */
  lastFrameMs(): number {
    return this._lastFrameMs;
  }

  /**
   * Play combat death theater on the staged mesh.
   * Wound (micro pops + 1–2 solid chips) → boom (rest flings) → wire shatter + scar.
   * Parts are the same hand-drawn construction-kit pieces.
   */
  playDeath(opts: DeathPreviewOpts = {}) {
    if (this.meshRoot.children.length === 0) return;
    this.clearDeathFx();
    // Rest pose before measuring pivot
    this.meshRoot.position.set(0, 0, 0);
    this.meshRoot.rotation.set(0, 0, 0);
    this.meshRoot.quaternion.identity();
    this.meshRoot.visible = true;
    this.restoreHullWire();
    // Re-show any previously chipped part groups
    this.meshRoot.traverse((o) => {
      if (o.userData?.kind === "deathPart") o.visible = true;
    });
    this.meshRoot.updateMatrixWorld(true);

    const tier = opts.tier ?? "medium";
    // Ground structures never tumble — only true air units may set air.
    const air = opts.air ?? false;
    const speed = Math.max(0.25, opts.speed ?? 1);
    // boomDur = solid pieces linger before wire shatter (read: chunks in air)
    const durs =
      tier === "heavy"
        ? { wound: 0.78, boom: 0.52, hold: 0.95 }
        : tier === "light"
          ? { wound: 0.52, boom: 0.38, hold: 0.6 }
          : { wound: 0.65, boom: 0.45, hold: 0.75 };

    const box = new THREE.Box3().setFromObject(this.meshRoot);
    const pivot = box.isEmpty()
      ? new THREE.Vector3(0, 0.35, 0)
      : box.getCenter(new THREE.Vector3());

    const seed = Math.random() * 100;
    const parts = this.deathPartGroups();
    const nParts = Math.max(1, parts.length);
    const chipped = parts.map(() => false);

    // 2–4 micro pops spaced through wound
    const nMicro = tier === "heavy" ? 4 : tier === "light" ? 2 : 3;
    const microAt: number[] = [];
    for (let i = 0; i < nMicro; i++) {
      microAt.push(durs.wound * (0.08 + (i / Math.max(1, nMicro - 0.2)) * 0.72));
    }

    // Heavier chips: peel more construction pieces before the boom
    const nChip =
      nParts <= 1
        ? 0
        : tier === "heavy"
          ? Math.min(3, nParts - 1)
          : Math.min(2, nParts - 1);
    const chipAt: { t: number; partI: number }[] = [];
    // Prefer outer / later indices (top of structure) as sacrificial
    const order = Array.from({ length: nParts }, (_, i) => i).reverse();
    for (let c = 0; c < nChip; c++) {
      const partI = order[c] ?? c;
      const t = durs.wound * (0.22 + c * 0.18 + (seed * 0.01) % 0.06);
      chipAt.push({ t: Math.min(t, durs.wound * 0.82), partI });
    }

    this.death = {
      phase: "wound",
      age: 0,
      woundDur: durs.wound,
      boomDur: durs.boom,
      holdDur: durs.hold,
      air,
      loop: opts.loop ?? false,
      speed,
      tier,
      seed,
      // Spin is air-only. Ground buildings stay planted — never list or sink.
      spinYaw: air ? (1.0 + Math.sin(seed) * 1.1) * (seed > 50 ? 1 : -1) : 0,
      spinPitch: air ? Math.sin(seed * 0.7) * 1.2 : 0,
      spinRoll: air ? (1.6 + Math.cos(seed * 1.1) * 1.4) * (Math.sin(seed * 2) > 0 ? 1 : -1) : 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      elev: air ? 0.55 : 0,
      pivot,
      flying: [],
      shards: [],
      micros: [],
      microAt,
      microI: 0,
      chipAt,
      chipI: 0,
      chipped,
      scar: null,
      savedAutoSpin: this.autoSpin,
    };
    this.autoSpin = false;
    this.applyDeathPose();
  }

  /** Stop and restore staged mesh. */
  stopDeath(silent = false) {
    if (!this.death) return;
    const saved = this.death.savedAutoSpin;
    this.clearDeathFx();
    this.death = null;
    this.meshRoot.visible = true;
    this.meshRoot.position.set(0, 0, 0);
    this.meshRoot.rotation.set(0, 0, 0);
    this.meshRoot.quaternion.identity();
    this.meshRoot.traverse((o) => {
      if (o.userData?.kind === "deathPart") o.visible = true;
    });
    this.restoreHullWire();
    if (!silent) this.autoSpin = saved;
  }

  private restoreHullWire() {
    this.meshRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") {
        o.visible = this.showHull;
      }
      if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
        o.visible = this.showWire;
      }
    });
  }

  private clearDeathFx() {
    while (this.fxRoot.children.length) {
      const c = this.fxRoot.children.pop()!;
      this.fxRoot.remove(c);
      c.traverse((o) => {
        // Only dispose geos/mats we own (shards / scars / micros). Flying part
        // clones share catalog solids — disposing those would nuke the mesh.
        if ((o as THREE.LineSegments).isLineSegments) {
          const ls = o as THREE.LineSegments;
          if (o.userData?.ownedGeo) ls.geometry.dispose();
          if (o.userData?.ownedMat) (ls.material as THREE.Material).dispose();
        }
        if ((o as THREE.Mesh).isMesh && o.userData?.ownedGeo) {
          (o as THREE.Mesh).geometry.dispose();
        }
      });
    }
    if (this.death) {
      this.death.shards = [];
      this.death.flying = [];
      this.death.micros = [];
    }
  }

  /** Collect construction part groups under the staged mesh. */
  private deathPartGroups(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.meshRoot.traverse((o) => {
      if (o.userData?.kind === "deathPart") out.push(o);
    });
    // Fallback: treat the scale group as one piece if nothing tagged
    if (!out.length && this.meshRoot.children[0]) {
      out.push(this.meshRoot.children[0]!);
    }
    return out;
  }

  /**
   * Ground: identity — planted on the pad.
   * Air: rotate about the mesh bbox center, lift by `elev` (cruise → pad).
   */
  private applyDeathPose() {
    if (!this.death) return;
    const d = this.death;
    if (!d.air) {
      this.meshRoot.position.set(0, 0, 0);
      this.meshRoot.quaternion.identity();
      return;
    }
    const euler = new THREE.Euler(d.pitch, d.yaw, d.roll, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);
    this.meshRoot.quaternion.copy(q);
    // Want pivot P to stay at (Px, Py + elev, Pz) after rotation R:
    //   R*P + position = P + elevY  →  position = P + elevY − R*P
    const c = d.pivot;
    const rc = c.clone().applyQuaternion(q);
    this.meshRoot.position.set(c.x - rc.x, c.y + d.elev - rc.y, c.z - rc.z);
  }

  private setDeathChrome(hullOn: boolean, wireOn: boolean) {
    this.meshRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") {
        o.visible = hullOn && this.showHull;
      }
      if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
        o.visible = wireOn && this.showWire;
      }
    });
  }

  /** Kick origin in root-local space (assembled mesh center, or flying avg). */
  private deathKickOrigin(): THREE.Vector3 {
    const d = this.death!;
    if (d.flying.length) {
      const o = new THREE.Vector3();
      for (const f of d.flying) o.add(f.root.position);
      return o.multiplyScalar(1 / d.flying.length);
    }
    this.meshRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.meshRoot);
    if (box.isEmpty()) return new THREE.Vector3(0, d.elev + 0.3, 0);
    const c = box.getCenter(new THREE.Vector3());
    this.root.worldToLocal(c);
    return c;
  }

  /**
   * Micro-explosion: phosphor star + short-lived edge flecks at a hull point.
   * Structure stays solid — this is a wound pop, not a shatter.
   */
  private spawnMicro(partI: number) {
    if (!this.death) return;
    const d = this.death;
    const parts = this.deathPartGroups();
    const src = parts[partI % parts.length] ?? this.meshRoot;
    src.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(src);
    const center = box.isEmpty()
      ? new THREE.Vector3(0, d.elev + 0.3, 0)
      : box.getCenter(new THREE.Vector3());
    // Jitter to a surface-ish point on the part bbox
    const size = box.isEmpty()
      ? new THREE.Vector3(0.2, 0.2, 0.2)
      : box.getSize(new THREE.Vector3());
    const ang = d.seed * 1.7 + partI * 2.3 + d.microI * 1.1;
    center.x += Math.cos(ang) * size.x * 0.35;
    center.y += (0.15 + Math.sin(ang * 0.7) * 0.35) * size.y;
    center.z += Math.sin(ang) * size.z * 0.35;
    this.root.worldToLocal(center);

    const g = new THREE.Group();
    g.position.copy(center);
    const rays = 7;
    const r0 = 0.04;
    const r1 = 0.18 + (d.tier === "heavy" ? 0.06 : 0);
    const pos: number[] = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + ang;
      const elev = (i % 3) * 0.4 - 0.4;
      const c0 = Math.cos(a);
      const s0 = Math.sin(a);
      pos.push(c0 * r0, elev * r0, s0 * r0, c0 * r1, elev * r1 * 1.2, s0 * r1);
    }
    // Small cross for CRT punch
    pos.push(-r1 * 0.5, 0, 0, r1 * 0.5, 0, 0, 0, -r1 * 0.4, 0, 0, r1 * 0.4, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = this.shardMat.clone();
    mat.opacity = 1;
    const lines = new THREE.LineSegments(geo, mat);
    lines.userData.ownedGeo = true;
    lines.userData.ownedMat = true;
    g.add(lines);
    this.fxRoot.add(g);
    d.micros.push({ root: g, age: 0, life: 0.14 + Math.random() * 0.06 });

    // 2–4 fleck shards from the pop
    const nFleck = d.tier === "heavy" ? 4 : 3;
    for (let f = 0; f < nFleck; f++) {
      const a = ang + f * 1.7;
      const len = 0.05 + Math.random() * 0.06;
      const fgeo = new THREE.BufferGeometry();
      fgeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [-len * 0.5, 0, 0, len * 0.5, 0, 0],
          3,
        ),
      );
      const fline = new THREE.LineSegments(fgeo, this.shardMat);
      fline.userData.ownedGeo = true;
      fline.position.copy(center);
      this.fxRoot.add(fline);
      const kick = 0.9 + Math.random() * 0.7;
      d.shards.push({
        line: fline,
        vx: Math.cos(a) * kick,
        vy: 0.5 + Math.random() * 0.8,
        vz: Math.sin(a) * kick,
        ax: (Math.random() - 0.5) * 10,
        ay: (Math.random() - 0.5) * 8,
        az: (Math.random() - 0.5) * 10,
        age: 0,
        life: 0.12 + Math.random() * 0.1,
      });
    }
  }

  /**
   * Peel one construction piece off as a solid hull+wire chunk.
   * Original part hides; rest of structure stays planted.
   */
  private chipPart(partI: number) {
    if (!this.death) return;
    const d = this.death;
    const parts = this.deathPartGroups();
    if (partI < 0 || partI >= parts.length) return;
    if (d.chipped[partI]) return;
    d.chipped[partI] = true;

    const src = parts[partI]!;
    src.updateMatrixWorld(true);
    const clone = src.clone(true);
    const wPos = new THREE.Vector3();
    const wQuat = new THREE.Quaternion();
    const wScale = new THREE.Vector3();
    src.matrixWorld.decompose(wPos, wQuat, wScale);
    this.root.worldToLocal(wPos);
    clone.position.copy(wPos);
    clone.quaternion.copy(wQuat);
    clone.scale.copy(wScale);
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") {
        o.visible = this.showHull;
      }
      if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
        o.visible = this.showWire;
      }
    });
    this.fxRoot.add(clone);
    src.visible = false;

    const origin = this.deathKickOrigin();
    const dir = wPos.clone().sub(origin);
    if (dir.lengthSq() < 1e-6) {
      const a = partI * 1.7 + d.seed;
      dir.set(Math.cos(a), 0.4, Math.sin(a));
    }
    dir.normalize();
    // Mild kick — chips tumble off, not full detonation. Ground: flatter toss.
    const kick = (d.air ? 1.15 : 1.05) + (d.tier === "heavy" ? 0.35 : 0.15);
    const spin = d.air ? 5 : 2.2;
    d.flying.push({
      root: clone,
      vx: dir.x * kick + (Math.random() - 0.5) * 0.4,
      vy: d.air
        ? dir.y * kick + 0.7 + Math.random() * 0.5
        : 0.55 + Math.random() * 0.35 + Math.max(0, dir.y) * 0.25,
      vz: dir.z * kick + (Math.random() - 0.5) * 0.4,
      ax: (Math.random() - 0.5) * spin,
      ay: (Math.random() - 0.5) * spin * 0.85,
      az: (Math.random() - 0.5) * spin,
    });

    // Chip pop micro at that part
    this.spawnMicro(partI);
  }

  /** Fling every remaining solid part hard — the big boom. */
  private startBoom() {
    if (!this.death) return;
    const d = this.death;
    this.meshRoot.updateMatrixWorld(true);
    const parts = this.deathPartGroups();
    const origin = this.deathKickOrigin();
    const n = Math.max(1, parts.length);

    // Count unchipped remainders
    let remain = 0;
    for (let i = 0; i < n; i++) {
      if (!d.chipped[i]) remain++;
    }

    // Ground + single solid (or only one left): do NOT tumble the whole hull —
    // flash + linger planted, then detonate in place. Whole-building spin/sink
    // is the exact bad read we killed CRT for.
    const plantBoom = !d.air && remain <= 1 && d.flying.length === 0;

    if (!plantBoom) {
      for (let i = 0; i < n; i++) {
        if (d.chipped[i]) continue;
        const src = parts[i]!;
        if (!src.visible && src.userData?.kind === "deathPart") continue;
        src.updateMatrixWorld(true);
        const clone = src.clone(true);
        const wPos = new THREE.Vector3();
        const wQuat = new THREE.Quaternion();
        const wScale = new THREE.Vector3();
        src.matrixWorld.decompose(wPos, wQuat, wScale);
        this.root.worldToLocal(wPos);
        clone.position.copy(wPos);
        clone.quaternion.copy(wQuat);
        clone.scale.copy(wScale);
        clone.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") {
            o.visible = this.showHull;
          }
          if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
            o.visible = this.showWire;
          }
        });
        this.fxRoot.add(clone);

        const dir = wPos.clone().sub(origin);
        if (dir.lengthSq() < 1e-6) {
          const a = (i / n) * Math.PI * 2 + d.seed;
          dir.set(Math.cos(a), d.air ? 0.45 : 0.15, Math.sin(a));
        }
        dir.normalize();
        const partBoost = n > 1 ? 1.55 : 1.15;
        const kick =
          ((d.air ? 2.8 : 2.35) + (d.tier === "heavy" ? 0.9 : 0.35)) * partBoost;
        // Ground debris: outward + short hop, mild spin — never long tumble
        const spin = d.air ? 10 : 3.2;
        d.flying.push({
          root: clone,
          vx: dir.x * kick + (Math.random() - 0.5) * 0.7,
          vy: d.air
            ? dir.y * kick + 0.95 + Math.random() * 0.85
            : 0.7 + Math.random() * 0.55 + Math.max(0, dir.y) * 0.3,
          vz: dir.z * kick + (Math.random() - 0.5) * 0.7,
          ax: (Math.random() - 0.5) * spin,
          ay: (Math.random() - 0.5) * spin * 0.9,
          az: (Math.random() - 0.5) * spin,
        });
        d.chipped[i] = true;
      }
      this.meshRoot.visible = false;
    } else {
      // Planted: hide nothing yet — detonate samples meshRoot wires at end of boom
      for (let i = 0; i < n; i++) d.chipped[i] = true;
      this.meshRoot.visible = true;
      this.setDeathChrome(true, true);
    }

    // Louder boom read: triple flash
    this.spawnMicro(0);
    this.spawnMicro(Math.max(0, Math.floor(n / 2)));
    this.spawnMicro(Math.max(0, n - 1));
  }

  private tickFlying(step: number) {
    const d = this.death;
    if (!d) return;
    for (const f of d.flying) {
      f.root.position.x += f.vx * step;
      f.root.position.y += f.vy * step;
      f.root.position.z += f.vz * step;
      f.vy -= (d.air ? 3.8 : 5.5) * step;
      f.vx *= 1 - 0.35 * step;
      f.vz *= 1 - 0.35 * step;
      // Ground: bounce on the pad so debris never sinks through the floor
      if (!d.air && f.root.position.y < 0.04) {
        f.root.position.y = 0.04;
        f.vy = Math.abs(f.vy) * 0.25;
        f.ax *= 0.7;
        f.ay *= 0.7;
        f.az *= 0.7;
      }
      f.root.rotateX(f.ax * step);
      f.root.rotateY(f.ay * step);
      f.root.rotateZ(f.az * step);
    }
  }

  private tickMicros(step: number) {
    const d = this.death;
    if (!d) return;
    for (const m of d.micros) {
      m.age += step;
      const t = Math.min(1, m.age / Math.max(1e-4, m.life));
      const s = 0.55 + t * 1.6;
      m.root.scale.setScalar(s);
      m.root.traverse((o) => {
        if ((o as THREE.LineSegments).isLineSegments) {
          const mat = (o as THREE.LineSegments).material as THREE.LineBasicMaterial;
          mat.opacity = Math.max(0, 1 - t * t) * 0.95;
        }
      });
      if (m.age >= m.life) m.root.visible = false;
    }
  }

  private tickShards(step: number): number {
    const d = this.death;
    if (!d) return 0;
    let live = 0;
    for (const s of d.shards) {
      s.age += step;
      if (s.age >= s.life) {
        s.line.visible = false;
        continue;
      }
      live++;
      const t = s.age / s.life;
      s.line.position.x += s.vx * step;
      s.line.position.y += s.vy * step;
      s.line.position.z += s.vz * step;
      s.vy -= 4.5 * step;
      s.vx *= 1 - 0.6 * step;
      s.vz *= 1 - 0.6 * step;
      s.line.rotation.x += s.ax * step;
      s.line.rotation.y += s.ay * step;
      s.line.rotation.z += s.az * step;
      let op = 1 - t;
      if (t > 0.7) {
        const ft = (t - 0.7) / 0.3;
        op = ft < 0.33 ? 0.15 : ft < 0.66 ? 0.55 : 0.05;
      }
      this.shardMat.opacity = Math.max(0.05, op * 0.95);
      s.line.scale.setScalar(Math.max(0.15, 1 - t * 0.55));
    }
    return live;
  }

  /** Wire-detonate flying solid parts (or staged mesh). */
  private detonate() {
    if (!this.death) return;
    const d = this.death;

    // Louder boom: denser phosphor edges
    const nShards =
      d.tier === "heavy" ? 36 : d.tier === "light" ? 16 : 26;

    const wires: THREE.LineSegments[] = [];
    const wireRoots =
      d.flying.length > 0 ? d.flying.map((f) => f.root) : [this.meshRoot];
    for (const root of wireRoots) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if ((o as THREE.LineSegments).isLineSegments && o.userData.kind === "wire") {
          wires.push(o as THREE.LineSegments);
        }
      });
    }

    const kickOrigin = this.deathKickOrigin();
    let spawned = 0;
    for (const wire of wires) {
      const pos = wire.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      const segs = Math.floor(pos.count / 2);
      if (segs <= 0) continue;
      const take = Math.max(1, Math.ceil(nShards / Math.max(1, wires.length)));
      const stride = Math.max(1, Math.floor(segs / take));
      wire.updateMatrixWorld(true);
      for (let i = 0; i < take && spawned < nShards; i++) {
        const si = (i * stride) % segs;
        const e1 = new THREE.Vector3().fromBufferAttribute(pos, si * 2);
        const e2 = new THREE.Vector3().fromBufferAttribute(pos, si * 2 + 1);
        e1.applyMatrix4(wire.matrixWorld);
        e2.applyMatrix4(wire.matrixWorld);
        this.root.worldToLocal(e1);
        this.root.worldToLocal(e2);

        const mid = e1.clone().add(e2).multiplyScalar(0.5);
        const geo = new THREE.BufferGeometry();
        const arr = new Float32Array([
          e1.x - mid.x,
          e1.y - mid.y,
          e1.z - mid.z,
          e2.x - mid.x,
          e2.y - mid.y,
          e2.z - mid.z,
        ]);
        geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
        const line = new THREE.LineSegments(geo, this.shardMat);
        line.userData.ownedGeo = true;
        line.position.copy(mid);
        this.fxRoot.add(line);

        const dir = mid.clone().sub(kickOrigin);
        if (dir.lengthSq() < 1e-8) dir.set(Math.sin(i + spawned), 0.5, Math.cos(i + spawned));
        dir.normalize();
        let ivx = 0;
        let ivy = 0;
        let ivz = 0;
        if (d.flying.length) {
          let best = d.flying[0]!;
          let bestD = Infinity;
          for (const f of d.flying) {
            const dd = f.root.position.distanceToSquared(mid);
            if (dd < bestD) {
              bestD = dd;
              best = f;
            }
          }
          ivx = best.vx * 0.55;
          ivy = best.vy * 0.55;
          ivz = best.vz * 0.55;
        }
        const kick = (d.air ? 2.8 : 2.2) + (d.tier === "heavy" ? 0.85 : 0.3);
        d.shards.push({
          line,
          vx: ivx + dir.x * kick + (Math.random() - 0.5) * 1.05,
          vy: ivy + dir.y * kick + 0.85 + Math.random() * 1.0,
          vz: ivz + dir.z * kick + (Math.random() - 0.5) * 1.05,
          ax: (Math.random() - 0.5) * 12,
          ay: (Math.random() - 0.5) * 11,
          az: (Math.random() - 0.5) * 12,
          age: 0,
          life: 0.42 + Math.random() * 0.38 + (d.tier === "heavy" ? 0.15 : 0),
        });
        spawned++;
      }
    }

    for (const f of d.flying) {
      f.root.visible = false;
    }
    this.meshRoot.visible = false;

    // Surface scar on ground plane — bigger boom footprint
    const scar = new THREE.Group();
    const r = d.tier === "heavy" ? 1.15 : d.tier === "light" ? 0.62 : 0.85;
    const ringPos: number[] = [];
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const rr0 = r * (0.92 + (i % 2) * 0.1);
      const rr1 = r * (0.92 + ((i + 1) % 2) * 0.1);
      ringPos.push(
        Math.cos(a0) * rr0,
        0.02,
        Math.sin(a0) * rr0,
        Math.cos(a1) * rr1,
        0.02,
        Math.sin(a1) * rr1,
      );
    }
    ringPos.push(-r * 0.45, 0.02, 0, r * 0.45, 0.02, 0);
    ringPos.push(0, 0.02, -r * 0.45, 0, 0.02, r * 0.45);
    // Second ring for louder read
    const r2 = r * 0.55;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = ((i + 1) / 6) * Math.PI * 2;
      ringPos.push(
        Math.cos(a0) * r2,
        0.025,
        Math.sin(a0) * r2,
        Math.cos(a1) * r2,
        0.025,
        Math.sin(a1) * r2,
      );
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ringPos, 3));
    const ring = new THREE.LineSegments(ringGeo, this.scarRingMat);
    ring.userData.ownedGeo = true;
    scar.add(ring);
    const fillGeo = new THREE.CircleGeometry(r * 0.8, 8);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, this.scarFillMat);
    fill.userData.ownedGeo = true;
    fill.position.y = 0.015;
    scar.add(fill);
    scar.rotation.y = Math.random() * Math.PI * 2;
    this.fxRoot.add(scar);
    d.scar = scar;

    this.scarRingMat.opacity = 0.95;
    this.scarFillMat.opacity = 0.22;
  }

  private tickDeath(dt: number) {
    const d = this.death;
    if (!d) return;
    const step = dt * d.speed;
    d.age += step;
    this.clock += step;

    // Always advance chips-in-flight + micro flashes + fleck shards
    this.tickFlying(step);
    this.tickMicros(step);
    this.tickShards(step);

    if (d.phase === "wound") {
      const u = Math.min(1, d.age / Math.max(1e-4, d.woundDur));
      // Air only: light vacuum tumble. Ground: hard plant every frame.
      if (d.air) {
        d.yaw += d.spinYaw * step * (0.55 + u * 0.5);
        d.pitch += d.spinPitch * step * 0.7;
        d.roll += d.spinRoll * step * 0.75;
        d.elev = Math.max(0.08, d.elev - (0.35 + u * 0.9) * step);
      } else {
        d.yaw = 0;
        d.pitch = 0;
        d.roll = 0;
        d.elev = 0;
      }
      this.applyDeathPose();
      this.setDeathChrome(true, true);
      this.meshRoot.visible = true;

      while (d.microI < d.microAt.length && d.age >= d.microAt[d.microI]!) {
        // Cycle parts so pops land on different construction pieces
        const parts = this.deathPartGroups();
        const pi = Math.floor((d.seed + d.microI * 2.7) % Math.max(1, parts.length));
        // Prefer unchipped parts for wound pops
        let pick = pi;
        for (let k = 0; k < parts.length; k++) {
          const j = (pi + k) % parts.length;
          if (!d.chipped[j]) {
            pick = j;
            break;
          }
        }
        this.spawnMicro(pick);
        d.microI++;
      }

      while (d.chipI < d.chipAt.length && d.age >= d.chipAt[d.chipI]!.t) {
        this.chipPart(d.chipAt[d.chipI]!.partI);
        d.chipI++;
      }

      if (d.age >= d.woundDur) {
        this.startBoom();
        d.phase = "boom";
        d.age = 0;
      }
      return;
    }

    if (d.phase === "boom") {
      // Remaining solids already flung; short flight then wire detonation
      if (d.age >= d.boomDur) {
        this.detonate();
        d.phase = "detonate";
        d.age = 0;
      }
      return;
    }

    if (d.phase === "detonate") {
      let live = 0;
      for (const s of d.shards) {
        if (s.line.visible && s.age < s.life) live++;
      }
      const scarT = d.age;
      if (scarT < 0.05) {
        this.scarRingMat.opacity = 0;
        this.scarFillMat.opacity = 0;
      } else if (scarT < 0.18) {
        this.scarRingMat.opacity = 0.9;
        this.scarFillMat.opacity = 0.18;
      } else {
        this.scarRingMat.opacity = 0.55;
        this.scarFillMat.opacity = 0.1;
      }

      if (live === 0 && d.age > 0.35) {
        d.phase = "hold";
        d.age = 0;
      }
      return;
    }

    if (d.phase === "hold") {
      if (d.age >= d.holdDur) {
        if (d.loop) {
          const speed = d.speed;
          const air = d.air;
          const tier = d.tier;
          const saved = d.savedAutoSpin;
          this.stopDeath(true);
          this.playDeath({ air, tier, loop: true, speed });
          if (this.death) this.death.savedAutoSpin = saved;
        } else {
          this.stopDeath();
        }
      }
    }
  }

  meshStats(): { verts: number; faces: number; parts: number } {
    let verts = 0;
    let faces = 0;
    let parts = 0;
    this.meshRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.kind === "hull") {
        parts += 1;
        const g = (o as THREE.Mesh).geometry;
        const pos = g.getAttribute("position");
        if (pos) verts += pos.count;
        if (g.index) faces += g.index.count / 3;
        else if (pos) faces += pos.count / 3;
      }
    });
    return { verts, faces: Math.round(faces), parts };
  }

  private clearMesh() {
    while (this.meshRoot.children.length) {
      this.meshRoot.remove(this.meshRoot.children[0]!);
    }
    for (const e of this.ownedEdges) e.dispose();
    this.ownedEdges = [];
  }

  tick(dt: number) {
    if (this.disposed) return;
    const t0 = performance.now();
    if (this.death) this.tickDeath(dt);
    else if (this.autoSpin && !this.dragging) {
      this.az += this.spinRate * dt;
      this.applyCamera();
    }
    this.renderer.render(this.scene, this.camera);
    this._lastFrameMs = performance.now() - t0;
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose() {
    this.disposed = true;
    this.unbind?.();
    this.unbind = null;
    this.ro?.disconnect();
    this.ro = null;
    this.stopDeath(true);
    this.clearMesh();
    this.hullMat.dispose();
    this.wireMat.dispose();
    this.groundMat.dispose();
    this.gridMat.dispose();
    this.shardMat.dispose();
    this.scarRingMat.dispose();
    this.scarFillMat.dispose();
    this.ground.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).geometry.dispose();
      }
      if ((o as THREE.LineSegments).isLineSegments) {
        (o as THREE.LineSegments).geometry.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
