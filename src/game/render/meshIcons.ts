/**
 * Bake phosphor mesh thumbnails for deck / HUD icons.
 * Same look as labs mesh catalog thumbs (black hull + wire silhouette),
 * regenerated from live geos so icons track geo edits without an asset pipeline.
 */
import * as THREE from "three";
import { BUILDINGS, RACES, unitProducedBy } from "../sim/defs";
import type { CardDef } from "../sim/deck";
import type { BuildingKind, RaceId, UnitKind } from "../sim/types";
import { makeBuildingGeos } from "./buildingGeos";
import { makeUnitGeos, ROVER_TURRET_PIVOT } from "./unitGeos";

const BG = 0x02040a;
const THUMB_PX = 128;
const UNIT_CREASE = 22;
const BUILD_CREASE = 18;

/** Stable icon key → PNG data URL */
export type MeshIconMap = Record<string, string>;

type IconPart = {
  geo: THREE.BufferGeometry;
  /** Optional local offset (e.g. rover turret pivot). */
  x?: number;
  y?: number;
  z?: number;
};

type IconDef = {
  key: string;
  crease: number;
  parts: IconPart[];
};

function buildingSolid(
  b: ReturnType<typeof makeBuildingGeos>,
  kind: BuildingKind,
): THREE.BufferGeometry {
  if (kind === "extractor") return b.extractor;
  if (kind === "depot") return b.depot;
  if (kind === "refinery") return b.refinery;
  if (kind === "dome") return b.dome;
  if (kind === "command") return b.command;
  if (kind === "barracks") return b.barracks;
  if (kind === "turret") return b.turret;
  if (kind === "aa") return b.aa;
  if (kind === "factory") return b.factory;
  if (kind === "airpad") return b.airpad;
  if (kind === "scout") return b.scoutPad;
  // Tech aliases — match planetEntities.buildingGeo
  if (kind === "logistics") return b.factory;
  if (kind === "em_array") return b.aa;
  if (kind === "strike_dock") return b.airpad;
  if (kind === "null_lattice") return b.dome;
  if (kind === "bomber_works") return b.airpad;
  if (kind === "capacitor") return b.depot;
  if (kind === "artillery") return b.turret;
  if (kind === "core") return b.coreStation;
  return b.extractor;
}

function unitParts(
  u: ReturnType<typeof makeUnitGeos>,
  kind: UnitKind,
  race: RaceId,
): IconPart[] {
  if (kind === "worker" && race === "operators") {
    return [
      { geo: u.workerOps },
      {
        geo: u.workerOpsTurret,
        x: ROVER_TURRET_PIVOT.x,
        y: ROVER_TURRET_PIVOT.y,
        z: ROVER_TURRET_PIVOT.z,
      },
    ];
  }
  if (kind === "worker") return [{ geo: u.worker }];
  if (kind === "raider") return [{ geo: u.raider }];
  if (kind === "tank") return [{ geo: u.tank }];
  if (kind === "flyer") return [{ geo: u.flyer }];
  if (kind === "interceptor") return [{ geo: u.interceptor }];
  if (kind === "bomber") return [{ geo: u.bomber }];
  if (kind === "scout") return [{ geo: u.scout }];
  return [{ geo: u.worker }];
}

/**
 * Icon key for a deck card.
 * Producers → unit product silhouette; pure structures → building mesh.
 * Operations have no mesh (null).
 */
export function cardIconKey(card: CardDef, race: RaceId): string | null {
  if (card.operation || !card.building) return null;
  const product = unitProducedBy(card.building, race);
  if (product) {
    if (product === "worker" && race === "operators") return "u:rover";
    return `u:${product}`;
  }
  return `b:${card.building}`;
}

/** All keys needed for a race's full card set (starter + injects). */
function keysForRace(race: RaceId): Set<string> {
  const keys = new Set<string>();
  // Every placeable building + every unit product used by that race
  for (const def of Object.values(BUILDINGS)) {
    if (!def.placeable && def.kind !== "core") continue;
    keys.add(`b:${def.kind}`);
    const product = unitProducedBy(def.kind, race);
    if (product) {
      if (product === "worker" && race === "operators") keys.add("u:rover");
      else keys.add(`u:${product}`);
    }
  }
  // Shared combat units that may appear on non-Ops decks
  for (const k of ["u:worker", "u:raider", "u:tank", "u:flyer", "u:scout"] as const) {
    keys.add(k);
  }
  return keys;
}

