/**
 * Legacy re-export — Dispatch lab is now Construction.
 * Prefer `labs/construction` and lab id `construction`.
 */
export {
  makeConstructionLab as makeDispatchLab,
  makeConstructionLab,
  getConstructionLabHandle,
  getDispatchLabHandle,
  listConstructionCatalog,
  listDispatchCatalog,
  resolveCardId,
  resolveDispatchId,
  CARDS,
  DISPATCHES,
} from "../construction/index";

export type {
  ConstructionLabHandle,
  ConstructionLabHandle as DispatchLabHandle,
  ConstructionVerdict,
  ConstructionVerdict as DispatchVerdict,
} from "../construction/index";
