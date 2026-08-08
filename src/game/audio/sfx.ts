/**
 * Phosphor UI SFX + rough combat bus — Web Audio synth (muted with music).
 * World cues accept optional map position for distance / stereo pan.
 */
import { getAudioContext, isMusicMuted, unlockAudio } from "./music";
import { applySpatial, type MapPos } from "./spatial";
import type { ProjectileStyle } from "../sim/types";

type AC = AudioContext;

/** Soft polyphony gate so mass combat doesn't melt the graph. */
const lastPlay = new Map<string, number>();

function allow(key: string, minGapMs: number): boolean {
  const now = performance.now();
  const prev = lastPlay.get(key) ?? 0;
  if (now - prev < minGapMs) return false;
  lastPlay.set(key, now);
  return true;
}

function ctxReady(): AC | null {
  if (isMusicMuted()) return null;
  unlockAudio();
  return getAudioContext();
}

/** Connect a dry node through optional stereo pan to the destination. */
function toOut(c: AC, node: AudioNode, t0: number, pan: number) {
  if (Math.abs(pan) < 0.02) {
    node.connect(c.destination);
    return;
  }
  const p = c.createStereoPanner();
  p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t0);
  node.connect(p);
  p.connect(c.destination);
}

function chirp(
  freq: number,
  dur: number,
  peak = 0.055,
  when = 0,
  type: OscillatorType = "sawtooth",
  slide = 1.06,
) {
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  // light low-pass so saw isn't as harsh on phone speakers
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(Math.min(4200, freq * 3.2), t0);
  f.Q.value = 0.7;

  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide !== 1) {
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t0 + dur * 0.85);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(f);
  f.connect(g);
  toOut(c, g, t0, 0);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Cached noise buffer (short white noise). */
let noiseBuf: AudioBuffer | null = null;

function getNoise(c: AC): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const n = Math.floor(c.sampleRate * 0.35);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

