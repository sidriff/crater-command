import * as THREE from "three";
import { GLOBE_RADIUS, MAP_H, MAP_W } from "../sim/defs";
import { CELL_BLOCKED, dirToMap, getPassability, strategicBiasMap } from "../sim/terrain";

export const HEIGHT_AMP = 0.135;
/** Same quanta as planet mesh verts — entities must sit on what you see. */
export const HEIGHT_QUANT = HEIGHT_AMP * 0.006;
export const DIST_MIN = 14;
export const DIST_MAX = GLOBE_RADIUS * 5.2;
/** Default camera distance from surface focus (~3× prior 0.72R). */
export const DEFAULT_DIST = GLOBE_RADIUS * 2.16;
export const EL_MIN = THREE.MathUtils.degToRad(8);
export const EL_MAX = THREE.MathUtils.degToRad(82);
export const ORBIT_SENS = 0.012;
/** Pan scale vs screen height — higher = more travel per finger pixel. */
export const PAN_SCROLL = 0.78;
/** Exponential friction for swipe momentum (1/s). */
export const PAN_FRICTION = 4.2;
/** Clamp world-space pan speed after fling. */
export const PAN_MOM_MAX = 48;

export const UNIT_SMOOTH = 14;

/**
 * Surface profile for globe mesh + entity placement.
 * - `match`: crater bowls, noise height, strategic bias (live game).
 * - `flat`: constant radius sphere, no height — labs / readability baseline.
 */
export type SurfaceProfile = "match" | "flat";

let _surfaceProfile: SurfaceProfile = "match";

export function getSurfaceProfile(): SurfaceProfile {
  return _surfaceProfile;
}

/** Affects terrainHeight / mapToWorld / placeOnSurface. Call before warming geometry. */
export function setSurfaceProfile(profile: SurfaceProfile) {
  _surfaceProfile = profile;
}

function hash3(x: number, y: number, z: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise3(px: number, py: number, pz: number) {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fy = py - iy;
  const fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);
  const nx00 = n000 * (1 - ux) + n100 * ux;
  const nx10 = n010 * (1 - ux) + n110 * ux;
  const nx01 = n001 * (1 - ux) + n101 * ux;
  const nx11 = n011 * (1 - ux) + n111 * ux;
  const nxy0 = nx00 * (1 - uy) + nx10 * uy;
  const nxy1 = nx01 * (1 - uy) + nx11 * uy;
  return nxy0 * (1 - uz) + nxy1 * uz;
}

export function terrainHeight(nx: number, ny: number, nz: number): number {
  // Flat profile: perfect sphere — entities and mesh share constant radius.
  if (_surfaceProfile === "flat") return 0;
  let h = 0;
  h += (noise3(nx * 1.05, ny * 1.05, nz * 1.05) * 2 - 1) * 0.05;
  h += (noise3(nx * 2.0 + 1.3, ny * 2.0, nz * 2.0) * 2 - 1) * 0.02;
  const map = dirToMap(nx, ny, nz);
  const strat = strategicBiasMap(map.x, map.y);
  h += strat * 1.65;
  const raw = h * HEIGHT_AMP;
  // Snap to mesh quanta so units/scaffolds don't float above faceted rock
  return Math.round(raw / HEIGHT_QUANT) * HEIGHT_QUANT;
}

export function surfaceRadiusAlong(dir: THREE.Vector3) {
  const n = dir.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : dir.clone().normalize();
  return GLOBE_RADIUS * (1 + terrainHeight(n.x, n.y, n.z));
}

export function projectToSurface(world: THREE.Vector3, out: THREE.Vector3) {
  if (world.lengthSq() < 1e-12) out.set(0, 1, 0);
  else out.copy(world).normalize();
  return out.multiplyScalar(surfaceRadiusAlong(out));
}

export function dirFromMap(x: number, y: number, out: THREE.Vector3) {
  const lon = (x / MAP_W) * Math.PI * 2;
  const lat = (y / MAP_H - 0.5) * Math.PI * 0.92;
  const cl = Math.cos(lat);
  return out.set(cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)).normalize();
}

export function mapToWorld(x: number, y: number, out: THREE.Vector3) {
  dirFromMap(x, y, out);
  return out.multiplyScalar(surfaceRadiusAlong(out));
}

export function smoothToward(cur: { x: number; y: number }, tx: number, ty: number, k: number) {
  let dx = tx - cur.x;
  if (dx > MAP_W * 0.5) dx -= MAP_W;
  if (dx < -MAP_W * 0.5) dx += MAP_W;
  cur.x = (cur.x + dx * k + MAP_W) % MAP_W;
  cur.y += (ty - cur.y) * k;
}

const PLANET_DETAIL = 10;
const PLANET_MESH_REV = 4;
let _globeGeo: THREE.BufferGeometry | null = null;
let _globePromise: Promise<THREE.BufferGeometry> | null = null;
let _globeRev = -1;

