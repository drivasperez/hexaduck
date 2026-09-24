import { createLeaderboard } from '/shared/leaderboard.js';

(() => {
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, SCALE = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    SCALE = Math.hypot(W, H) / 1100;
  }
  addEventListener('resize', resize);
  resize();

  const TAU = Math.PI * 2, SEG = TAU / 6;
  const CENTER_R = 48, PLAYER_R = 66, WALL_T = 26, SPAWN = 900;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
  const DUCK = '#FFD23F', BEAK = '#FF8A1F';

  const MODES = [
    { name: 'Scope 1', blurb: 'Direct emissions. A gentle start.',
      speed: 300, accel: 3, rot: 1.3, player: 8.4, gapMul: 1.2,
      hue: 196, hue2: 172, sat: 55, patterns: ['c', 'c', 'tri', 'barrage', 'zig'] },
    { name: 'Scope 2', blurb: 'Purchased energy. Things speed up.',
      speed: 390, accel: 4, rot: 1.9, player: 9.4, gapMul: 1.0,
      hue: 140, hue2: 100, sat: 45, patterns: ['c', 'tri', 'barrage', 'zig', 'multic', 'spiral'] },
    { name: 'Scope 3', blurb: 'The whole value chain. Good luck.',
      speed: 480, accel: 5, rot: 2.6, player: 10.4, gapMul: 0.9,
      hue: 330, hue2: 285, sat: 45, patterns: ['c', 'tri', 'barrage', 'zig', 'multic', 'spiral', 'spiral'] },
  ];
  const RANKS = [[0, 'Baseline'], [10, 'Measured'], [20, 'Reducing'], [30, 'Verified'], [45, 'Science-based'], [60, 'Net zero']];
  const QUIPS = [
    'Your preview environment is still booting. Go again.',
    "It's very simple: you just fly between the walls.",
    'Physics runs on elapsed time. Your monitor is not the problem.',
    'At least the gravity is fine this time.',
    'Scope 3 emissions are hard for everyone.',
    'The duck believes in you.',
  ];

  // ---------- storage ----------
  function loadBest() {
    try { const v = JSON.parse(localStorage.getItem('hexaduck-best') || 'null'); if (Array.isArray(v) && v.length === 3) return v; } catch (e) {}
    return [0, 0, 0];
  }
  function saveBest() { try { localStorage.setItem('hexaduck-best', JSON.stringify(best)); } catch (e) {} }

  // ---------- audio ----------
  let ac = null, muted = false;
  function unlockAudio() {
    try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {}
    if (ac && !Music.on) Music.start(mode);
  }
  function beep(f, d, type = 'square', v = 0.04, delay = 0, f2 = null) {
    if (muted || !ac) return;
    try {
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
      g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  const rankSound = () => { beep(523, .12, 'square', .035); beep(659, .12, 'square', .035, .09); beep(784, .2, 'square', .035, .18); };

  // ---------- generative music ----------
  // A 16th-note step sequencer on the Web Audio clock. Each scope has its own key, tempo
  // and chord loop; the bass, arpeggio and lead are generated from the chords and a seeded
  // random walk, and new layers join as your rank climbs.
  const Music = (() => {
    const MINOR = [0, 2, 3, 5, 7, 8, 10];
    const CFG = [
      { bpm: 128, root: 57, prog: [0, 5, 2, 6] },   // A minor: i VI III VII
      { bpm: 144, root: 62, prog: [0, 5, 3, 4] },   // D minor: i VI iv v
      { bpm: 160, root: 54, prog: [0, 6, 5, 4] },   // F# minor: i VII VI v
    ];
    const ARPS = [[0, 1, 2, 3], [0, 2, 1, 3], [3, 2, 1, 0], [0, 1, 2, 1], [0, 3, 1, 2]];
    let bus, filt, master, noiseBuf, timer = null;
    let cfg = CFG[0], mi = 0, spb = 0.5, stepDur = 0.125, nextTime = 0, startTime = 0, step = 0;
    let rng = Math.random, phrase = [], arpPick = [];
    let on = false;

    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    const deg = (d, oct = 0) => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return cfg.root + MINOR[i] + 12 * (o + oct); };
    function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

    function init() {
      if (bus) return;
      bus = ac.createGain(); bus.gain.value = 1;
      filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 18000; filt.Q.value = 0.7;
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.42;
      const comp = ac.createDynamicsCompressor();
      bus.connect(filt).connect(master).connect(comp).connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }

    function makePhrase() {
      const p = []; let d = Math.floor(rng() * 5);
      for (let i = 0; i < 16; i++) {
        if (rng() < 0.22) { p.push(null); continue; }
        d += [-2, -1, -1, 0, 1, 1, 2][Math.floor(rng() * 7)];
        d = Math.max(-2, Math.min(9, d)); p.push(d);
      }
      return p;
    }
    function mutate() { for (let k = 0; k < 4; k++) { const i = Math.floor(rng() * 16); phrase[i] = rng() < 0.2 ? null : Math.max(-2, Math.min(9, (phrase[i] ?? 3) + [-2, -1, 1, 2][Math.floor(rng() * 4)])); } }

    // --- voices ---
    function kick(t) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.3);
      // sidechain-style pump on the whole bus
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(0.55, t); bus.gain.linearRampToValueAtTime(1, t + spb * 0.45);
    }
    function noise(t, dur, type, freq, v) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    }
    function tone(t, midi, dur, type, v, cutoff) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(mtof(midi), t);
      let n = o;
      if (cutoff) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.25), t + dur); o.connect(f); n = f; }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.03);
    }

    function level() {
      if (state === 'menu') return -1;
      return Math.min(5, rankIdx + mi);   // higher scopes start with more layers
    }

    function playStep(n, t) {
      const s = n % 16, bar = Math.floor(n / 16);
      const chord = cfg.prog[bar % 4];
      const triad = [deg(chord), deg(chord + 2), deg(chord + 4), deg(chord, 1)];
      const L = level();
      if (s === 0) {
        if (bar % 4 === 0) arpPick = [0, 1, 2, 3].map(() => ARPS[Math.floor(rng() * ARPS.length)]);
        if (bar > 0 && bar % 4 === 0) mutate();
      }
      const arp = arpPick[bar % 4] || ARPS[0];

      if (L < 0) { // menu: calm bass and a soft arpeggio
        if (s % 8 === 0) tone(t, deg(chord, -1), spb * 1.8, 'sawtooth', 0.09, 700);
        if (s % 2 === 0) tone(t, triad[arp[(s / 2) % 4]] + 12, stepDur * 1.6, 'triangle', 0.05, 0);
        return;
      }
      // drums
      if (s % 4 === 0) kick(t);
      if (mi === 2 && L >= 3 && s === 10) kick(t);
      if (L >= 1 && s % 4 === 2) noise(t, 0.05, 'highpass', 8000, 0.16);
      if (L >= 4 && s % 2 === 1) noise(t, 0.025, 'highpass', 10000, 0.06);
      if ((L >= 3 || (mi > 0 && L >= 2)) && (s === 4 || s === 12)) { noise(t, 0.16, 'bandpass', 1800, 0.45); tone(t, 55, 0.08, 'triangle', 0.15, 0); }
      if (L >= 5 && bar % 4 === 3 && s >= 12) noise(t, 0.08, 'bandpass', 2400, 0.25); // fill
      // bass: pumping 8ths with octave bounce
      if (s % 2 === 0) tone(t, deg(chord, -1) + (s % 4 === 2 ? 12 : 0), stepDur * 1.5, 'sawtooth', 0.13, 700 + L * 180);
      // arpeggio
      if (L >= 2) tone(t, triad[arp[s % 4]] + 12 + (L >= 4 && s % 8 >= 4 ? 12 : 0), stepDur * 0.9, 'square', 0.03, 2600 + L * 300);
      // lead melody on 8ths, snapped to chord tones on strong beats
      if (L >= 4 && s % 2 === 0) {
        let d = phrase[(bar % 2) * 8 + s / 2];
        if (d != null) {
          if (s % 8 === 0) { const opts = [chord, chord + 2, chord + 4, chord + 7]; d = opts.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a); }
          tone(t, deg(d, 1), stepDur * 1.8, 'square', 0.045, 3200);
          if (L >= 5) tone(t, deg(d, 2), stepDur * 1.2, 'triangle', 0.02, 0);
        }
      }
    }

    function tick() {
      if (!on || ac.state !== 'running') return;
      if (nextTime < ac.currentTime - 0.2) nextTime = ac.currentTime + 0.05; // resync after a stall
      while (nextTime < ac.currentTime + 0.12) { playStep(step, nextTime); nextTime += stepDur; step++; }
    }

    return {
      get on() { return on; },
      start(modeIdx) {
        if (!ac) return;
        init();
        mi = modeIdx; cfg = CFG[modeIdx];
        spb = 60 / cfg.bpm; stepDur = spb / 4;
        rng = mulberry((Math.random() * 1e9) | 0);
        phrase = makePhrase(); arpPick = [];
        step = 0; nextTime = ac.currentTime + 0.06; startTime = nextTime;
        filt.frequency.cancelScheduledValues(ac.currentTime);
        filt.frequency.setTargetAtTime(18000, ac.currentTime, 0.05);
        on = true;
        if (!timer) timer = setInterval(tick, 25);
        tick();
      },
      muffle() { if (!filt) return; filt.frequency.cancelScheduledValues(ac.currentTime); filt.frequency.setTargetAtTime(320, ac.currentTime, 0.15); },
      setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.42, ac.currentTime, 0.02); },
      phase() { if (!on || !ac || ac.state !== 'running') return null; const p = (ac.currentTime - startTime) / spb; return p < 0 ? 0 : p % 1; },
    };
  })();

  // ---------- state ----------
  const keys = { l: false, r: false };
  const touches = new Map();
  let isTouch = false;
  let state = 'menu', mode = 0, best = loadBest();
  let clock = 0, t = 0, playerA = 0, walls = [], cursor = 0;
  let rot = 0, rotVel = 0.35, rotDir = 1, nextFlip = 4, speed = 0;
  let shake = 0, flash = 0, deathT = 0, rankIdx = 0, rankFlashT = 9, rankFlashText = '', newBest = false, quip = '';

  const norm = a => ((a % TAU) + TAU) % TAU;
  const sideOf = a => Math.floor(norm(a) / SEG) % 6;
  const left = () => keys.l || [...touches.values()].includes('l');
  const right = () => keys.r || [...touches.values()].includes('r');

  function blockedAt(side) {
    for (const w of walls) if (w.side === side && w.d <= PLAYER_R + 3 && w.d + w.t >= PLAYER_R - 3) return true;
    return false;
  }

  function addPattern(at) {
    const m = MODES[mode];
    const p = m.patterns[Math.floor(Math.random() * m.patterns.length)];
    const r = Math.floor(Math.random() * 6), dir = Math.random() < 0.5 ? 1 : -1;
    const sp = s => s * speed * m.gapMul;
    const S = i => (((r + dir * i) % 6) + 6) % 6;
    const all = ex => [0, 1, 2, 3, 4, 5].filter(x => !ex.includes(x));
    const rows = [];
    let o = 0;
    const rep = (n, gap, fn) => { for (let i = 0; i < n; i++) { rows.push(fn(i, o)); if (i < n - 1) o += sp(gap); } };
    switch (p) {
      case 'c': rows.push([0, all([S(0)])]); break;
      case 'multic': rep(3, 0.62, i => [o, all([S(i % 2 ? 3 : 0)])]); break;
      case 'tri': rep(4, 0.34, i => [o, i % 2 ? [S(1), S(3), S(5)] : [S(0), S(2), S(4)]]); break;
      case 'barrage': rep(3, 0.42, i => [o, i % 2 ? [S(3), S(4), S(5)] : [S(0), S(1), S(2)]]); break;
      case 'zig': rep(5, 0.3, i => [o, all([S(i % 2)])]); break;
      case 'spiral': rep(10, 0.14, i => [o, all([S(i), S(i + 1)]), WALL_T * 0.8]); break;
    }
    for (const [off, sides, th] of rows) for (const s of sides) walls.push({ side: s, d: at + off, t: th || WALL_T });
    return at + o + WALL_T + sp(0.5);
  }

  function startGame() {
    unlockAudio();
    const m = MODES[mode];
    state = 'play'; t = 0; walls = []; speed = m.speed;
    cursor = SPAWN - 150;
    playerA = norm(-Math.PI / 2 - rot);
    rotDir = Math.random() < 0.5 ? 1 : -1; nextFlip = 3 + Math.random() * 3;
    rankIdx = 0; rankFlashT = 0; rankFlashText = m.name; newBest = false;
    Board.startRun(mode);
    Music.start(mode);
  }

  function die() {
    state = 'dead'; deathT = 0; flash = 1; shake = reduceMotion ? 0 : 1;
    let q; do { q = QUIPS[Math.floor(Math.random() * QUIPS.length)]; } while (q === quip);
    quip = q;
    if (t > best[mode]) { best[mode] = t; newBest = true; saveBest(); }
    Board.finishRun(mode, t);
    beep(220, .5, 'sawtooth', .06, 0, 55);
    Music.muffle();
  }

  const Board = createLeaderboard({
    game: 'hexaduck', modes: MODES.map(m => m.name), format: s => `${s.toFixed(2)} s`, onClose: () => cv.focus(),
  });
  const homeLink = document.querySelector('.home-link');
  function openBoard() {
    if (state === 'play') return;
    keys.l = keys.r = false; touches.clear();
    Board.open(mode);
  }
  Board.button.addEventListener('click', openBoard);

  function boardLine(s) {
    switch (s?.kind) {
      case 'posting': return ['Posting to the leaderboard…', false];
      case 'posted': return [s.improved ? `#${s.rank} on the ${s.modeName} leaderboard` : `Your best stands at ${s.best.toFixed(2)} s, #${s.rank} on ${s.modeName}`, s.improved];
      case 'needName': return [isTouch ? 'Tap Leaderboard to post this run' : 'Press L to post this run to the leaderboard', false];
      case 'rejected': return ['The leaderboard did not accept this run', false];
      case 'offline': return ['The leaderboard is unavailable right now', false];
    }
    return null;
  }

  function goMenu() { state = 'menu'; touches.clear(); Music.start(mode); }
  function changeMode(d) { mode = (mode + d + 3) % 3; unlockAudio(); Music.start(mode); }

  // ---------- update ----------
  function update(dt) {
    clock += dt;
    shake = Math.max(0, shake - dt * 2.5);
    flash = Math.max(0, flash - dt * 2.2);
    rankFlashT += dt;
    const m = MODES[mode];

    if (state === 'play') {
      t += dt;
      speed = Math.min(m.speed + m.accel * t, m.speed * 1.7);
      if (t > nextFlip) { rotDir *= -1; nextFlip = t + 2.5 + Math.random() * 4; }
      const target = rotDir * m.rot * (1 + Math.min(t, 90) / 90 * 0.6);
      rotVel += (target - rotVel) * Math.min(1, dt * 4);
      rot += rotVel * dt;

      const mv = speed * dt;
      for (const w of walls) w.d -= mv;
      walls = walls.filter(w => w.d + w.t > CENTER_R);
      cursor -= mv;
      while (cursor < SPAWN) cursor = addPattern(cursor);

      const dir = (right() ? 1 : 0) - (left() ? 1 : 0);
      if (dir) {
        const cs = sideOf(playerA);
        const na = norm(playerA + dir * m.player * dt);
        const ns = sideOf(na);
        if (ns === cs || !blockedAt(ns)) playerA = na;
        else playerA = dir > 0 ? cs * SEG + SEG - 0.001 : cs * SEG + 0.001;
      }
      if (blockedAt(sideOf(playerA))) { die(); return; }

      while (rankIdx < RANKS.length - 1 && t >= RANKS[rankIdx + 1][0]) {
        rankIdx++; rankFlashT = 0; rankFlashText = RANKS[rankIdx][1]; rankSound();
      }
    } else {
      const want = (state === 'menu' ? 0.35 : 0.15) * (rotVel >= 0 ? 1 : -1);
      rotVel += (want - rotVel) * Math.min(1, dt * 2);
      rot += rotVel * dt;
      if (state === 'dead') deathT += dt;
    }
  }

  // ---------- drawing ----------
  function palette() {
    const m = MODES[mode];
    const k = (Math.sin(clock * 0.25) + 1) / 2;
    const h = m.hue + (m.hue2 - m.hue) * k;
    return {
      bg1: `hsl(${h} ${m.sat}% 13%)`, bg2: `hsl(${h} ${m.sat}% 17.5%)`,
      core: `hsl(${h} ${m.sat}% 9%)`, wall: `hsl(${h} 75% 72%)`,
      dim: `hsl(${h} 35% 80%)`, text: '#F2FAF7',
    };
  }

  function poly(pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
  const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

  function drawDuck() {
    const a = playerA;
    const local = norm(a) % SEG;
    const pr = PLAYER_R * Math.cos(SEG / 2) / Math.cos(local - SEG / 2);
    ctx.save();
    ctx.translate(pr * Math.cos(a), pr * Math.sin(a));
    ctx.rotate(a);
    ctx.fillStyle = DUCK;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-5, -3.5); ctx.lineTo(-5, 3.5); ctx.closePath(); ctx.fill(); // tail
    ctx.beginPath(); ctx.ellipse(-1, 0, 7, 5.2, 0, 0, TAU); ctx.fill(); // body
    ctx.beginPath(); ctx.arc(6, 0, 3.9, 0, TAU); ctx.fill(); // head
    ctx.fillStyle = BEAK;
    ctx.beginPath(); ctx.moveTo(8.8, -1.8); ctx.lineTo(13.5, 0); ctx.lineTo(8.8, 1.8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function text(str, x, y, size, color, weight = 500, align = 'center', alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  function draw() {
    const c = palette();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = c.bg1; ctx.fillRect(0, 0, W, H);

    const mp = Music.phase();
    const beat = mp == null ? (clock % 0.5) / 0.5 : mp;
    const pulse = reduceMotion ? 1 : 1 + 0.06 * Math.exp(-beat * 6);
    const zoom = 1 + (pulse - 1) * 0.25;
    const sx = (Math.random() - 0.5) * shake * 14, sy = (Math.random() - 0.5) * shake * 14;

    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(SCALE * zoom, SCALE * zoom);
    ctx.rotate(rot);

    ctx.fillStyle = c.bg2;
    for (let i = 1; i < 6; i += 2) { poly([[0, 0], P(3000, i * SEG), P(3000, (i + 1) * SEG)]); ctx.fill(); }

    ctx.fillStyle = c.wall;
    for (const w of walls) {
      const r1 = Math.max(w.d, CENTER_R), r2 = w.d + w.t;
      if (r2 <= r1 || r1 > 2000) continue;
      const a1 = w.side * SEG, a2 = a1 + SEG;
      poly([P(r1, a1), P(r2, a1), P(r2, a2), P(r1, a2)]); ctx.fill();
    }

    const cr = CENTER_R * pulse;
    const hex = []; for (let i = 0; i < 6; i++) hex.push(P(cr, i * SEG));
    poly(hex); ctx.fillStyle = c.core; ctx.fill();
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = c.wall; ctx.stroke();

    if (state !== 'menu') drawDuck();
    ctx.restore();

    const base = Math.min(W, H);
    const pad = Math.max(16, base * 0.035);

    if (state === 'play' || state === 'dead') {
      text(MODES[mode].name, pad, pad + base * 0.02, base * 0.032, c.dim, 500, 'left');
      text(RANKS[rankIdx][1], pad, pad + base * 0.065, base * 0.045, c.text, 700, 'left');
      text(t.toFixed(2), W - pad, pad + base * 0.04, base * 0.075, c.text, 700, 'right');
      text(best[mode] > 0 ? `Best ${best[mode].toFixed(2)}` : 'No best yet', W - pad, pad + base * 0.1, base * 0.03, c.dim, 500, 'right');
    }

    if (state === 'play' && rankFlashT < 1.4) {
      const a = 1 - rankFlashT / 1.4;
      text(rankFlashText, W / 2, H * 0.2, base * 0.085, c.text, 700, 'center', a);
    }

    if (state === 'menu') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, 0, W, H);
      const m = MODES[mode];
      text('Hexaduck', W / 2, H * 0.28, base * 0.15, DUCK, 700);
      text('Dodge the emissions. Hold on until net zero.', W / 2, H * 0.28 + base * 0.11, base * 0.034, c.text);
      text('‹', W / 2 - base * 0.25, H * 0.56, base * 0.08, c.dim, 700);
      text('›', W / 2 + base * 0.25, H * 0.56, base * 0.08, c.dim, 700);
      text(m.name, W / 2, H * 0.56, base * 0.075, c.text, 700);
      text(m.blurb, W / 2, H * 0.56 + base * 0.075, base * 0.032, c.dim);
      text(best[mode] > 0 ? `Best ${best[mode].toFixed(2)} s` : 'No run yet', W / 2, H * 0.56 + base * 0.125, base * 0.032, DUCK);
      if (isTouch) {
        text('Tap the middle to start. Tap the sides to change scope.', W / 2, H * 0.84, base * 0.03, c.text);
        text('In game, hold the left or right half of the screen.', W / 2, H * 0.84 + base * 0.045, base * 0.028, c.dim);
      } else {
        text('Press space to start. Use ← and → to change scope.', W / 2, H * 0.84, base * 0.03, c.text);
        text('In game, ← → or A D to steer. M to mute. L for the leaderboard.', W / 2, H * 0.84 + base * 0.045, base * 0.028, c.dim);
      }
    }

    if (state === 'dead') {
      const a = Math.min(1, deathT * 3);
      ctx.fillStyle = `rgba(0,0,0,${0.4 * a})`; ctx.fillRect(0, 0, W, H);
      text(`${t.toFixed(2)} s`, W / 2, H * 0.38, base * 0.13, c.text, 700, 'center', a);
      text(newBest ? `New best. You reached ${RANKS[rankIdx][1]}.` : `You reached ${RANKS[rankIdx][1]}.`,
        W / 2, H * 0.38 + base * 0.1, base * 0.04, newBest ? DUCK : c.dim, 700, 'center', a);
      text(quip, W / 2, H * 0.38 + base * 0.16, base * 0.032, c.text, 500, 'center', a);
      const bl = boardLine(Board.status);
      if (bl) text(bl[0], W / 2, H * 0.38 + base * 0.23, base * 0.032, bl[1] ? DUCK : c.dim, 700, 'center', a);
      if (deathT > 0.35) {
        if (isTouch) {
          text('Tap to go again', W / 2, H * 0.8, base * 0.04, c.text, 700);
          text('Tap here for the menu', W / 2, pad + base * 0.16, base * 0.03, c.dim);
        } else {
          text('Space to go again. Esc for the menu.', W / 2, H * 0.8, base * 0.036, c.text, 700);
        }
      }
    }

    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- input ----------
  addEventListener('keydown', e => {
    if (Board.isOpen()) return;
    const k = e.code;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) e.preventDefault();
    unlockAudio();
    if (k === 'KeyM') { muted = !muted; Music.setMuted(muted); return; }
    if (k === 'KeyL' && state !== 'play') { e.preventDefault(); openBoard(); return; }
    if (state === 'menu') {
      if (e.repeat) return;
      if (k === 'ArrowLeft' || k === 'KeyA') changeMode(-1);
      else if (k === 'ArrowRight' || k === 'KeyD') changeMode(1);
      else if (k === 'Space' || k === 'Enter') startGame();
    } else if (state === 'dead') {
      if (k === 'Escape') goMenu();
      else if ((k === 'Space' || k === 'Enter') && deathT > 0.35) startGame();
    } else if (k === 'Escape') { goMenu(); }
    if (k === 'ArrowLeft' || k === 'KeyA') keys.l = true;
    if (k === 'ArrowRight' || k === 'KeyD') keys.r = true;
  });
  addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.l = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.r = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    try { document.hidden ? ac.suspend() : ac.resume(); } catch (e) {}
  });
  addEventListener('blur', () => { keys.l = keys.r = false; touches.clear(); });

  cv.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') isTouch = true;
    unlockAudio();
    cv.focus();
    const x = e.clientX, y = e.clientY;
    if (state === 'menu') {
      if (x < W * 0.3) changeMode(-1);
      else if (x > W * 0.7) changeMode(1);
      else startGame();
      return;
    }
    if (state === 'dead') {
      if (deathT < 0.35) return;
      if (y < H * 0.22) { goMenu(); return; }
      startGame();
    }
    touches.set(e.pointerId, x < W / 2 ? 'l' : 'r');
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  const release = e => touches.delete(e.pointerId);
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
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
