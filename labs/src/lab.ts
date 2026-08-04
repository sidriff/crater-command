import type { LeverDef, LeverRegistry } from "./levers";

/** Thin shell contract — labs own their update loop and scene content. */
export interface LabContext {
  /** Full-bleed globe / preview host (no UI chrome). */
  viewport: HTMLElement;
  /** Side panel host for lab-owned controls (scenarios, scorecard, etc.). */
  panel: HTMLElement;
  levers: LeverRegistry;
  /** Write a labelled row into the shell stats strip. */
  stat(key: string, value: string | number): void;
  /** Re-sync generated lever sliders after the lab mutates values. */
  refreshPanel(): void;
}

export interface Lab {
  id: string;
  title: string;
  blurb: string;
  levers: readonly LeverDef[];
  setup(ctx: LabContext): void;
  tick(dt: number, ctx: LabContext): void;
  teardown(ctx: LabContext): void;
}
