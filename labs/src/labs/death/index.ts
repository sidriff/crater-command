/**
 * Legacy re-export — Death lab is now Destruction.
 * Prefer `labs/destruction` and lab id `destruction`.
 */
export {
  makeDestructionLab,
  makeDestructionLab as makeDeathLab,
  getDestructionLabHandle,
  getDestructionLabHandle as getDeathLabHandle,
  listDestructionCatalog,
  listDestructionCatalog as listDeathCatalog,
  resolveDestructionId,
  resolveDestructionId as resolveDeathId,
} from "../destruction/index";

export type {
  DestructionLabHandle,
  DestructionLabHandle as DeathLabHandle,
  DestructionVerdict,
  DestructionVerdict as DeathVerdict,
} from "../destruction/index";
