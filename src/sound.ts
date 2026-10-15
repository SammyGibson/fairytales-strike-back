// Tiny synthesised sound effects, so the game needs no audio files.

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function audio(): AudioContext | null {
  if (muted) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

function noise(duration: number, volume: number, filterType: BiquadFilterType, from: number, to: number): void {
  const a = audio();
  if (!a) return;
  const length = Math.floor(a.sampleRate * duration);
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, a.currentTime);
  filter.frequency.exponentialRampToValueAtTime(to, a.currentTime + duration);
  const gain = a.createGain();
  gain.gain.value = volume;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
}

export const sfx = {
  click: () => tone("square", 700, 500, 0.05, 0.06),
  swing: () => noise(0.18, 0.35, "bandpass", 600, 3200),
  hit: () => {
    tone("square", 220, 90, 0.12, 0.18);
    noise(0.1, 0.25, "lowpass", 1800, 400);
  },
  block: () => {
    tone("square", 1250, 900, 0.16, 0.12);
    tone("triangle", 1900, 1500, 0.22, 0.08);
  },
  hurt: () => tone("sawtooth", 420, 140, 0.25, 0.16),
  groan: () => tone("sawtooth", 130, 80, 0.5, 0.1),
  zombieDie: () => {
    tone("sawtooth", 180, 60, 0.45, 0.14);
    noise(0.3, 0.2, "lowpass", 1200, 200);
  },
  throw: () => noise(0.25, 0.25, "bandpass", 400, 1400),
  splat: () => noise(0.22, 0.4, "lowpass", 900, 150),
  roar: () => {
    tone("sawtooth", 160, 55, 1.1, 0.2);
    tone("square", 90, 40, 1.1, 0.12);
  },
  bossHurt: () => tone("sawtooth", 260, 120, 0.25, 0.14),
  stomp: () => {
    tone("sine", 90, 40, 0.25, 0.25);
    noise(0.15, 0.2, "lowpass", 500, 120);
  },
  charge: () => {
    tone("sawtooth", 160, 640, 1, 0.07);
    tone("sine", 220, 880, 1, 0.06);
  },
  fireball: () => {
    noise(0.35, 0.3, "bandpass", 1600, 300);
    tone("sawtooth", 300, 120, 0.3, 0.05);
  },
  squish: () => {
    tone("sine", 320, 90, 0.18, 0.18);
    noise(0.12, 0.15, "lowpass", 800, 200);
  },
  slam: () => {
    tone("sine", 70, 30, 0.6, 0.35);
    noise(0.4, 0.35, "lowpass", 700, 80);
  },
  door: () => {
    tone("sawtooth", 55, 40, 2.2, 0.12);
    noise(2.2, 0.18, "lowpass", 300, 90);
  },
  blink: () => [1200, 1600, 2000].forEach((f, i) => tone("sine", f, f * 1.2, 0.12, 0.06, i * 0.05)),
  rewind: () => {
    for (let i = 0; i < 10; i++) tone("square", 1400 - i * 90, 1300 - i * 90, 0.05, 0.05, i * 0.13);
    tone("sine", 900, 200, 1.4, 0.08);
  },
  reward: () => [523, 784, 1047, 1319].forEach((f, i) => tone("triangle", f, f, 0.3, 0.13, i * 0.12)),
  switchSword: () => {
    noise(0.2, 0.2, "bandpass", 800, 3000);
    tone("triangle", 600, 900, 0.15, 0.08);
  },
  pickup: () => {
    tone("sine", 660, 660, 0.1, 0.14);
    tone("sine", 990, 990, 0.16, 0.14, 0.09);
  },
  checkpoint: () => [523, 659, 784].forEach((f, i) => tone("triangle", f, f, 0.18, 0.12, i * 0.1)),
  victory: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.26, 0.14, i * 0.15)),
  defeat: () => [392, 330, 262].forEach((f, i) => tone("triangle", f, f * 0.98, 0.3, 0.12, i * 0.22)),
};