function resolveIconDef(
  key: string,
  race: RaceId,
  u: ReturnType<typeof makeUnitGeos>,
  b: ReturnType<typeof makeBuildingGeos>,
): IconDef | null {
  if (key.startsWith("u:")) {
    const slug = key.slice(2);
    if (slug === "rover") {
      return { key, crease: UNIT_CREASE, parts: unitParts(u, "worker", "operators") };
    }
    const kind = slug as UnitKind;
    return { key, crease: UNIT_CREASE, parts: unitParts(u, kind, race) };
  }
  if (key.startsWith("b:")) {
    const kind = key.slice(2) as BuildingKind;
    return {
      key,
      crease: BUILD_CREASE,
      parts: [{ geo: buildingSolid(b, kind) }],
    };
  }
  return null;
}

/**
 * Offscreen WebGL pass: one square PNG per icon key.
 * Safe to call at match boot; disposes its own renderer + temporary packs.
 */
export function bakeMeshIcons(
  race: RaceId = "operators",
  size = THUMB_PX,
): MeshIconMap {
  const tint = RACES[race]?.tint ?? "#2dff8c";
  const keys = [...keysForRace(race)];

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${size}px`,
    `height:${size}px`,
    "overflow:hidden",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(host);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(BG, 1);
  renderer.setSize(size, size, false);
  host.appendChild(renderer.domElement);

  const hullMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const wireMat = new THREE.LineBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const meshRoot = new THREE.Group();
  scene.add(meshRoot);

  const units = makeUnitGeos();
  const buildings = makeBuildingGeos();
  const ownedEdges: THREE.BufferGeometry[] = [];

  const clearMesh = () => {
    while (meshRoot.children.length) meshRoot.remove(meshRoot.children[0]!);
    for (const e of ownedEdges) e.dispose();
    ownedEdges.length = 0;
  };

  const frameAndSnap = (): string => {
    const box = new THREE.Box3().setFromObject(meshRoot);
    let lookY = 0.45;
    let dist = 6;
    if (!box.isEmpty()) {
      const sizeV = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      lookY = center.y;
      const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z, 0.35);
      dist = THREE.MathUtils.clamp(maxDim * 2.15, 1.4, 32);
    }
    const az = 0.55;
    const el = 0.48;
    const x = Math.cos(el) * Math.sin(az) * dist;
    const y = Math.sin(el) * dist;
    const z = Math.cos(el) * Math.cos(az) * dist;
    camera.position.set(x, y, z);
    camera.lookAt(0, lookY, 0);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  };

  const out: MeshIconMap = {};
  for (const key of keys) {
    const def = resolveIconDef(key, race, units, buildings);
    if (!def) continue;
    try {
      clearMesh();
      for (const p of def.parts) {
        const part = new THREE.Group();
        if (p.x != null || p.y != null || p.z != null) {
          part.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
        }
        part.add(new THREE.Mesh(p.geo, hullMat));
        const edges = new THREE.EdgesGeometry(p.geo, def.crease);
        ownedEdges.push(edges);
        part.add(new THREE.LineSegments(edges, wireMat));
        meshRoot.add(part);
      }
      out[key] = frameAndSnap();
    } catch {
      /* leave missing — UI falls back to text-only */
    }
  }

  clearMesh();
  hullMat.dispose();
  wireMat.dispose();
  renderer.dispose();
  host.remove();

  for (const g of Object.values(units)) g.dispose();
  // Top-level building solids (kits alias some — dispose top-level only)
  const b = buildings;
  const solids: THREE.BufferGeometry[] = [
    b.pad,
    b.padLg,
    b.scaffoldDeck,
    b.scaffoldLeg,
    b.ring,
    b.marker,
    b.coreStation,
    b.coreHive,
    b.coreRocket,
    b.coreGem,
    b.coreBeam,
    b.coreBeamSoft,
    b.extractor,
    b.depot,
    b.refinery,
    b.dome,
    b.barracks,
    b.turret,
    b.aa,
    b.factory,
    b.airpad,
    b.scoutPad,
    b.scoutPadStaged,
    b.depotStaged,
    b.barracksStaged,
    b.airpadStaged,
    b.bomberWorksStaged,
    b.command,
    b.accent,
    b.crystalSpike,
    b.crystalSpikeSm,
    b.crystalSpikeTall,
  ];
  for (const g of solids) g.dispose();
  for (const kit of Object.values(b.kits)) {
    for (const g of kit.parts) g.dispose();
    for (const g of kit.edges) g.dispose();
  }

  return out;
}

export function iconUrl(
  map: MeshIconMap,
  card: CardDef,
  race: RaceId,
): string | null {
  const key = cardIconKey(card, race);
  if (!key) return null;
  return map[key] ?? null;
}
