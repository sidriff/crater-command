/**
 * Map-space listener for combat/world SFX — distance gain + stereo pan.
 * Listener sits at the camera surface focus; pan uses screen-right on the map.
 */
import { MAP_H, MAP_W } from "../sim/defs";

export type MapPos = { x: number; y: number };

export type AudioListenerPose = {
  /** Focus point in map units */
  x: number;
  y: number;
  /** Screen-right unit vector in map space (wrapped X) */
  rightX: number;
  rightY: number;
  /**
   * Hear-radius scale from camera zoom (1 = default tactical).
   * Zoomed out → larger map radius still reads “near”.
   */
  hearScale: number;
};

/** Resolved routing for one one-shot. */
export type SpatialMix = {
  /** 0…1 peak scale */
  gain: number;
  /** StereoPanner −1…1 */
  pan: number;
};

let pose: AudioListenerPose | null = null;

/** Full volume within this map distance (× hearScale). */
const FULL_DIST = 2.2;
/** Silent beyond this map distance (× hearScale). */
const MAX_DIST = 15;
/** Map units of lateral offset for full L/R pan (× hearScale). */
const PAN_SCALE = 7;
/** Drop events quieter than this (saves polyphony). */
const GAIN_FLOOR = 0.035;

export function setAudioListener(next: AudioListenerPose | null) {
  pose = next;
}

export function getAudioListener(): AudioListenerPose | null {
  return pose;
}

export function clearAudioListener() {
  pose = null;
}

/** Shortest wrapped Δx on the cylindrical map. */
export function wrapDx(fromX: number, toX: number): number {
  let dx = toX - fromX;
  if (dx > MAP_W * 0.5) dx -= MAP_W;
  if (dx < -MAP_W * 0.5) dx += MAP_W;
  return dx;
}

export function mapDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = wrapDx(ax, bx);
  const dy = by - ay;
  return Math.hypot(dx, dy);
}

/**
 * Gain + pan for a source at map (x,y).
 * Returns null if too quiet / no listener yet (caller may still play centered).
 */
export function spatialAt(x: number, y: number): SpatialMix | null {
  if (!pose) return { gain: 1, pan: 0 };

  const hs = Math.max(0.55, Math.min(2.2, pose.hearScale));
  const full = FULL_DIST * hs;
  const maxD = MAX_DIST * hs;
  const panSc = PAN_SCALE * hs;

  const dx = wrapDx(pose.x, x);
  const dy = y - pose.y;
  // Soft clamp Y so polar stretch doesn’t dominate
  const dyw = dy * (MAP_W / Math.max(MAP_H, 1));
  const d = Math.hypot(dx, dy);

  let gain: number;
  if (d <= full) gain = 1;
  else if (d >= maxD) gain = 0;
  else {
    const t = (d - full) / (maxD - full);
    // Gentle curve — still present mid-field, dies at edge
    gain = Math.pow(1 - t, 1.35);
  }

  if (gain < GAIN_FLOOR) return null;

  // Lateral along screen-right (map tangent)
  const lateral = dx * pose.rightX + dy * pose.rightY;
  // Slight front/back: pure left/right from lateral; nudge pan with screen-space x
  let pan = lateral / panSc;
  // Secondary: raw east bias if right vector is weak
  if (Math.hypot(pose.rightX, pose.rightY) < 0.2) {
    pan = dx / panSc;
  }
  // Keep a touch of height in pan so N/S isn’t fully mono (stereo image width)
  pan += (dyw * 0.15) / panSc;
  pan = Math.max(-1, Math.min(1, pan));

  return { gain, pan };
}

/** Multiply peak; if spatial says silent, returns null (skip the one-shot). */
export function applySpatial(
  peak: number,
  pos?: MapPos | null,
): { peak: number; pan: number } | null {
  if (!pos) return { peak, pan: 0 };
  const s = spatialAt(pos.x, pos.y);
  if (!s) return null;
  return { peak: peak * s.gain, pan: s.pan };
}
