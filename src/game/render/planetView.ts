import * as THREE from "three";
import { GLOBE_RADIUS, MAP_H, MAP_W } from "../sim/defs";
import { START_P0 } from "../sim/terrain";
import type { BuildingKind, PlayerId, SimSnapshot } from "../sim/types";
import { PlanetEntityLayer } from "./planetEntities";
import { attachFowShader, createFowState, updateFow, type FowState } from "./planetFow";
import { bindPlanetInput } from "./planetInput";
import { PlanetPlaceAssist } from "./planetPlaceAssist";
import {
  DEFAULT_DIST,
  DIST_MAX,
  DIST_MIN,
  EL_MAX,
  EL_MIN,
  isPlanetGeometryReady,
  makeBuildingGeos,
  mapToWorld,
  placeOnSurface,
  PAN_FRICTION,
  projectToSurface,
  scaffoldFootprint,
  warmPlanetGeometry,
} from "./planetMath";

export { warmPlanetGeometry, isPlanetGeometryReady } from "./planetMath";

export type PlanetViewOpts = {
  container: HTMLElement;
  viewer: PlayerId;
  /** Called only from confirm UI after valid center reticle place */
  onPlace: (x: number, y: number) => void;
  onGlobeReady?: () => void;
  /** Optional: live preview validity for HUD ✓ button */
  onPlacePreview?: (info: { ok: boolean; reason: string; x: number; y: number } | null) => void;
};

/**
 * Globe scene orchestrator: camera, input, FOW, entity layer, ghost.
 * Placement is center-locked hologram; pan moves the world under the reticle.
 */
