/**
 * Map mesh catalog ids → identity-board anchors so the readability quadrant
 * can ring + focus the live solid for the selected mesh.
 */
import type { BuildingKind, UnitKind } from "@game/sim/types";
import { identityPosition } from "../readability/boards";

type Target = { entity: "building" | "unit"; kind: BuildingKind | UnitKind };

/** Mesh lab id → sim kind on the identity board (aliases share a target). */
const MESH_TARGET: Record<string, Target> = {
  "u:rover": { entity: "unit", kind: "worker" },
  "u:workerOps": { entity: "unit", kind: "worker" },
  "u:workerOpsTurret": { entity: "unit", kind: "worker" },
  "u:worker": { entity: "unit", kind: "worker" },
  "u:scout": { entity: "unit", kind: "scout" },
  "u:raider": { entity: "unit", kind: "raider" },
  "u:tank": { entity: "unit", kind: "tank" },
  "u:flyer": { entity: "unit", kind: "flyer" },
  "u:interceptor": { entity: "unit", kind: "interceptor" },
  "u:bomber": { entity: "unit", kind: "bomber" },

  "b:coreStation": { entity: "building", kind: "core" },
  "b:coreHive": { entity: "building", kind: "core" },
  "b:coreRocket": { entity: "building", kind: "core" },
  "b:extractor": { entity: "building", kind: "extractor" },
  "b:depot": { entity: "building", kind: "depot" },
  "b:depotStaged": { entity: "building", kind: "depot" },
  "b:refinery": { entity: "building", kind: "refinery" },
  "b:dome": { entity: "building", kind: "dome" },
  "b:command": { entity: "building", kind: "command" },
  "b:barracks": { entity: "building", kind: "barracks" },
  "b:barracksStaged": { entity: "building", kind: "barracks" },
  "b:turret": { entity: "building", kind: "turret" },
  "b:aa": { entity: "building", kind: "aa" },
  "b:factory": { entity: "building", kind: "factory" },
  "b:airpad": { entity: "building", kind: "airpad" },
  "b:airpadStaged": { entity: "building", kind: "airpad" },
  "b:scoutPad": { entity: "building", kind: "scout" },
  // Concept-only / alias geos used in match
  "b:logistics": { entity: "building", kind: "logistics" },
  "b:em_array": { entity: "building", kind: "em_array" },
  "b:strike_dock": { entity: "building", kind: "strike_dock" },
  "b:artillery": { entity: "building", kind: "artillery" },
  "b:bomber_works": { entity: "building", kind: "bomber_works" },
  "b:null_lattice": { entity: "building", kind: "null_lattice" },
};

/** Map cell for ring + camera, or null when no identity slot. */
export function meshIdentityFocus(
  meshId: string,
): { x: number; y: number; label: string } | null {
  const t = MESH_TARGET[meshId];
  if (!t) return null;
  const pos = identityPosition(t.entity, t.kind);
  if (!pos) return null;
  return { ...pos, label: `${t.entity}:${t.kind}` };
}
