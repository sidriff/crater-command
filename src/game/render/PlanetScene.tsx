import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLOBE_RADIUS, MAP_H, MAP_W, RACES, UNITS } from "../sim/defs";
import { CELL_BLOCKED, dirToMap, getPassability, strategicBiasMap } from "../sim/terrain";
import type { BuildingKind, PlayerId, SimSnapshot, UnitKind } from "../sim/types";

const HEIGHT_AMP = 0.135;
const DIST_MIN = 14;
const DIST_MAX = GLOBE_RADIUS * 5.2;
const EL_MIN = THREE.MathUtils.degToRad(8);
const EL_MAX = THREE.MathUtils.degToRad(82);
const ORBIT_SENS = 0.012;
const PAN_SCROLL = 0.65;
const UNIT_SMOOTH = 14;

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
  // Mostly smooth ball — only soft bulk undulation.
  // Crater walls / floors come almost entirely from strategicBiasMap.
  let h = 0;
  h += (noise3(nx * 1.05, ny * 1.05, nz * 1.05) * 2 - 1) * 0.05;
  h += (noise3(nx * 2.0 + 1.3, ny * 2.0, nz * 2.0) * 2 - 1) * 0.02;
  const map = dirToMap(nx, ny, nz);
  const strat = strategicBiasMap(map.x, map.y); // rim +, floor -
  // Walls read hard against the smooth shell
  h += strat * 1.65;
  return h * HEIGHT_AMP;
}

function surfaceRadiusAlong(dir: THREE.Vector3) {
  const n = dir.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : dir.clone().normalize();
  return GLOBE_RADIUS * (1 + terrainHeight(n.x, n.y, n.z));
}

function projectToSurface(world: THREE.Vector3, out: THREE.Vector3) {
  if (world.lengthSq() < 1e-12) out.set(0, 1, 0);
  else out.copy(world).normalize();
  return out.multiplyScalar(surfaceRadiusAlong(out));
}

function dirFromMap(x: number, y: number, out: THREE.Vector3) {
  const lon = (x / MAP_W) * Math.PI * 2;
  const lat = ((y / MAP_H) - 0.5) * Math.PI * 0.92;
  const cl = Math.cos(lat);
  return out.set(cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)).normalize();
}

export function mapToWorld(x: number, y: number, out: THREE.Vector3) {
  dirFromMap(x, y, out);
  return out.multiplyScalar(surfaceRadiusAlong(out));
}

function surfaceNormal(x: number, y: number, out: THREE.Vector3) {
  const e = 0.28;
  const p = new THREE.Vector3();
  const px = new THREE.Vector3();
  const py = new THREE.Vector3();
  mapToWorld(x, y, p);
  mapToWorld(x + e, y, px);
  mapToWorld(x, y + e, py);
  out.copy(px.sub(p).cross(py.sub(p))).normalize();
  if (out.dot(p) < 0) out.negate();
  return out;
}

function smoothToward(cur: { x: number; y: number }, tx: number, ty: number, k: number) {
  let dx = tx - cur.x;
  if (dx > MAP_W * 0.5) dx -= MAP_W;
  if (dx < -MAP_W * 0.5) dx += MAP_W;
  cur.x = (cur.x + dx * k + MAP_W) % MAP_W;
  cur.y += (ty - cur.y) * k;
}