export class PlanetView {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private globeMesh: THREE.Mesh | null = null;
  private entityRoot = new THREE.Group();
  private projectileRoot = new THREE.Group();
  private ghost: THREE.Mesh;
  private ghostWire: THREE.LineSegments;
  private ghostGroup = new THREE.Group();
  private ghostEdgeOwned: THREE.BufferGeometry | null = null;
  private placeGeos = makeBuildingGeos();
  private placeAssist: PlanetPlaceAssist;
  private viewer: PlayerId;
  private onPlace: (x: number, y: number) => void;
  private onGlobeReady?: () => void;
  private onPlacePreview?: PlanetViewOpts["onPlacePreview"];
  private snap: SimSnapshot | null = null;
  private placeKind: BuildingKind | null = null;
  /** Operation targeting (survey etc) — no building ghost */
  private opAim = false;
  private opRadius = 1.35;
  private opRingGeo: THREE.RingGeometry | null = null;
  private placeCursor: { x: number; y: number } | null = null;
  private placeOk = false;
  private placeReason = "";
  /** External validity checker (sim canPlacePreview) */
  private placeValidator:
    | ((kind: BuildingKind, x: number, y: number) => { ok: boolean; reason: string })
    | null = null;
  private entities: PlanetEntityLayer;
  private fow: FowState | null = null;
  private planetMat: THREE.MeshStandardMaterial | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private unbindInput: (() => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2(0, 0);

  private focus = new THREE.Vector3();
  private az = 0.15;
  private el = THREE.MathUtils.degToRad(48);
  private dist = GLOBE_RADIUS * 3.7; // title-like wide frame, eases to tactical
  private azT = 0.15;
  private elT = THREE.MathUtils.degToRad(42);
  private distT = GLOBE_RADIUS * 3.7;
  private normal = new THREE.Vector3();
  private east = new THREE.Vector3();
  private north = new THREE.Vector3();
  private viewDir = new THREE.Vector3();
  private panEast = new THREE.Vector3();
  private panNorth = new THREE.Vector3();
  private panMom = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private stars: THREE.Points | null = null;
  private _ro: ResizeObserver | null = null;

  constructor(opts: PlanetViewOpts) {
    this.container = opts.container;
    this.viewer = opts.viewer;
    this.onPlace = opts.onPlace;
    this.onGlobeReady = opts.onGlobeReady;
    this.onPlacePreview = opts.onPlacePreview;

    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 2000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xb0c4d8, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6688aa, 0.35);
    fill.position.set(-60, -20, -80);
    this.scene.add(fill);

    this.buildStarfield();
    this.scene.add(this.entityRoot);
    this.scene.add(this.projectileRoot);
    this.entities = new PlanetEntityLayer(
      this.scene,
      this.entityRoot,
      this.projectileRoot,
      this.viewer,
    );

    const ghostGeo = new THREE.BoxGeometry(1.5, 0.55, 1.5);
    this.ghost = new THREE.Mesh(
      ghostGeo,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.38,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    this.ghost.scale.setScalar(0.96);
    const edge0 = new THREE.EdgesGeometry(ghostGeo, 15);
    this.ghostEdgeOwned = edge0;
    this.ghostWire = new THREE.LineSegments(
      edge0,
      new THREE.LineBasicMaterial({
        color: 0x2dff8c,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.ghostGroup.add(this.ghost, this.ghostWire);
    this.ghostGroup.visible = false;
    this.scene.add(this.ghostGroup);
    this.placeAssist = new PlanetPlaceAssist(this.scene);

    mapToWorld(START_P0.x, START_P0.y, this.focus);
    this.unbindInput = this.attachInput();

    this._ro = new ResizeObserver(() => this.onResize());
    this._ro.observe(this.container);

    void warmPlanetGeometry().then((geo) => {
      if (this.disposed) return;
      this.setupGlobe(geo);
      // Ease camera from title-wide to tactical after rock is up
      this.distT = DEFAULT_DIST;
      this.elT = THREE.MathUtils.degToRad(48);
      this.onGlobeReady?.();
    });

    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private attachInput() {
    const self = this;
    return bindPlanetInput({
      container: self.container,
      camera: self.camera,
      renderer: self.renderer,
      get globeMesh() {
        return self.globeMesh;
      },
      get azT() {
        return self.azT;
      },
      set azT(v: number) {
        self.azT = v;
      },
      get elT() {
        return self.elT;
      },
      set elT(v: number) {
        self.elT = v;
      },
      get distT() {
        return self.distT;
      },
      set distT(v: number) {
        self.distT = v;
      },
      get dist() {
        return self.dist;
      },
      panEast: self.panEast,
      panNorth: self.panNorth,
      focus: self.focus,
      panMom: self.panMom,
      projectToSurface,
      isUi: (t) => (t as HTMLElement | null)?.closest?.("[data-ui]") != null,
    });
  }

  setSnapshot(snap: SimSnapshot) {
    this.snap = snap;
    this.entities.setSnapshot(snap);
  }

  setPlaceKind(kind: BuildingKind | null) {
    this.opAim = false;
    this.placeKind = kind;
    if (!kind) {
      this.placeCursor = null;
      this.placeOk = false;
      this.placeReason = "";
      this.onPlacePreview?.(null);
      return;
    }
    this.applyGhostGeometry(kind);
  }

  /** Focus mode for operations — pan world, confirm mark. */
  setOpAim(radius: number | null) {
    if (radius == null) {
      this.opAim = false;
      this.placeKind = null;
      this.placeCursor = null;
      this.placeOk = false;
      this.placeReason = "";
      this.onPlacePreview?.(null);
      return;
    }
    this.opAim = true;
    this.opRadius = radius;
    // non-null placeKind enables cursor pipeline; geometry is radio ring
    this.placeKind = "core";
    this.applyOpGhostGeometry();
  }

  private applyOpGhostGeometry() {
    if (!this.opRingGeo) {
      this.opRingGeo = new THREE.RingGeometry(0.55, 0.95, 28);
      this.opRingGeo.rotateX(-Math.PI / 2);
    }
    this.ghost.geometry = this.opRingGeo;
    if (this.ghostEdgeOwned) this.ghostEdgeOwned.dispose();
    this.ghostEdgeOwned = new THREE.EdgesGeometry(this.opRingGeo, 15);
    this.ghostWire.geometry = this.ghostEdgeOwned;
  }

  private placeSolidGeo(kind: BuildingKind): THREE.BufferGeometry {
    const g = this.placeGeos;
    if (kind === "extractor") return g.extractor;
    if (kind === "depot") return g.depot;
    if (kind === "refinery") return g.refinery;
    if (kind === "dome") return g.dome;
    if (kind === "barracks") return g.barracks;
    if (kind === "turret") return g.turret;
    if (kind === "aa") return g.aa;
    if (kind === "factory") return g.factory;
    if (kind === "airpad") return g.airpad;
    if (kind === "scout") return g.scoutPad;
    return g.depot;
  }

  private applyGhostGeometry(kind: BuildingKind) {
    const solid = this.placeSolidGeo(kind);
    // Share solid geo (owned by placeGeos); replace edge geo
    this.ghost.geometry = solid;
    if (this.ghostEdgeOwned) this.ghostEdgeOwned.dispose();
    this.ghostEdgeOwned = new THREE.EdgesGeometry(solid, 18);
    this.ghostWire.geometry = this.ghostEdgeOwned;
  }

  setPlaceValidator(
    fn: ((kind: BuildingKind, x: number, y: number) => { ok: boolean; reason: string }) | null,
  ) {
    this.placeValidator = fn;
  }

  /** Screen-center map cell currently under the reticle (or null). */
  getPlaceCursor(): { x: number; y: number } | null {
    return this.placeCursor;
  }

  /** Snap camera focus to a map point (operation Focus). */
  focusMap(x: number, y: number) {
    mapToWorld(x, y, this.focus);
    this.panMom.set(0, 0, 0);
  }

  isPlaceValid(): boolean {
    return this.placeOk;
  }

  getPlaceReason(): string {
    return this.placeReason;
  }

  /** Confirm button: place at center reticle if valid. */
  confirmPlace(): boolean {
    if ((!this.placeKind && !this.opAim) || !this.placeCursor || !this.placeOk) return false;
    this.onPlace(this.placeCursor.x, this.placeCursor.y);
    return true;
  }

  private projectScreenCenter(): { x: number; y: number } | null {
    if (!this.globeMesh) return null;
    // Slightly above true center so thumb chrome at bottom doesn't feel like the pad is too high
    this.ndc.set(0, 0.06);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.globeMesh, false);
    if (!hits[0]) return null;
    const p = hits[0].point.clone().normalize();
    const lat = Math.asin(THREE.MathUtils.clamp(p.y, -1, 1));
    const lon = Math.atan2(p.x, p.z);
    const x = ((lon / (Math.PI * 2) + 1) % 1) * MAP_W;
    const y = (lat / (Math.PI * 0.92) + 0.5) * MAP_H;
    if (y < 0.5 || y > MAP_H - 0.5) return null;
    return { x, y };
  }

  private setupGlobe(geo: THREE.BufferGeometry) {
    this.fow = createFowState();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.82,
      metalness: 0.04,
    });
    attachFowShader(mat, this.fow.tex);
    this.planetMat = mat;
    this.globeMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.globeMesh);

    // Phosphor wire hull (matches title globe — without this play rock looks bald)
    const wire = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x00ffaa,
        wireframe: true,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    wire.renderOrder = 1;
    this.scene.add(wire);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.045, 48, 32),
      new THREE.MeshBasicMaterial({
        color: 0x6a9ec8,
        transparent: true,
        opacity: 0.045,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.scene.add(sky);
  }

  private buildStarfield() {
    const COUNT = 4800;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const R = 360;
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = R * (0.92 + Math.random() * 0.08);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      const roll = Math.random();
      if (roll < 0.08) c.setHSL(0.08, 0.55, 0.75 + Math.random() * 0.2);
      else if (roll < 0.2) c.setHSL(0.58, 0.45, 0.8 + Math.random() * 0.15);
      else c.setHSL(0.6, 0.05 + Math.random() * 0.15, 0.7 + Math.random() * 0.3);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.85,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    );
    this.scene.add(this.stars);
    this.scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(400, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x02040a, side: THREE.BackSide, depthWrite: false }),
      ),
    );
  }

  private onResize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private loop(now: number) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.updateCamera(dt);
    if (this.fow && this.snap) {
      updateFow(this.fow, this.snap, this.viewer, dt, this.planetMat);
    }
    this.entities.sync(dt);
    this.updatePlaceCursor();
    this.syncGhost();
    if (this.stars) this.stars.rotation.y += dt * 0.004;
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private updatePlaceCursor() {
    if (!this.placeKind && !this.opAim) {
      this.placeCursor = null;
      return;
    }
    const m = this.projectScreenCenter();
    this.placeCursor = m;
    if (!m) {
      this.placeOk = false;
      this.placeReason = "Off surface";
      this.onPlacePreview?.({ ok: false, reason: this.placeReason, x: 0, y: 0 });
      return;
    }
    if (this.opAim) {
      this.placeOk = true;
      this.placeReason = "Focus ready";
    } else if (this.placeValidator && this.placeKind) {
      const r = this.placeValidator(this.placeKind, m.x, m.y);
      this.placeOk = r.ok;
      this.placeReason = r.reason;
    } else {
      this.placeOk = true;
      this.placeReason = "Ready";
    }
    this.onPlacePreview?.({ ok: this.placeOk, reason: this.placeReason, x: m.x, y: m.y });
  }

  private updateCamera(dt: number) {
    // Coast after fling (surface-constrained)
    if (this.panMom.lengthSq() > 1e-6) {
      this.focus.addScaledVector(this.panMom, dt);
      const damp = Math.exp(-PAN_FRICTION * dt);
      this.panMom.multiplyScalar(damp);
      if (this.panMom.lengthSq() < 0.04) this.panMom.set(0, 0, 0);
    }
    projectToSurface(this.focus, this.focus);
    const k = 1 - Math.exp(-0.08 * 60 * dt);
    this.az += (this.azT - this.az) * k;
    this.el += (this.elT - this.el) * k;
    this.dist += (this.distT - this.dist) * k;
    this.el = THREE.MathUtils.clamp(this.el, EL_MIN, EL_MAX);
    this.dist = THREE.MathUtils.clamp(this.dist, DIST_MIN, DIST_MAX);

    this.normal.copy(this.focus).normalize();
    this.tmp.set(0, 1, 0);
    this.north.copy(this.tmp).addScaledVector(this.normal, -this.tmp.dot(this.normal));
    if (this.north.lengthSq() < 1e-8) {
      this.tmp.set(1, 0, 0);
      this.north.copy(this.tmp).addScaledVector(this.normal, -this.tmp.dot(this.normal));
    }
    this.north.normalize();
    this.east.crossVectors(this.north, this.normal).normalize();
    this.north.crossVectors(this.normal, this.east).normalize();

    const cel = Math.cos(this.el);
    const sel = Math.sin(this.el);
    this.viewDir
      .set(0, 0, 0)
      .addScaledVector(this.north, cel * Math.cos(this.az))
      .addScaledVector(this.east, cel * Math.sin(this.az))
      .addScaledVector(this.normal, sel)
      .normalize();

    this.camera.position.copy(this.focus).addScaledVector(this.viewDir, this.dist);
    this.camera.up.copy(this.normal);
    this.lookTarget.copy(this.focus).addScaledVector(this.normal, -this.dist * 0.16);
    this.camera.lookAt(this.lookTarget);
    this.camera.updateMatrixWorld();

    this.tmp.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.panEast.copy(this.tmp).addScaledVector(this.normal, -this.tmp.dot(this.normal));
    if (this.panEast.lengthSq() < 1e-8) this.panEast.copy(this.east);
    else this.panEast.normalize();
    this.tmp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.panNorth.copy(this.tmp).addScaledVector(this.normal, -this.tmp.dot(this.normal));
    if (this.panNorth.lengthSq() < 1e-8) this.panNorth.copy(this.north);
    else this.panNorth.normalize();
  }

  private syncGhost() {
    if ((!this.placeKind && !this.opAim) || !this.placeCursor || !this.snap) {
      this.ghostGroup.visible = false;
      this.placeAssist.hide();
      return;
    }
    this.ghostGroup.visible = true;
    const ok = this.placeOk;
    const tint = this.opAim ? 0x66ddff : ok ? 0x2dff8c : 0xff4466;
    (this.ghostWire.material as THREE.LineBasicMaterial).color.set(tint);
    (this.ghostWire.material as THREE.LineBasicMaterial).opacity = ok ? 0.95 : 0.85;
    (this.ghost.material as THREE.MeshBasicMaterial).opacity = this.opAim ? 0.22 : ok ? 0.32 : 0.48;
    // holographic pulse
    const pulse = 1 + 0.035 * Math.sin(performance.now() * 0.006);
    let elev = 0.12;
    const race = this.snap.players[this.viewer]?.race ?? "operators";
    if (this.opAim) {
      elev = 0.35;
      // scale ring by op radius (base ring ~1 map unit visual)
      const sc = this.opRadius * 1.15 * pulse;
      placeOnSurface(this.ghostGroup, this.placeCursor.x, this.placeCursor.y, elev, 0, 0, 0, sc, 1, sc, 0);
      this.placeAssist.hide();
      return;
    }
    if (race === "operators" && this.placeKind !== "core") {
      const scaf = scaffoldFootprint(this.placeCursor.x, this.placeCursor.y, 0.78, 0, 0.1, 0.45);
      elev = scaf.deckElev + 0.12; // sit on scaffold deck top
    }
    // Structure hologram at true building scale (matches placed sx≈1.15)
    const s = 1.15 * pulse;
    placeOnSurface(
      this.ghostGroup,
      this.placeCursor.x,
      this.placeCursor.y,
      elev,
      0,
      0,
      0,
      s,
      s,
      s,
    );

    this.placeAssist.sync(
      {
        kind: this.placeKind!,
        x: this.placeCursor.x,
        y: this.placeCursor.y,
        ok: this.placeOk,
        reason: this.placeReason,
        race,
      },
      this.snap,
    );
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unbindInput?.();
    this.entities.dispose();
    this.placeAssist.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this._ro?.disconnect();
    this.fow?.tex.dispose();
    this.planetMat?.dispose();
    (this.ghost.material as THREE.Material).dispose();
    (this.ghostWire.material as THREE.Material).dispose();
    this.ghostEdgeOwned?.dispose();
    // placeGeos solids shared — dispose all buffer geos from the pack
    for (const v of Object.values(this.placeGeos)) {
      if (v && typeof (v as THREE.BufferGeometry).dispose === "function") {
        (v as THREE.BufferGeometry).dispose();
      }
    }
  }
}
