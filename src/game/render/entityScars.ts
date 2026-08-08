/**
 * Surface scars — lasting phosphor marks where units died / crashed.
 * Vacuum-hard: thin wire rings + faint fill, no smoke.
 */
import * as THREE from "three";
import type { RaceId } from "../sim/types";
import { RACES } from "../sim/defs";
import { placeOnSurface } from "./planetMath";

export const SCAR_MAX = 48;

export type ScarKind = "impact" | "skid" | "burn";

export type Scar = {
  root: THREE.Group;
  ring: THREE.LineSegments;
  fill: THREE.Mesh;
  ringMat: THREE.LineBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  alive: boolean;
  scale0: number;
};

export type ScarHost = {
  scarRoot: THREE.Group;
  scarPool: Scar[];
  scarActive: number;
  scarRingGeo: THREE.BufferGeometry;
  scarFillGeo: THREE.BufferGeometry;
  /** Shared templates; each scar clones so opacity can age independently. */
  scarMatTemplates: Record<string, { ring: THREE.LineBasicMaterial; fill: THREE.MeshBasicMaterial }>;
};

/** Hex ring in XZ (y-up model space) for placeOnSurface. */
export function makeScarRingGeo(radius = 0.55, segments = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    pos.push(
      Math.cos(a0) * radius,
      0,
      Math.sin(a0) * radius,
      Math.cos(a1) * radius,
      0,
      Math.sin(a1) * radius,
    );
  }
  // Cross hair for impact read at distance
  pos.push(-radius * 0.35, 0, 0, radius * 0.35, 0, 0);
  pos.push(0, 0, -radius * 0.35, 0, 0, radius * 0.35);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function makeScarFillGeo(radius = 0.42): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

function ensureScarTemplates(host: ScarHost, race: RaceId) {
  if (host.scarMatTemplates[race]) return host.scarMatTemplates[race]!;
  const tint = new THREE.Color(RACES[race].tint);
  const ring = new THREE.LineBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  });
  const fill = new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const pair = { ring, fill };
  host.scarMatTemplates[race] = pair;
  return pair;
}

function acquireScar(host: ScarHost): Scar {
  for (const s of host.scarPool) {
    if (!s.alive) return s;
  }
  if (host.scarPool.length >= SCAR_MAX) {
    // Recycle oldest
    let oldest = host.scarPool[0]!;
    for (const s of host.scarPool) {
      if (s.age > oldest.age) oldest = s;
    }
    oldest.alive = false;
    oldest.root.visible = false;
    return oldest;
  }
  const root = new THREE.Group();
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x2dff8c,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  });
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x2dff8c,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.LineSegments(host.scarRingGeo, ringMat);
  const fill = new THREE.Mesh(host.scarFillGeo, fillMat);
  root.add(fill);
  root.add(ring);
  host.scarRoot.add(root);
  const scar: Scar = {
    root,
    ring,
    fill,
    ringMat,
    fillMat,
    age: 0,
    life: 60,
    alive: false,
    scale0: 1,
  };
  host.scarPool.push(scar);
  return scar;
}

/**
 * Stamp a scar at map (x,y). `scale` is unit tier size (~0.6–1.4).
 * `kind` tweaks life and initial scale punch.
 */
export function stampScar(
  host: ScarHost,
  x: number,
  y: number,
  race: RaceId,
  scale: number,
  kind: ScarKind = "impact",
) {
  const scar = acquireScar(host);
  const tmpl = ensureScarTemplates(host, race);
  scar.ringMat.color.copy(tmpl.ring.color);
  scar.fillMat.color.copy(tmpl.fill.color);
  scar.ringMat.opacity = 0.75;
  scar.fillMat.opacity = 0.12;
  scar.alive = true;
  scar.age = 0;
  scar.life = kind === "burn" ? 90 : kind === "skid" ? 55 : 70;
  scar.scale0 = scale * (kind === "burn" ? 1.15 : kind === "skid" ? 0.85 : 1);
  scar.root.visible = true;
  // Slight random yaw so rings don't tile
  const yaw = Math.random() * Math.PI * 2;
  placeOnSurface(scar.root, x, y, 0.025, 0, 0, 0, scar.scale0, 1, scar.scale0, yaw);
  host.scarActive = host.scarPool.reduce((n, s) => n + (s.alive ? 1 : 0), 0);
}

export function updateScars(host: ScarHost, dt: number) {
  if (host.scarActive <= 0) return;
  let live = 0;
  for (const scar of host.scarPool) {
    if (!scar.alive) continue;
    scar.age += dt;
    if (scar.age >= scar.life) {
      scar.alive = false;
      scar.root.visible = false;
      continue;
    }
    live++;
    const t = scar.age / scar.life;
    // CRT bite at birth, then long slow phosphor decay
    let op = 1;
    if (scar.age < 0.06) op = 0;
    else if (scar.age < 0.1) op = 1;
    else if (scar.age < 0.14) op = 0.35;
    else if (scar.age < 0.2) op = 1;
    else op = 1 - t * t;

    scar.ringMat.opacity = 0.2 + 0.55 * op;
    scar.fillMat.opacity = 0.03 + 0.12 * op;

    // Grow slightly then settle
    const punch = scar.age < 0.25 ? 1 + (1 - scar.age / 0.25) * 0.2 : 1;
    const sc = scar.scale0 * punch * (1 + t * 0.08);
    scar.root.scale.set(sc, 1, sc);
  }
  host.scarActive = live;
}

export function disposeScars(host: ScarHost) {
  for (const pair of Object.values(host.scarMatTemplates)) {
    pair.ring.dispose();
    pair.fill.dispose();
  }
  host.scarRingGeo.dispose();
  host.scarFillGeo.dispose();
  for (const s of host.scarPool) {
    s.ringMat.dispose();
    s.fillMat.dispose();
    s.root.removeFromParent();
  }
  host.scarPool.length = 0;
  host.scarActive = 0;
}
