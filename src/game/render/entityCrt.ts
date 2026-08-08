/** CRT phosphor assembly flicker helpers for buildings / unit spawns. */

/**
 * CRT phosphor wink-in: hard on/off frames (not ease scale).
 * Returns visibility weight 0 or 1 for stepped flicker, then solid 1.
 */
export function crtWinkIn(ageSec: number): number {
  if (ageSec < 0.04) return 0;
  if (ageSec < 0.09) return 1;
  if (ageSec < 0.14) return 0;
  if (ageSec < 0.2) return 1;
  if (ageSec < 0.26) return 0;
  if (ageSec < 0.32) return 1;
  if (ageSec < 0.38) return 0;
  return 1;
}

/** Stepped phosphor flicker for an assembling part (seeded). */
export function crtResolveOn(tSec: number, seed: number): boolean {
  // ~28 hard frames/sec — snappier CRT bite
  const tick = Math.floor(tSec * 28 + seed * 7.3);
  const h = Math.sin(tick * 12.9898 + seed * 78.233) * 43758.5453;
  const f = h - Math.floor(h);
  return f > 0.22;
}

/**
 * Part assembly phase from build progress.
 * 0 = hidden, 1 = resolving (wire flicker), 2 = locked (hull+wire).
 */
export function partPhase(
  progress: number,
  partIndex: number,
  n: number,
  tSec: number,
  seed: number,
): 0 | 1 | 2 {
  if (n <= 0) return 2;
  if (progress >= 0.999) return 2;
  if (progress <= 0.001) return 0;
  const u = progress * n;
  const active = Math.min(n - 1, Math.floor(u));
  if (partIndex < active) return 2;
  if (partIndex > active) return 0;
  const frac = u - Math.floor(u);
  // Shorter bands so each part snaps on quicker within its progress slice
  if (frac < 0.06) return crtResolveOn(tSec, seed + partIndex) ? 1 : 0;
  if (frac < 0.45) return crtResolveOn(tSec * 1.15, seed + partIndex + 3) ? 1 : 0;
  if (!crtResolveOn(tSec * 1.4, seed + partIndex + 9)) return 1;
  return 2;
}

/**
 * Reverse of partPhase for deaths: pass structural integrity 1→0.
 * Same phase vocabulary (locked → resolving wire → gone).
 */
export function partPhaseUnbuild(
  integrity: number,
  partIndex: number,
  n: number,
  tSec: number,
  seed: number,
): 0 | 1 | 2 {
  // Outer parts unlock first: reverse index through the same progress curve.
  if (n <= 0) return integrity > 0.001 ? 2 : 0;
  const revIndex = n - 1 - partIndex;
  return partPhase(integrity, revIndex, n, tSec, seed + 17);
}

