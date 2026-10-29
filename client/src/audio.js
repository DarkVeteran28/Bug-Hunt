// Small Web Audio synthesiser: every sound is generated, so there are no
// third-party audio assets.
import { settings, onSettings } from './settings.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let engine = null;
let ambience = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  applyVolume();
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function applyVolume() {
  if (master) master.gain.value = settings.muted ? 0 : settings.volume;
}
onSettings(applyVolume);

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
  if (c && !ambience) startAmbience();
}

function noise(duration, { freq = 1000, q = 1, type = 'lowpass', gain = 0.5, attack = 0.002, when = 0 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + duration + 0.05);
}

function tone(freq, duration, { type = 'sine', gain = 0.2, when = 0, slide = 0 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + duration + 0.05);
}

export const sfx = {
  shot(weapon = 'pistol', distance = 0) {
    const fall = Math.max(0.08, 1 - distance / 120);
    const cfg = { pistol: [2200, 0.18], smg: [3000, 0.1], shotgun: [900, 0.35], rifle: [1600, 0.3] }[weapon] || [2000, 0.2];
    noise(cfg[1], { freq: cfg[0], gain: 0.55 * fall });
    tone(140, cfg[1], { type: 'square', gain: 0.12 * fall, slide: -90 });
  },
  reload() {
    noise(0.05, { freq: 4000, type: 'bandpass', q: 4, gain: 0.3 });
    noise(0.05, { freq: 3000, type: 'bandpass', q: 4, gain: 0.3, when: 0.25 });
  },
  empty() { noise(0.03, { freq: 5000, type: 'highpass', gain: 0.2 }); },
  footstep() { noise(0.06, { freq: 500, gain: 0.08 }); },
  hit() { tone(1400, 0.08, { type: 'triangle', gain: 0.25 }); },
  kill() { tone(900, 0.12, { type: 'triangle', gain: 0.25 }); tone(1500, 0.2, { type: 'triangle', gain: 0.25, when: 0.08 }); },
  hurt() { tone(220, 0.25, { type: 'sawtooth', gain: 0.18, slide: -120 }); },
  success() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'square', gain: 0.1, when: i * 0.09 })); },
  fail() { tone(300, 0.2, { type: 'square', gain: 0.1 }); tone(200, 0.3, { type: 'square', gain: 0.1, when: 0.15 }); },
  mission() { [392, 523, 659].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.15, when: i * 0.12 })); },
  click() { tone(800, 0.04, { type: 'square', gain: 0.05 }); },
  door() { noise(0.6, { freq: 300, gain: 0.25, attack: 0.1 }); },
  setEngine(on, speed = 0) {
    if (!ensure()) return;
    if (on && !engine) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(f).connect(g).connect(master);
      o.start();
      engine = { o, g };
    }
    if (!on && engine) {
      engine.o.stop();
      engine = null;
    }
    if (engine) engine.o.frequency.setTargetAtTime(45 + Math.abs(speed) * 4, ctx.currentTime, 0.1);
  },
};

function startAmbience() {
  // Gentle surf: slowly modulated filtered noise.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 450;
  const g = ctx.createGain();
  g.gain.value = 0.03;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.025;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start();
  lfo.start();
  ambience = { src, g };
}
