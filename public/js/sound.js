/**
 * Every sound is synthesised on the fly — no audio files to ship or wait for.
 * The context stays suspended until the first user gesture, per browser policy.
 */

let ctx = null;
let muted = localStorage.getItem('pm-muted') === '1';

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }
export function setMuted(value) {
  muted = !!value;
  localStorage.setItem('pm-muted', muted ? '1' : '0');
}
export function unlock() { if (!muted) audio(); }

function noiseBuffer(ac, seconds) {
  const frames = Math.floor(ac.sampleRate * seconds);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function burst(ac, { when = 0, duration = 0.08, freq = 2000, q = 1, gain = 0.2, type = 'bandpass' }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, duration);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const vol = ac.createGain();
  const t = ac.currentTime + when;
  vol.gain.setValueAtTime(gain, t);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(vol).connect(ac.destination);
  src.start(t);
  src.stop(t + duration);
}

function tone(ac, { when = 0, freq = 440, duration = 0.12, gain = 0.12, type = 'sine', slideTo = null }) {
  const osc = ac.createOscillator();
  osc.type = type;
  const vol = ac.createGain();
  const t = ac.currentTime + when;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(vol).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

const SOUNDS = {
  deal(ac) {
    burst(ac, { duration: 0.09, freq: 3200, q: 0.8, gain: 0.11, type: 'highpass' });
  },
  flip(ac) {
    burst(ac, { duration: 0.05, freq: 2400, q: 2, gain: 0.16 });
  },
  chips(ac) {
    for (let i = 0; i < 4; i++) {
      burst(ac, { when: i * 0.035, duration: 0.05, freq: 1400 + Math.random() * 900, q: 6, gain: 0.13 });
    }
  },
  potSlide(ac) {
    for (let i = 0; i < 9; i++) {
      burst(ac, { when: i * 0.03, duration: 0.07, freq: 1100 + Math.random() * 1400, q: 5, gain: 0.1 });
    }
  },
  check(ac) {
    burst(ac, { duration: 0.06, freq: 900, q: 4, gain: 0.16 });
    burst(ac, { when: 0.07, duration: 0.05, freq: 800, q: 4, gain: 0.12 });
  },
  fold(ac) {
    burst(ac, { duration: 0.14, freq: 520, q: 0.7, gain: 0.13, type: 'lowpass' });
  },
  turn(ac) {
    tone(ac, { freq: 660, duration: 0.1, gain: 0.1 });
    tone(ac, { when: 0.11, freq: 990, duration: 0.13, gain: 0.1 });
  },
  win(ac) {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(ac, { when: i * 0.07, freq: f, duration: 0.24, gain: 0.09, type: 'triangle' });
    });
  },
  lose(ac) {
    tone(ac, { freq: 320, duration: 0.3, gain: 0.07, type: 'sine', slideTo: 180 });
  },
};

export function play(name) {
  if (muted || !SOUNDS[name]) return;
  try { SOUNDS[name](audio()); } catch { /* audio unavailable — keep playing */ }
}