function yieldMain() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function colorPlanetVertex(
  a: THREE.Vector3,
  tmp: THREE.Color,
  deep: THREE.Color,
  low: THREE.Color,
  mid: THREE.Color,
  high: THREE.Color,
  ridge: THREE.Color,
  craterFloor: THREE.Color,
  ridgeRock: THREE.Color,
  passSand: THREE.Color,
  pass: Uint8Array,
  q: number,
): { h: number; cr: number; cg: number; cb: number; u: number; v: number } {
  const h = terrainHeight(a.x, a.y, a.z);
  const snapped = Math.round(h / q) * q;
  const t = (snapped / HEIGHT_AMP + 1) * 0.5;
  if (t < 0.22) tmp.copy(craterFloor).lerp(deep, t / 0.22);
  else if (t < 0.4) tmp.copy(deep).lerp(low, (t - 0.22) / 0.18);
  else if (t < 0.62) tmp.copy(low).lerp(mid, (t - 0.4) / 0.22);
  else if (t < 0.82) tmp.copy(mid).lerp(high, (t - 0.62) / 0.2);
  else tmp.copy(high).lerp(ridge, (t - 0.82) / 0.18);

  const map = dirToMap(a.x, a.y, a.z);
  const cx = ((Math.floor(map.x) % MAP_W) + MAP_W) % MAP_W;
  const cy = Math.max(0, Math.min(MAP_H - 1, Math.floor(map.y)));
  const cell = pass[cy * MAP_W + cx] ?? 0;
  if (cell === CELL_BLOCKED) tmp.lerp(ridgeRock, 0.55);
  else if (cell === 1) tmp.lerp(passSand, 0.35);
  else {
    const bias = strategicBiasMap(map.x, map.y);
    if (bias < -0.15) tmp.lerp(craterFloor, 0.35);
  }
  const faceHash = hash3(a.x * 2.1, a.y * 2.1, a.z * 2.1);
  tmp.offsetHSL(0, 0, (faceHash - 0.5) * 0.025);
  return {
    h: snapped,
    cr: tmp.r,
    cg: tmp.g,
    cb: tmp.b,
    u: map.x / MAP_W,
    v: THREE.MathUtils.clamp(map.y / MAP_H, 0, 1),
  };
}

async function buildPolyGlobeGeometry(): Promise<THREE.BufferGeometry> {
  await yieldMain();
  const geo = new THREE.IcosahedronGeometry(GLOBE_RADIUS, PLANET_DETAIL);
  await yieldMain();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  const deep = new THREE.Color("#243040");
  const low = new THREE.Color("#384a5c");
  const mid = new THREE.Color("#4d6274");
  const high = new THREE.Color("#6a7e90");
  const ridge = new THREE.Color("#8496a6");
  const craterFloor = new THREE.Color("#1c2632");
  const ridgeRock = new THREE.Color("#3a4555");
  const passSand = new THREE.Color("#4a5a48");
  const tmp = new THREE.Color();
  const a = new THREE.Vector3();
  const q = HEIGHT_QUANT;
  const pass = getPassability();
  const BATCH = 2500;

  for (let i = 0; i < pos.count; i++) {
    a.fromBufferAttribute(pos, i).normalize();
    const v = colorPlanetVertex(
      a, tmp, deep, low, mid, high, ridge, craterFloor, ridgeRock, passSand, pass, q,
    );
    pos.setXYZ(
      i,
      a.x * GLOBE_RADIUS * (1 + v.h),
      a.y * GLOBE_RADIUS * (1 + v.h),
      a.z * GLOBE_RADIUS * (1 + v.h),
    );
    uvs[i * 2] = v.u;
    uvs[i * 2 + 1] = v.v;
    colors[i * 3] = v.cr;
    colors[i * 3 + 1] = v.cg;
    colors[i * 3 + 2] = v.cb;
    if (i > 0 && i % BATCH === 0) await yieldMain();
  }

  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  await yieldMain();
  await yieldMain();
  geo.computeVertexNormals();
  await yieldMain();
  return geo;
}

/** Smooth sphere: no height displacement, no crater/pass coloring. FOW UVs still map. */
async function buildFlatGlobeGeometry(): Promise<THREE.BufferGeometry> {
  await yieldMain();
  const geo = new THREE.IcosahedronGeometry(GLOBE_RADIUS, PLANET_DETAIL);
  await yieldMain();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  const base = new THREE.Color("#3a4a5c");
  const tmp = new THREE.Color();
  const a = new THREE.Vector3();
  const BATCH = 2500;

  for (let i = 0; i < pos.count; i++) {
    a.fromBufferAttribute(pos, i).normalize();
    pos.setXYZ(i, a.x * GLOBE_RADIUS, a.y * GLOBE_RADIUS, a.z * GLOBE_RADIUS);
    const map = dirToMap(a.x, a.y, a.z);
    uvs[i * 2] = map.x / MAP_W;
    uvs[i * 2 + 1] = THREE.MathUtils.clamp(map.y / MAP_H, 0, 1);
    // Subtle face grain only — no strategic crater paint
    const faceHash = hash3(a.x * 2.1, a.y * 2.1, a.z * 2.1);
    tmp.copy(base).offsetHSL(0, 0, (faceHash - 0.5) * 0.04);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
    if (i > 0 && i % BATCH === 0) await yieldMain();
  }

  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  await yieldMain();
  geo.computeVertexNormals();
  await yieldMain();
  return geo;
}

const PLANET_FLAT_MESH_REV = 1;
let _flatGlobeGeo: THREE.BufferGeometry | null = null;
let _flatGlobePromise: Promise<THREE.BufferGeometry> | null = null;
let _flatGlobeRev = -1;

