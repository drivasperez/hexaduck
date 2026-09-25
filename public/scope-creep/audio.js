// Scope Creep's sound: generative background music on the Web Audio clock, and short effects.
// Nothing plays until the player first interacts (browsers require it), and M mutes everything.
//
//   Sound.unlock(); Sound.mood('map' | 'fight' | 'elite' | 'boss' | 'quiet'); Sound.fx('hit');

const KEY = 'scope-creep-muted';
let ac = null, master = null, musicBus = null, fxBus = null, noise = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } })();

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function setup() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = muted ? 0 : 1;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp).connect(ac.destination);
  musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
  fxBus = ac.createGain(); fxBus.gain.value = 0.7; fxBus.connect(master);
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function voice(bus, t, freq, dur, { type = 'triangle', v = 0.1, attack = 0.01, cutoff = 0, detune = 0, slideTo = 0 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  let node = o;
  if (cutoff) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  node.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function hiss(bus, t, dur, { freq = 6000, type = 'highpass', v = 0.05, q = 0.7 } = {}) {
  const s = ac.createBufferSource(); s.buffer = noise;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

// ---------- music ----------
// Each mood is a tempo and a four-chord loop (as scale degrees over a root), with layers that
// fill in as things get tenser: map is a soft electric piano, fights add drums, bosses go minor.
const MOODS = {
  map: { bpm: 84, root: 50, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], drums: 0 },
  fight: { bpm: 104, root: 50, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]], drums: 1 },
  elite: { bpm: 112, root: 52, chords: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [7, 10, 14, 17]], drums: 2 },
  boss: { bpm: 120, root: 45, chords: [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [7, 11, 14, 17]], drums: 3 },
};
let mood = 'quiet', nextTime = 0, step = 0, timer = null, seed = 1;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function playStep(n, t) {
  const m = MOODS[mood];
  if (!m) return;
  const spb = 60 / m.bpm, s16 = spb / 4;
  const s = n % 16, bar = Math.floor(n / 16), chord = m.chords[bar % 4];
  // Chord stabs on a lazy swing.
  if (s === 0 || s === 6 || (m.drums >= 2 && s === 10)) for (const iv of chord) voice(musicBus, t + (s === 6 ? s16 * 0.15 : 0), mtof(m.root + 12 + iv), spb * 1.6, { type: 'triangle', v: 0.035, attack: 0.02, cutoff: 2200, detune: (rand() - 0.5) * 8 });
  // Walking bass.
  if (s % 4 === 0) voice(musicBus, t, mtof(m.root - 12 + chord[0] + [0, 7, 12, 7][s / 4]), spb * 0.9, { type: 'sine', v: 0.14, attack: 0.01 });
  // A few melody notes from the chord, now and then.
  if (s % 2 === 0 && rand() < 0.18 + m.drums * 0.05) voice(musicBus, t, mtof(m.root + 24 + chord[Math.floor(rand() * 4)]), s16 * 2.5, { type: 'sine', v: 0.03, attack: 0.01 });
  if (m.drums >= 1 && (s === 2 || s === 6 || s === 10 || s === 14)) hiss(musicBus, t, 0.05, { v: 0.035 });
  if (m.drums >= 1 && (s === 0 || (m.drums >= 3 && s === 8))) voice(musicBus, t, 120, 0.18, { type: 'sine', v: 0.22, slideTo: 45 });
  if (m.drums >= 2 && (s === 4 || s === 12)) hiss(musicBus, t, 0.12, { freq: 1800, type: 'bandpass', v: 0.09 });
}

function tick() {
  if (!ac || ac.state !== 'running' || !MOODS[mood]) return;
  if (nextTime < ac.currentTime - 0.2) nextTime = ac.currentTime + 0.05;
  const s16 = 60 / MOODS[mood].bpm / 4;
  while (nextTime < ac.currentTime + 0.15) { playStep(step, nextTime); nextTime += s16; step++; }
}

