import * as THREE from "three";
import { MAP_H, MAP_W, RACES, UNITS } from "../sim/defs";
import type { SimSnapshot } from "../sim/types";
import { mapToWorld, placeOnSurface } from "./planetMath";

export type OpsDrawHost = {
  entityRoot: THREE.Group;
  projectileRoot?: THREE.Group;
  t?: number;
};

const _ringPool: THREE.Group[] = [];
const _linkPool: THREE.Line[] = [];
const _matCache = new Map<string, THREE.LineBasicMaterial>();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

const LINK_SEGS = 18;

function mat(color: number, opacity = 0.85) {
  const k = `${color.toString(16)}_${opacity}`;
  let m = _matCache.get(k);
  if (!m) {
    m = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    _matCache.set(k, m);
  }
  return m;
}

function acquireRing(color: number): THREE.Group {
  let g = _ringPool.pop();
  if (!g) {
    g = new THREE.Group();
    const ring = new THREE.RingGeometry(0.7, 1.0, 24);
    ring.rotateX(-Math.PI / 2);
    const edge = new THREE.EdgesGeometry(ring, 12);
    const line = new THREE.LineSegments(edge, mat(color));
    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    g.add(line, pip);
    g.userData.pool = "op-radio";
  } else {
    const line = g.children[0] as THREE.LineSegments;
    line.material = mat(color);
    const pip = g.children[1] as THREE.Mesh;
    (pip.material as THREE.MeshBasicMaterial).color.set(color);
  }
  g.visible = true;
  return g;
}

function acquireLink(color: number): THREE.Line {
  let line = _linkPool.pop();
  if (!line) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((LINK_SEGS + 1) * 3), 3),
    );
    line = new THREE.Line(geo, mat(color, 0.7));
    line.frustumCulled = false;
    line.userData.pool = "op-link";
  } else {
    line.material = mat(color, 0.7);
  }
  line.visible = true;
  return line;
}

/**
 * Surface-hugging tether: lerp in map space (with X wrap), then mapToWorld.
 * Avoids world-space chords that cut through the globe.
 */
function setLinkSurface(
  line: THREE.Line,
  ux: number,
  uy: number,
  ox: number,
  oy: number,
  unitElev: number,
  opElev: number,
  tSec: number,
  seed: number,
) {
  let dx = ox - ux;
  if (dx > MAP_W / 2) dx -= MAP_W;
  if (dx < -MAP_W / 2) dx += MAP_W;
  const dy = oy - uy;

  const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  const n = pos.count;
  const bob = 0.06 * Math.sin(tSec * 7 + seed);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let mx = ux + dx * t;
    mx = ((mx % MAP_W) + MAP_W) % MAP_W;
    const my = Math.max(0.4, Math.min(MAP_H - 0.4, uy + dy * t));
    // slight mid-path lift along surface normal (local elev blend)
    const elev = unitElev + (opElev - unitElev) * t + Math.sin(t * Math.PI) * (0.22 + bob);
    mapToWorld(mx, my, _c);
    _n.copy(_c).normalize();
    _c.addScaledVector(_n, elev);
    pos.setXYZ(i, _c.x, _c.y, _c.z);
  }
  pos.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

/**
 * Active ops: radio marks + surface tethers to assigned units.
 * FOW-agnostic (intel only).
 */
export function syncOps(host: OpsDrawHost, snap: SimSnapshot, tSec: number) {
  const root = host.entityRoot;
  for (const op of snap.ops ?? []) {
    const tint = RACES[snap.players[op.owner]?.race ?? "operators"]?.tint ?? "#66ddff";
    const color = new THREE.Color(tint).getHex();
    const g = acquireRing(color);
    const pulse = 1 + 0.08 * Math.sin(tSec * 6 + op.id);
    const sc = op.radius * 1.2 * pulse;
    placeOnSurface(g, op.x, op.y, 0.4, 0, 0, 0, sc, 1, sc, tSec * 0.4 + op.id);
    root.add(g);

    if (op.assigneeId == null) continue;
    const u = snap.units.find((x) => x.id === op.assigneeId && x.hp > 0);
    if (!u) continue;

    const air = UNITS[u.kind]?.air ? 1.45 : 0.5;
    const link = acquireLink(color);
    (link.material as THREE.LineBasicMaterial).opacity =
      0.5 + 0.28 * (0.5 + 0.5 * Math.sin(tSec * 9 + op.id));
    setLinkSurface(link, u.x, u.y, op.x, op.y, air, 0.5, tSec, op.id);
    root.add(link);
  }
}

export function recycleOpNode(c: THREE.Object3D): boolean {
  const tag = c.userData?.pool;
  if (tag === "op-radio") {
    c.visible = false;
    if (c.parent) c.parent.remove(c);
    _ringPool.push(c as THREE.Group);
    return true;
  }
  if (tag === "op-link") {
    c.visible = false;
    if (c.parent) c.parent.remove(c);
    _linkPool.push(c as THREE.Line);
    return true;
  }
  return false;
}
