/**
 * Construction progress helpers — mirror match entityCrt / entityBuildings.
 * Pure functions so scrub is deterministic.
 */
import { crtWinkIn, partPhase } from "@game/render/entityCrt";

export type ConstructTuning = {
  /** Seconds for progress 0→1 (kit resolve window). */
  constructDur: number;
  /** Seed for CRT flicker (stable per card). */
  seed: number;
};

export const DEFAULT_CONSTRUCT: ConstructTuning = {
  constructDur: 8,
  seed: 1.7,
};

export type PartVis = {
  /** 0 hidden · 1 wire resolve · 2 locked hull+wire */
  phase: 0 | 1 | 2;
};

export type ConstructFrame = {
  /** Build progress 0–1. */
  progress: number;
  /** Scaffold / pad visibility 0–1 (wink before work starts). */
  scaffoldVis: number;
  /** Per-kit-part phase. Empty when using solid-only path. */
  parts: PartVis[];
  /**
   * Solid shell path (no kit, or finished):
   * 0 hidden · 1 wire · 2 locked.
   */
  solidPhase: 0 | 1 | 2;
  phase: "idle" | "scaffold" | "resolve" | "done";
  done: boolean;
};

/**
 * Evaluate construction frame at time since work start.
 * tSec < 0 → scaffold wink only (hold-before).
 * tSec in [0, constructDur] → progress ramp.
 * tSec > constructDur → done.
 */
export function evalConstruct(
  tSec: number,
  tuning: ConstructTuning,
  partCount: number,
): ConstructFrame {
  const dur = Math.max(0.2, tuning.constructDur);
  const seed = tuning.seed;

  if (tSec <= 0) {
    // Hold-before: scaffold CRT-winks in, no building yet.
    // Map negative clock so age=0 at start of hold (large |tSec|) and grows toward launch.
    // Callers pass t = wall - holdBefore, so t ∈ [-holdBefore, 0].
    const age = Math.max(0, 0.5 + tSec); // ~0 early in hold if hold≥0.5s; solid near t=0
    const scaf = crtWinkIn(age);
    return {
      progress: 0,
      scaffoldVis: scaf,
      parts: Array.from({ length: partCount }, () => ({ phase: 0 as const })),
      solidPhase: 0,
      phase: "scaffold",
      done: false,
    };
  }

  const progress = Math.min(1, tSec / dur);
  const done = progress >= 0.999;

  if (partCount > 0) {
    const parts: PartVis[] = [];
    for (let i = 0; i < partCount; i++) {
      parts.push({
        phase: partPhase(progress, i, partCount, tSec, seed),
      });
    }
    return {
      progress,
      scaffoldVis: 1,
      parts,
      solidPhase: done ? 2 : 0,
      phase: done ? "done" : "resolve",
      done,
    };
  }

  // No kit: solid wink-in over first half, locked after
  let solidPhase: 0 | 1 | 2 = 0;
  if (done || progress >= 0.55) {
    solidPhase = 2;
  } else if (progress > 0.04) {
    solidPhase = partPhase(Math.min(0.99, progress * 1.4), 0, 1, tSec, seed);
  }

  return {
    progress,
    scaffoldVis: 1,
    parts: [],
    solidPhase,
    phase: done ? "done" : solidPhase === 0 ? "scaffold" : "resolve",
    done,
  };
}

/** Window length for construct mode (progress only — holds added by lab). */
export function constructWindowSec(t: ConstructTuning): number {
  return Math.max(0.2, t.constructDur);
}
