import { createLeaderboard } from '/shared/leaderboard.js';
import {
  FEVER_KICK, FEVER_MAX, islandBonus, MAX_SPEED, newDuck, PX_PER_M, START_TIME, step, Terrain,
} from '/tailwind/physics.js';

(() => {
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');

  // At full zoom the view is 540 world units tall (and at least 720 wide in landscape). The
  // camera zooms out as the duck climbs so the ground stays in view.
  const BASE_H = 540;
  let W = 0, H = 0, DPR = 1, S = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    S = Math.min(H / BASE_H, W / (W < H ? 520 : 720));
  }
  addEventListener('resize', resize);
  resize();

  const TAU = Math.PI * 2, STEP = 1 / 240, SEA = -60;
  const FEVER_TIME = 5, STREAK = 3;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
  const DUCK = '#FFD23F', BEAK = '#FF8A1F', INK = '#FFFFFF', SHADOW = 'rgba(15, 59, 76, 0.55)';
  // For testing: `?day=5` shortens the first day. It can only make the day shorter.
  const DAY = Math.min(START_TIME, Math.max(1, Number(new URLSearchParams(location.search).get('day')) || START_TIME));

  // Hill colours per island, as [stripe, other stripe, edge].
  const ISLANDS = [
    ['#7CCB6E', '#6BBB5F', '#C9F0A6'],
    ['#E6C35C', '#D8B24A', '#FFE9A3'],
    ['#6FB7D8', '#5EA6C8', '#C3E9F7'],
    ['#D08BC6', '#C078B6', '#F4C9EE'],
    ['#8ED6A6', '#7BC593', '#D2F5DE'],
    ['#EA9E6E', '#DB8B5B', '#FFD2B3'],
  ];
  const QUIPS = [
    'Dive on the downhills. Let go on the uphills.',
    'Three perfect landings in a row give you a tailwind.',
    'Wind power works at night. Ducks do not.',
    'Every island you reach buys more daylight.',
    'Land along the slope, not into it.',
  ];

  // ---------- storage ----------
  function loadBest() { try { return Number(localStorage.getItem('tailwind-best')) || 0; } catch (e) { return 0; } }
  function saveBest() { try { localStorage.setItem('tailwind-best', String(best)); } catch (e) {} }

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  function hash(n, seed = 0) {
    let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function mix(c1, c2, k) {
    const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const a = p(c1), b = p(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(',')})`;
  }

  // ---------- audio ----------
  let ac = null, muted = false, noiseBuf = null, sfxBus = null, windGain = null;
  function unlockAudio() {
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        sfxBus = ac.createGain(); sfxBus.gain.value = muted ? 0 : 1; sfxBus.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        // Wind: looped noise that swells with speed.
        const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.8;
        windGain = ac.createGain(); windGain.gain.value = 0;
        src.connect(f).connect(windGain).connect(sfxBus); src.start();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) {}
    if (ac && !Music.on) Music.start();
  }
  function beep(f, d, type = 'triangle', v = 0.05, delay = 0, f2 = null) {
    if (!ac) return;
    try {
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
      g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(sfxBus); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  function whoosh(d, from, to, v) {
    if (!ac) return;
    try {
      const t0 = ac.currentTime;
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + d);
      const g = ac.createGain(); g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      s.connect(f).connect(g).connect(sfxBus); s.start(t0, Math.random()); s.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  const sfx = {
    takeoff: () => whoosh(0.35, 500, 2200, 0.12),
    perfect: () => { beep(784, 0.1, 'square', 0.03); beep(988, 0.1, 'square', 0.03, 0.07); beep(1319, 0.16, 'square', 0.03, 0.14); },
    bad: () => { whoosh(0.2, 300, 120, 0.3); beep(110, 0.18, 'sawtooth', 0.06, 0, 70); },
    island: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, 'square', 0.035, i * 0.09)),
    fever: () => { whoosh(0.8, 300, 4000, 0.25); beep(392, 0.5, 'sawtooth', 0.04, 0, 1568); },
    tick: () => beep(1200, 0.05, 'square', 0.025),
    night: () => { beep(392, 0.5, 'triangle', 0.06); beep(330, 0.5, 'triangle', 0.06, 0.25); beep(262, 0.9, 'triangle', 0.06, 0.5); },
  };

  // ---------- music ----------
  // A breezy major-key step sequencer. Layers join on later islands and during a tailwind.
  const Music = (() => {
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const ROOT = 55, BPM = 124, PROG = [0, 4, 5, 3];  // G major: I V vi IV
    const spb = 60 / BPM, stepDur = spb / 4;
    const MELODY = [4, null, 2, null, 4, 5, 4, null, 2, null, 0, 2, 4, null, null, null];
    let bus, filt, timer = null, on = false, nextTime = 0, step_ = 0;
    const deg = (d, oct = 0) => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return ROOT + MAJOR[i] + 12 * (o + oct); };
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    function init() {
      if (bus) return;
      bus = ac.createGain();
      filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 18000;
      const master = ac.createGain(); master.gain.value = 0.34;
      bus.connect(filt).connect(master).connect(ac.createDynamicsCompressor()).connect(sfxBus);
    }
    function tone(t, midi, dur, type, v, cutoff) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(mtof(midi), t);
      let n = o;
      if (cutoff) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.3), t + dur); o.connect(f); n = f; }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.03);
    }
    function hat(t, v) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
      const g = ac.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + 0.06);
    }
    function kick(t) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.24);
    }
    function playStep(n, t) {
      const s = n % 16, bar = Math.floor(n / 16), chord = PROG[bar % 4];
      const L = state === 'play' ? Math.min(4, island + 1 + (fever > 0 ? 2 : 0)) : 0;
      if (s % 4 === 0) tone(t, deg(chord, -1), spb * 0.9, 'triangle', 0.14, 0);
      if (s % 2 === 0) tone(t, deg(chord + [0, 2, 4, 2][(s >> 1) % 4], 1), stepDur * 1.6, 'triangle', 0.04, 0);
      if (L >= 1 && s % 4 === 0) kick(t);
      if (L >= 1 && s % 4 === 2) hat(t, 0.1);
      if (L >= 2) { const d = MELODY[s]; if (d != null) tone(t, deg(chord + d, 1), stepDur * 2.2, 'square', 0.035, 3000); }
      if (L >= 3 && s % 2 === 1) hat(t, 0.05);
      if (L >= 4 && s % 4 === 0) tone(t, deg(chord + 4, 2), stepDur * 3, 'sine', 0.03, 0);
    }
    function tick() {
      if (!on || ac.state !== 'running') return;
      if (nextTime < ac.currentTime - 0.2) nextTime = ac.currentTime + 0.05;
      while (nextTime < ac.currentTime + 0.12) { playStep(step_, nextTime); nextTime += stepDur; step_++; }
    }
    return {
      get on() { return on; },
      start() {
        if (!ac) return;
        init();
        step_ = 0; nextTime = ac.currentTime + 0.06; on = true;
        filt.frequency.cancelScheduledValues(ac.currentTime);
        filt.frequency.setTargetAtTime(18000, ac.currentTime, 0.05);
        if (!timer) timer = setInterval(tick, 25);
        tick();
      },
      muffle() { if (!filt) return; filt.frequency.cancelScheduledValues(ac.currentTime); filt.frequency.setTargetAtTime(350, ac.currentTime, 0.3); },
    };
  })();
  function setMuted(m) { muted = m; if (sfxBus) sfxBus.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.02); }

  // ---------- state ----------
  let state = 'menu', best = loadBest(), isTouch = false;
  let terrain, duck, clock = 0, acc = 0, t = 0, timeLeft = DAY, dist = 0;
  let island = 0, streak = 0, fever = 0, lastTick = 0;
  let camX = 0, zoom = 1, flash = 0, deathT = 0, newBest = false, quip = '';
  let held = false, popups = [];

  function reset() {
    terrain = new Terrain();
    duck = newDuck(terrain);
    island = 0; streak = 0; fever = 0; dist = 0; t = 0; timeLeft = DAY; popups = [];
    zoom = 1; camX = duck.x - viewW() * 0.28;
  }
  const viewW = () => W / (S * zoom);
  reset();

  function popup(text, color = INK) { popups.push({ text, color, t: 0 }); if (popups.length > 3) popups.shift(); }

  function startGame() {
    unlockAudio();
    reset();
    state = 'play'; newBest = false; held = false; lastTick = Math.ceil(timeLeft);
    Board.startRun(0);
    Music.start();
  }

  function end() {
    state = 'dead'; deathT = 0; held = false;
    let q; do { q = QUIPS[Math.floor(Math.random() * QUIPS.length)]; } while (q === quip);
    quip = q;
    const m = Math.floor(dist);
    if (m > best) { best = m; newBest = true; saveBest(); }
    Board.finishRun(0, m);
    sfx.night();
    Music.muffle();
  }

  function goMenu() { state = 'menu'; reset(); Music.start(); }

  // The menu's attract mode flies itself: dive on downhills and time the landings.
  function autopilot() {
    const d = duck;
    if (d.ground) return terrain.slope(d.x) < 0;
    if (d.vy >= 0) return false;
    const s = terrain.slope(d.x + d.vx * 0.12);
    return s < 0 && d.vy / d.vx > s;
  }

  // ---------- update ----------
  function update(dt) {
    clock += dt;
    flash = Math.max(0, flash - dt * 2);
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 1.6);

    if (state === 'dead') { deathT += dt; return; }
    const playing = state === 'play';
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      const dive = playing ? held : autopilot();
      for (const e of step(duck, terrain, dive, STEP, fever > 0 ? FEVER_MAX : MAX_SPEED)) if (playing) onEvent(e);
    }
    if (!playing) { dist = 0; follow(dt); return; }

    t += dt;
    timeLeft -= dt;
    fever = Math.max(0, fever - dt);
    dist = Math.max(0, duck.x / PX_PER_M);
    const isl = terrain.islandAt(duck.x);
    if (isl > island) {
      island = isl;
      const bonus = islandBonus(island);
      timeLeft += bonus;
      popup(`Island ${island + 1} · +${bonus} s of daylight`, DUCK);
      sfx.island();
    }
    if (timeLeft <= 10 && Math.ceil(timeLeft) < lastTick) sfx.tick();
    lastTick = Math.ceil(timeLeft);
    if (windGain) windGain.gain.setTargetAtTime(Math.min(0.12, Math.hypot(duck.vx, duck.vy) / 12000), ac.currentTime, 0.2);
    follow(dt);
    if (timeLeft <= 0) { timeLeft = 0; end(); }
  }

  function onEvent(e) {
    if (e === 'takeoff') { if (Math.hypot(duck.vx, duck.vy) > 700) sfx.takeoff(); return; }
    if (e === 'perfect') {
      streak++;
      sfx.perfect();
      if (streak >= STREAK) {
        streak = 0; fever = FEVER_TIME; duck.vx += FEVER_KICK;
        popup('Tailwind!', DUCK); flash = reduceMotion ? 0 : 0.6; sfx.fever();
      } else popup(`Perfect landing ${'•'.repeat(streak)}`);
    } else if (e === 'bad') { streak = 0; popup('Bumpy landing', '#FFC9B8'); sfx.bad(); }
    else streak = 0;
  }

  function follow(dt) {
    const viewH0 = H / S;
    const target = clamp((viewH0 * 0.72) / (duck.y - SEA + 160), 0.4, 1);
    zoom += (target - zoom) * Math.min(1, dt * 3);
    camX = duck.x - viewW() * 0.28;
  }

  // ---------- drawing ----------
  function text(str, x, y, size, color, weight = 500, align = 'center', alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size * 0.14); ctx.lineJoin = 'round'; ctx.strokeStyle = SHADOW;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  // World (y up, sea at 0) to CSS pixels.
  const K = () => S * zoom;
  const sx = x => (x - camX) * K();
  const sy = y => H - (y - SEA) * K();

  // Sky colours through the day, as [share of the day gone, colour]. Going through pink and
  // lilac on the way to orange keeps the middle of the day from turning grey.
  const SKY_TOP = [[0, '#5DBCD6'], [0.45, '#6FB4DA'], [0.65, '#B99AC4'], [0.8, '#E98A5E'], [1, '#2B2753']];
  const SKY_BOTTOM = [[0, '#D4F1F2'], [0.45, '#E6F0E0'], [0.65, '#FFD8A8'], [0.8, '#FFC27A'], [1, '#C2607A']];
  function gradient(stops, k) {
    for (let i = 1; i < stops.length; i++) {
      const [k1, c1] = stops[i - 1], [k2, c2] = stops[i];
      if (k <= k2) return mix(c1, c2, (k - k1) / (k2 - k1));
    }
    return stops[stops.length - 1][1];
  }

  function daylight() { return clamp(1 - timeLeft / START_TIME, 0, 1); }

  function drawSky() {
    const k = state === 'menu' ? 0.15 : daylight();
    const top = gradient(SKY_TOP, k), bottom = gradient(SKY_BOTTOM, k);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // The sun sinks towards the horizon as the day runs out.
    const sunY = lerp(H * 0.14, H * 0.78, k), sunX = W * 0.78;
    ctx.fillStyle = k < 0.7 ? 'rgba(255, 244, 200, 0.95)' : mix('#FFE3A0', '#FF7A59', (k - 0.7) / 0.3);
    ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(26, Math.min(W, H) * 0.06), 0, TAU); ctx.fill();
    // Far hills, a slow parallax band.
    ctx.fillStyle = k < 0.7 ? 'rgba(90, 170, 150, 0.45)' : 'rgba(80, 70, 110, 0.5)';
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 20) {
      const wx = x / K() + camX * 0.25;
      ctx.lineTo(x, H * 0.62 - (Math.sin(wx * 0.004) * 40 + Math.sin(wx * 0.0017 + 1) * 60) * K());
    }
    ctx.lineTo(W, H); ctx.fill();
    // Clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < 6; i++) {
      const span = W + 400;
      const x = ((hash(i, 5) * span - (camX * 0.1 + clock * 12) * K() * (0.5 + hash(i, 6))) % span + span) % span - 200;
      const y = H * (0.08 + hash(i, 7) * 0.3), r = (30 + hash(i, 8) * 40) * Math.max(0.6, K());
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.8, r * 0.6, 0, 0, TAU); ctx.ellipse(x + r * 0.8, y - r * 0.3, r, r * 0.55, 0, 0, TAU); ctx.fill();
    }
  }

  function drawTerrain() {
    const x0 = camX - 20, x1 = camX + viewW() + 20;
    const pts = terrain.points;
    const k = state === 'menu' ? 0 : daylight();
    const dim = k < 0.7 ? 0 : (k - 0.7) / 0.3 * 0.45;
    const stepW = 6 / K();
    for (let i = terrain.segment(x0); i < pts.length - 1 && pts[i].x < x1; i++) {
      const a = pts[i], b = pts[i + 1];
      const pal = ISLANDS[terrain.islandAt((a.x + b.x) / 2) % ISLANDS.length];
      const fill = pal[i % 2];
      ctx.fillStyle = dim ? mix(fill, '#2B2753', dim) : fill;
      ctx.beginPath();
      ctx.moveTo(sx(Math.max(a.x, x0)), H + 2);
      for (let x = Math.max(a.x, x0); x <= Math.min(b.x, x1) + stepW; x += stepW) ctx.lineTo(sx(Math.min(x, b.x)), sy(terrain.height(Math.min(x, b.x))));
      ctx.lineTo(sx(Math.min(b.x, x1)), H + 2);
      ctx.closePath(); ctx.fill();
    }
    // A bright edge along the top of the ground.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = Math.max(2, 4 * K());
    ctx.beginPath();
    for (let x = x0; x <= x1; x += stepW) { const X = sx(x), Y = sy(terrain.height(x)); x === x0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.stroke();
    // Wind turbines on some hilltops.
    for (let i = Math.max(1, terrain.segment(x0)); i < pts.length - 1 && pts[i].x < x1; i++) {
      const p = pts[i];
      if (p.y < pts[i - 1].y || p.y < pts[i + 1].y || hash(i, 9) > 0.5) continue;
      drawTurbine(sx(p.x), sy(p.y), K(), i);
    }
  }

  function drawTurbine(x, y, k, i) {
    const h = 120 * k;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 5 * k);
    ctx.beginPath(); ctx.moveTo(x, y + 4 * k); ctx.lineTo(x, y - h); ctx.stroke();
    const spin = reduceMotion ? 0 : clock * (2 + (fever > 0 ? 6 : 0)) + i;
    ctx.lineWidth = Math.max(1.5, 3.5 * k);
    ctx.beginPath();
    for (let b = 0; b < 3; b++) {
      const a = spin + b * TAU / 3;
      ctx.moveTo(x, y - h); ctx.lineTo(x + Math.cos(a) * 55 * k, y - h + Math.sin(a) * 55 * k);
    }
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y - h, Math.max(2, 5 * k), 0, TAU); ctx.fill();
  }

  function drawSea() {
    const y = sy(0);
    ctx.fillStyle = '#2F8FB0';
    ctx.beginPath(); ctx.moveTo(0, H + 2);
    for (let x = 0; x <= W + 10; x += 10) ctx.lineTo(x, y + Math.sin(x * 0.03 + clock * 2) * 3);
    ctx.lineTo(W, H + 2); ctx.fill();
  }

  function drawDuck() {
    const d = duck;
    const k = Math.max(S * 0.7, K()) * 1.25;
    const x = sx(d.x), y = sy(d.y);
    const angle = -Math.atan2(d.vy, d.vx);
    // Speed lines while a tailwind is blowing.
    if (fever > 0 && !reduceMotion) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const off = (hash(i, Math.floor(clock * 20)) - 0.5) * 30 * k;
        ctx.beginPath(); ctx.moveTo(x - 20 * k, y - 14 * k + off); ctx.lineTo(x - (60 + 40 * hash(i, 3)) * k, y - 14 * k + off); ctx.stroke();
      }
    }
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(k, k);
    ctx.fillStyle = DUCK;
    ctx.beginPath(); ctx.moveTo(-17, -12); ctx.lineTo(-9, -18); ctx.lineTo(-9, -8); ctx.closePath(); ctx.fill();  // tail
    ctx.beginPath(); ctx.ellipse(-1, -11, 13, 9, 0, 0, TAU); ctx.fill();                                          // body
    ctx.beginPath(); ctx.arc(11, -21, 7, 0, TAU); ctx.fill();                                                       // head
    ctx.fillStyle = BEAK;
    ctx.beginPath(); ctx.moveTo(16, -23); ctx.lineTo(25, -20); ctx.lineTo(16, -17); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0B2A36';
    ctx.beginPath(); ctx.arc(13, -23, 1.6, 0, TAU); ctx.fill();
    // Wings flap in the air, tuck in for a dive and rest on the ground.
    const diving = state === 'play' ? held : false;
    const flap = d.ground ? 0.15 : diving ? 0.5 : Math.sin(clock * 22) * 0.8 - 0.4;
    ctx.fillStyle = '#F2B81F';
    ctx.save(); ctx.translate(-3, -13); ctx.rotate(flap);
    ctx.beginPath(); ctx.ellipse(-6, 0, diving ? 8 : 11, 5, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function clockText(s) { const n = Math.ceil(s); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky();
    drawTerrain();
    drawSea();
    drawDuck();

    const base = Math.min(W, H), pad = Math.max(16, base * 0.035);
    if (state !== 'menu') {
      text(`Island ${island + 1}`, pad, pad + base * 0.03, base * 0.045, INK, 700, 'left');
      text(`${Math.floor(dist)} m`, W - pad, pad + base * 0.04, base * 0.075, INK, 700, 'right');
      text(best > 0 ? `Best ${best} m` : 'No best yet', W - pad, pad + base * 0.1, base * 0.03, INK, 500, 'right');
      const urgent = state === 'play' && timeLeft <= 10;
      const pulse = urgent && !reduceMotion ? 1 + 0.08 * Math.max(0, Math.sin(clock * TAU)) : 1;
      text(`☀ ${clockText(timeLeft)}`, W / 2, pad + base * 0.04, base * 0.055 * pulse, urgent ? '#FFC9B8' : INK, 700);
      if (fever > 0) text('Tailwind', W / 2, pad + base * 0.1, base * 0.032, DUCK, 700, 'center', Math.min(1, fever));
    }
    if (state === 'play') popups.forEach((p, i) => {
      text(p.text, W / 2, H * 0.24 + i * base * 0.06, base * 0.045, p.color, 700, 'center', 1 - Math.max(0, p.t - 1) / 0.6);
    });

    if (state === 'menu') {
      ctx.fillStyle = 'rgba(15, 59, 76, 0.28)'; ctx.fillRect(0, 0, W, H);
      text('Tailwind', W / 2, H * 0.28, base * 0.15, DUCK, 700);
      text('Race the sunset across the islands.', W / 2, H * 0.28 + base * 0.11, base * 0.036, INK);
      text(best > 0 ? `Best ${best} m` : 'No flight yet', W / 2, H * 0.53, base * 0.04, DUCK, 700);
      const how = isTouch ? 'Tap to start. Hold anywhere to dive, let go to fly.' : 'Press space to start. Hold space to dive, let go to fly.';
      text(how, W / 2, H * 0.7, base * 0.032, INK);
      text(isTouch ? 'Land along the slopes. Three perfect landings give you a tailwind.' : 'Land along the slopes. Three perfect landings give you a tailwind. M to mute, L for the leaderboard.',
        W / 2, H * 0.7 + base * 0.05, base * 0.027, INK);
    }

    if (state === 'dead') {
      const a = Math.min(1, deathT * 2);
      ctx.fillStyle = `rgba(20, 16, 50, ${0.5 * a})`; ctx.fillRect(0, 0, W, H);
      text(`${Math.floor(dist)} m`, W / 2, H * 0.36, base * 0.13, INK, 700, 'center', a);
      text(newBest ? `New best. The sun set on island ${island + 1}.` : `The sun set on island ${island + 1}.`,
        W / 2, H * 0.36 + base * 0.1, base * 0.04, newBest ? DUCK : INK, 700, 'center', a);
      text(quip, W / 2, H * 0.36 + base * 0.16, base * 0.032, INK, 500, 'center', a);
      const bl = boardLine(Board.status);
      if (bl) text(bl[0], W / 2, H * 0.36 + base * 0.23, base * 0.032, bl[1] ? DUCK : INK, 700, 'center', a);
      if (deathT > 0.8) {
        if (isTouch) {
          text('Tap to fly again', W / 2, H * 0.8, base * 0.04, INK, 700);
          text('Tap here for the menu', W / 2, pad + base * 0.16, base * 0.03, INK);
        } else text('Space to fly again. Esc for the menu.', W / 2, H * 0.8, base * 0.036, INK, 700);
      }
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255, 245, 200, ${flash * 0.4})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- leaderboard ----------
  const Board = createLeaderboard({ game: 'tailwind', modes: ['Daylight'], format: m => `${m} m`, onClose: () => cv.focus() });
  const homeLink = document.querySelector('.home-link');
  function openBoard() { if (state === 'play') return; held = false; Board.open(0); }
  Board.button.addEventListener('click', openBoard);

  function boardLine(s) {
    switch (s?.kind) {
      case 'posting': return ['Posting to the leaderboard…', false];
      case 'posted': return [s.improved ? `#${s.rank} on the leaderboard` : `Your best stands at ${s.best} m, #${s.rank} on the leaderboard`, s.improved];
      case 'needName': return [isTouch ? 'Tap Leaderboard to post this flight' : 'Press L to post this flight to the leaderboard', false];
      case 'rejected': return ['The leaderboard did not accept this flight', false];
      case 'offline': return ['The leaderboard is unavailable right now', false];
    }
    return null;
  }

  // ---------- input ----------
  const DIVE_KEYS = ['Space', 'ArrowDown', 'KeyS', 'ArrowUp', 'KeyW'];
  addEventListener('keydown', e => {
    if (Board.isOpen()) return;
    const k = e.code;
    if (DIVE_KEYS.includes(k)) e.preventDefault();
    unlockAudio();
    if (k === 'KeyM') { setMuted(!muted); return; }
    if (k === 'KeyL' && state !== 'play') { e.preventDefault(); openBoard(); return; }
    if (e.repeat) return;
    if (state === 'menu') { if (k === 'Space' || k === 'Enter') startGame(); }
    else if (state === 'dead') {
      if (k === 'Escape') goMenu();
      else if ((k === 'Space' || k === 'Enter') && deathT > 0.8) startGame();
    } else if (k === 'Escape') goMenu();
    else if (DIVE_KEYS.includes(k)) held = true;
  });
  addEventListener('keyup', e => { if (DIVE_KEYS.includes(e.code)) held = false; });
  addEventListener('blur', () => { held = false; });
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    try { document.hidden ? ac.suspend() : ac.resume(); } catch (e) {}
  });

  cv.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') isTouch = true;
    unlockAudio();
    cv.focus();
    if (state === 'menu') { startGame(); return; }
    if (state === 'dead') {
      if (deathT < 0.8) return;
      if (e.clientY < H * 0.22) goMenu(); else startGame();
      return;
    }
    held = true;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointerup', () => { held = false; });
  cv.addEventListener('pointercancel', () => { held = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- loop: physics runs in fixed steps, so frame rate doesn't change the flight ----------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 1 / 30) dt = 1 / 30;
    update(dt);
    draw();
    Board.button.hidden = state === 'play';
    homeLink.hidden = state !== 'menu';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  cv.focus();
})();
