import * as THREE from "three";
import { MAP_H, MAP_W } from "../sim/defs";
import type { PlayerId, SimSnapshot } from "../sim/types";

export const FOW_SCALE = 6;

export type FowState = {
  tex: THREE.DataTexture;
  seen: Uint8Array;
  edge: Uint8Array;
  dist: Float32Array;
  time: number;
};

export function createFowState(): FowState {
  const FW = MAP_W * FOW_SCALE;
  const FH = MAP_H * FOW_SCALE;
  const data = new Uint8Array(FW * FH * 4);
  const tex = new THREE.DataTexture(data, FW, FH);
  tex.format = THREE.RGBAFormat;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return {
    tex,
    seen: new Uint8Array(FW * FH),
    edge: new Uint8Array(FW * FH),
    dist: new Float32Array(FW * FH),
    time: 0,
  };
}

/** Bake vision into FOW texture; advance shader time uniform if present. */
export function updateFow(
  fow: FowState,
  snap: SimSnapshot,
  viewer: PlayerId,
  dt: number,
  planetMat: THREE.MeshStandardMaterial | null,
) {
  fow.time += dt;
  const sh = planetMat?.userData.shader as
    | { uniforms: { uFowTime: { value: number } } }
    | undefined;
  if (sh?.uniforms?.uFowTime) sh.uniforms.uFowTime.value = fow.time;

  const SCALE = FOW_SCALE;
  const FW = MAP_W * SCALE;
  const FH = MAP_H * SCALE;
  const RIM_PX = 2;
  const vis = snap.players[viewer]?.vision;
  if (!vis) return;
  const data = fow.tex.image.data as Uint8Array;
  const seenBuf = fow.seen;
  const edgeBuf = fow.edge;
  const distBuf = fow.dist;
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
  fow.tex.needsUpdate = true;
}

export function attachFowShader(
  mat: THREE.MeshStandardMaterial,
  fowTex: THREE.DataTexture,
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFowMap = { value: fowTex };
    shader.uniforms.uFowTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vFowUv;`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>\nvFowUv = uv;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uFowMap;
uniform float uFowTime;
varying vec2 vFowUv;
float fowHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec4 fow = texture2D(uFowMap, vFowUv);
  float shroud = clamp(fow.a, 0.0, 1.0);
  float rimAmt = smoothstep(0.35, 0.75, fow.g)
               * smoothstep(0.35, 0.85, fow.b)
               * shroud;
  float veil = shroud * (1.0 - rimAmt * 0.9);
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    diffuseColor.rgb * 0.1 + vec3(0.015, 0.02, 0.045),
    veil
  );
  if (rimAmt > 0.02) {
    float noise = fowHash(floor(vFowUv * 220.0) + floor(uFowTime * 10.0));
    float life = (0.9 + 0.12 * noise)
               * (0.92 + 0.08 * sin(uFowTime * 14.0 + vFowUv.x * 30.0));
    diffuseColor.rgb += fow.rgb * rimAmt * 0.95 * life;
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => "planet-fow-bake-v1";
}
