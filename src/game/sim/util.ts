import { MAP_H, MAP_W } from "./defs";
import type { BuildingKind, ProjectileStyle, UnitKind } from "./types";

let nextId = 1;

export function allocId(): number {
  return nextId++;
}

export function getNextId(): number {
  return nextId;
}

export function setNextId(n: number) {
  nextId = n;
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function dist(ax: number, ay: number, bx: number, by: number) {
  let dx = Math.abs(ax - bx);
  if (dx > MAP_W / 2) dx = MAP_W - dx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

export function cellKey(x: number, y: number) {
  return `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2}`;
}

export function unitShotStyle(kind: UnitKind): ProjectileStyle {
  if (kind === "tank") return "shell";
  if (kind === "flyer" || kind === "scout") return "laser";
  return "bolt";
}

export function buildingShotStyle(kind: BuildingKind): ProjectileStyle {
  if (kind === "aa") return "laser";
  return "bolt";
}

export function sepRadius(kind: UnitKind): number {
  if (kind === "tank") return 0.95;
  if (kind === "flyer") return 0.85;
  if (kind === "raider") return 0.7;
  if (kind === "scout") return 0.65;
  return 0.55; // worker
}

/** Stable slot angle for unit around a focus point */
export function slotAngle(id: number, slots = 8): number {
  return ((id * 2.399) % slots) * ((Math.PI * 2) / slots);
}

export { MAP_H, MAP_W };