/** Shared planet mesh — built once, prewarmed from menu so bot start isn't a multi-second freeze. */
const PLANET_DETAIL = 10;
// Bump when terrain formula changes so prewarmed mesh doesn't stick
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
  const q = HEIGHT_AMP * 0.006; // fine snap so smooth areas stay smooth
  const pass = getPassability();
  // Small batches — large chunks freeze the title typewriter / progress bar
  const BATCH = 2_500;

  for (let i = 0; i < pos.count; i++) {
    a.fromBufferAttribute(pos, i).normalize();
    const v = colorPlanetVertex(
      a,
      tmp,
      deep,
      low,
      mid,
      high,
      ridge,
      craterFloor,
      ridgeRock,
      passSand,
      pass,
      q,
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
  // normals are the last long sync hit — yield once more so UI can paint first
  await yieldMain();
  geo.computeVertexNormals();
  await yieldMain();
  return geo;
}

/** Kick off planet bake early (menu). Safe to call many times. */
export function warmPlanetGeometry(): Promise<THREE.BufferGeometry> {
  if (_globeGeo && _globeRev === PLANET_MESH_REV) return Promise.resolve(_globeGeo);
  if (_globePromise && _globeRev === PLANET_MESH_REV) return _globePromise;
  // Drop stale mesh if terrain rev changed
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

export function isPlanetGeometryReady() {
  return _globeGeo != null && _globeRev === PLANET_MESH_REV;
}

function PolyGlobe({
  meshRef,
  snapRef,
  viewer,
  onReady,
}: {
  meshRef: MutableRefObject<THREE.Mesh | null>;
  snapRef: MutableRefObject<SimSnapshot>;
  viewer: PlayerId;
  onReady?: () => void;
}) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(_globeGeo);

  useEffect(() => {
    if (geo) {
      onReady?.();
      return;
    }
    let alive = true;
    void warmPlanetGeometry().then((g) => {
      if (!alive) return;
      setGeo(g);
      onReady?.();
    });
    return () => {
      alive = false;
    };
  }, [geo, onReady]);

  // FOW baked into planet material (no second shell → no z-fight blotches)
  const SCALE = 8;
  const FW = MAP_W * SCALE;
  const FH = MAP_H * SCALE;
  const RIM_PX = 2;

  const { tex, seenBuf, edgeBuf, distBuf } = useMemo(() => {
    const data = new Uint8Array(FW * FH * 4);
    const t = new THREE.DataTexture(data, FW, FH);
    t.format = THREE.RGBAFormat;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.flipY = false;
    t.needsUpdate = true;
    return {
      tex: t,
      seenBuf: new Uint8Array(FW * FH),
      edgeBuf: new Uint8Array(FW * FH),
      distBuf: new Float32Array(FW * FH),
    };
  }, []);

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.82,
      metalness: 0.04,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFowMap = { value: tex };
      shader.uniforms.uFowTime = { value: 0 };
      m.userData.shader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          varying vec2 vFowUv;
          `,
        )
        .replace(
          "#include <uv_vertex>",
          /* glsl */ `
          #include <uv_vertex>
          vFowUv = uv;
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          uniform sampler2D uFowMap;
          uniform float uFowTime;
          varying vec2 vFowUv;
          float fowHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          `,
        )
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
          #include <color_fragment>
          {
            vec4 fow = texture2D(uFowMap, vFowUv);
            float shroud = clamp(fow.a, 0.0, 1.0);
            float rimAmt = smoothstep(0.35, 0.75, fow.g)
                         * smoothstep(0.35, 0.85, fow.b)
                         * shroud;
            // Unseen rock: crush into deep shroud (still shows form)
            float veil = shroud * (1.0 - rimAmt * 0.9);
            diffuseColor.rgb = mix(
              diffuseColor.rgb,
              diffuseColor.rgb * 0.1 + vec3(0.015, 0.02, 0.045),
              veil
            );
            // Pixel scan rim lives on the rock surface
            if (rimAmt > 0.02) {
              float noise = fowHash(floor(vFowUv * 220.0) + floor(uFowTime * 10.0));
              float life = (0.9 + 0.12 * noise)
                         * (0.92 + 0.08 * sin(uFowTime * 14.0 + vFowUv.x * 30.0));
              diffuseColor.rgb += fow.rgb * rimAmt * 0.95 * life;
            }
          }
          `,
        );
    };
    m.customProgramCacheKey = () => "planet-fow-bake-v1";
    return m;
  }, [tex]);

  useEffect(
    () => () => {
      // shared planet geo is cached — do not dispose
      tex.dispose();
      mat.dispose();
    },
    [tex, mat],
  );

  useFrame((_, dt) => {
    if (!geo) return;
    const sh = mat.userData.shader as
      | { uniforms: { uFowTime: { value: number } } }
      | undefined;
    if (sh?.uniforms?.uFowTime) sh.uniforms.uFowTime.value += dt;

    const snap = snapRef.current;
    if (!snap) return;
    const vis = snap.players[viewer]?.vision;
    if (!vis) return;
    const data = tex.image.data as Uint8Array;
    seenBuf.fill(0);

    const R = SCALE * 0.78;
    const R2 = R * R;
    for (let cy = 0; cy < MAP_H; cy++) {
      for (let cx = 0; cx < MAP_W; cx++) {
        if (vis[cy * MAP_W + cx] !== 1) continue;
        const cxh = (cx + 0.5) * SCALE;
        const cyh = (cy + 0.5) * SCALE;
        const y0 = Math.max(0, Math.floor(cyh - R - 1));
        const y1 = Math.min(FH - 1, Math.ceil(cyh + R + 1));
        const xPad0 = Math.floor(cxh - R - 1);
        const xPad1 = Math.ceil(cxh + R + 1);
        for (let y = y0; y <= y1; y++) {
          const dy = y + 0.5 - cyh;
          for (let x = xPad0; x <= xPad1; x++) {
            const dx = x + 0.5 - cxh;
            if (dx * dx + dy * dy > R2) continue;
            const xx = ((x % FW) + FW) % FW;
            seenBuf[y * FW + xx] = 1;
          }
        }
      }
    }

    edgeBuf.fill(0);
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const i = y * FW + x;
        const s = seenBuf[i]!;
        const l = seenBuf[y * FW + ((x - 1 + FW) % FW)]!;
        const r = seenBuf[y * FW + ((x + 1) % FW)]!;
        const u = y > 0 ? seenBuf[(y - 1) * FW + x]! : s;
        const d = y < FH - 1 ? seenBuf[(y + 1) * FW + x]! : s;
        if (s !== l || s !== r || s !== u || s !== d) edgeBuf[i] = 1;
      }
    }

    distBuf.fill(RIM_PX + 1);
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        if (edgeBuf[y * FW + x] !== 1) continue;
        for (let dy = -RIM_PX; dy <= RIM_PX; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= FH) continue;
          for (let dx = -RIM_PX; dx <= RIM_PX; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > RIM_PX) continue;
            const xx = (x + dx + FW) % FW;
            const j = yy * FW + xx;
            if (d < distBuf[j]!) distBuf[j] = d;
          }
        }
      }
    }

    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const i = y * FW + x;
        const o = i * 4;
        const seen = seenBuf[i] === 1;
        const ad = distBuf[i]!;

        if (seen && ad > RIM_PX) {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 0;
        } else if (ad <= RIM_PX) {
          const t = 1 - ad / (RIM_PX + 0.001);
          if (seen) {
            const core = Math.pow(t, 1.1);
            data[o] = Math.floor(100 + 80 * core);
            data[o + 1] = Math.floor(210 + 45 * core);
            data[o + 2] = 255;
            data[o + 3] = Math.floor(150 + 100 * core);
          } else {
            const halo = Math.pow(t, 1.2);
            data[o] = Math.floor(18 + 30 * halo);
            data[o + 1] = Math.floor(45 + 55 * halo);
            data[o + 2] = Math.floor(80 + 70 * halo);
            data[o + 3] = Math.floor(70 + 70 * halo);
          }
        } else {
          data[o] = 8;
          data[o + 1] = 12;
          data[o + 2] = 22;
          data[o + 3] = 178;
        }
      }
    }
    tex.needsUpdate = true;
  });

  if (!geo) return null;

  return (
    <group>
      <mesh ref={meshRef} geometry={geo} material={mat} />
      {/* soft atmosphere rim */}
      <mesh scale={1.045}>
        <sphereGeometry args={[GLOBE_RADIUS, 48, 32]} />
        <meshBasicMaterial
          color="#6a9ec8"
          transparent
          opacity={0.045}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Starfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const { geo, mat } = useMemo(() => {
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx2 = canvas.getContext("2d")!;
    const g = ctx2.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx2.fillStyle = g;
    ctx2.fillRect(0, 0, 32, 32);
    const map = new THREE.CanvasTexture(canvas);
    const material = new THREE.PointsMaterial({
      size: 0.85,
      map,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return { geo: geometry, mat: material };
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.map?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame((_, dt) => {
    if (pointsRef.current) pointsRef.current.rotation.y += dt * 0.004;
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[400, 24, 16]} />
        <meshBasicMaterial color="#02040a" side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[390, 24, 16]} />
        <meshBasicMaterial
          color="#081020"
          side={THREE.BackSide}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>
      <points ref={pointsRef} geometry={geo} material={mat} />
    </group>
  );
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _no = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/** Place mesh on surface; local offsets are in (east, up, north) units.
 *  Orientation is radial (planet-center upright), not terrain-slope, so
 *  buildings/units stand true rather than tilting with crater walls. */
function placeOnSurface(
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
) {
  mapToWorld(x, y, _p);
  // Radial up = upright on the globe (not surfaceNormal, which tilts on slopes)
  if (_p.lengthSq() < 1e-12) _n.set(0, 1, 0);
  else _n.copy(_p).normalize();
  // east / north frame on the tangent plane
  _e.set(0, 1, 0).cross(_n);
  if (_e.lengthSq() < 1e-8) _e.set(1, 0, 0).cross(_n);
  _e.normalize();
  _no.copy(_n).cross(_e).normalize();
  _q.setFromUnitVectors(_up, _n);
  if (yaw !== 0) {
    const yawQ = new THREE.Quaternion().setFromAxisAngle(_up, yaw);
    _q.multiply(yawQ);
  }
  mesh.quaternion.copy(_q);
  mesh.position
    .copy(_p)
    .addScaledVector(_n, elev + oy)
    .addScaledVector(_e, ox)
    .addScaledVector(_no, oz);
  mesh.scale.set(sx, sy, sz);
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

/** Merge simple primitives into one BufferGeometry (local Y-up). */
function mergeParts(
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
    const g = p.geo.clone();
    g.rotateX(p.rx ?? 0);
    g.rotateY(p.ry ?? 0);
    g.rotateZ(p.rz ?? 0);
    g.scale(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
    geos.push(g);
  }
  // manual merge (no BufferGeometryUtils dependency)
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
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

function makeUnitGeos() {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, s = 6) =>
    new THREE.CylinderGeometry(rt, rb, h, s);
  const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);
  const sph = (r: number) => new THREE.SphereGeometry(r, 6, 5);

  // Worker — biped droid: torso + head + legs + arms
  const worker = mergeParts([
    { geo: box(0.55, 0.55, 0.4), y: 0.85 }, // torso
    { geo: box(0.38, 0.32, 0.32), y: 1.3 }, // head
    { geo: box(0.14, 0.45, 0.14), x: -0.18, y: 0.35 }, // L leg
    { geo: box(0.14, 0.45, 0.14), x: 0.18, y: 0.35 }, // R leg
    { geo: box(0.12, 0.4, 0.12), x: -0.4, y: 0.95, rz: 0.3 }, // L arm
    { geo: box(0.12, 0.4, 0.12), x: 0.4, y: 0.95, rz: -0.3 }, // R arm
    { geo: box(0.22, 0.1, 0.18), y: 0.12, x: -0.18 }, // L foot
    { geo: box(0.22, 0.1, 0.18), y: 0.12, x: 0.18 },
  ]);

  // Raider — low wedge skiff / pointed mech
  const raider = mergeParts([
    { geo: box(0.7, 0.35, 1.1), y: 0.45 }, // hull
    { geo: cone(0.35, 0.7, 4), y: 0.5, z: 0.55, rx: Math.PI / 2 }, // nose
    { geo: box(0.15, 0.25, 0.5), x: -0.5, y: 0.4 }, // fin L
    { geo: box(0.15, 0.25, 0.5), x: 0.5, y: 0.4 },
    { geo: cyl(0.12, 0.18, 0.25, 5), y: 0.75 }, // cockpit
    { geo: box(0.2, 0.12, 0.35), y: 0.25, z: -0.45 }, // thruster
  ]);

  // Tank — chassis + tracks + turret + barrel
  const tank = mergeParts([
    { geo: box(1.15, 0.35, 0.85), y: 0.4 }, // body
    { geo: box(1.25, 0.22, 0.28), x: 0, y: 0.22, z: 0.4 }, // track front-ish
    { geo: box(1.25, 0.22, 0.28), y: 0.22, z: -0.4 },
    { geo: cyl(0.32, 0.35, 0.28, 6), y: 0.72 }, // turret
    { geo: box(0.14, 0.14, 0.7), y: 0.75, z: 0.55 }, // barrel
    { geo: box(0.25, 0.15, 0.2), y: 0.95 }, // cupola
  ]);

  // Flyer — diamond craft with wings
  const flyer = mergeParts([
    { geo: box(0.35, 0.25, 0.9), y: 0.3 }, // body
    { geo: box(1.4, 0.08, 0.4), y: 0.28 }, // wings
    { geo: cone(0.22, 0.45, 4), y: 0.3, z: 0.55, rx: Math.PI / 2 },
    { geo: box(0.12, 0.35, 0.25), y: 0.45, z: -0.35 }, // tail
    { geo: box(0.5, 0.06, 0.18), y: 0.55, z: -0.35 }, // tail wing
  ]);

  // Scout — little quadcopter / recon drone
  const rotor = () => {
    const g = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 8);
    return g;
  };
  const scout = mergeParts([
    { geo: box(0.45, 0.16, 0.55), y: 0.55 }, // body
    { geo: box(0.22, 0.14, 0.28), y: 0.62, z: 0.15 }, // camera pod
    { geo: sph(0.1), y: 0.55, z: 0.42 }, // lens
    // arms
    { geo: box(0.9, 0.06, 0.08), y: 0.55 },
    { geo: box(0.08, 0.06, 0.9), y: 0.55 },
    // motor pods
    { geo: cyl(0.08, 0.08, 0.1, 5), x: 0.42, y: 0.58, z: 0.42 },
    { geo: cyl(0.08, 0.08, 0.1, 5), x: -0.42, y: 0.58, z: 0.42 },
    { geo: cyl(0.08, 0.08, 0.1, 5), x: 0.42, y: 0.58, z: -0.42 },
    { geo: cyl(0.08, 0.08, 0.1, 5), x: -0.42, y: 0.58, z: -0.42 },
    // rotors (flat discs)
    { geo: rotor(), x: 0.42, y: 0.66, z: 0.42 },
    { geo: rotor(), x: -0.42, y: 0.66, z: 0.42 },
    { geo: rotor(), x: 0.42, y: 0.66, z: -0.42 },
    { geo: rotor(), x: -0.42, y: 0.66, z: -0.42 },
    // landing skids
    { geo: box(0.12, 0.06, 0.5), x: -0.18, y: 0.35 },
    { geo: box(0.12, 0.06, 0.5), x: 0.18, y: 0.35 },
  ]);

  // accent pips (eye / barrel tip)
  const pip = sph(0.14);

  return { worker, raider, tank, flyer, scout, pip, box: box(1, 1, 1) };
}

function makeBuildingGeos() {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, s = 6) =>
    new THREE.CylinderGeometry(rt, rb, h, s);
  const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);

  const pad = flatHex(0.95);
  const padLg = flatHex(1.25);
  const ring = flatRing(0.55, 0.82, 6);
  const marker = flatRing(0.38, 0.58, 6);

  // Core — Operators: tall modular station (tower hub + high ring + panels)
  const coreStation = mergeParts([
    { geo: cyl(0.55, 0.7, 0.4, 6), y: 0.25 }, // foot
    { geo: cyl(0.38, 0.45, 2.2, 6), y: 1.5 }, // main mast
    { geo: new THREE.TorusGeometry(1.35, 0.14, 5, 18), y: 2.0, rx: Math.PI / 2 },
    { geo: box(0.75, 0.1, 0.4), x: 0.95, y: 2.0 },
    { geo: box(0.75, 0.1, 0.4), x: -0.95, y: 2.0 },
    { geo: box(0.4, 0.1, 0.75), z: 0.95, y: 2.0 },
    { geo: box(0.4, 0.1, 0.75), z: -0.95, y: 2.0 },
    { geo: box(0.1, 1.1, 0.65), x: 1.55, y: 2.0 }, // solar
    { geo: box(0.1, 1.1, 0.65), x: -1.55, y: 2.0 },
    { geo: cyl(0.28, 0.35, 0.7, 5), y: 3.0 }, // upper module
    { geo: box(0.55, 0.2, 0.55), y: 3.5 }, // beacon deck
  ]);

  // Core — Blight: stack of hexagonal orbs (protruding hive)
  const hexOrb = (r: number) => new THREE.IcosahedronGeometry(r, 0);
  const coreHive = mergeParts([
    { geo: hexOrb(1.15), y: 1.0 }, // base bulb
    { geo: hexOrb(0.95), y: 2.15 },
    { geo: hexOrb(0.78), y: 3.15 },
    { geo: hexOrb(0.58), y: 3.95 },
    { geo: hexOrb(0.4), y: 4.55 }, // crown
    // side buds so it reads as a colony
    { geo: hexOrb(0.42), x: 0.95, y: 1.55, z: 0.35 },
    { geo: hexOrb(0.38), x: -0.85, y: 2.0, z: -0.4 },
    { geo: hexOrb(0.32), x: 0.55, y: 2.85, z: -0.55 },
    { geo: cone(0.14, 0.85, 5), x: 0.4, y: 4.9, z: 0.15 },
    { geo: cone(0.12, 0.7, 5), x: -0.35, y: 4.75, z: -0.2 },
  ]);

  // Core — Mandate: tall landed rocket
  const coreRocket = mergeParts([
    { geo: cyl(0.7, 0.85, 0.35, 6), y: 0.2 }, // landing skirt
    { geo: cyl(0.5, 0.58, 2.6, 6), y: 1.65 }, // stack
    { geo: cone(0.58, 1.1, 6), y: 3.55 }, // nose
    { geo: cyl(0.65, 0.8, 0.35, 6), y: 0.45 }, // thruster ring
    { geo: box(0.14, 1.0, 0.7), x: 0.7, y: 0.85 },
    { geo: box(0.14, 1.0, 0.7), x: -0.7, y: 0.85 },
    { geo: box(0.7, 1.0, 0.14), z: 0.7, y: 0.85 },
    { geo: box(0.7, 1.0, 0.14), z: -0.7, y: 0.85 },
    { geo: box(0.12, 0.7, 0.12), x: 0.75, y: 0.35, z: 0.75 },
    { geo: box(0.12, 0.7, 0.12), x: -0.75, y: 0.35, z: 0.75 },
    { geo: box(0.12, 0.7, 0.12), x: 0.75, y: 0.35, z: -0.75 },
    { geo: box(0.12, 0.7, 0.12), x: -0.75, y: 0.35, z: -0.75 },
    { geo: cyl(0.12, 0.12, 0.4, 5), y: 4.2 }, // beacon tip
  ]);

  const coreGem = new THREE.OctahedronGeometry(0.55, 0);
  // Core skybeam (unit height; scaled in place) — thin spike
  const coreBeam = new THREE.CylinderGeometry(0.035, 0.09, 1, 6, 1, true);
  const coreBeamSoft = new THREE.CylinderGeometry(0.1, 0.22, 1, 6, 1, true);

  // Extractor — drill + gantry
  const extractor = mergeParts([
    { geo: cyl(0.45, 0.65, 0.5, 6), y: 0.3 },
    { geo: cyl(0.2, 0.25, 1.0, 5), y: 1.0 },
    { geo: box(0.9, 0.12, 0.12), y: 1.35 },
    { geo: box(0.12, 0.12, 0.7), y: 1.35, z: 0.2 },
    { geo: cone(0.3, 0.4, 5), y: 1.65 },
  ]);

  // Barracks / Bay — hangar shed
  const barracks = mergeParts([
    { geo: box(1.4, 0.85, 1.1), y: 0.5 },
    { geo: box(1.5, 0.12, 1.2), y: 1.0 }, // roof
    { geo: box(0.15, 0.7, 0.15), x: -0.55, y: 0.45, z: 0.45 },
    { geo: box(0.15, 0.7, 0.15), x: 0.55, y: 0.45, z: 0.45 },
    { geo: box(0.5, 0.45, 0.08), y: 0.4, z: 0.58 }, // door
  ]);

  // Turret — base + barrel
  const turret = mergeParts([
    { geo: cyl(0.4, 0.55, 0.4, 6), y: 0.25 },
    { geo: cyl(0.28, 0.32, 0.7, 6), y: 0.8 },
    { geo: box(0.16, 0.16, 0.85), y: 1.05, z: 0.45 },
    { geo: box(0.35, 0.2, 0.35), y: 1.25 },
  ]);

  // AA nest — pyramid launcher
  const aa = mergeParts([
    { geo: cyl(0.5, 0.65, 0.3, 4), y: 0.2 },
    { geo: cone(0.55, 1.1, 4), y: 0.85 },
    { geo: box(0.12, 0.5, 0.12), x: 0.25, y: 1.3, z: 0.15 },
    { geo: box(0.12, 0.5, 0.12), x: -0.25, y: 1.3, z: 0.15 },
  ]);

  // Factory / Forge
  const factory = mergeParts([
    { geo: box(1.5, 0.9, 1.2), y: 0.55 },
    { geo: box(0.45, 1.1, 0.45), x: 0.45, y: 1.0 }, // stack
    { geo: box(0.35, 0.7, 0.35), x: -0.4, y: 0.95 },
    { geo: box(0.8, 0.25, 0.5), y: 1.15, z: 0.3 },
    { geo: box(1.6, 0.1, 1.3), y: 0.12 },
  ]);

  // Airpad
  const airpad = mergeParts([
    { geo: cyl(1.0, 1.0, 0.18, 6), y: 0.12 },
    { geo: cyl(0.55, 0.55, 0.12, 6), y: 0.28 },
    { geo: box(0.15, 0.4, 0.15), x: 0.7, y: 0.35 },
    { geo: box(0.15, 0.4, 0.15), x: -0.7, y: 0.35 },
  ]);

  // Scout works — dish platform
  const scoutPad = mergeParts([
    { geo: box(1.1, 0.35, 1.1), y: 0.25 },
    { geo: cyl(0.15, 0.2, 0.7, 5), y: 0.75 },
    { geo: new THREE.SphereGeometry(0.4, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), y: 1.2 },
    { geo: box(0.5, 0.12, 0.12), y: 0.7, x: 0.35 },
  ]);

  const accent = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  // Faceted crystal shards (stretched octahedra), base near y=0
  function crystalShard(h: number, r: number) {
    const g = new THREE.OctahedronGeometry(r, 0);
    g.scale(1, h / (r * 2), 1);
    g.translate(0, h * 0.5, 0);
    return g;
  }
  const crystalSpike = crystalShard(1.4, 0.28);
  const crystalSpikeSm = crystalShard(0.9, 0.18);
  const crystalSpikeTall = crystalShard(1.85, 0.32);

  return {
    pad,
    padLg,
    ring,
    marker,
    coreStation,
    coreHive,
    coreRocket,
    coreGem,
    coreBeam,
    coreBeamSoft,
    extractor,
    barracks,
    turret,
    aa,
    factory,
    airpad,
    scoutPad,
    accent,
    crystalSpike,
    crystalSpikeSm,
    crystalSpikeTall,
  };
}

function EntityLayer({
  snapRef,
  viewer,
}: {
  snapRef: MutableRefObject<SimSnapshot>;
  viewer: PlayerId;
}) {
  const group = useRef<THREE.Group>(null);
  const pool = useRef<THREE.Object3D[]>([]);
  const smoothPos = useRef(new Map<number, { x: number; y: number }>());

  // Rally-style: dark hull occluder + glowing wire shell (per team)
  const mats = useMemo(() => {
    const hull = (hex: string) =>
      new THREE.MeshBasicMaterial({
        color: hex,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    const wire = (hex: string) =>
      new THREE.LineBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
    const solid = (hex: string, e = 0.4) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: e,
        roughness: 0.5,
        metalness: 0.25,
        flatShading: true,
      });
    const basic = (hex: string, op = 0.9) =>
      new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: op,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
    return {
      hull0: hull("#04120a"),
      hull1: hull("#120406"),
      wire0: wire("#2dff8c"),
      wire1: wire("#ff2a2a"),
      p0: solid("#2dff8c", 0.45),
      p1: solid("#ff2a2a", 0.45),
      dark0: solid("#0a2818", 0.1),
      dark1: solid("#280a0a", 0.1),
      metal: solid("#4a5565", 0.1),
      white: solid("#e8f0ff", 0.5),
      crystal: new THREE.MeshStandardMaterial({
        color: "#7ef0ff",
        emissive: "#20e8ff",
        emissiveIntensity: 1.6,
        roughness: 0.08,
        metalness: 0.45,
        flatShading: true,
        transparent: true,
        opacity: 0.92,
      }),
      crystalDim: new THREE.MeshStandardMaterial({
        color: "#3a6a78",
        emissive: "#0a4050",
        emissiveIntensity: 0.45,
        roughness: 0.35,
        metalness: 0.3,
        flatShading: true,
        transparent: true,
        opacity: 0.55,
      }),
      marker0: basic("#2dff8c", 0.95),
      marker1: basic("#ff2a2a", 0.95),
      pad0: basic("#2dff8c", 0.35),
      pad1: basic("#ff2a2a", 0.35),
      beam0: new THREE.MeshBasicMaterial({
        color: "#2dff8c",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      beam1: new THREE.MeshBasicMaterial({
        color: "#ff2a2a",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      beamSoft0: new THREE.MeshBasicMaterial({
        color: "#2dff8c",
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      beamSoft1: new THREE.MeshBasicMaterial({
        color: "#ff2a2a",
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    };
  }, []);

  const unitGeos = useMemo(() => makeUnitGeos(), []);
  const bGeos = useMemo(() => makeBuildingGeos(), []);
  const unitEdges = useMemo(() => {
    const mk = (g: THREE.BufferGeometry) => new THREE.EdgesGeometry(g, 22);
    return {
      worker: mk(unitGeos.worker),
      raider: mk(unitGeos.raider),
      tank: mk(unitGeos.tank),
      flyer: mk(unitGeos.flyer),
      scout: mk(unitGeos.scout),
    };
  }, [unitGeos]);
  const coreEdges = useMemo(() => {
    const mk = (g: THREE.BufferGeometry) => new THREE.EdgesGeometry(g, 18);
    return {
      operators: mk(bGeos.coreStation),
      blight: mk(bGeos.coreHive),
      mandate: mk(bGeos.coreRocket),
    };
  }, [bGeos]);

  useEffect(() => {
    return () => {
      Object.values(unitGeos).forEach((g) => g.dispose());
      Object.values(bGeos).forEach((g) => g.dispose());
      Object.values(unitEdges).forEach((g) => g.dispose());
      Object.values(coreEdges).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    };
  }, [unitGeos, bGeos, unitEdges, coreEdges, mats]);

  useFrame((_, dt) => {
    const g = group.current;
    const snap = snapRef.current;
    if (!g || !snap) return;
    const t = performance.now() * 0.001;
    const k = 1 - Math.exp(-UNIT_SMOOTH * Math.min(0.05, dt));

    const tint0 = RACES[snap.players[0]!.race].tint;
    const tint1 = RACES[snap.players[1]!.race].tint;
    mats.wire0.color.set(tint0);
    mats.wire1.color.set(tint1);
    mats.hull0.color.set(tint0).multiplyScalar(0.07);
    mats.hull1.color.set(tint1).multiplyScalar(0.07);
    mats.p0.color.set(tint0).offsetHSL(0, 0.05, -0.05);
    mats.p0.emissive.copy(mats.p0.color);
    mats.p1.color.set(tint1).offsetHSL(0, 0.05, -0.05);
    mats.p1.emissive.copy(mats.p1.color);
    mats.marker0.color.set(tint0);
    mats.marker1.color.set(tint1);
    mats.pad0.color.set(tint0);
    mats.pad1.color.set(tint1);
    mats.beam0.color.set(tint0);
    mats.beam1.color.set(tint1);
    mats.beamSoft0.color.set(tint0);
    mats.beamSoft1.color.set(tint1);

    for (const m of pool.current) m.visible = false;
    let pi = 0;
    const takeMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      let obj = pool.current[pi];
      if (!obj || !(obj instanceof THREE.Mesh) || obj instanceof THREE.LineSegments) {
        if (obj) g.remove(obj);
        obj = new THREE.Mesh(geo, mat);
        pool.current[pi] = obj;
        g.add(obj);
      } else {
        (obj as THREE.Mesh).geometry = geo;
        (obj as THREE.Mesh).material = mat;
      }
      obj.visible = true;
      obj.scale.set(1, 1, 1);
      obj.rotation.set(0, 0, 0);
      pi++;
      return obj as THREE.Mesh;
    };
    const takeLine = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      let obj = pool.current[pi];
      if (!obj || !(obj instanceof THREE.LineSegments)) {
        if (obj) g.remove(obj);
        obj = new THREE.LineSegments(geo, mat);
        pool.current[pi] = obj;
        g.add(obj);
      } else {
        obj.geometry = geo;
        obj.material = mat;
      }
      obj.visible = true;
      obj.scale.set(1, 1, 1);
      obj.rotation.set(0, 0, 0);
      pi++;
      return obj as THREE.LineSegments;
    };

    const visAt = (x: number, y: number, owner: PlayerId) => {
      if (owner === viewer) return true;
      const cx = ((Math.floor(x) % MAP_W) + MAP_W) % MAP_W;
      const cy = Math.max(0, Math.min(MAP_H - 1, Math.floor(y)));
      return snap.players[viewer]!.vision[cy * MAP_W + cx] === 1;
    };

    const team = (o: PlayerId) => (o === 0 ? mats.p0 : mats.p1);
    const dark = (o: PlayerId) => (o === 0 ? mats.dark0 : mats.dark1);
    const mark = (o: PlayerId) => (o === 0 ? mats.marker0 : mats.marker1);
    const padM = (o: PlayerId) => (o === 0 ? mats.pad0 : mats.pad1);
    const hullM = (o: PlayerId) => (o === 0 ? mats.hull0 : mats.hull1);
    const wireM = (o: PlayerId) => (o === 0 ? mats.wire0 : mats.wire1);

    const placeWireShell = (
      solidGeo: THREE.BufferGeometry,
      edgeGeo: THREE.BufferGeometry,
      owner: PlayerId,
      x: number,
      y: number,
      elev: number,
      sx: number,
      sy: number,
      sz: number,
      yaw: number,
    ) => {
      const h = takeMesh(solidGeo, hullM(owner));
      placeOnSurface(h, x, y, elev, 0, 0, 0, sx * 0.96, sy * 0.96, sz * 0.96, yaw);
      const w = takeLine(edgeGeo, wireM(owner));
      placeOnSurface(w, x, y, elev, 0, 0, 0, sx, sy, sz, yaw);
    };

    for (const m of snap.minerals) {
      const seen = visAt(m.x, m.y, viewer);
      const mat = seen ? mats.crystal : mats.crystalDim;
      const s = 0.95 + m.yield * 0.045;
      const seed = m.id * 2.17;
      const spikes = [
        { geo: bGeos.crystalSpikeTall, ox: 0.0, oz: 0.0, sc: 1.2 * s, yaw: seed },
        { geo: bGeos.crystalSpike, ox: 0.55, oz: -0.25, sc: 0.95 * s, yaw: seed + 0.8 },
        { geo: bGeos.crystalSpike, ox: -0.5, oz: 0.35, sc: 1.05 * s, yaw: seed + 1.9 },
        { geo: bGeos.crystalSpikeSm, ox: 0.35, oz: 0.55, sc: 0.8 * s, yaw: seed + 2.7 },
        { geo: bGeos.crystalSpikeSm, ox: -0.6, oz: -0.3, sc: 0.75 * s, yaw: seed + 3.5 },
        { geo: bGeos.crystalSpikeSm, ox: 0.15, oz: -0.6, sc: 0.7 * s, yaw: seed + 4.4 },
        { geo: bGeos.crystalSpike, ox: 0.65, oz: 0.4, sc: 0.85 * s, yaw: seed + 5.2 },
        { geo: bGeos.crystalSpikeSm, ox: -0.25, oz: 0.65, sc: 0.65 * s, yaw: seed + 6.1 },
      ];
      for (const sp of spikes) {
        const mesh = takeMesh(sp.geo, mat);
        placeOnSurface(
          mesh,
          m.x,
          m.y,
          0.04,
          sp.ox,
          0,
          sp.oz,
          sp.sc * 0.85,
          sp.sc,
          sp.sc * 0.85,
          sp.yaw,
        );
      }
    }

    for (const b of snap.buildings) {
      const mat = team(b.owner);
      const dmat = dark(b.owner);
      const prog = b.done ? 1 : 0.4 + b.progress * 0.6;
      const yaw = b.id * 0.7;
      const race = snap.players[b.owner]!.race;
      const beamMat = b.owner === 0 ? mats.beam0 : mats.beam1;
      const beamSoft = b.owner === 0 ? mats.beamSoft0 : mats.beamSoft1;

      // Core skybeams always pierce FOW so you can read both bases
      if (b.kind === "core") {
        // match placeWireShell core scale so beam sits on the crown
        const sy = 2.05 * prog;
        const topLocal =
          race === "mandate" ? 4.35 : race === "blight" ? 4.75 : 3.65;
        const topElev = topLocal * sy;
        const pulse = 0.94 + 0.06 * Math.sin(t * 2.2 + b.id);
        const h = 26 * pulse;
        // cylinder centered on elev → bottom lands exactly on topElev
        const coreB = takeMesh(bGeos.coreBeam, beamMat);
        placeOnSurface(coreB, b.x, b.y, topElev + h * 0.5, 0, 0, 0, 0.55, h, 0.55, 0);
        const coreBs = takeMesh(bGeos.coreBeamSoft, beamSoft);
        placeOnSurface(coreBs, b.x, b.y, topElev + h * 0.5, 0, 0, 0, 0.85, h * 0.98, 0.85, 0);
      }

      if (!visAt(b.x, b.y, b.owner)) continue;

      // no hex pads — buildings sit on bare rock

      if (b.kind === "core") {
        const coreGeo =
          race === "operators"
            ? bGeos.coreStation
            : race === "blight"
              ? bGeos.coreHive
              : bGeos.coreRocket;
        // larger / taller presence
        const sx = 1.85;
        const sy = 2.05 * prog;
        placeWireShell(coreGeo, coreEdges[race], b.owner, b.x, b.y, 0, sx, sy, sx, yaw);
        const gem = takeMesh(bGeos.coreGem, mats.white);
        placeOnSurface(
          gem,
          b.x,
          b.y,
          (race === "mandate" ? 4.6 : race === "blight" ? 4.9 : 3.9) * prog,
          0,
          0,
          0,
          1.15,
          1.15,
          1.15,
          t * 0.4,
        );
      } else if (b.kind === "extractor") {
        const body = takeMesh(bGeos.extractor, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.25, 1.55 * prog, 1.25, yaw);
        const tip = takeMesh(bGeos.accent, mats.white);
        placeOnSurface(tip, b.x, b.y, 2.4 * prog);
      } else if (b.kind === "barracks") {
        const body = takeMesh(bGeos.barracks, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.2, 1.45 * prog, 1.2, yaw);
      } else if (b.kind === "turret") {
        const body = takeMesh(bGeos.turret, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.2, 1.5 * prog, 1.2, t * 0.15 + yaw);
      } else if (b.kind === "aa") {
        const body = takeMesh(bGeos.aa, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.2, 1.5 * prog, 1.2, yaw);
      } else if (b.kind === "factory") {
        const body = takeMesh(bGeos.factory, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.25, 1.5 * prog, 1.25, yaw);
        const stack = takeMesh(bGeos.accent, dmat);
        placeOnSurface(stack, b.x, b.y, 2.2 * prog, 0.4, 0, 0.2, 1.2, 1.8, 1.2);
      } else if (b.kind === "airpad") {
        const body = takeMesh(bGeos.airpad, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.3, 1.35 * prog, 1.3, yaw);
        const gem = takeMesh(unitGeos.pip, mats.white);
        placeOnSurface(gem, b.x, b.y, 0.7 * prog, 0, 0, 0, 1.4, 1.4, 1.4);
      } else if (b.kind === "scout") {
        const body = takeMesh(bGeos.scoutPad, mat);
        placeOnSurface(body, b.x, b.y, 0, 0, 0, 0, 1.2, 1.45 * prog, 1.2, yaw);
      }
    }

    const alive = new Set<number>();
    for (const u of snap.units) {
      alive.add(u.id);
      let s = smoothPos.current.get(u.id);
      if (!s) {
        s = { x: u.x, y: u.y };
        smoothPos.current.set(u.id, s);
      } else smoothToward(s, u.x, u.y, k);
    }
    for (const id of smoothPos.current.keys()) {
      if (!alive.has(id)) smoothPos.current.delete(id);
    }

    for (const u of snap.units) {
      const s = smoothPos.current.get(u.id)!;
      if (!visAt(s.x, s.y, u.owner)) continue;
      const elev = UNITS[u.kind].air ? 1.35 + Math.sin(t * 3 + u.id) * 0.12 : 0.12;
      const yaw = u.id * 0.9 + (u.carrying ? t * 0.5 : 0);

      let solidGeo: THREE.BufferGeometry = unitGeos.worker;
      let edgeGeo: THREE.BufferGeometry = unitEdges.worker;
      let scale = 1.05;
      if (u.kind === "raider") {
        solidGeo = unitGeos.raider;
        edgeGeo = unitEdges.raider;
        scale = 1.1;
      } else if (u.kind === "tank") {
        solidGeo = unitGeos.tank;
        edgeGeo = unitEdges.tank;
        scale = 1.15;
      } else if (u.kind === "flyer") {
        solidGeo = unitGeos.flyer;
        edgeGeo = unitEdges.flyer;
        scale = 1.1;
      } else if (u.kind === "scout") {
        solidGeo = unitGeos.scout;
        edgeGeo = unitEdges.scout;
        scale = 1.15;
      }

      if (!UNITS[u.kind].air) {
        const pad = takeMesh(bGeos.marker, padM(u.owner));
        placeOnSurface(
          pad,
          s.x,
          s.y,
          0.04,
          0,
          0,
          0,
          u.kind === "tank" ? 0.85 : 0.65,
          1,
          u.kind === "tank" ? 0.85 : 0.65,
        );
        const ring = takeMesh(bGeos.ring, mark(u.owner));
        placeOnSurface(
          ring,
          s.x,
          s.y,
          0.07,
          0,
          0,
          0,
          u.kind === "tank" ? 1.1 : 0.9,
          1,
          u.kind === "tank" ? 1.1 : 0.9,
        );
      }

      placeWireShell(solidGeo, edgeGeo, u.owner, s.x, s.y, elev, scale, scale, scale, yaw);
    }
  });

  return <group ref={group} />;
}

function ProjectileLayer({
  snapRef,
  viewer,
}: {
  snapRef: MutableRefObject<SimSnapshot>;
  viewer: PlayerId;
}) {
  const group = useRef<THREE.Group>(null);
  const pool = useRef<THREE.Mesh[]>([]);
  const geo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), []);
  const mats = useMemo(() => {
    const mk = (hex: string, op = 0.95) =>
      new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: op,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    return {
      mine: mk("#5ef0ff", 0.95),
      mineCore: mk("#e8ffff", 0.9),
      laser0: mk("#9dff7a", 0.9),
      laser1: mk("#ffc14a", 0.9),
      bolt0: mk("#c8ff9a", 0.95),
      bolt1: mk("#ffd080", 0.95),
      shell: mk("#ffe0a0", 1),
    };
  }, []);

  useEffect(
    () => () => {
      geo.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats],
  );

  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const n = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const q = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    const g = group.current;
    const snap = snapRef.current;
    if (!g || !snap) return;
    for (const m of pool.current) m.visible = false;
    let pi = 0;
    const take = (mat: THREE.Material) => {
      let mesh = pool.current[pi];
      if (!mesh) {
        mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 8;
        pool.current.push(mesh);
        g.add(mesh);
      } else {
        mesh.material = mat;
      }
      mesh.visible = true;
      pi++;
      return mesh;
    };

    const elev = (air: number) => 0.35 + air * 1.35;

    const placeBeam = (
      mat: THREE.Material,
      ax: number,
      ay: number,
      ae: number,
      bx: number,
      by: number,
      be: number,
      radius: number,
      life: number,
    ) => {
      mapToWorld(ax, ay, a);
      surfaceNormal(ax, ay, n);
      a.addScaledVector(n, ae);
      mapToWorld(bx, by, b);
      surfaceNormal(bx, by, n);
      b.addScaledVector(n, be);
      dir.copy(b).sub(a);
      const len = dir.length();
      if (len < 0.05) return;
      mid.copy(a).add(b).multiplyScalar(0.5);
      dir.normalize();
      q.setFromUnitVectors(up, dir);
      const mesh = take(mat);
      mesh.position.copy(mid);
      mesh.quaternion.copy(q);
      const fade = Math.max(0.25, Math.min(1, life));
      mesh.scale.set(radius * fade, len, radius * fade);
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.opacity = (m.userData.baseOp ?? 0.9) * fade;
    };

    // cache base opacities once
    for (const m of Object.values(mats)) {
      if (m.userData.baseOp == null) m.userData.baseOp = m.opacity;
    }

    for (const p of snap.projectiles) {
      // skip beams wholly in fog for enemy shots? always show own; enemy if either end visible
      const visA = snap.players[viewer]!.vision;
      const see = (x: number, y: number) => {
        const cx = ((Math.floor(x) % MAP_W) + MAP_W) % MAP_W;
        const cy = Math.max(0, Math.min(MAP_H - 1, Math.floor(y)));
        return visA[cy * MAP_W + cx] === 1;
      };
      if (p.owner !== viewer && !see(p.ox, p.oy) && !see(p.tx, p.ty) && !see(p.x, p.y)) continue;

      const life = 1 - p.age / Math.max(0.01, p.maxAge);
      const teamLaser = p.owner === 0 ? mats.laser0 : mats.laser1;
      const teamBolt = p.owner === 0 ? mats.bolt0 : mats.bolt1;

      if (p.style === "mine") {
        placeBeam(
          mats.mine,
          p.ox,
          p.oy,
          elev(p.fromAir),
          p.tx,
          p.ty,
          elev(p.toAir),
          0.07,
          life,
        );
        placeBeam(
          mats.mineCore,
          p.ox,
          p.oy,
          elev(p.fromAir),
          p.tx,
          p.ty,
          elev(p.toAir),
          0.028,
          life,
        );
      } else if (p.style === "laser") {
        placeBeam(
          teamLaser,
          p.ox,
          p.oy,
          elev(p.fromAir),
          p.tx,
          p.ty,
          elev(p.toAir),
          0.055,
          life,
        );
      } else if (p.style === "shell") {
        // short glowing stub at projectile tip
        let dx = p.tx - p.x;
        if (dx > MAP_W / 2) dx -= MAP_W;
        if (dx < -MAP_W / 2) dx += MAP_W;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const back = 0.55;
        const bx = (p.x - (dx / d) * back + MAP_W) % MAP_W;
        const by = p.y - (dy / d) * back;
        placeBeam(mats.shell, bx, by, elev(p.fromAir), p.x, p.y, elev(p.fromAir), 0.1, 1);
      } else {
        let dx = p.tx - p.x;
        if (dx > MAP_W / 2) dx -= MAP_W;
        if (dx < -MAP_W / 2) dx += MAP_W;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const back = 0.4;
        const bx = (p.x - (dx / d) * back + MAP_W) % MAP_W;
        const by = p.y - (dy / d) * back;
        placeBeam(teamBolt, bx, by, elev(p.fromAir), p.x, p.y, elev(p.fromAir), 0.06, 1);
      }
    }
  });

  return <group ref={group} />;
}

function GhostMesh({
  placeRef,
  kindRef,
  viewer,
  snapRef,
}: {
  placeRef: MutableRefObject<{ x: number; y: number } | null>;
  kindRef: MutableRefObject<BuildingKind | null>;
  viewer: PlayerId;
  snapRef: MutableRefObject<SimSnapshot>;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const kind = kindRef.current;
    const ghost = placeRef.current;
    if (!kind || !ghost || !snapRef.current) {
      m.visible = false;
      return;
    }
    m.visible = true;
    placeOnSurface(m, ghost.x, ghost.y, 0.15, 0, 0, 0, 1.2, 0.5, 1.2);
    const tint = RACES[snapRef.current.players[viewer]!.race].tint;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.color.set(tint);
    mat.emissive.set(tint);
  });
  return (
    <mesh ref={mesh} visible={false}>
      <boxGeometry args={[1.4, 0.5, 1.4]} />
      <meshStandardMaterial transparent opacity={0.5} emissiveIntensity={0.55} flatShading />
    </mesh>
  );
}

function CameraRig({
  focusMap,
}: {
  focusMap: { x: number; y: number };
}) {
  const { camera, gl, size } = useThree();
  const focus = useRef(new THREE.Vector3());
  const az = useRef(0.15);
  const el = useRef(THREE.MathUtils.degToRad(48));
  const dist = useRef(GLOBE_RADIUS * 0.72);
  const azT = useRef(az.current);
  const elT = useRef(el.current);
  const distT = useRef(dist.current);
  const normal = useRef(new THREE.Vector3());
  const east = useRef(new THREE.Vector3());
  const north = useRef(new THREE.Vector3());
  const viewDir = useRef(new THREE.Vector3());
  const panEast = useRef(new THREE.Vector3());
  const panNorth = useRef(new THREE.Vector3());
  const tmp = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());
  const pointers = useRef(new Map<number, { x: number; y: number; button: number }>());
  const pinchStart = useRef<{ dist: number; camDist: number } | null>(null);
  const twoFingerMid = useRef<{ x: number; y: number } | null>(null);
  const twoFingerAngle = useRef<number | null>(null);

  useEffect(() => {
    mapToWorld(focusMap.x, focusMap.y, focus.current);
  }, [focusMap.x, focusMap.y]);

  useEffect(() => {
    const elDom = gl.domElement;
    elDom.style.touchAction = "none";
    const isUi = (t: EventTarget | null) =>
      (t as HTMLElement | null)?.closest?.("[data-ui]") != null;

    const applyPan = (dx: number, dy: number) => {
      const screenH = Math.max(1, size.height);
      const scale = (dist.current / screenH) * PAN_SCROLL;
      focus.current
        .addScaledVector(panEast.current, dx * scale)
        .addScaledVector(panNorth.current, dy * scale);
      projectToSurface(focus.current, focus.current);
    };
    const applyOrbit = (dx: number, dy: number) => {
      azT.current += dx * ORBIT_SENS;
      elT.current = THREE.MathUtils.clamp(elT.current + dy * ORBIT_SENS, EL_MIN, EL_MAX);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (isUi(e.target)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      elDom.setPointerCapture?.(e.pointerId);
      if (pointers.current.size === 2) {
        const pts = [...pointers.current.values()];
        const a = pts[0]!;
        const b = pts[1]!;
        pinchStart.current = {
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          camDist: distT.current,
        };
        twoFingerMid.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        twoFingerAngle.current = Math.atan2(b.y - a.y, b.x - a.x);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, button: prev.button });
      if (pointers.current.size >= 2) {
        const pts = [...pointers.current.values()];
        const a = pts[0]!;
        const b = pts[1]!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        if (twoFingerAngle.current != null) {
          let dAng = angle - twoFingerAngle.current;
          if (dAng > Math.PI) dAng -= Math.PI * 2;
          if (dAng < -Math.PI) dAng += Math.PI * 2;
          azT.current += dAng;
          if (twoFingerMid.current) {
            elT.current = THREE.MathUtils.clamp(
              elT.current + (mid.y - twoFingerMid.current.y) * ORBIT_SENS,
              EL_MIN,
              EL_MAX,
            );
          }
        }
        twoFingerAngle.current = angle;
        twoFingerMid.current = mid;
        if (pinchStart.current) {
          distT.current = THREE.MathUtils.clamp(
            pinchStart.current.camDist / (d / pinchStart.current.dist),
            DIST_MIN,
            DIST_MAX,
          );
        }
        return;
      }
      if (pointers.current.size === 1) {
        const orbit = prev.button === 2 || prev.button === 1 || e.altKey || e.buttons === 2;
        if (orbit) applyOrbit(dx, dy);
        else {
          applyPan(-dx, dy);
        }
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) {
        pinchStart.current = null;
        twoFingerMid.current = null;
        twoFingerAngle.current = null;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (isUi(e.target)) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 80 : 1;
      distT.current = THREE.MathUtils.clamp(
        distT.current * Math.exp(e.deltaY * scale * 0.0014),
        DIST_MIN,
        DIST_MAX,
      );
    };
    const onContext = (ev: Event) => ev.preventDefault();
    elDom.addEventListener("pointerdown", onPointerDown);
    elDom.addEventListener("pointermove", onPointerMove);
    elDom.addEventListener("pointerup", onPointerUp);
    elDom.addEventListener("pointercancel", onPointerUp);
    elDom.addEventListener("wheel", onWheel, { passive: false });
    elDom.addEventListener("contextmenu", onContext);
    return () => {
      elDom.removeEventListener("pointerdown", onPointerDown);
      elDom.removeEventListener("pointermove", onPointerMove);
      elDom.removeEventListener("pointerup", onPointerUp);
      elDom.removeEventListener("pointercancel", onPointerUp);
      elDom.removeEventListener("wheel", onWheel);
      elDom.removeEventListener("contextmenu", onContext);
    };
  }, [gl, size.height]);

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt);
    // Stay where the player left the camera — no auto-return to base
    projectToSurface(focus.current, focus.current);
    const k = 1 - Math.exp(-0.08 * 60 * d);
    az.current += (azT.current - az.current) * k;
    el.current += (elT.current - el.current) * k;
    dist.current += (distT.current - dist.current) * k;
    el.current = THREE.MathUtils.clamp(el.current, EL_MIN, EL_MAX);
    dist.current = THREE.MathUtils.clamp(dist.current, DIST_MIN, DIST_MAX);

    normal.current.copy(focus.current).normalize();
    tmp.current.set(0, 1, 0);
    north.current
      .copy(tmp.current)
      .addScaledVector(normal.current, -tmp.current.dot(normal.current));
    if (north.current.lengthSq() < 1e-8) {
      tmp.current.set(1, 0, 0);
      north.current
        .copy(tmp.current)
        .addScaledVector(normal.current, -tmp.current.dot(normal.current));
    }
    north.current.normalize();
    east.current.crossVectors(north.current, normal.current).normalize();
    north.current.crossVectors(normal.current, east.current).normalize();

    const cel = Math.cos(el.current);
    const sel = Math.sin(el.current);
    viewDir.current
      .set(0, 0, 0)
      .addScaledVector(north.current, cel * Math.cos(az.current))
      .addScaledVector(east.current, cel * Math.sin(az.current))
      .addScaledVector(normal.current, sel)
      .normalize();

    camera.position.copy(focus.current).addScaledVector(viewDir.current, dist.current);
    camera.up.copy(normal.current);
    // Aim slightly "down" (into planet along -up) so the surface sits higher in the frame
    lookTarget.current
      .copy(focus.current)
      .addScaledVector(normal.current, -dist.current * 0.16);
    camera.lookAt(lookTarget.current);
    camera.updateMatrixWorld();

    tmp.current.setFromMatrixColumn(camera.matrixWorld, 0);
    panEast.current
      .copy(tmp.current)
      .addScaledVector(normal.current, -tmp.current.dot(normal.current));
    if (panEast.current.lengthSq() < 1e-8) panEast.current.copy(east.current);
    else panEast.current.normalize();
    tmp.current.setFromMatrixColumn(camera.matrixWorld, 1);
    panNorth.current
      .copy(tmp.current)
      .addScaledVector(normal.current, -tmp.current.dot(normal.current));
    if (panNorth.current.lengthSq() < 1e-8) panNorth.current.copy(north.current);
    else panNorth.current.normalize();
  });

  return null;
}