export type WarmPlanetOpts = {
  /** No craters / height — constant-radius lab sphere */
  flat?: boolean;
};

export function warmPlanetGeometry(opts?: WarmPlanetOpts): Promise<THREE.BufferGeometry> {
  if (opts?.flat) {
    if (_flatGlobeGeo && _flatGlobeRev === PLANET_FLAT_MESH_REV) {
      return Promise.resolve(_flatGlobeGeo);
    }
    if (_flatGlobePromise && _flatGlobeRev === PLANET_FLAT_MESH_REV) {
      return _flatGlobePromise;
    }
    if (_flatGlobeGeo && _flatGlobeRev !== PLANET_FLAT_MESH_REV) {
      _flatGlobeGeo.dispose();
      _flatGlobeGeo = null;
    }
    _flatGlobeRev = PLANET_FLAT_MESH_REV;
    _flatGlobePromise = buildFlatGlobeGeometry()
      .then((g) => {
        _flatGlobeGeo = g;
        return g;
      })
      .catch((err) => {
        _flatGlobePromise = null;
        _flatGlobeRev = -1;
        throw err;
      });
    return _flatGlobePromise;
  }

  if (_globeGeo && _globeRev === PLANET_MESH_REV) return Promise.resolve(_globeGeo);
  if (_globePromise && _globeRev === PLANET_MESH_REV) return _globePromise;
  if (_globeGeo && _globeRev !== PLANET_MESH_REV) {
    _globeGeo.dispose();
    _globeGeo = null;
  }
  _globeRev = PLANET_MESH_REV;
  _globePromise = buildPolyGlobeGeometry()
    .then((g) => {
      _globeGeo = g;
      return g;
    })
    .catch((err) => {
      _globePromise = null;
      _globeRev = -1;
      throw err;
    });
  return _globePromise;
}

