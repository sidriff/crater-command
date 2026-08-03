/**
 * Phosphor UI SFX — high, thin saw/chirp synth (muted with music).
 */
import { getAudioContext, isMusicMuted, unlockAudio } from "./music";

function chirp(
  freq: number,
  dur: number,
  peak = 0.055,
  when = 0,
  type: OscillatorType = "sawtooth",
  slide = 1.06,
) {
  if (isMusicMuted()) return;
  unlockAudio();
  const c = getAudioContext();
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
