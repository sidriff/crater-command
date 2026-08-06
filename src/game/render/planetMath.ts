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
/** True surface radial, kept unrotated while _n becomes the banked/pitched body up. */
const _nr = new THREE.Vector3();
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
 *
 * `elev` is always measured along the *true* radial, never along the banked body
 * up — otherwise a rolling craft would swing around the ground point below it and
 * pass through the rock at inverted.
 *
 * `pivotY` is the model-space height of the roll/pitch axis (scaled by `sy`).
 * Ground kit rotates about y=0 because that's where the wheels are; an aircraft
 * rotates about its own spine, so pass its centerline here.
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
  pivotY = 0,
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

  _nr.copy(_n);

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
    .addScaledVector(_nr, elev + oy)
    .addScaledVector(_e, ox)
    .addScaledVector(_no, oz);
  // Rotate about model y=pivotY instead of the origin: put the pivot where the
  // radial says it should be, then back the origin off along the body up.
  if (pivotY !== 0) {
    const py = pivotY * sy;
    mesh.position.addScaledVector(_nr, py).addScaledVector(_n, -py);
  }
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
 * Operators scaffold: square deck sits on the *highest* footprint sample;
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