export function isPlanetGeometryReady(opts?: WarmPlanetOpts) {
  if (opts?.flat) {
    return _flatGlobeGeo != null && _flatGlobeRev === PLANET_FLAT_MESH_REV;
  }
  return _globeGeo != null && _globeRev === PLANET_MESH_REV;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _no = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _pe = new THREE.Vector3();
const _pn = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Place mesh on surface. Offsets: (map-east, radial-up, map-north).
 * Upright is radial (planet center), not slope-tilted.
 * Yaw is map-space: 0 = +map-X (east), π/2 = +map-Y (north). Model +Z is forward.
 * Optional bank (roll about forward) and pitch (nose about right) in radians.
 */
export function placeOnSurface(
  mesh: THREE.Object3D,
  x: number,
  y: number,
  elev: number,
  ox = 0,
  oy = 0,
  oz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  yaw = 0,
  bank = 0,
  pitch = 0,
) {
  mapToWorld(x, y, _p);
  if (_p.lengthSq() < 1e-12) _n.set(0, 1, 0);
  else _n.copy(_p).normalize();

  const eps = 0.08;
  mapToWorld(x + eps, y, _pe);
  mapToWorld(x, y + eps, _pn);
  _e.copy(_pe).sub(_p);
  _e.addScaledVector(_n, -_e.dot(_n));
  if (_e.lengthSq() < 1e-12) {
    _e.set(0, 1, 0).cross(_n);
    if (_e.lengthSq() < 1e-8) _e.set(1, 0, 0).cross(_n);
  }
  _e.normalize();
  _no.copy(_pn).sub(_p);
  _no.addScaledVector(_n, -_no.dot(_n));
  if (_no.lengthSq() < 1e-12) _no.copy(_n).cross(_e);
  _no.normalize();
  _no.addScaledVector(_e, -_no.dot(_e));
  if (_no.lengthSq() < 1e-12) _no.copy(_n).cross(_e);
  _no.normalize();
  _r.copy(_e).cross(_no);
  if (_r.dot(_n) < 0) _no.negate();

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  _f.copy(_e).multiplyScalar(c).addScaledVector(_no, s);
  if (_f.lengthSq() < 1e-12) _f.copy(_e);
  else _f.normalize();
  _r.copy(_n).cross(_f);
  if (_r.lengthSq() < 1e-12) _r.copy(_e);
  else _r.normalize();
  _f.copy(_r).cross(_n).normalize();

  // Optional pitch (about right) then bank (about forward) for hops / drift lean
  if (pitch !== 0 || bank !== 0) {
    if (pitch !== 0) {
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // nose-up: forward tilts toward radial up
      const fx = _f.x * cp + _n.x * sp;
      const fy = _f.y * cp + _n.y * sp;
      const fz = _f.z * cp + _n.z * sp;
      _n.set(_n.x * cp - _f.x * sp, _n.y * cp - _f.y * sp, _n.z * cp - _f.z * sp).normalize();
      _f.set(fx, fy, fz).normalize();
      _r.copy(_n).cross(_f).normalize();
    }
    if (bank !== 0) {
      const cb = Math.cos(bank);
      const sb = Math.sin(bank);
      const rx = _r.x * cb + _n.x * sb;
      const ry = _r.y * cb + _n.y * sb;
      const rz = _r.z * cb + _n.z * sb;
      _n.set(_n.x * cb - _r.x * sb, _n.y * cb - _r.y * sb, _n.z * cb - _r.z * sb).normalize();
      _r.set(rx, ry, rz).normalize();
      _f.copy(_r).cross(_n).normalize();
    }
  }

  _m.makeBasis(_r, _n, _f);
  mesh.quaternion.setFromRotationMatrix(_m);
  mesh.position
    .copy(_p)
    .addScaledVector(_n, elev + oy)
    .addScaledVector(_e, ox)
    .addScaledVector(_no, oz);
  mesh.scale.set(sx, sy, sz);
}

/**
 * Sample center + 4 footprint corners; return elev so the body clears the
 * tallest nearby terrain (relative to center radius) plus a base pad.
 * `slope` is rMax - rMin — useful for ramp hops.
 */
export function footprintClearanceElev(
  x: number,
  y: number,
  halfX: number,
  halfY: number,
  baseElev: number,
): { elev: number; slope: number; r0: number } {
  mapToWorld(x, y, _p);
  const r0 = Math.max(1e-6, _p.length());
  let rMax = r0;
  let rMin = r0;
  const pts: [number, number][] = [
    [x + halfX, y + halfY],
    [x + halfX, y - halfY],
    [x - halfX, y + halfY],
    [x - halfX, y - halfY],
  ];
  for (const [sx, sy] of pts) {
    const mx = ((sx % MAP_W) + MAP_W) % MAP_W;
    const my = THREE.MathUtils.clamp(sy, 0.5, MAP_H - 0.5);
    mapToWorld(mx, my, _pe);
    const r = _pe.length();
    if (r > rMax) rMax = r;
    if (r < rMin) rMin = r;
  }
  // Cap lift — one high corner on a rim shouldn't levitate the whole unit
  const lift = Math.min(0.28, Math.max(0, rMax - r0));
  return { elev: baseElev + lift, slope: rMax - rMin, r0 };
}

/**
 * Ops scaffold: square deck sits on the *highest* footprint sample;
 * legs run from deck down into lower ground (with embed).
 * Local lx/lz are body-right / body-forward (yaw-aligned).
 */
export function scaffoldFootprint(
  x: number,
  y: number,
  half: number,
  yaw: number,
  deckClear = 0.06,
  legEmbed = 0.35,
): {
  /** Radial elev of deck underside above center surface */
  deckElev: number;
  slope: number;
  corners: { ox: number; oz: number; legLen: number }[];
} {
  mapToWorld(x, y, _p);
  const r0 = Math.max(1e-6, _p.length());
  const ce = Math.cos(yaw);
  const se = Math.sin(yaw);
  // body right (east,north) and forward (east,north)
  const re = se;
  const rn = -ce;
  const fe = ce;
  const fn = se;

  // Sample slightly inset so a rim cell doesn't yank the pad into the sky
  const sampleHalf = half * 0.82;
  const cornerSigns: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  let rMax = r0;
  let rMin = r0;
  const samples: { ox: number; oz: number; rel: number }[] = [];
  for (const [sx, sz] of cornerSigns) {
    const oxS = re * sampleHalf * sx + fe * sampleHalf * sz;
    const ozS = rn * sampleHalf * sx + fn * sampleHalf * sz;
    const mx = ((x + oxS) % MAP_W + MAP_W) % MAP_W;
    const my = THREE.MathUtils.clamp(y + ozS, 0.5, MAP_H - 0.5);
    mapToWorld(mx, my, _pe);
    const r = _pe.length();
    if (r > rMax) rMax = r;
    if (r < rMin) rMin = r;
    const ox = re * half * sx + fe * half * sz;
    const oz = rn * half * sx + fn * half * sz;
    samples.push({ ox, oz, rel: r - r0 });
  }

  const lift = Math.min(0.45, Math.max(0, rMax - r0));
  const deckElev = lift + deckClear;
  const corners = samples.map((s) => ({
    ox: s.ox,
    oz: s.oz,
    legLen: Math.max(0.2, deckElev - s.rel + legEmbed),
  }));
  return { deckElev, slope: rMax - rMin, corners };
}

function flatHex(r: number) {
  const g = new THREE.CircleGeometry(r, 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

function flatRing(inner: number, outer: number, seg = 16) {
  const g = new THREE.RingGeometry(inner, outer, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function mergeParts(
  parts: {
    geo: THREE.BufferGeometry;
    x?: number;
    y?: number;
    z?: number;
    sx?: number;
    sy?: number;
    sz?: number;
    rx?: number;
    ry?: number;
    rz?: number;
  }[],
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    geos.push(materializePart(p));
  }
  return mergeGeos(geos, true);
}

export type PartSpec = {
  geo: THREE.BufferGeometry;
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
};

/** Apply local transform; returns a new BufferGeometry. */
export function materializePart(p: PartSpec): THREE.BufferGeometry {
  const g = p.geo.clone();
  g.rotateX(p.rx ?? 0);
  g.rotateY(p.ry ?? 0);
  g.rotateZ(p.rz ?? 0);
  g.scale(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  return g;
}

/** Merge already-transformed geos. If disposeParts, disposes inputs after merge. */
export function mergeGeos(geos: THREE.BufferGeometry[], disposeParts = false): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  let vBase = 0;
  for (const g of geos) {
    const a = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      pos[vo++] = a.getX(i);
      pos[vo++] = a.getY(i);
      pos[vo++] = a.getZ(i);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vBase;
    } else {
      for (let i = 0; i < a.count; i++) idx[io++] = vBase + i;
    }
    vBase += a.count;
    if (disposeParts) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

/** Solid + per-part geo/edges for CRT assembly resolve. */
export type BuildingPartKit = {
  solid: THREE.BufferGeometry;
  parts: THREE.BufferGeometry[];
  edges: THREE.BufferGeometry[];
};

export function kitFromSpecs(specs: PartSpec[], crease = 18): BuildingPartKit {
  const parts = specs.map(materializePart);
  const solid = mergeGeos(
    parts.map((g) => g.clone()),
    true,
  );
  const edges = parts.map((g) => new THREE.EdgesGeometry(g, crease));
  return { solid, parts, edges };
}

export function makeUnitGeos() {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, s = 6) =>
    new THREE.CylinderGeometry(rt, rb, h, s);
  const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);
  const sph = (r: number) => new THREE.SphereGeometry(r, 6, 5);
  const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);

  const worker = mergeParts([
    { geo: box(0.55, 0.55, 0.4), y: 0.85 },
    { geo: box(0.38, 0.32, 0.32), y: 1.3 },
    { geo: box(0.14, 0.45, 0.14), x: -0.18, y: 0.35 },
    { geo: box(0.14, 0.45, 0.14), x: 0.18, y: 0.35 },
    { geo: box(0.12, 0.4, 0.12), x: -0.4, y: 0.95, rz: 0.3 },
    { geo: box(0.12, 0.4, 0.12), x: 0.4, y: 0.95, rz: -0.3 },
    { geo: box(0.22, 0.1, 0.18), y: 0.12, x: -0.18 },
    { geo: box(0.22, 0.1, 0.18), y: 0.12, x: 0.18 },
  ]);

  // Operators worker — body (no turret) + separate turret for tracking
  const wheel = () => cyl(0.18, 0.18, 0.12, 8);
  const workerOps = mergeParts([
    { geo: box(0.95, 0.1, 0.95), y: 0.36 },
    { geo: box(0.62, 0.12, 0.62), y: 0.24 },
    { geo: box(0.95, 0.06, 0.08), y: 0.2, z: 0.34 },
    { geo: box(0.95, 0.06, 0.08), y: 0.2, z: -0.34 },
    { geo: box(0.07, 0.18, 0.07), x: 0.38, y: 0.26, z: 0.38 },
    { geo: box(0.07, 0.18, 0.07), x: -0.38, y: 0.26, z: 0.38 },
    { geo: box(0.07, 0.18, 0.07), x: 0.38, y: 0.26, z: -0.38 },
    { geo: box(0.07, 0.18, 0.07), x: -0.38, y: 0.26, z: -0.38 },
    { geo: wheel(), x: 0.46, y: 0.18, z: 0.38, rz: Math.PI / 2 },
    { geo: wheel(), x: -0.46, y: 0.18, z: 0.38, rz: Math.PI / 2 },
    { geo: wheel(), x: 0.46, y: 0.18, z: -0.38, rz: Math.PI / 2 },
    { geo: wheel(), x: -0.46, y: 0.18, z: -0.38, rz: Math.PI / 2 },
    { geo: cyl(0.34, 0.36, 0.08, 8), y: 0.44 },
    { geo: ico(0.32, 0), y: 0.7 },
    { geo: cyl(0.12, 0.14, 0.1, 6), y: 0.98 },
    // antenna stays on body
    { geo: box(0.035, 0.22, 0.035), x: -0.14, y: 1.1, z: -0.1 },
  ]);

  // Turret pivots at (0, 1.02, 0); barrel points +Z. Geometry is relative to pivot.
  const workerOpsTurret = mergeParts([
    { geo: box(0.18, 0.08, 0.18), y: 0.04 },
    { geo: box(0.07, 0.07, 0.42), y: 0.0, z: 0.26 },
    { geo: cyl(0.05, 0.07, 0.08, 5), y: 0.0, z: 0.48, rx: Math.PI / 2 },
  ]);

  const raider = mergeParts([
    { geo: box(0.7, 0.35, 1.1), y: 0.45 },
    { geo: cone(0.35, 0.7, 4), y: 0.5, z: 0.55, rx: Math.PI / 2 },
    { geo: box(0.15, 0.25, 0.5), x: -0.5, y: 0.4 },
    { geo: box(0.15, 0.25, 0.5), x: 0.5, y: 0.4 },
    { geo: cyl(0.12, 0.18, 0.25, 5), y: 0.75 },
    { geo: box(0.2, 0.12, 0.35), y: 0.25, z: -0.45 },
  ]);

  const tank = mergeParts([
    { geo: box(1.15, 0.35, 0.85), y: 0.4 },
    { geo: box(1.25, 0.22, 0.28), y: 0.22, z: 0.4 },
    { geo: box(1.25, 0.22, 0.28), y: 0.22, z: -0.4 },
    { geo: cyl(0.32, 0.35, 0.28, 6), y: 0.72 },
    { geo: box(0.14, 0.14, 0.7), y: 0.75, z: 0.55 },
    { geo: box(0.25, 0.15, 0.2), y: 0.95 },
  ]);

  const flyer = mergeParts([
    { geo: box(0.35, 0.25, 0.9), y: 0.3 },
    { geo: box(1.4, 0.08, 0.4), y: 0.28 },
    { geo: cone(0.22, 0.45, 4), y: 0.3, z: 0.55, rx: Math.PI / 2 },
    { geo: box(0.12, 0.35, 0.25), y: 0.45, z: -0.35 },
    { geo: box(0.5, 0.06, 0.18), y: 0.55, z: -0.35 },
  ]);

  // Drone (Ops scout) — vacuum/low-g recon drone. No rotors: nothing to bite
  // in a hard vacuum. Station-keeps on canted cold-gas/RCS thruster bells,
  // compact octagonal chassis, forward sensor-eye on a gimbal collar as the
  // primary top-down ID mark, short perch skids for regolith touchdown.
  const rcsBell = () => cone(0.085, 0.15, 6);
  const scout = mergeParts([
    { geo: cyl(0.22, 0.25, 0.14, 8), y: 0.5 },
    // forward sensor-eye, gimbal collar
    { geo: cyl(0.09, 0.09, 0.05, 8), y: 0.52, z: 0.22 },
    { geo: sph(0.1), y: 0.56, z: 0.28 },
    // cross struts to the four RCS corners — short, not blade-length
    { geo: box(0.62, 0.05, 0.06), y: 0.48 },
    { geo: box(0.06, 0.05, 0.62), y: 0.48 },
    // four canted RCS thruster bells, nozzle apex down + outward
    { geo: rcsBell(), x: 0.31, y: 0.4, z: 0.31, rz: 0.4, rx: -0.4 },
    { geo: rcsBell(), x: -0.31, y: 0.4, z: 0.31, rz: -0.4, rx: -0.4 },
    { geo: rcsBell(), x: 0.31, y: 0.4, z: -0.31, rz: 0.4, rx: 0.4 },
    { geo: rcsBell(), x: -0.31, y: 0.4, z: -0.31, rz: -0.4, rx: 0.4 },
    // ventral perch skids (hop-and-settle, not rolling gear)
    { geo: box(0.05, 0.16, 0.05), x: 0.18, y: 0.34 },
    { geo: box(0.05, 0.16, 0.05), x: -0.18, y: 0.34 },
    // off-axis comms whip
    { geo: box(0.02, 0.22, 0.02), x: -0.12, y: 0.66, z: -0.06 },
  ]);

  const pip = sph(0.14);
  return { worker, workerOps, workerOpsTurret, raider, tank, flyer, scout, pip, box: box(1, 1, 1) };
}

/** Local (model) position of Ops rover turret pivot / beam tip (unscaled mesh units). */
export const ROVER_TURRET_PIVOT = { x: 0, y: 1.02, z: 0 };
export const ROVER_TURRET_TIP = { x: 0, y: 1.02, z: 0.52 };

export function makeBuildingGeos() {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, s = 6) =>
    new THREE.CylinderGeometry(rt, rb, h, s);
  const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);

  const pad = flatHex(0.95);
  const padLg = flatHex(1.25);
  // Ops square scaffold deck (thin plate) + unit-height leg (scaled per corner)
  const scaffoldDeck = new THREE.BoxGeometry(1.55, 0.12, 1.55);
  scaffoldDeck.translate(0, 0.06, 0); // top of deck at y=0.12
  const scaffoldLeg = new THREE.BoxGeometry(0.1, 1, 0.1);
  // pivot at top of leg so scale.y grows downward when we place carefully
  scaffoldLeg.translate(0, -0.5, 0);
  const ring = flatRing(0.55, 0.82, 6);
  const marker = flatRing(0.38, 0.58, 6);

  const coreStation = mergeParts([
    { geo: cyl(0.55, 0.7, 0.4, 6), y: 0.25 },
    { geo: cyl(0.38, 0.45, 2.2, 6), y: 1.5 },
    { geo: new THREE.TorusGeometry(1.35, 0.14, 5, 18), y: 2.0, rx: Math.PI / 2 },
    { geo: box(0.75, 0.1, 0.4), x: 0.95, y: 2.0 },
    { geo: box(0.75, 0.1, 0.4), x: -0.95, y: 2.0 },
    { geo: box(0.4, 0.1, 0.75), z: 0.95, y: 2.0 },
    { geo: box(0.4, 0.1, 0.75), z: -0.95, y: 2.0 },
    { geo: box(0.1, 1.1, 0.65), x: 1.55, y: 2.0 },
    { geo: box(0.1, 1.1, 0.65), x: -1.55, y: 2.0 },
    { geo: cyl(0.28, 0.35, 0.7, 5), y: 3.0 },
    { geo: box(0.55, 0.2, 0.55), y: 3.5 },
  ]);

  const hexOrb = (r: number) => new THREE.IcosahedronGeometry(r, 0);
  const coreHive = mergeParts([
    { geo: hexOrb(1.15), y: 1.0 },
    { geo: hexOrb(0.95), y: 2.15 },
    { geo: hexOrb(0.78), y: 3.15 },
    { geo: hexOrb(0.58), y: 3.95 },
    { geo: hexOrb(0.4), y: 4.55 },
    { geo: hexOrb(0.42), x: 0.95, y: 1.55, z: 0.35 },
    { geo: hexOrb(0.38), x: -0.85, y: 2.0, z: -0.4 },
    { geo: hexOrb(0.32), x: 0.55, y: 2.85, z: -0.55 },
    { geo: cone(0.14, 0.85, 5), x: 0.4, y: 4.9, z: 0.15 },
    { geo: cone(0.12, 0.7, 5), x: -0.35, y: 4.75, z: -0.2 },
  ]);

  const coreRocket = mergeParts([
    { geo: cyl(0.7, 0.85, 0.35, 6), y: 0.2 },
    { geo: cyl(0.5, 0.58, 2.6, 6), y: 1.65 },
    { geo: cone(0.58, 1.1, 6), y: 3.55 },
    { geo: cyl(0.65, 0.8, 0.35, 6), y: 0.45 },
    { geo: box(0.14, 1.0, 0.7), x: 0.7, y: 0.85 },
    { geo: box(0.14, 1.0, 0.7), x: -0.7, y: 0.85 },
    { geo: box(0.7, 1.0, 0.14), z: 0.7, y: 0.85 },
    { geo: box(0.7, 1.0, 0.14), z: -0.7, y: 0.85 },
    { geo: box(0.12, 0.7, 0.12), x: 0.75, y: 0.35, z: 0.75 },
    { geo: box(0.12, 0.7, 0.12), x: -0.75, y: 0.35, z: 0.75 },
    { geo: box(0.12, 0.7, 0.12), x: 0.75, y: 0.35, z: -0.75 },
    { geo: box(0.12, 0.7, 0.12), x: -0.75, y: 0.35, z: -0.75 },
    { geo: cyl(0.12, 0.12, 0.4, 5), y: 4.2 },
  ]);

  const coreGem = new THREE.OctahedronGeometry(0.55, 0);
  const coreBeam = new THREE.CylinderGeometry(0.035, 0.09, 1, 6, 1, true);
  const coreBeamSoft = new THREE.CylinderGeometry(0.1, 0.22, 1, 6, 1, true);

  const extractorKit = kitFromSpecs([
    { geo: cyl(0.45, 0.65, 0.5, 6), y: 0.3 },
    { geo: cyl(0.2, 0.25, 1.0, 5), y: 1.0 },
    { geo: box(0.9, 0.12, 0.12), y: 1.35 },
    { geo: box(0.12, 0.12, 0.7), y: 1.35, z: 0.2 },
    { geo: cone(0.3, 0.4, 5), y: 1.65 },
  ]);
  const extractor = extractorKit.solid;

  // Ops Worker Depot — pad + garage bay for rovers
  const depotKit = kitFromSpecs([
    { geo: box(1.35, 0.18, 1.2), y: 0.12 },
    { geo: box(1.15, 0.55, 0.95), y: 0.48 },
    { geo: box(0.55, 0.45, 0.12), y: 0.55, z: 0.55 },
    { geo: cyl(0.22, 0.28, 0.35, 6), y: 1.0, x: -0.25 },
    { geo: box(0.35, 0.5, 0.35), y: 0.95, x: 0.35 },
    { geo: box(0.12, 0.55, 0.12), x: 0.55, y: 0.45, z: 0.4 },
    { geo: box(0.12, 0.55, 0.12), x: -0.55, y: 0.45, z: 0.4 },
  ]);
  const depot = depotKit.solid;

  // Ops Refinery — processing stack + intake
  const refineryKit = kitFromSpecs([
    { geo: box(1.2, 0.35, 1.05), y: 0.25 },
    { geo: cyl(0.32, 0.4, 1.15, 6), y: 1.0, x: -0.2 },
    { geo: cyl(0.18, 0.22, 0.85, 5), y: 0.9, x: 0.35 },
    { geo: box(0.55, 0.25, 0.4), y: 0.55, z: 0.45 },
    { geo: box(0.2, 0.15, 0.55), y: 0.7, z: 0.15 },
    { geo: cone(0.22, 0.35, 5), y: 1.75, x: -0.2 },
  ]);
  const refinery = refineryKit.solid;

  // Ops Habitat — fragile geodesic dome (Red Mars glass house)
  const domeShell = new THREE.IcosahedronGeometry(0.85, 1);
  domeShell.scale(1, 0.72, 1);
  domeShell.translate(0, 0.95, 0);
  const domeKit = kitFromSpecs([
    { geo: cyl(0.95, 1.0, 0.16, 8), y: 0.1 },
    { geo: box(1.1, 0.12, 1.1), y: 0.22 },
    { geo: domeShell, y: 0 },
    { geo: box(0.35, 0.28, 0.08), y: 0.4, z: 0.55 },
    { geo: box(0.08, 0.35, 0.08), x: 0.7, y: 0.45 },
    { geo: box(0.08, 0.35, 0.08), x: -0.7, y: 0.45 },
  ]);
  const dome = domeKit.solid;

  const barracksKit = kitFromSpecs([
    { geo: box(1.4, 0.85, 1.1), y: 0.5 },
    { geo: box(1.5, 0.12, 1.2), y: 1.0 },
    { geo: box(0.15, 0.7, 0.15), x: -0.55, y: 0.45, z: 0.45 },
    { geo: box(0.15, 0.7, 0.15), x: 0.55, y: 0.45, z: 0.45 },
    { geo: box(0.5, 0.45, 0.08), y: 0.4, z: 0.58 },
  ]);
  const barracks = barracksKit.solid;

  const turretKit = kitFromSpecs([
    { geo: cyl(0.4, 0.55, 0.4, 6), y: 0.25 },
    { geo: cyl(0.28, 0.32, 0.7, 6), y: 0.8 },
    { geo: box(0.16, 0.16, 0.85), y: 1.05, z: 0.45 },
    { geo: box(0.35, 0.2, 0.35), y: 1.25 },
  ]);
  const turret = turretKit.solid;

  const aaKit = kitFromSpecs([
    { geo: cyl(0.5, 0.65, 0.3, 4), y: 0.2 },
    { geo: cone(0.55, 1.1, 4), y: 0.85 },
    { geo: box(0.12, 0.5, 0.12), x: 0.25, y: 1.3, z: 0.15 },
    { geo: box(0.12, 0.5, 0.12), x: -0.25, y: 1.3, z: 0.15 },
  ]);
  const aa = aaKit.solid;

  const factoryKit = kitFromSpecs([
    { geo: box(1.5, 0.9, 1.2), y: 0.55 },
    { geo: box(0.45, 1.1, 0.45), x: 0.45, y: 1.0 },
    { geo: box(0.35, 0.7, 0.35), x: -0.4, y: 0.95 },
    { geo: box(0.8, 0.25, 0.5), y: 1.15, z: 0.3 },
    { geo: box(1.6, 0.1, 1.3), y: 0.12 },
  ]);
  const factory = factoryKit.solid;

  const airpadKit = kitFromSpecs([
    { geo: cyl(1.0, 1.0, 0.18, 6), y: 0.12 },
    { geo: cyl(0.55, 0.55, 0.12, 6), y: 0.28 },
    { geo: box(0.15, 0.4, 0.15), x: 0.7, y: 0.35 },
    { geo: box(0.15, 0.4, 0.15), x: -0.7, y: 0.35 },
  ]);
  const airpad = airpadKit.solid;


  // Command Center / Bureau / Fang tech pad
  const commandKit = kitFromSpecs([
    { geo: box(1.45, 0.2, 1.35), y: 0.12 },
    { geo: box(1.1, 0.7, 1.0), y: 0.55 },
    { geo: cyl(0.35, 0.4, 0.55, 8), y: 1.15 },
    { geo: box(0.9, 0.12, 0.9), y: 1.45 },
    { geo: box(0.18, 0.55, 0.18), x: 0.55, y: 0.5, z: 0.5 },
    { geo: box(0.18, 0.55, 0.18), x: -0.55, y: 0.5, z: 0.5 },
    { geo: box(0.45, 0.35, 0.12), y: 0.55, z: 0.6 },
  ]);
  const command = commandKit.solid;

  // Scout Works (Drone hangar) — the only round footprint in the Ops kit,
  // deliberately so its top-down silhouette can't be confused with the
  // square-scaffold family. Iris hatch + asymmetric launch-rail arm.
  const scoutPadKit = kitFromSpecs([
    { geo: cyl(0.85, 0.9, 0.14, 10), y: 0.08 },
    { geo: flatRing(0.55, 0.78, 10), y: 0.16 },
    { geo: cyl(0.5, 0.5, 0.07, 10), y: 0.21 },
    { geo: box(0.5, 0.1, 0.22), x: -0.75, y: 0.22, ry: -0.35 },
    { geo: box(0.08, 0.35, 0.08), x: -1.05, y: 0.35, ry: -0.35 },
    { geo: new THREE.IcosahedronGeometry(0.07, 0), x: -1.05, y: 0.55, ry: -0.35 },
    { geo: cyl(0.06, 0.06, 0.18, 6), x: 0.35, y: 0.28, z: 0.35 },
  ]);
  const scoutPad = scoutPadKit.solid;

  const accent = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  function crystalShard(h: number, r: number) {
    const g = new THREE.OctahedronGeometry(r, 0);
    g.scale(1, h / (r * 2), 1);
    g.translate(0, h * 0.5, 0);
    return g;
  }
  const crystalSpike = crystalShard(1.4, 0.28);
  const crystalSpikeSm = crystalShard(0.9, 0.18);
  const crystalSpikeTall = crystalShard(1.85, 0.32);

  /** Per-building part kits for CRT assembly resolve (placeables only). */
  const kits: Record<string, BuildingPartKit> = {
    extractor: extractorKit,
    depot: depotKit,
    refinery: refineryKit,
    dome: domeKit,
    barracks: barracksKit,
    turret: turretKit,
    aa: aaKit,
    factory: factoryKit,
    airpad: airpadKit,
    scout: scoutPadKit,
    scoutPad: scoutPadKit,
    command: commandKit,
  };

  return {
    pad,
    padLg,
    scaffoldDeck,
    scaffoldLeg,
    ring,
    marker,
    coreStation,
    coreHive,
    coreRocket,
    coreGem,
    coreBeam,
    coreBeamSoft,
    extractor,
    depot,
    refinery,
    dome,
    barracks,
    turret,
    aa,
    factory,
    airpad,
    scoutPad,
    command,
    accent,
    crystalSpike,
    crystalSpikeSm,
    crystalSpikeTall,
    kits,
  };
}
