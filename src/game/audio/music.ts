/**
 * Procedural pocket-RTS soundtrack via Web Audio.
 * Sparse, slightly ominous — drones + soft arp + muted pulse.
 * Unlocks only after a user gesture (autoplay policy).
 */

type AC = AudioContext;

let ctx: AC | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let playing = false;
let muted = false;
let timer: number | null = null;
let startedOnce = false;
let visBound = false;

const BPM = 86;
const STEP_SEC = 60 / BPM / 2; // 8th notes

// A minor-ish space palette (Hz)
const ROOT = 55; // A1
const SCALE = [0, 2, 3, 5, 7, 8, 10, 12];

function midi(semi: number) {
  return ROOT * Math.pow(2, semi / 12);
}

function ensure(): AC | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const ACTor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ACTor) return null;
    ctx = new ACTor({ latencyHint: "playback" });
    master = ctx.createGain();
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    master.gain.value = 0.75;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Shared context for music + SFX. */
export function getAudioContext(): AC | null {
  return ensure();
}

/** Call synchronously from a user gesture. */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  startedOnce = true;
  if (!visBound) {
    visBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ctx?.state === "suspended") {
        void ctx.resume();
      }
    });
  }
}

export function isMusicMuted() {
  return muted;
}

export function setMusicMuted(m: boolean) {
  muted = m;
  if (!musicGain || !ctx) return;
  const target = m || !playing ? 0.0001 : 0.42;
  musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
}

export function toggleMusicMute() {
  setMusicMuted(!muted);
  return muted;
}

function tone(
  c: AC,
  dest: AudioNode,
  freq: number,
  t0: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  filterFreq = 1200,
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  f.type = "lowpass";
  f.frequency.setValueAtTime(filterFreq, t0);
  f.Q.value = 0.7;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(f);
  f.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  osc.onended = () => {
    try {
      osc.disconnect();
      f.disconnect();
      g.disconnect();
    } catch {
      /* already gone */
    }
  };
}

function noiseHit(c: AC, dest: AudioNode, t0: number, dur: number, peak: number) {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 800;
  const g = c.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, peak), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + dur);
  src.onended = () => {
    try {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    } catch {
      /* */
    }
  };
}

/** One bar pattern (16 steps of 8th notes). */
function scheduleBar(c: AC, dest: GainNode, t0: number, bar: number) {
  tone(c, dest, midi(0), t0, STEP_SEC * 16 * 0.98, "sine", 0.045, 280);
  tone(c, dest, midi(7), t0, STEP_SEC * 16 * 0.98, "sine", 0.028, 400);

  if (bar % 2 === 0) {
    tone(c, dest, midi(12 + 3), t0 + 0.01, STEP_SEC * 8, "triangle", 0.018, 900);
    tone(c, dest, midi(12 + 7), t0 + 0.02, STEP_SEC * 8, "triangle", 0.014, 900);
  } else {
    tone(c, dest, midi(12 + 5), t0 + 0.01, STEP_SEC * 8, "triangle", 0.016, 850);
    tone(c, dest, midi(12 + 10), t0 + 0.02, STEP_SEC * 8, "triangle", 0.012, 850);
  }

  const arpPattern = [0, 3, 7, 12, 10, 7, 3, 0, 5, 8, 12, 15, 12, 8, 5, 3];
  for (let i = 0; i < 16; i++) {
    if (i % 3 === 1) continue;
    const deg = arpPattern[(i + bar * 3) % arpPattern.length]!;
    const f0 = midi(12 + SCALE[deg % SCALE.length]! + Math.floor(deg / 12) * 12);
    const t = t0 + i * STEP_SEC;
    tone(c, dest, f0, t, STEP_SEC * 0.85, "sine", 0.035, 1800);
    if (i % 4 === 0) tone(c, dest, f0 * 2, t + 0.01, STEP_SEC * 0.5, "triangle", 0.01, 2400);
  }

  for (const beat of [0, 8]) {
    const t = t0 + beat * STEP_SEC;
    tone(c, dest, 55, t, 0.18, "sine", 0.07, 120);
    tone(c, dest, 42, t, 0.22, "sine", 0.04, 90);
  }
  for (const beat of [4, 12]) {
    noiseHit(c, dest, t0 + beat * STEP_SEC, 0.05, 0.02);
  }
  if (bar % 4 === 3) {
    tone(c, dest, midi(24 + 7), t0 + 12 * STEP_SEC, 0.35, "sine", 0.03, 4000);
  }
}

let barCount = 0;
let nextBarTime = 0;

function tick() {
  if (!ctx || !musicGain || !playing) return;
  const c = ctx;
  const now = c.currentTime;
  while (nextBarTime < now + 0.8) {
    scheduleBar(c, musicGain, nextBarTime, barCount);
    nextBarTime += STEP_SEC * 16;
    barCount++;
  }
  timer = window.setTimeout(tick, 120);
}

export function startMusic() {
  const c = ensure();
  if (!c || !musicGain) return;
  unlockAudio();
  if (master) master.gain.value = 0.75;
  if (playing) {
    if (!muted) {
      musicGain.gain.setTargetAtTime(0.42, c.currentTime, 0.05);
    }
    return;
  }
  playing = true;
  barCount = 0;
  nextBarTime = c.currentTime + 0.08;
  if (!muted) {
    musicGain.gain.cancelScheduledValues(c.currentTime);
    musicGain.gain.setValueAtTime(0.0001, c.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(0.42, c.currentTime + 1.2);
  }
  tick();
}

export function stopMusic() {
  playing = false;
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (musicGain && ctx) {
    musicGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
  }
}

export function ensureMusicFromGesture() {
  unlockAudio();
  if (!playing) startMusic();
}
