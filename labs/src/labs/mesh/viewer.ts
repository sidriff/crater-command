/**
 * Isolated CRT mesh stage — black hull + phosphor wire, orbit camera.
 * Not PlanetView: no globe, FOW, or sim. Pure silhouette iteration.
 */
import * as THREE from "three";
import { ROVER_TURRET_PIVOT } from "@game/render/unitGeos";
import type { MeshDef, MeshPacks } from "./catalog";

const BG = 0x02040a;
const GROUND = 0x0a2218;

export type MeshViewerOpts = {
  container: HTMLElement;
};

export class MeshViewer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private meshRoot = new THREE.Group();
  private ground: THREE.Group;
  private hullMat: THREE.MeshBasicMaterial;
  private wireMat: THREE.LineBasicMaterial;
  private groundMat: THREE.MeshBasicMaterial;
  private gridMat: THREE.LineBasicMaterial;

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

    this.ground = this.makeGround();
    this.root.add(this.ground);
    this.root.add(this.meshRoot);
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
    this.clearMesh();
    const crease = creaseOverride ?? def.crease;
    const scale = def.scale ?? 1;
    const geos = def.parts(packs);
    const group = new THREE.Group();
    group.scale.setScalar(scale);

    geos.forEach((solid, i) => {
      // Operators turret sits on rover body at pivot
      const part = new THREE.Group();
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
    if (this.autoSpin && !this.dragging) {
      this.az += this.spinRate * dt;
      this.applyCamera();
    }
    this.renderer.render(this.scene, this.camera);
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
    this.clearMesh();
    this.hullMat.dispose();
    this.wireMat.dispose();
    this.groundMat.dispose();
    this.gridMat.dispose();
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
