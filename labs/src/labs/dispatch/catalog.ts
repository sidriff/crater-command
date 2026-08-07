/**
 * Dispatch catalog — producer → product egress pairs.
 * Scout Works is gold-standard; others are draft stubs until authored for real.
 */
import type { BuildingKind, UnitKind } from "@game/sim/types";

/** ready = match-quality · draft = playable stub · stub = park only (unused now). */
export type DispatchStatus = "ready" | "draft" | "stub";

export type DispatchDef = {
  id: string;
  label: string;
  /** Building kind in match (scout = Scout Works pad). */
  building: BuildingKind;
  product: UnitKind;
  status: DispatchStatus;
  /** One-liner for the panel. */
  note: string;
  /** Mesh lab id for the empty producer (optional). */
  meshId?: string;
};

export const DISPATCHES: readonly DispatchDef[] = [
  {
    id: "scout_works",
    label: "Scout Works",
    building: "scout",
    product: "scout",
    status: "ready",
    note: "Rail fling → free flight. Gold standard — match this feel for other producers.",
    meshId: "b:scout",
  },
  {
    id: "depot",
    label: "Depot",
    building: "depot",
    product: "worker",
    status: "draft",
    note: "Draft: ramp roll-out (park pitch) → level → drive. Ground; cruise height ignored.",
    meshId: "b:depot",
  },
  {
    id: "barracks",
    label: "Bay",
    building: "barracks",
    product: "raider",
    status: "draft",
    note: "Draft: hardstand roll-out nose-first → drive. Tighter slide than depot.",
    meshId: "b:barracks",
  },
  {
    id: "airpad",
    label: "Airpad",
    building: "airpad",
    product: "interceptor",
    status: "draft",
    note: "Draft: vertical lift → pitch-over push → free. Uses air cruise when height at scout default.",
    meshId: "b:airpad",
  },
  {
    id: "bomber_works",
    label: "Bomber Works",
    building: "bomber_works",
    product: "bomber",
    status: "draft",
    note: "Draft: heavier VTOL (slower lift, softer push). Building mesh still airpad stand-in.",
    meshId: "b:airpad",
  },
];

export function dispatchById(id: string): DispatchDef {
  return DISPATCHES.find((d) => d.id === id) ?? DISPATCHES[0]!;
}

/** Cards with scrub / loop motion (ready or draft). */
export function dispatchPlayable(def: DispatchDef): boolean {
  return def.status === "ready" || def.status === "draft";
}

export function resolveDispatchId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const exact = DISPATCHES.find((d) => d.id === t || d.id.replace(/_/g, "") === t);
  if (exact) return exact.id;
  const byLabel = DISPATCHES.find(
    (d) => d.label.toLowerCase() === t || d.building === t || d.product === t,
  );
  return byLabel?.id ?? null;
}

export function listDispatchCatalog(): {
  id: string;
  label: string;
  status: DispatchStatus;
}[] {
  return DISPATCHES.map((d) => ({ id: d.id, label: d.label, status: d.status }));
}