function rayToMap(
  raycaster: THREE.Raycaster,
  globe: THREE.Object3D,
): { x: number; y: number } | null {
  const hits = raycaster.intersectObject(globe, false);
  if (!hits[0]) return null;
  const p = hits[0].point.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(p.y, -1, 1));
  const lon = Math.atan2(p.x, p.z);
  const x = ((lon / (Math.PI * 2) + 1) % 1) * MAP_W;
  const y = (lat / (Math.PI * 0.92) + 0.5) * MAP_H;
  if (y < 0.5 || y > MAP_H - 0.5) return null;
  return { x, y };
}

function PlaceGlobe({
  kindRef,
  placeRef,
  onPlace,
  globeRef,
}: {
  kindRef: MutableRefObject<BuildingKind | null>;
  placeRef: MutableRefObject<{ x: number; y: number } | null>;
  onPlace: (x: number, y: number) => void;
  globeRef: MutableRefObject<THREE.Mesh | null>;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const project = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!globeRef.current) return null;
      return rayToMap(raycaster, globeRef.current);
    };
    const onDown = (e: PointerEvent) => {
      if (!kindRef.current || e.button !== 0) return;
      if ((e.target as HTMLElement)?.closest?.("[data-ui]")) return;
      down.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!kindRef.current) return;
      const m = project(e.clientX, e.clientY);
      if (m) placeRef.current = m;
    };
    const onUp = (e: PointerEvent) => {
      if (!kindRef.current || !down.current) {
        down.current = null;
        return;
      }
      if ((e.target as HTMLElement)?.closest?.("[data-ui]")) {
        down.current = null;
        return;
      }
      const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y);
      down.current = null;
      if (moved > 10) return;
      const m = project(e.clientX, e.clientY);
      if (m) onPlace(m.x, m.y);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, kindRef, placeRef, onPlace, globeRef, raycaster, pointer]);

  return null;
}

