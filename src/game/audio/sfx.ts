/**
 * Phosphor UI SFX + rough combat bus — Web Audio synth (muted with music).
 */
import { getAudioContext, isMusicMuted, unlockAudio } from "./music";
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
  g.connect(c.destination);
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
  g.connect(c.destination);
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
  g.connect(c.destination);
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
  g.connect(c.destination);
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
export function sfxWeaponFire(style: ProjectileStyle, light = false) {
  if (style === "mine") return;
  if (!allow(`fire:${style}:${light ? "L" : "H"}`, light ? 45 : 55)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const jit = 0.92 + Math.random() * 0.16;

  if (style === "laser") {
    // Thin high zap — scouts quieter
    const peak = light ? 0.028 : 0.045;
    tone(c, t0, (light ? 2100 : 1680) * jit, light ? 0.05 : 0.07, peak, "sawtooth", 1.35, 4200);
    tone(c, t0, (light ? 3200 : 2600) * jit, 0.04, peak * 0.55, "triangle", 1.2, 5000);
    noiseBurst(c, t0, 0.03, peak * 0.35, "highpass", 1800, 0.5);
    return;
  }

  if (style === "shell") {
    // Low thump + grit
    tone(c, t0, 90 * jit, 0.12, 0.07, "sine", 0.55, 220);
    tone(c, t0, 160 * jit, 0.08, 0.04, "triangle", 0.7, 400);
    noiseBurst(c, t0, 0.09, 0.055, "lowpass", 900, 0.6);
    return;
  }

  // bolt — mid punch
  tone(c, t0, 420 * jit, 0.06, 0.05, "square", 0.75, 1600);
  tone(c, t0, 880 * jit, 0.045, 0.03, "sawtooth", 1.15, 2400);
  noiseBurst(c, t0, 0.04, 0.03, "bandpass", 1200, 1.2);
}

/** Projectile impact / splash. */
export function sfxHit(style: ProjectileStyle, onBuilding = false) {
  if (style === "mine") return;
  if (!allow(`hit:${style}:${onBuilding ? "b" : "u"}`, 40)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const mul = onBuilding ? 1.25 : 1;
  const jit = 0.9 + Math.random() * 0.2;

  if (style === "shell") {
    noiseBurst(c, t0, 0.12 * mul, 0.07 * mul, "lowpass", 700 * jit, 0.7);
    tone(c, t0, 70 * jit, 0.14, 0.055 * mul, "sine", 0.5, 180);
    return;
  }
  if (style === "laser") {
    noiseBurst(c, t0, 0.045, 0.035 * mul, "highpass", 1400, 0.6);
    tone(c, t0, 1400 * jit, 0.05, 0.03 * mul, "triangle", 0.6, 3000);
    return;
  }
  noiseBurst(c, t0, 0.06, 0.045 * mul, "bandpass", 900 * jit, 1);
  tone(c, t0, 220 * jit, 0.07, 0.035 * mul, "triangle", 0.65, 800);
}

/** Unit destroyed. */
export function sfxUnitDeath(air = false) {
  if (!allow(air ? "death:air" : "death:unit", 70)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const jit = 0.9 + Math.random() * 0.2;

  if (air) {
    // Pop + falling whine
    noiseBurst(c, t0, 0.1, 0.06, "bandpass", 1600 * jit, 0.9);
    tone(c, t0, 900 * jit, 0.18, 0.04, "sawtooth", 0.35, 2200);
    tone(c, t0, 180 * jit, 0.14, 0.03, "sine", 0.5, 300);
    return;
  }
  noiseBurst(c, t0, 0.14, 0.065, "lowpass", 600 * jit, 0.7);
  tone(c, t0, 140 * jit, 0.16, 0.05, "sine", 0.45, 250);
  tone(c, t0, 320 * jit, 0.1, 0.028, "triangle", 0.55, 700);
}

/** Building / core destroyed — heavier boom. */
export function sfxBuildingDeath(isCore = false) {
  if (!allow(isCore ? "death:core" : "death:bldg", isCore ? 200 : 90)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;
  const mul = isCore ? 1.5 : 1;

  noiseBurst(c, t0, 0.22 * mul, 0.09 * mul, "lowpass", 450, 0.5);
  noiseBurst(c, t0 + 0.02, 0.12, 0.05 * mul, "highpass", 900, 0.6);
  tone(c, t0, 55, 0.28 * mul, 0.08 * mul, "sine", 0.4, 140);
  tone(c, t0, 110, 0.2, 0.04 * mul, "triangle", 0.5, 280);
  if (isCore) {
    tone(c, t0 + 0.05, 40, 0.4, 0.06, "sine", 0.6, 100);
  }
}

/** Unit rolled off the pad / produced. */
export function sfxUnitSpawn(air = false) {
  if (!allow(air ? "spawn:air" : "spawn:ground", 80)) return;
  const c = ctxReady();
  if (!c) return;
  const t0 = c.currentTime;

  if (air) {
    // Soft thruster puff + rise
    noiseBurst(c, t0, 0.08, 0.03, "highpass", 700, 0.5);
    tone(c, t0, 480, 0.1, 0.032, "triangle", 1.45, 1800);
    tone(c, t0 + 0.04, 720, 0.09, 0.022, "sine", 1.3, 2400);
    return;
  }
  // Ground deploy chirp
  tone(c, t0, 360, 0.07, 0.035, "square", 1.4, 1400);
  tone(c, t0 + 0.03, 540, 0.08, 0.028, "triangle", 1.25, 2000);
  noiseBurst(c, t0 + 0.01, 0.05, 0.02, "lowpass", 800, 0.6);
}