function noiseBurst(
  c: AC,
  t0: number,
  dur: number,
  peak: number,
  filterType: BiquadFilterType,
  filterFreq: number,
  q = 0.8,
  pan = 0,
) {
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  const f = c.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(filterFreq, t0);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  toOut(c, g, t0, pan);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function tone(
  c: AC,
  t0: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType,
  slide = 1,
  filterFreq = 2800,
  pan = 0,
) {
  const o = c.createOscillator();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(filterFreq, t0);
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide !== 1) {
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur * 0.9);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(f);
  f.connect(g);
  toOut(c, g, t0, pan);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Soft UI tick (cascade step). */
export function sfxTick() {
  chirp(1480, 0.028, 0.032, 0, "sawtooth", 1.12);
}

/** Slightly brighter tick. */
export function sfxBlip() {
  chirp(1760, 0.032, 0.036, 0, "sawtooth", 1.1);
}

/** Menu / button press. */
export function sfxClick() {
  chirp(1240, 0.038, 0.05, 0, "sawtooth", 1.18);
  chirp(1860, 0.028, 0.028, 0.018, "sawtooth", 0.94);
}

/** Affirm (faction / ok). */
export function sfxConfirm() {
  chirp(980, 0.04, 0.048, 0, "sawtooth", 1.15);
  chirp(1470, 0.05, 0.04, 0.035, "sawtooth", 1.12);
  chirp(1960, 0.07, 0.03, 0.08, "triangle", 1.05);
}

/** Denied / invalid. */
export function sfxDeny() {
  chirp(420, 0.07, 0.04, 0, "sawtooth", 0.72);
  chirp(280, 0.1, 0.035, 0.05, "sawtooth", 0.8);
}

/** Building locked. */
export function sfxPlace() {
  chirp(880, 0.035, 0.042, 0, "sawtooth", 1.14);
  chirp(1320, 0.045, 0.036, 0.03, "sawtooth", 1.1);
  chirp(1760, 0.06, 0.028, 0.07, "triangle", 1.06);
}

/** Open panel / enter mode. */
export function sfxOpen() {
  chirp(1100, 0.035, 0.04, 0, "sawtooth", 1.2);
  chirp(1650, 0.045, 0.03, 0.028, "sawtooth", 1.1);
}

/** Close / cancel. */
export function sfxClose() {
  chirp(1320, 0.03, 0.032, 0, "sawtooth", 0.88);
  chirp(880, 0.045, 0.028, 0.028, "sawtooth", 0.85);
}

/** Audio bridge while ESTABLISHING LINK… */
export function sfxLinkStart() {
  if (isMusicMuted()) return;
  unlockAudio();
  const c = getAudioContext();
  if (!c) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(2400, t0);
  o.type = "sawtooth";
  o.frequency.setValueAtTime(320, t0);
  o.frequency.exponentialRampToValueAtTime(1280, t0 + 0.55);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  o.connect(f);
  f.connect(g);
  toOut(c, g, t0, 0);
  o.start(t0);
  o.stop(t0 + 0.65);

  for (let i = 0; i < 6; i++) {
    chirp(1400 + i * 110, 0.035, 0.03, 0.12 + i * 0.09, "sawtooth", 1.08);
  }
}

export function sfxLinkOk() {
  chirp(1180, 0.04, 0.045, 0, "sawtooth", 1.12);
  chirp(1760, 0.06, 0.038, 0.04, "sawtooth", 1.08);
  chirp(2340, 0.09, 0.03, 0.1, "triangle", 1.04);
}

// ── Combat bus (rough procedural) ──────────────────────────────────────────

/** Weapon fire by projectile style. Skips mine beams. */
export function sfxWeaponFire(style: ProjectileStyle, light = false, pos?: MapPos | null) {
  if (style === "mine") return;
  const base = style === "laser" ? (light ? 0.028 : 0.045) : style === "shell" ? 0.07 : 0.05;
  const sp = applySpatial(base, pos);
  if (!sp) return;
  if (!allow(`fire:${style}:${light ? "L" : "H"}`, light ? 45 : 55)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const jit = 0.92 + Math.random() * 0.16;
  const { peak, pan } = sp;

  if (style === "laser") {
    tone(c, t0, (light ? 2100 : 1680) * jit, light ? 0.05 : 0.07, peak, "sawtooth", 1.35, 4200, pan);
    tone(c, t0, (light ? 3200 : 2600) * jit, 0.04, peak * 0.55, "triangle", 1.2, 5000, pan);
    noiseBurst(c, t0, 0.03, peak * 0.35, "highpass", 1800, 0.5, pan);
    return;
  }

  if (style === "shell") {
    tone(c, t0, 90 * jit, 0.12, peak, "sine", 0.55, 220, pan);
    tone(c, t0, 160 * jit, 0.08, peak * 0.57, "triangle", 0.7, 400, pan);
    noiseBurst(c, t0, 0.09, peak * 0.78, "lowpass", 900, 0.6, pan);
    return;
  }

  tone(c, t0, 420 * jit, 0.06, peak, "square", 0.75, 1600, pan);
  tone(c, t0, 880 * jit, 0.045, peak * 0.6, "sawtooth", 1.15, 2400, pan);
  noiseBurst(c, t0, 0.04, peak * 0.6, "bandpass", 1200, 1.2, pan);
}

/** Projectile impact / splash. */
export function sfxHit(style: ProjectileStyle, onBuilding = false, pos?: MapPos | null) {
  if (style === "mine") return;
  const mul = onBuilding ? 1.25 : 1;
  const base =
    style === "shell" ? 0.07 * mul : style === "laser" ? 0.035 * mul : 0.045 * mul;
  const sp = applySpatial(base, pos);
  if (!sp) return;
  if (!allow(`hit:${style}:${onBuilding ? "b" : "u"}`, 40)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const jit = 0.9 + Math.random() * 0.2;
  const { peak, pan } = sp;

  if (style === "shell") {
    noiseBurst(c, t0, 0.12 * mul, peak, "lowpass", 700 * jit, 0.7, pan);
    tone(c, t0, 70 * jit, 0.14, peak * 0.78, "sine", 0.5, 180, pan);
    return;
  }
  if (style === "laser") {
    noiseBurst(c, t0, 0.045, peak, "highpass", 1400, 0.6, pan);
    tone(c, t0, 1400 * jit, 0.05, peak * 0.85, "triangle", 0.6, 3000, pan);
    return;
  }
  noiseBurst(c, t0, 0.06, peak, "bandpass", 900 * jit, 1, pan);
  tone(c, t0, 220 * jit, 0.07, peak * 0.78, "triangle", 0.65, 800, pan);
}

/** Unit destroyed. */
export function sfxUnitDeath(air = false, pos?: MapPos | null) {
  const sp = applySpatial(air ? 0.06 : 0.065, pos);
  if (!sp) return;
  if (!allow(air ? "death:air" : "death:unit", 70)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const jit = 0.9 + Math.random() * 0.2;
  const { peak, pan } = sp;

  if (air) {
    noiseBurst(c, t0, 0.1, peak, "bandpass", 1600 * jit, 0.9, pan);
    tone(c, t0, 900 * jit, 0.18, peak * 0.67, "sawtooth", 0.35, 2200, pan);
    tone(c, t0, 180 * jit, 0.14, peak * 0.5, "sine", 0.5, 300, pan);
    return;
  }
  noiseBurst(c, t0, 0.14, peak, "lowpass", 600 * jit, 0.7, pan);
  tone(c, t0, 140 * jit, 0.16, peak * 0.77, "sine", 0.45, 250, pan);
  tone(c, t0, 320 * jit, 0.1, peak * 0.43, "triangle", 0.55, 700, pan);
}

/** Building / core destroyed — heavier boom. */
export function sfxBuildingDeath(isCore = false, pos?: MapPos | null) {
  const mul = isCore ? 1.5 : 1;
  const sp = applySpatial(0.09 * mul, pos);
  if (!sp) return;
  if (!allow(isCore ? "death:core" : "death:bldg", isCore ? 200 : 90)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const { peak, pan } = sp;

  noiseBurst(c, t0, 0.22 * mul, peak, "lowpass", 450, 0.5, pan);
  noiseBurst(c, t0 + 0.02, 0.12, peak * 0.55, "highpass", 900, 0.6, pan);
  tone(c, t0, 55, 0.28 * mul, peak * 0.89, "sine", 0.4, 140, pan);
  tone(c, t0, 110, 0.2, peak * 0.44, "triangle", 0.5, 280, pan);
  if (isCore) {
    tone(c, t0 + 0.05, 40, 0.4, peak * 0.67, "sine", 0.6, 100, pan);
  }
}

/** Unit rolled off the pad / produced. */
export function sfxUnitSpawn(air = false, pos?: MapPos | null) {
  const sp = applySpatial(air ? 0.03 : 0.035, pos);
  if (!sp) return;
  if (!allow(air ? "spawn:air" : "spawn:ground", 80)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const { peak, pan } = sp;

  if (air) {
    noiseBurst(c, t0, 0.08, peak, "highpass", 700, 0.5, pan);
    tone(c, t0, 480, 0.1, peak * 1.07, "triangle", 1.45, 1800, pan);
    tone(c, t0 + 0.04, 720, 0.09, peak * 0.73, "sine", 1.3, 2400, pan);
    return;
  }
  tone(c, t0, 360, 0.07, peak, "square", 1.4, 1400, pan);
  tone(c, t0 + 0.03, 540, 0.08, peak * 0.8, "triangle", 1.25, 2000, pan);
  noiseBurst(c, t0 + 0.01, 0.05, peak * 0.57, "lowpass", 800, 0.6, pan);
}

// ── Construction bus ───────────────────────────────────────────────────────

/**
 * Single construction zap — thin electric tick to match worker build beams.
 * Call in a burst/pause pattern from the snapshot driver.
 */
export function sfxBuildZap(pos?: MapPos | null) {
  const sp = applySpatial(0.028, pos);
  if (!sp) return;
  if (!allow("build:zap", 38)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const jit = 0.88 + Math.random() * 0.28;
  const { peak, pan } = sp;

  noiseBurst(c, t0, 0.028, peak, "highpass", 2200 * jit, 0.7, pan);
  tone(c, t0, 1900 * jit, 0.035, peak * 0.93, "sawtooth", 1.22, 4800, pan);
  tone(c, t0, 2800 * jit, 0.022, peak * 0.5, "triangle", 1.1, 5600, pan);
}

/** Scaffold start when a worker first bites into a pad (progress leaves 0). */
export function sfxBuildStart(pos?: MapPos | null) {
  const sp = applySpatial(0.034, pos);
  if (!sp) return;
  if (!allow("build:start", 120)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const { peak, pan } = sp;
  tone(c, t0, 520, 0.06, peak, "square", 1.18, 1800, pan);
  tone(c, t0 + 0.025, 780, 0.07, peak * 0.76, "triangle", 1.12, 2400, pan);
  noiseBurst(c, t0 + 0.01, 0.05, peak * 0.65, "bandpass", 1100, 0.9, pan);
}

/** Structure locked in — finished construction. */
export function sfxBuildComplete(pos?: MapPos | null) {
  const sp = applySpatial(0.05, pos);
  if (!sp) return;
  if (!allow("build:done", 90)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const { peak, pan } = sp;

  tone(c, t0, 95, 0.12, peak, "sine", 0.7, 220, pan);
  noiseBurst(c, t0, 0.07, peak * 0.6, "lowpass", 700, 0.6, pan);
  tone(c, t0 + 0.04, 640, 0.07, peak * 0.72, "triangle", 1.28, 2000, pan);
  tone(c, t0 + 0.09, 960, 0.09, peak * 0.6, "triangle", 1.15, 2800, pan);
  tone(c, t0 + 0.15, 1280, 0.1, peak * 0.44, "sine", 1.08, 3200, pan);
}