// ---------- effects ----------
const FX = {
  card: t => voice(fxBus, t, 900, 0.06, { type: 'square', v: 0.02, cutoff: 3000 }),
  hit: t => { voice(fxBus, t, 160, 0.14, { type: 'sine', v: 0.25, slideTo: 60 }); hiss(fxBus, t, 0.08, { freq: 2500, type: 'bandpass', v: 0.12 }); },
  block: t => { voice(fxBus, t, 1320, 0.18, { type: 'triangle', v: 0.05 }); voice(fxBus, t, 1980, 0.12, { type: 'sine', v: 0.03 }); },
  hurt: t => { voice(fxBus, t, 220, 0.25, { type: 'sawtooth', v: 0.06, cutoff: 900, slideTo: 110 }); },
  emit: t => hiss(fxBus, t, 0.5, { freq: 400, type: 'lowpass', v: 0.18 }),
  heat: t => { voice(fxBus, t, 740, 0.18, { type: 'square', v: 0.03, cutoff: 2000 }); voice(fxBus, t + 0.2, 554, 0.25, { type: 'square', v: 0.03, cutoff: 2000 }); },
  heal: t => [523, 659, 784].forEach((f, i) => voice(fxBus, t + i * 0.06, f, 0.3, { type: 'sine', v: 0.05 })),
  reward: t => [587, 740, 880, 1175].forEach((f, i) => voice(fxBus, t + i * 0.07, f, 0.35, { type: 'triangle', v: 0.05 })),
  gameover: t => [392, 330, 262, 196].forEach((f, i) => voice(fxBus, t + i * 0.22, f, 0.6, { type: 'triangle', v: 0.07 })),
  victory: t => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => voice(fxBus, t + i * 0.12, f, 0.5, { type: 'triangle', v: 0.06 })),
  duck: t => { voice(fxBus, t, 700, 0.09, { type: 'sawtooth', v: 0.03, cutoff: 1400, slideTo: 520 }); },
  // Office sounds, for Audit, Please.
  stamp: t => { voice(fxBus, t, 90, 0.18, { type: 'sine', v: 0.35, slideTo: 40 }); hiss(fxBus, t, 0.06, { freq: 900, type: 'lowpass', v: 0.3 }); },
  buzz: t => { voice(fxBus, t, 110, 0.35, { type: 'square', v: 0.05, cutoff: 700 }); voice(fxBus, t, 116, 0.35, { type: 'square', v: 0.05, cutoff: 700 }); },
  coin: t => { voice(fxBus, t, 1568, 0.12, { type: 'square', v: 0.03, cutoff: 5000 }); voice(fxBus, t + 0.07, 2093, 0.25, { type: 'square', v: 0.03, cutoff: 5000 }); },
  paper: t => hiss(fxBus, t, 0.14, { freq: 3500, type: 'bandpass', v: 0.12, q: 0.5 }),
  found: t => { voice(fxBus, t, 880, 0.1, { type: 'triangle', v: 0.05 }); voice(fxBus, t + 0.08, 660, 0.2, { type: 'triangle', v: 0.05 }); },
};

export const Sound = {
  get muted() { return muted; },
  unlock() {
    try {
      setup();
      if (ac.state === 'suspended') ac.resume();
      if (!timer) timer = setInterval(tick, 30);
    } catch (e) {}
  },
  mood(next) {
    if (next === mood) return;
    mood = next;
    step = 0;
    if (ac) nextTime = ac.currentTime + 0.1;
  },
  fx(name) {
    if (!ac || muted || ac.state !== 'running') return;
    try { FX[name]?.(ac.currentTime + 0.01); } catch (e) {}
  },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.02);
    return muted;
  },
};

document.addEventListener('visibilitychange', () => {
  if (!ac) return;
  try { document.hidden ? ac.suspend() : ac.resume(); } catch (e) {}
});