function SceneInner({
  snapRef,
  viewer,
  placeKindRef,
  ghostRef,
  onPlace,
  focusMap,
  onGlobeReady,
}: {
  snapRef: MutableRefObject<SimSnapshot>;
  viewer: PlayerId;
  placeKindRef: MutableRefObject<BuildingKind | null>;
  ghostRef: MutableRefObject<{ x: number; y: number } | null>;
  onPlace: (x: number, y: number) => void;
  focusMap: { x: number; y: number };
  onGlobeReady?: () => void;
}) {
  const globeRef = useRef<THREE.Mesh | null>(null);
  return (
    <>
      <color attach="background" args={["#071018"]} />
      <ambientLight intensity={0.78} />
      <directionalLight position={[60, 90, 50]} intensity={2.65} color="#fff6ea" />
      <directionalLight position={[-45, 20, -35]} intensity={0.95} color="#7a9ec8" />
      <directionalLight position={[10, -40, 30]} intensity={0.35} color="#c8d8ff" />
      <hemisphereLight args={["#a8c8e8", "#2a3548", 0.55]} />
      <Starfield />
      <PolyGlobe
        meshRef={globeRef}
        snapRef={snapRef}
        viewer={viewer}
        onReady={onGlobeReady}
      />
      <EntityLayer snapRef={snapRef} viewer={viewer} />
      <ProjectileLayer snapRef={snapRef} viewer={viewer} />
      <GhostMesh placeRef={ghostRef} kindRef={placeKindRef} viewer={viewer} snapRef={snapRef} />
      <PlaceGlobe
        kindRef={placeKindRef}
        placeRef={ghostRef}
        onPlace={onPlace}
        globeRef={globeRef}
      />
      <CameraRig focusMap={focusMap} />
    </>
  );
}

