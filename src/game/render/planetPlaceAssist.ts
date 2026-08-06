import * as THREE from "three";
import { BUILD_MIN_DIST, MAP_H, MAP_W } from "../sim/defs";
import { CELL_BLOCKED, CELL_SLOW, cellPassAt } from "../sim/terrain";
import type { RaceId, SimSnapshot } from "../sim/types";
import { mapToWorld, placeOnSurface, scaffoldFootprint } from "./planetMath";

/** Spacing ring — keep in sync with sim BUILD_MIN_DIST. */
export const PLACE_MIN_DIST = BUILD_MIN_DIST;
const TERRAIN_R = 4.1;
const TERRAIN_STEP = 0.55;
const SCAFFOLD_HALF = 0.78;
/** Lift wash marks along true surface normal so they clear steep folds. */
const WASH_LIFT = 0.28;

type AssistState = {
  kind: string;
  x: number;
  y: number;
  ok: boolean;
  reason: string;
  race: RaceId;
};

/**
 * Placement-mode visuals: spacing ring, circular terrain wash (discs + blocked Xs),
 * blocker highlight, Operators scaffold ghost.
 */
export class PlanetPlaceAssist {
  private root = new THREE.Group();
  private ring: THREE.Line;
  private link: THREE.Line;
  private blockRing: THREE.Line;
  private terrain: THREE.InstancedMesh;
  private terrainDummy = new THREE.Object3D();
  private blockedXs: THREE.LineSegments;
  private deck: THREE.LineSegments;
  private legs: THREE.LineSegments[] = [];
  private _p = new THREE.Vector3();
  private _n = new THREE.Vector3();
  private _e = new THREE.Vector3();
  private _no = new THREE.Vector3();
  private _pe = new THREE.Vector3();
  private _pn = new THREE.Vector3();
  private _radial = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private maxTerrain: number;

