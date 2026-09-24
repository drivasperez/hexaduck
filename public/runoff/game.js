import { createLeaderboard } from '/shared/leaderboard.js';
import {
  ACCEL, BUFFER, COYOTE, CRATE, CRATE_SLOW, G, GLIDE_FALL, GLIDE_TIME, JUMP_CUT, JUMP_V, MAX_SPEED, MIN_SPEED,
  nextBuilding, PX_PER_M, START_SPEED, WATER_Y,
} from '/runoff/level.js';

(() => {
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');

  // The world is laid out in a 540-unit-tall frame. Landscape views always show at least 720
  // units of width so there's enough warning of the next gap. Portrait views settle for 520 so
  // the duck isn't tiny, and the duck sits further left to make up for it; they also see more sky.
  const BASE_H = 540;
  let W = 0, H = 0, DPR = 1, S = 1, VW = 0, VH = 0, DUCK_X = 0.24;  // DUCK_X: where the duck sits across the view
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    S = Math.min(H / BASE_H, W / (W < H ? 520 : 720));
    DUCK_X = W < H ? 0.16 : 0.24;
    VW = W / S; VH = H / S;
  }
  addEventListener('resize', resize);
  resize();

  const TAU = Math.PI * 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
  const DUCK = '#FFD23F', BEAK = '#FF8A1F', INK = '#F2FAF7';

  const RANKS = [[0, 'Drizzle'], [250, 'Showers'], [700, 'Downpour'], [1400, 'Flash flood'], [2400, 'Storm surge'], [3600, 'Hundred-year flood']];
  // Sky and rain for each rank: [sky top, sky bottom, far skyline, near skyline, rain amount]
  const WEATHER = [
    ['#1D6275', '#4E9C9A', '#2F7784', '#205F6E', 0.15],
    ['#185568', '#3F8488', '#296C79', '#1B5463', 0.3],
    ['#134656', '#316E76', '#225C69', '#164856', 0.5],
    ['#0F3847', '#285A64', '#1C4D5A', '#123D4A', 0.7],
    ['#0B2B38', '#1F4852', '#173F4B', '#0F323E', 0.85],
    ['#081F29', '#193A43', '#12323C', '#0B2832', 1],
  ];
  const FALL_QUIPS = [
    'Ducks can swim. This one chose drama.',
    'The water always finds a way.',
    'Try the glide: hold jump while you fall.',
    'Runoff is a stormwater problem, and now a duck problem.',
    'Adaptation is cheaper than recovery.',
  ];
  const WALL_QUIPS = [
    'That building was not climate-resilient. Neither was the duck.',
    'Hold jump for a higher leap.',
    'Walls: surprisingly solid.',
    'The duck has filed a complaint with the planning office.',
  ];

  // ---------- storage ----------
  function loadBest() { try { return Number(localStorage.getItem('runoff-best')) || 0; } catch (e) { return 0; } }
  function saveBest() { try { localStorage.setItem('runoff-best', String(best)); } catch (e) {} }

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, k) => a + (b - a) * k;
  function hash(n, seed = 0) {
    let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------- audio ----------
  let ac = null, muted = false, noiseBuf = null, sfxBus = null, rainGain = null;
  function unlockAudio() {
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        sfxBus = ac.createGain(); sfxBus.gain.value = muted ? 0 : 1; sfxBus.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        // Rain: looped noise through a bandpass, louder as the weather worsens.
        const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.6;
        rainGain = ac.createGain(); rainGain.gain.value = 0;
        src.connect(f).connect(rainGain).connect(sfxBus); src.start();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) {}
    if (ac && !Music.on) Music.start();
  }
  function beep(f, d, type = 'square', v = 0.05, delay = 0, f2 = null) {
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
  function hiss(d, freq, v, type = 'lowpass', delay = 0) {
    if (!ac) return;
    try {
      const t0 = ac.currentTime + delay;
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      s.connect(f).connect(g).connect(sfxBus); s.start(t0, Math.random()); s.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  const sfx = {
    jump: () => beep(330, 0.12, 'square', 0.035, 0, 660),
    land: () => hiss(0.08, 500, 0.12),
    crate: () => { hiss(0.18, 900, 0.3, 'bandpass'); beep(110, 0.15, 'triangle', 0.12, 0, 60); },
    wall: () => { hiss(0.25, 300, 0.4); beep(90, 0.3, 'sawtooth', 0.08, 0, 40); },
    splash: () => { hiss(0.7, 1800, 0.35, 'bandpass'); hiss(0.9, 400, 0.25, 'lowpass', 0.05); },
    rank: () => { beep(587, 0.1, 'square', 0.03); beep(740, 0.1, 'square', 0.03, 0.08); beep(880, 0.18, 'square', 0.03, 0.16); },
    thunder: () => { hiss(2.2, 160, 0.5, 'lowpass', 0.3); },
  };

  // ---------- music ----------
  // A small step sequencer on the Web Audio clock: driving bass and kick, with hats, an
  // arpeggio and a lead joining as the weather worsens.
  const Music = (() => {
    const MINOR = [0, 2, 3, 5, 7, 8, 10];
    const ROOT = 52, BPM = 152, PROG = [0, 5, 3, 4];  // E minor: i VI iv v
    const spb = 60 / BPM, stepDur = spb / 4;
    let bus, filt, timer = null, on = false, nextTime = 0, step = 0;
    const deg = (d, oct = 0) => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return ROOT + MINOR[i] + 12 * (o + oct); };
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    const LEAD = [4, null, 2, 4, 5, null, 4, 2, 0, null, 2, null, 4, 2, 1, null];

    function init() {
      if (bus) return;
      bus = ac.createGain(); bus.gain.value = 1;
      filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 18000;
      const master = ac.createGain(); master.gain.value = 0.36;
      bus.connect(filt).connect(master).connect(ac.createDynamicsCompressor()).connect(sfxBus);
    }
    function tone(t, midi, dur, type, v, cutoff) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(mtof(midi), t);
      let n = o;
      if (cutoff) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.3), t + dur); o.connect(f); n = f; }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(t, dur, freq, v) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
    }
    function kick(t) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.27);
    }
    function playStep(n, t) {
      const s = n % 16, bar = Math.floor(n / 16), chord = PROG[bar % 4];
      const L = state === 'play' ? rankIdx : -1;
      if (L < 0) {
        if (s % 8 === 0) tone(t, deg(chord, -1), spb * 1.8, 'sawtooth', 0.08, 600);
        if (s % 4 === 2) tone(t, deg(chord + [0, 2, 4, 2][(s >> 2) % 4], 1), stepDur * 2, 'triangle', 0.04, 0);
        return;
      }
      if (s % 4 === 0) kick(t);
      if (s % 2 === 0) tone(t, deg(chord, -1) + (s % 4 === 2 ? 12 : 0), stepDur * 1.4, 'sawtooth', 0.12, 650 + L * 200);
      if (L >= 1 && s % 4 === 2) noise(t, 0.05, 8000, 0.14);
      if (L >= 2) tone(t, deg(chord + [0, 2, 4, 7][s % 4], 1), stepDur * 0.9, 'square', 0.028, 2400 + L * 300);
      if (L >= 3 && (s === 4 || s === 12)) noise(t, 0.14, 1500, 0.3);
      if (L >= 4 && s % 2 === 0) { const d = LEAD[(s / 2 + (bar % 2) * 8) % 16]; if (d != null) tone(t, deg(chord + d, 1), stepDur * 1.8, 'square', 0.04, 3200); }
      if (L >= 5 && s % 2 === 1) noise(t, 0.025, 10000, 0.05);
    }
    function tick() {
      if (!on || ac.state !== 'running') return;
      if (nextTime < ac.currentTime - 0.2) nextTime = ac.currentTime + 0.05;
      while (nextTime < ac.currentTime + 0.12) { playStep(step, nextTime); nextTime += stepDur; step++; }
    }
    return {
      get on() { return on; },
      start() {
        if (!ac) return;
        init();
        step = 0; nextTime = ac.currentTime + 0.06; on = true;
        filt.frequency.cancelScheduledValues(ac.currentTime);
        filt.frequency.setTargetAtTime(18000, ac.currentTime, 0.05);
        if (!timer) timer = setInterval(tick, 25);
        tick();
      },
      muffle() { if (!filt) return; filt.frequency.cancelScheduledValues(ac.currentTime); filt.frequency.setTargetAtTime(300, ac.currentTime, 0.15); },
    };
  })();
  function setMuted(m) { muted = m; if (sfxBus) sfxBus.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.02); }

  // ---------- state ----------
  let state = 'menu', best = loadBest(), isTouch = false;
  let clock = 0, t = 0, speed = START_SPEED, camX = 0, startX = 0, dist = 0;
  let buildings = [], debris = [];
  let rankIdx = 0, rankFlashT = 9, rankFlashText = '', newBest = false, quip = '';
  let shake = 0, flash = 0, deathT = 0, nextThunder = 8;
  let held = false, pressedAt = -1, legPhase = 0;
  const duck = { x: 0, y: 0, vy: 0, ground: true, coyote: 0, glide: 0, gliding: false, cut: false, crashed: false };

  // ---------- level generation ----------
  function addBuilding(x, w, top) {
    const b = { x, w, top, seed: (Math.random() * 1e9) | 0, crates: [], deco: Math.floor(Math.random() * 4) };
    if (w > 520 && x > 900 && Math.random() < 0.4) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) b.crates.push({ x: x + rand(160, w - 160 - CRATE), stack: Math.random() < 0.25 ? 2 : 1, hit: false });
    }
    buildings.push(b);
    return b;
  }

  function generate(until) {
    let prev = buildings[buildings.length - 1];
    while (prev.x + prev.w < until) {
      const next = nextBuilding(prev, speed);
      prev = addBuilding(next.x, next.w, next.top);
    }
    buildings = buildings.filter(b => b.x + b.w > camX - 200);
  }

  function buildingAt(x) {
    for (const b of buildings) if (x >= b.x && x <= b.x + b.w) return b;
    return null;
  }

  function resetWorld() {
    buildings = []; debris = [];
    speed = START_SPEED;
    addBuilding(-400, 1900, 380);
    Object.assign(duck, { x: 0, y: 380, vy: 0, ground: true, coyote: 0, glide: 0, gliding: false, cut: false, crashed: false });
    startX = duck.x; dist = 0;
    camX = duck.x - VW * DUCK_X;
    generate(camX + VW + 600);
  }
  resetWorld();

  function startGame() {
    unlockAudio();
    resetWorld();
    state = 'play'; t = 0; rankIdx = 0; rankFlashT = 0; rankFlashText = RANKS[0][1]; newBest = false;
    held = false; pressedAt = -1; nextThunder = 6 + Math.random() * 6;
    Board.startRun(0);
    Music.start();
  }

  function die(cause) {
    state = 'dead'; deathT = 0;
    const pool = cause === 'wall' ? WALL_QUIPS : FALL_QUIPS;
    let q; do { q = pool[Math.floor(Math.random() * pool.length)]; } while (q === quip && pool.length > 1);
    quip = q;
    const m = Math.floor(dist);
    if (m > best) { best = m; newBest = true; saveBest(); }
    Board.finishRun(0, m);
    sfx.splash();
    Music.muffle();
  }

  function goMenu() { state = 'menu'; held = false; resetWorld(); Music.start(); }

  // ---------- update ----------
  function jumpPressed() { pressedAt = clock; held = true; }
  function jumpReleased() {
    held = false;
    if (state === 'play' && !duck.ground && duck.vy < 0 && !duck.cut) { duck.vy *= JUMP_CUT; duck.cut = true; }
  }

  function update(dt) {
    clock += dt;
    shake = Math.max(0, shake - dt * 3);
    flash = Math.max(0, flash - dt * 1.8);
    rankFlashT += dt;

    if (state === 'menu') {
      camX += 140 * dt;
      generate(camX + VW + 600);
    } else if (state === 'play') {
      updatePlay(dt);
    } else {
      deathT += dt;
      updateDebris(dt);
    }

    const rain = WEATHER[state === 'menu' ? 1 : rankIdx][4];
    if (rainGain) rainGain.gain.setTargetAtTime(0.02 + rain * 0.09, ac.currentTime, 0.5);
  }

  function updatePlay(dt) {
    t += dt;
    const d = duck;
    if (!d.crashed) speed = Math.min(MAX_SPEED, speed + ACCEL * dt);

    if (pressedAt >= 0 && clock - pressedAt <= BUFFER && !d.crashed && (d.ground || d.coyote > 0)) {
      d.vy = -JUMP_V; d.ground = false; d.coyote = 0; d.glide = GLIDE_TIME; d.cut = false; pressedAt = -1;
      if (!held) { d.vy *= JUMP_CUT; d.cut = true; }  // a tap shorter than a frame still gives a short hop
      sfx.jump();
    }

    const prevY = d.y;
    if (!d.crashed) d.x += speed * dt;
    if (d.ground) {
      const under = buildingAt(d.x);
      if (under) d.y = under.top;
      else { d.ground = false; d.coyote = COYOTE; d.vy = 0; }
    }
    if (!d.ground) {
      d.coyote -= dt;
      d.gliding = held && d.vy > 0 && d.glide > 0 && !d.crashed;
      if (d.gliding) { d.glide -= dt; d.vy += (GLIDE_FALL - d.vy) * Math.min(1, dt * 12); }
      else d.vy = Math.min(1400, d.vy + G * dt);
      d.y += d.vy * dt;

      const under = !d.crashed && (buildingAt(d.x + 8) || buildingAt(d.x - 8));
      if (under && d.y >= under.top) {
        // Landed from above, or clipped the roof edge close enough to step up onto it.
        if (prevY <= under.top + 2 || d.y - under.top < 12) {
          d.y = under.top; d.vy = 0; d.ground = true; d.gliding = false; sfx.land();
        } else {
          d.crashed = true; d.x = under.x - 9; speed = 0; d.vy = Math.max(d.vy, 0);
          shake = reduceMotion ? 0 : 0.8; sfx.wall();
        }
      }
    }

    // Crates slow the duck down and go flying.
    for (const b of buildings) for (const c of b.crates) {
      if (c.hit || d.x + 13 < c.x || d.x - 13 > c.x + CRATE) continue;
      if (d.y > b.top - CRATE * c.stack && d.y - 22 < b.top) {
        c.hit = true;
        for (let k = 0; k < c.stack; k++) debris.push({ x: c.x, y: b.top - CRATE * (k + 1), vx: speed * rand(0.4, 0.8), vy: rand(-420, -250), r: 0, vr: rand(-8, 8) });
        speed = Math.max(MIN_SPEED, speed * CRATE_SLOW);
        shake = reduceMotion ? 0 : 0.35; sfx.crate();
      }
    }
    updateDebris(dt);

    if (d.y > WATER_Y + 26) { die(d.crashed ? 'wall' : 'fall'); return; }

    dist = Math.max(0, (d.x - startX) / PX_PER_M);
    legPhase += speed * dt * 0.045;
    camX = d.crashed ? camX : d.x - VW * DUCK_X;
    generate(camX + VW + 600);

    while (rankIdx < RANKS.length - 1 && dist >= RANKS[rankIdx + 1][0]) {
      rankIdx++; rankFlashT = 0; rankFlashText = RANKS[rankIdx][1]; sfx.rank();
    }
    if (rankIdx >= 3 && t > nextThunder) {
      nextThunder = t + rand(7, 14);
      flash = reduceMotion ? 0.3 : 1;
      sfx.thunder();
    }
  }

  function updateDebris(dt) {
    for (const p of debris) { p.x += p.vx * dt; p.vy += G * dt; p.y += p.vy * dt; p.r += p.vr * dt; }
    debris = debris.filter(p => p.y < WATER_Y + 40);
  }

  // ---------- drawing ----------
  function text(str, x, y, size, color, weight = 500, align = 'center', alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  // World units to the canvas: x is shifted by the camera, y so the bottom of the view is BASE_H.
  function world(parallax = 1, sx = 0, sy = 0) {
    ctx.setTransform(DPR * S, 0, 0, DPR * S, 0, 0);
    ctx.translate(-camX * parallax + sx, VH - BASE_H + sy);
  }

  function skyline(parallax, colW, minH, maxH, color, seed, lit) {
    const off = camX * parallax;
    const first = Math.floor(off / colW) - 1;
    ctx.fillStyle = color;
    for (let i = first; i < first + VW / colW + 3; i++) {
      const h = lerp(minH, maxH, hash(i, seed));
      const w = colW * (0.7 + hash(i, seed + 1) * 0.3);
      ctx.fillRect(i * colW, WATER_Y - h, w, h + 60);
    }
    if (!lit) return;
    ctx.fillStyle = 'rgba(255, 210, 63, 0.35)';
    for (let i = first; i < first + VW / colW + 3; i++) {
      const h = lerp(minH, maxH, hash(i, seed));
      for (let wy = WATER_Y - h + 10; wy < WATER_Y - 8; wy += 16)
        for (let wx = 6; wx < colW * 0.6; wx += 12)
          if (hash(i * 131 + wx * 7 + wy, seed + 2) < 0.12) ctx.fillRect(i * colW + wx, wy, 4, 6);
    }
  }

  function drawBuilding(b) {
    ctx.fillStyle = '#0B2A36';
    ctx.fillRect(b.x, b.top, b.w, WATER_Y + 80 - b.top);
    ctx.fillStyle = '#2C6E7F';
    ctx.fillRect(b.x - 4, b.top, b.w + 8, 7);
    // windows
    const cols = Math.floor((b.w - 30) / 34);
    for (let r = 0; b.top + 30 + r * 38 < WATER_Y; r++) for (let c = 0; c < cols; c++) {
      const lit = hash(c * 97 + r * 13, b.seed) < 0.22;
      ctx.fillStyle = lit ? 'rgba(255, 210, 63, 0.55)' : 'rgba(127, 214, 230, 0.07)';
      ctx.fillRect(b.x + 22 + c * 34, b.top + 30 + r * 38, 16, 20);
    }
    // rooftop clutter, purely decorative
    ctx.fillStyle = '#123F4D';
    const dx = b.x + b.w * (0.55 + 0.3 * hash(1, b.seed));
    if (b.deco === 0) { ctx.fillRect(dx, b.top - 34, 30, 34); ctx.fillRect(dx - 3, b.top - 38, 36, 6); }            // water tank
    else if (b.deco === 1) { ctx.fillRect(dx, b.top - 60, 3, 60); ctx.fillRect(dx - 10, b.top - 44, 23, 2); }     // antenna
    else if (b.deco === 2) {                                                                                        // solar panels
      ctx.fillStyle = '#24566A';
      for (let k = 0; k < 3 && dx + k * 40 < b.x + b.w - 30; k++) { ctx.beginPath(); ctx.moveTo(dx + k * 40, b.top); ctx.lineTo(dx + k * 40 + 34, b.top - 16); ctx.lineTo(dx + k * 40 + 34, b.top); ctx.fill(); }
    }
    for (const c of b.crates) if (!c.hit) for (let k = 0; k < c.stack; k++) drawCrate(c.x, b.top - CRATE * (k + 1), 0);
  }

  function drawCrate(x, y, r) {
    ctx.save();
    ctx.translate(x + CRATE / 2, y + CRATE / 2); ctx.rotate(r);
    ctx.fillStyle = '#B7793A'; ctx.fillRect(-CRATE / 2, -CRATE / 2, CRATE, CRATE);
    ctx.strokeStyle = '#7A4E22'; ctx.lineWidth = 3;
    ctx.strokeRect(-CRATE / 2 + 1.5, -CRATE / 2 + 1.5, CRATE - 3, CRATE - 3);
    ctx.beginPath(); ctx.moveTo(-CRATE / 2 + 3, -CRATE / 2 + 3); ctx.lineTo(CRATE / 2 - 3, CRATE / 2 - 3); ctx.stroke();
    ctx.restore();
  }

  function drawDuck() {
    const d = duck;
    ctx.save();
    ctx.translate(d.x, d.y);
    const tilt = d.ground ? 0 : clamp(d.vy / 2200, -0.3, 0.45);
    ctx.rotate(tilt);
    // legs
    ctx.strokeStyle = BEAK; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (d.ground) {
      const a = Math.sin(legPhase) * 6;
      ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-2 + a, 0); ctx.moveTo(3, -8); ctx.lineTo(3 - a, 0); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-3, -8); ctx.lineTo(-8, -3); ctx.moveTo(2, -8); ctx.lineTo(-3, -2); ctx.stroke();
    }
    ctx.fillStyle = DUCK;
    ctx.beginPath(); ctx.moveTo(-17, -16); ctx.lineTo(-9, -21); ctx.lineTo(-9, -12); ctx.closePath(); ctx.fill();  // tail
    ctx.beginPath(); ctx.ellipse(-1, -15, 13, 9, 0, 0, TAU); ctx.fill();                                           // body
    ctx.beginPath(); ctx.arc(11, -26, 7, 0, TAU); ctx.fill();                                                        // head
    ctx.fillStyle = BEAK;
    ctx.beginPath(); ctx.moveTo(16, -28); ctx.lineTo(25, -25); ctx.lineTo(16, -22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0B2A36';
    ctx.beginPath(); ctx.arc(13, -28, 1.6, 0, TAU); ctx.fill();
    // wing: tucked while running, raised in the air, flapping while gliding
    ctx.fillStyle = '#F2B81F';
    const flap = d.gliding ? Math.sin(clock * 40) * 0.9 : d.ground ? 0.1 : -0.7;
    ctx.save(); ctx.translate(-3, -17); ctx.rotate(flap - 0.2);
    ctx.beginPath(); ctx.ellipse(-6, 0, 10, 5, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawWater() {
    ctx.fillStyle = 'rgba(30, 127, 140, 0.88)';
    ctx.beginPath();
    const x0 = camX - 20, x1 = camX + VW + 20;
    ctx.moveTo(x0, BASE_H + 10);
    for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, WATER_Y + Math.sin(x * 0.02 + clock * 2.2) * 4 + Math.sin(x * 0.047 - clock * 3.1) * 2);
    ctx.lineTo(x1, BASE_H + 10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(127, 214, 230, 0.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 12) { const y = WATER_Y + Math.sin(x * 0.02 + clock * 2.2) * 4 + Math.sin(x * 0.047 - clock * 3.1) * 2; x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  }

  function drawRain(amount) {
    const n = Math.floor(40 + amount * 260);
    const fall = 900, wind = -(state === 'play' ? speed * 0.5 : 120) - 80;
    ctx.setTransform(DPR * S, 0, 0, DPR * S, 0, 0);
    ctx.strokeStyle = `rgba(200, 235, 240, ${0.18 + amount * 0.2})`; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const sp = 0.8 + hash(i, 3) * 0.5;
      const x = ((hash(i, 1) * (VW + 200) + clock * wind * sp) % (VW + 200) + VW + 200) % (VW + 200) - 100;
      const y = (hash(i, 2) * (VH + 40) + clock * fall * sp) % (VH + 40) - 20;
      ctx.moveTo(x, y); ctx.lineTo(x + wind * 0.02, y + 16);
    }
    ctx.stroke();
  }

  function draw() {
    const wi = state === 'menu' ? 1 : rankIdx;
    const [skyTop, skyBottom, far, near, rain] = WEATHER[wi];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, skyTop); g.addColorStop(1, skyBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const sx = (Math.random() - 0.5) * shake * 16, sy = (Math.random() - 0.5) * shake * 16;
    world(0.15); skyline(0.15, 90, 120, 260, far, 11, false);
    world(0.4); skyline(0.4, 70, 60, 180, near, 23, true);
    drawRain(rain * 0.5);

    world(1, sx, sy);
    for (const b of buildings) if (b.x < camX + VW + 50 && b.x + b.w > camX - 50) drawBuilding(b);
    for (const p of debris) drawCrate(p.x, p.y, p.r);
    if (state !== 'menu') drawDuck();
    drawWater();
    drawRain(rain);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const base = Math.min(W, H), pad = Math.max(16, base * 0.035);

    if (state !== 'menu') {
      text(RANKS[rankIdx][1], pad, pad + base * 0.03, base * 0.045, INK, 700, 'left');
      text(`${Math.floor(dist)} m`, W - pad, pad + base * 0.04, base * 0.075, INK, 700, 'right');
      text(best > 0 ? `Best ${best} m` : 'No best yet', W - pad, pad + base * 0.1, base * 0.03, '#CFE6EA', 500, 'right');
    }
    if (state === 'play' && rankFlashT < 1.4) text(rankFlashText, W / 2, H * 0.22, base * 0.085, INK, 700, 'center', 1 - rankFlashT / 1.4);

    if (state === 'menu') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, W, H);
      text('Runoff', W / 2, H * 0.3, base * 0.15, DUCK, 700);
      text("The water's rising. Keep the duck on the rooftops.", W / 2, H * 0.3 + base * 0.11, base * 0.034, INK);
      text(best > 0 ? `Best ${best} m` : 'No run yet', W / 2, H * 0.55, base * 0.04, DUCK, 700);
      if (isTouch) {
        text('Tap to start. Tap to jump, hold to jump higher.', W / 2, H * 0.72, base * 0.03, INK);
        text('Hold while falling to glide for a moment.', W / 2, H * 0.72 + base * 0.045, base * 0.028, '#CFE6EA');
      } else {
        text('Press space to start. Space, ↑ or W to jump; hold to jump higher.', W / 2, H * 0.72, base * 0.03, INK);
        text('Hold jump while falling to glide for a moment. M to mute. L for the leaderboard.', W / 2, H * 0.72 + base * 0.045, base * 0.028, '#CFE6EA');
      }
    }

    if (state === 'dead') {
      const a = Math.min(1, deathT * 3);
      ctx.fillStyle = `rgba(0,0,0,${0.42 * a})`; ctx.fillRect(0, 0, W, H);
      text(`${Math.floor(dist)} m`, W / 2, H * 0.36, base * 0.13, INK, 700, 'center', a);
      text(newBest ? `New best. You made it to ${RANKS[rankIdx][1]}.` : `You made it to ${RANKS[rankIdx][1]}.`,
        W / 2, H * 0.36 + base * 0.1, base * 0.04, newBest ? DUCK : '#CFE6EA', 700, 'center', a);
      text(quip, W / 2, H * 0.36 + base * 0.16, base * 0.032, INK, 500, 'center', a);
      const bl = boardLine(Board.status);
      if (bl) text(bl[0], W / 2, H * 0.36 + base * 0.23, base * 0.032, bl[1] ? DUCK : '#CFE6EA', 700, 'center', a);
      if (deathT > 0.5) {
        if (isTouch) {
          text('Tap to go again', W / 2, H * 0.8, base * 0.04, INK, 700);
          text('Tap here for the menu', W / 2, pad + base * 0.16, base * 0.03, '#CFE6EA');
        } else {
          text('Space to go again. Esc for the menu.', W / 2, H * 0.8, base * 0.036, INK, 700);
        }
      }
    }

    if (flash > 0) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = `rgba(230, 245, 255, ${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- leaderboard ----------
  const Board = createLeaderboard({ game: 'runoff', modes: ['Endless'], format: m => `${m} m`, onClose: () => cv.focus() });
  const homeLink = document.querySelector('.home-link');
  function openBoard() { if (state === 'play') return; held = false; Board.open(0); }
  Board.button.addEventListener('click', openBoard);

  function boardLine(s) {
    switch (s?.kind) {
      case 'posting': return ['Posting to the leaderboard…', false];
      case 'posted': return [s.improved ? `#${s.rank} on the leaderboard` : `Your best stands at ${s.best} m, #${s.rank} on the leaderboard`, s.improved];
      case 'needName': return [isTouch ? 'Tap Leaderboard to post this run' : 'Press L to post this run to the leaderboard', false];
      case 'rejected': return ['The leaderboard did not accept this run', false];
      case 'offline': return ['The leaderboard is unavailable right now', false];
    }
    return null;
  }

  // ---------- input ----------
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyX'];
  addEventListener('keydown', e => {
    if (Board.isOpen()) return;
    const k = e.code;
    if (JUMP_KEYS.includes(k) || k === 'ArrowDown') e.preventDefault();
    unlockAudio();
    if (k === 'KeyM') { setMuted(!muted); return; }
    if (k === 'KeyL' && state !== 'play') { e.preventDefault(); openBoard(); return; }
    if (e.repeat) return;
    if (state === 'menu') { if (k === 'Space' || k === 'Enter') startGame(); }
    else if (state === 'dead') {
      if (k === 'Escape') goMenu();
      else if ((k === 'Space' || k === 'Enter') && deathT > 0.5) startGame();
    } else if (k === 'Escape') goMenu();
    else if (JUMP_KEYS.includes(k)) jumpPressed();
  });
  addEventListener('keyup', e => { if (JUMP_KEYS.includes(e.code)) jumpReleased(); });
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
      if (deathT < 0.5) return;
      if (e.clientY < H * 0.22) goMenu(); else startGame();
      return;
    }
    jumpPressed();
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointerup', () => jumpReleased());
  cv.addEventListener('pointercancel', () => jumpReleased());
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- loop (elapsed-time based, so frame rate doesn't change difficulty) ----------
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