export function PlanetCanvas({
  snapRef,
  viewer,
  placeKind,
  onPlace,
  onGlobeReady,
}: {
  snapRef: MutableRefObject<SimSnapshot>;
  viewer: PlayerId;
  placeKind: BuildingKind | null;
  onPlace: (x: number, y: number) => void;
  onGlobeReady?: () => void;
}) {
  const placeKindRef = useRef(placeKind);
  const ghostRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const placeStable = useRef(onPlace);
  const readyStable = useRef(onGlobeReady);
  placeKindRef.current = placeKind;
  placeStable.current = onPlace;
  readyStable.current = onGlobeReady;

  const focusMap = useMemo(() => {
    const snap = snapRef.current;
    const core = snap?.buildings.find((b) => b.owner === viewer && b.kind === "core");
    return core
      ? { x: core.x, y: core.y }
      : viewer === 0
        ? { x: MAP_W * 0.25, y: MAP_H * 0.28 }
        : { x: MAP_W * 0.75, y: MAP_H * 0.72 };
  }, [snapRef, viewer]);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return <div id="game-canvas-root" className="absolute inset-0 bg-[#02040a]" />;
  }

  return (
    <div id="game-canvas-root" className="absolute inset-0 touch-none bg-[#02040a]">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 24, GLOBE_RADIUS + 36], fov: 42, near: 0.1, far: 900 }}
        gl={{
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
          powerPreference: "default",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.28,
        }}
      >
        <SceneInner
          snapRef={snapRef}
          viewer={viewer}
          placeKindRef={placeKindRef}
          ghostRef={ghostRef}
          onPlace={(x, y) => placeStable.current(x, y)}
          focusMap={focusMap}
          onGlobeReady={() => readyStable.current?.()}
        />
      </Canvas>
    </div>
  );
}