  private matOk = new THREE.LineBasicMaterial({
    color: 0x2dff8c,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  private matBad = new THREE.LineBasicMaterial({
    color: 0xff4466,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  private matWarn = new THREE.LineBasicMaterial({
    color: 0xffcc44,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  private matX = new THREE.LineBasicMaterial({
    color: 0xff3355,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  private matScaf = new THREE.LineBasicMaterial({
    color: 0x88ffcc,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  });

  private terrainGeo: THREE.CircleGeometry;
  private colorAttr: THREE.InstancedBufferAttribute;

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.root);
    this.root.visible = false;
    this.root.renderOrder = 8;

    this.ring = this.makeLoop(48);
    this.link = this.makeLoop(2);
    this.blockRing = this.makeLoop(40);
    this.root.add(this.ring, this.link, this.blockRing);

    // circular footprint of samples: count upper bound still square grid then skip outside
    const steps = Math.floor((TERRAIN_R * 2) / TERRAIN_STEP) + 1;
    this.maxTerrain = steps * steps;

    this.terrainGeo = new THREE.CircleGeometry(0.2, 8);
    this.terrainGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.terrain = new THREE.InstancedMesh(this.terrainGeo, mat, this.maxTerrain);
    this.terrain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(this.maxTerrain * 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    this.terrain.instanceColor = this.colorAttr;
    this.terrain.frustumCulled = false;
    this.terrain.renderOrder = 9;
    this.root.add(this.terrain);

    const xPos = new Float32Array(this.maxTerrain * 4 * 3);
    const xGeo = new THREE.BufferGeometry();
    xGeo.setAttribute("position", new THREE.BufferAttribute(xPos, 3));
    this.blockedXs = new THREE.LineSegments(xGeo, this.matX);
    this.blockedXs.frustumCulled = false;
    this.blockedXs.renderOrder = 10;
    this.root.add(this.blockedXs);

    const deckGeo = new THREE.BoxGeometry(1.55, 0.12, 1.55);
    deckGeo.translate(0, 0.06, 0);
    this.deck = new THREE.LineSegments(new THREE.EdgesGeometry(deckGeo), this.matScaf);
    this.deck.visible = false;
    this.root.add(this.deck);
    deckGeo.dispose();

    const legSrc = new THREE.BoxGeometry(0.1, 1, 0.1);
    legSrc.translate(0, -0.5, 0);
    const legEdges = new THREE.EdgesGeometry(legSrc);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.LineSegments(legEdges.clone(), this.matScaf);
      leg.visible = false;
      this.legs.push(leg);
      this.root.add(leg);
    }
    legSrc.dispose();
  }

  private makeLoop(segs: number): THREE.Line {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((segs + 1) * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geo, this.matOk);
    line.frustumCulled = false;
    return line;
  }

  /**
   * Same map frame as placeOnSurface (radial up + map-east/north).
   * Keeps wash discs coplanar with building pads at any camera angle.
   */
  private sampleFrame(mx: number, my: number) {
    mapToWorld(mx, my, this._p);
    if (this._p.lengthSq() < 1e-12) this._n.set(0, 1, 0);
    else this._n.copy(this._p).normalize();

    const eps = 0.08;
    const mxE = ((mx + eps) % MAP_W + MAP_W) % MAP_W;
    const myN = THREE.MathUtils.clamp(my + eps, 0.5, MAP_H - 0.5);
    mapToWorld(mxE, my, this._pe);
    mapToWorld(mx, myN, this._pn);

    // East tangent (in radial plane)
    this._e.copy(this._pe).sub(this._p);
    this._e.addScaledVector(this._n, -this._e.dot(this._n));
    if (this._e.lengthSq() < 1e-12) {
      this._e.set(0, 1, 0).cross(this._n);
      if (this._e.lengthSq() < 1e-8) this._e.set(1, 0, 0).cross(this._n);
    }
    this._e.normalize();

    // North tangent, orthonormal
    this._no.copy(this._pn).sub(this._p);
    this._no.addScaledVector(this._n, -this._no.dot(this._n));
    if (this._no.lengthSq() < 1e-12) this._no.copy(this._n).cross(this._e);
    this._no.normalize();
    this._no.addScaledVector(this._e, -this._no.dot(this._e));
    if (this._no.lengthSq() < 1e-12) this._no.copy(this._n).cross(this._e);
    this._no.normalize();
    // Right-handed: east × north should match outward radial
    this._radial.copy(this._e).cross(this._no);
    if (this._radial.dot(this._n) < 0) this._no.negate();
  }

  private setLoop(
    line: THREE.Line,
    x: number,
    y: number,
    radius: number,
    segs: number,
    elev: number,
  ) {
    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const need = segs + 1;
    if (attr.count < need) {
      line.geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(need * 3), 3),
      );
    }
    const a = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const ox = Math.cos(ang) * radius;
      const oz = Math.sin(ang) * radius;
      const mx = ((x + ox) % MAP_W + MAP_W) % MAP_W;
      const my = THREE.MathUtils.clamp(y + oz, 0.5, MAP_H - 0.5);
      this.sampleFrame(mx, my);
      this._p.addScaledVector(this._n, elev + 0.16);
      a.setXYZ(i, this._p.x, this._p.y, this._p.z);
    }
    a.needsUpdate = true;
    line.geometry.setDrawRange(0, segs + 1);
    line.geometry.computeBoundingSphere();
  }

  private setSegment(line: THREE.Line, ax: number, ay: number, bx: number, by: number, elev: number) {
    const a = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const put = (i: number, x: number, y: number) => {
      const mx = ((x % MAP_W) + MAP_W) % MAP_W;
      const my = THREE.MathUtils.clamp(y, 0.5, MAP_H - 0.5);
      this.sampleFrame(mx, my);
      this._p.addScaledVector(this._n, elev + 0.22);
      a.setXYZ(i, this._p.x, this._p.y, this._p.z);
    };
    put(0, ax, ay);
    put(1, bx, by);
    for (let i = 2; i < a.count; i++) put(i, bx, by);
    a.needsUpdate = true;
    line.geometry.setDrawRange(0, 2);
    line.geometry.computeBoundingSphere();
  }

  hide() {
    this.root.visible = false;
  }

  sync(state: AssistState | null, snap: SimSnapshot | null) {
    if (!state || !snap) {
      this.hide();
      return;
    }
    this.root.visible = true;
    const { x, y, ok, reason, race } = state;
    this.ring.material = ok ? this.matOk : this.matBad;
    this.matScaf.color.set(ok ? 0x88ffcc : 0xff8899);

    this.setLoop(this.ring, x, y, PLACE_MIN_DIST, 48, 0.05);
    this.ring.visible = true;

    this.syncTerrain(x, y);

    const close =
      reason === "Too close" ||
      reason === "Blocked" ||
      (!ok && reason.toLowerCase().includes("close"));
    let nearest: { x: number; y: number; d: number } | null = null;
    for (const b of snap.buildings) {
      let dx = b.x - x;
      if (dx > MAP_W * 0.5) dx -= MAP_W;
      if (dx < -MAP_W * 0.5) dx += MAP_W;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (!nearest || d < nearest.d) nearest = { x: b.x, y: b.y, d };
    }
    if (nearest && nearest.d < PLACE_MIN_DIST * 2.2) {
      const hot = nearest.d < PLACE_MIN_DIST || close;
      this.blockRing.visible = true;
      this.blockRing.material = hot ? this.matBad : this.matWarn;
      this.setLoop(this.blockRing, nearest.x, nearest.y, 0.85, 40, 0.15);
      if (hot) {
        this.link.visible = true;
        this.link.material = this.matBad;
        this.setSegment(this.link, x, y, nearest.x, nearest.y, 0.25);
      } else {
        this.link.visible = false;
      }
    } else {
      this.blockRing.visible = false;
      this.link.visible = false;
    }

    if (race === "operators") {
      const scaf = scaffoldFootprint(x, y, SCAFFOLD_HALF, 0, 0.1, 0.45);
      this.deck.visible = true;
      placeOnSurface(this.deck, x, y, scaf.deckElev, 0, 0, 0, 1, 1, 1, 0);
      for (let i = 0; i < 4; i++) {
        const c = scaf.corners[i]!;
        const leg = this.legs[i]!;
        leg.visible = true;
        placeOnSurface(leg, x, y, scaf.deckElev, c.ox, 0, c.oz, 1, c.legLen, 1, 0);
      }
    } else {
      this.deck.visible = false;
      for (const leg of this.legs) leg.visible = false;
    }
  }

  private syncTerrain(cx: number, cy: number) {
    let discI = 0;
    let xVert = 0;
    const open = new THREE.Color(0x2dff8c);
    const slow = new THREE.Color(0xe8b84a);
    const xAttr = this.blockedXs.geometry.getAttribute("position") as THREE.BufferAttribute;
    const half = 0.3;
    const r2 = TERRAIN_R * TERRAIN_R;

    for (let dy = -TERRAIN_R; dy <= TERRAIN_R + 1e-6; dy += TERRAIN_STEP) {
      for (let dx = -TERRAIN_R; dx <= TERRAIN_R + 1e-6; dx += TERRAIN_STEP) {
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue; // circular wash

        const x = cx + dx;
        const y = cy + dy;
        const mx = ((x % MAP_W) + MAP_W) % MAP_W;
        const my = THREE.MathUtils.clamp(y, 0.5, MAP_H - 0.5);
        const pass = cellPassAt(mx, my);
        this.sampleFrame(mx, my);

        const dist = Math.sqrt(dist2);
        const fall = 1 - Math.min(1, dist / TERRAIN_R);
        // Extra lift on steep ground (when normal tips away from radial)
        this._radial.copy(this._p);
        let steep = 0;
        if (this._radial.lengthSq() > 1e-12) {
          this._radial.normalize();
          steep = 1 - Math.max(0, this._n.dot(this._radial));
        }
        const lift = WASH_LIFT + steep * 0.45;

        if (pass === CELL_BLOCKED) {
          const s = half * (0.7 + 0.4 * fall);
          const cxw = this._p.x + this._n.x * lift;
          const cyw = this._p.y + this._n.y * lift;
          const czw = this._p.z + this._n.z * lift;
          // diagonals in tangent plane
          const ex = this._e.x * s;
          const ey = this._e.y * s;
          const ez = this._e.z * s;
          const nx = this._no.x * s;
          const ny = this._no.y * s;
          const nz = this._no.z * s;
          if (xVert + 3 < xAttr.count) {
            // \ 
            xAttr.setXYZ(xVert++, cxw - ex - nx, cyw - ey - ny, czw - ez - nz);
            xAttr.setXYZ(xVert++, cxw + ex + nx, cyw + ey + ny, czw + ez + nz);
            // /
            xAttr.setXYZ(xVert++, cxw - ex + nx, cyw - ey + ny, czw - ez + nz);
            xAttr.setXYZ(xVert++, cxw + ex - nx, cyw + ey - ny, czw + ez - nz);
          }
          continue;
        }

        if (discI >= this.maxTerrain) continue;
        // Match placeOnSurface: local X=right (n×east), Y=up (radial), Z=forward (east)
        // CircleGeometry faces +Y after rotateX(-90), so it lies in XZ on the surface.
        this._radial.crossVectors(this._n, this._e).normalize(); // right
        this.terrainDummy.position.set(
          this._p.x + this._n.x * lift,
          this._p.y + this._n.y * lift,
          this._p.z + this._n.z * lift,
        );
        this._m.makeBasis(this._radial, this._n, this._e);
        this._q.setFromRotationMatrix(this._m);
        this.terrainDummy.quaternion.copy(this._q);
        const sc = 0.5 + 0.55 * fall;
        this.terrainDummy.scale.set(sc, sc, sc);
        this.terrainDummy.updateMatrix();
        this.terrain.setMatrixAt(discI, this.terrainDummy.matrix);
        this.terrain.setColorAt(discI, pass === CELL_SLOW ? slow : open);
        discI++;
      }
    }

    this.terrainDummy.scale.set(0, 0, 0);
    this.terrainDummy.updateMatrix();
    for (let i = discI; i < this.maxTerrain; i++) {
      this.terrain.setMatrixAt(i, this.terrainDummy.matrix);
    }
    this.terrain.instanceMatrix.needsUpdate = true;
    if (this.terrain.instanceColor) this.terrain.instanceColor.needsUpdate = true;
    this.terrain.count = this.maxTerrain;
    this.terrain.visible = true;

    for (let i = xVert; i < xAttr.count; i++) xAttr.setXYZ(i, 0, 0, 0);
    xAttr.needsUpdate = true;
    this.blockedXs.geometry.setDrawRange(0, xVert);
    this.blockedXs.geometry.computeBoundingSphere();
    this.blockedXs.visible = xVert > 0;
  }

  dispose() {
    this.scene.remove(this.root);
    this.ring.geometry.dispose();
    this.link.geometry.dispose();
    this.blockRing.geometry.dispose();
    this.terrainGeo.dispose();
    (this.terrain.material as THREE.Material).dispose();
    this.blockedXs.geometry.dispose();
    this.deck.geometry.dispose();
    for (const leg of this.legs) leg.geometry.dispose();
    this.matOk.dispose();
    this.matBad.dispose();
    this.matWarn.dispose();
    this.matX.dispose();
    this.matScaf.dispose();
  }
}
