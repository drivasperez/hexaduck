import { createLeaderboard, savedName } from '/shared/leaderboard.js';
import { createRoomConnection, renderTop } from '/shared/room.js';

// Confluence's client. The basin's Durable Object (src/confluence/basin.ts) runs the game and
// only sends drops whose motion changed, so this runs the same drift as the server
// (src/confluence/sim.ts) between updates. When an update disagrees with where a drop was drawn,
// the difference is eased out over a few frames rather than jumping.

(() => {
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  addEventListener('resize', resize);
  resize();

  const TAU = Math.PI * 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
  const $ = id => document.getElementById(id);
  const KIND = ['mote', 'player', 'bot'];

  // ---------- state ----------
  let cfg = null, myId = null, state = 'menu';
  const drops = new Map();  // id -> { x, y, vx, vy, mass, kind, name, color, ox, oy, born }
  const bursts = [];        // rings where a drop was absorbed or rain fell
  let cam = { x: 0, y: 0, zoom: 0.3 }, clock = 0, acc = 0, myMass = 0, cooldown = 0;

  // ---------- physics shared with the server ----------
  // Must match `drift` in src/confluence/sim.ts exactly; a test there checks the server's own
  // copy stays predictable.
  function drift(d, dt) {
    const k = 1 - cfg.drag * dt;
    d.vx *= k; d.vy *= k;
    d.x += d.vx * dt; d.y += d.vy * dt;
    const r = Math.sqrt(d.mass), dist = Math.hypot(d.x, d.y);
    if (dist + r <= cfg.radius || dist === 0) return;
    const nx = d.x / dist, ny = d.y / dist, out = d.vx * nx + d.vy * ny;
    if (out > 0) { d.vx -= (1 + cfg.bounce) * out * nx; d.vy -= (1 + cfg.bounce) * out * ny; }
    const inside = Math.max(0, cfg.radius - r);
    d.x = nx * inside; d.y = ny * inside;
  }

  // Your own flicks take effect straight away here; the server's next update confirms them.
  function predictPush(d, angle) {
    const e = Math.max(cfg.ejectMin, d.mass * cfg.ejectShare);
    d.mass -= e;
    d.vx -= Math.cos(angle) * cfg.ejectSpeed * e / d.mass;
    d.vy -= Math.sin(angle) * cfg.ejectSpeed * e / d.mass;
  }

  // ---------- connection ----------
  const conn = createRoomConnection({
    path: '/api/confluence', prefix: 'basin', onMessage, onStatus: status,
    onLost() { myId = null; if (state === 'play') showMenu(); },
  });

  function apply(row, born) {
    const [id, x, y, vx, vy, mass, kind, name, color] = row;
    const d = drops.get(id);
    if (d) {
      // Keep drawing it where it was, and ease towards where the server says it is.
      d.ox += d.x - x; d.oy += d.y - y;
      Object.assign(d, { x, y, vx, vy, mass, kind: KIND[kind] });
      if (name !== undefined) { d.name = name; d.color = color; } else d.name = '';
    } else {
      drops.set(id, { x, y, vx, vy, mass, kind: KIND[kind], name: name ?? '', color: color ?? 0, ox: 0, oy: 0, born });
      if (born > 0 && kind === 0 && mass > 30 && !reduceMotion) bursts.push({ x, y, t: 0, r: Math.sqrt(mass), rain: true });
    }
  }

  function onMessage(m) {
    switch (m.t) {
      case 'hi':
        cfg = m.cfg;
        drops.clear();
        for (const row of m.drops) apply(row, -1);
        status('');
        if (state === 'joining') join();
        break;
      case 'you':
        myId = m.id; state = 'play';
        $('panel').hidden = true; $('dead').hidden = true; $('hud').hidden = false;
        cv.focus();
        break;
      case 's': {
        if (m.full) {
          const keep = new Set(m.u.map(r => r[0]));
          for (const id of drops.keys()) if (!keep.has(id)) drops.delete(id);
        }
        for (const row of m.u) apply(row, clock);
        for (const id of m.rm) drops.delete(id);
        for (const [id] of m.k) {
          const d = drops.get(id);
          if (d) bursts.push({ x: d.x, y: d.y, t: 0, r: Math.sqrt(d.mass) * 1.5, rain: false });
        }
        const me = myId !== null ? drops.get(myId) : null;
        if (me) {
          if (me.mass > myMass + 1) sfx.grow();
          myMass = me.mass;
          $('hud-len').textContent = `${Math.round(me.mass)} ml`;
        }
        break;
      }
      case 'top':
        renderTop($('room-top'), $('room-count'), m, myId !== null ? drops.get(myId)?.name : null, { verb: 'drifting', format: n => `${n} ml` });
        break;
      case 'dead': onDead(m); break;
    }
  }

  // ---------- screens ----------
  function status(text) { $('status').textContent = text; }

  function showMenu() {
    state = 'menu';
    $('panel').hidden = false; $('dead').hidden = true; $('hud').hidden = true;
  }

  function join() {
    const name = $('join-name').value.trim() || savedName() || '';
    if (name) Board.setName(name);
    state = 'joining';
    if (!conn.open) { status('Connecting…'); return; }
    myMass = 0;
    unlockAudio();
    conn.send({ t: 'join', name });
  }

  function onDead(m) {
    state = 'dead'; myId = null; held = null;
    sfx.absorbed();
    $('dead-peak').textContent = `${m.peak} ml at your biggest`;
    $('dead-why').textContent = m.by ? `${m.by} absorbed you.` : 'A bigger drop absorbed you.';
    const line = $('dead-board');
    line.className = '';
    if (m.rank) {
      line.textContent = m.improved ? `#${m.rank} on the leaderboard` : `Your best stands at ${m.best} ml, #${m.rank} on the leaderboard`;
      if (m.improved) line.className = 'good';
    } else line.textContent = 'Grow past where you started to make the leaderboard.';
    $('hud').hidden = true; $('dead').hidden = false;
    $('again').focus();
  }

  $('join').addEventListener('submit', e => { e.preventDefault(); join(); });
  $('again').addEventListener('click', join);
  $('join-name').value = savedName();

  const Board = createLeaderboard({ game: 'confluence', modes: ['Biggest drop'], format: n => `${n} ml`, onClose: () => cv.focus() });
  Board.button.addEventListener('click', () => { if (state !== 'play') Board.open(0); });

  // ---------- audio ----------
  let ac = null, muted = false, lastGrow = 0;
  function unlockAudio() {
    try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {}
  }
  function tone(f, d, v, delay = 0, f2 = null, type = 'sine') {
    if (!ac || muted) return;
    try {
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  const sfx = {
    flick: () => tone(900, 0.08, 0.03, 0, 500),
    grow() { const now = performance.now(); if (now - lastGrow < 120) return; lastGrow = now; tone(420 + Math.min(500, Math.sqrt(myMass) * 8), 0.25, 0.035); },
    absorbed: () => [440, 370, 294, 220].forEach((f, i) => tone(f, 0.4, 0.05, i * 0.1)),
  };

  // ---------- input ----------
  // Holding the mouse, a finger or an arrow key keeps flicking as fast as the cooldown allows.
  let held = null, keys = new Set();
  const keyAngle = () => {
    const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
    // Keys say which way to go, so flick the opposite way.
    return x || y ? Math.atan2(-y, -x) : null;
  };
  addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') document.body.classList.add('touch'); }, true);
  cv.addEventListener('pointerdown', e => {
    unlockAudio();
    if (state !== 'play') return;
    held = [e.clientX, e.clientY];
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointermove', e => { if (held) held = [e.clientX, e.clientY]; });
  for (const type of ['pointerup', 'pointercancel']) cv.addEventListener(type, () => { held = null; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', e => {
    if (Board.isOpen() || e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyM') { muted = !muted; return; }
    if (e.code === 'KeyL' && state !== 'play') { Board.open(0); return; }
    if (e.code === 'Space' && state === 'dead' && !e.repeat) { e.preventDefault(); join(); return; }
    if (e.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { e.preventDefault(); keys.add(e.code); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { held = null; keys.clear(); });

  function flick(dt, me) {
    cooldown = Math.max(0, cooldown - dt);
    if (state !== 'play' || !me || cooldown > 0 || me.mass < cfg.minPushMass) return;
    let angle = keyAngle();
    if (angle === null && held) {
      // Flick towards the pointer, from where your drop is drawn on screen.
      const sx = (me.x + me.ox - cam.x) * cam.zoom + W / 2, sy = (me.y + me.oy - cam.y) * cam.zoom + H / 2;
      angle = Math.atan2(held[1] - sy, held[0] - sx);
    }
    if (angle === null) return;
    // A touch slower than the server's cooldown, so no flick gets refused.
    cooldown = cfg.pushCooldown + 0.02;
    predictPush(me, angle);
    conn.send({ t: 'push', a: Math.round(angle * 1000) / 1000 });
    sfx.flick();
  }

  // ---------- drawing ----------
  function hash(n, seed = 0) {
    let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Blue for drops you can absorb, red for ones that can absorb you, as in Osmos.
  function tint(d, me) {
    if (d === me) return ['#FFF3B8', '#FFD23F'];
    if (!me) return ['#C8F2FA', '#4FB3CC'];
    const k = d.mass / me.mass;
    if (k < 0.98) return ['#C8F2FA', '#3FA9C4'];
    if (k > 1.02) return ['#FFD2C2', '#E8603C'];
    return ['#F4F4F4', '#A8B4B8'];
  }

  function drawBasin() {
    ctx.fillStyle = '#061820';
    ctx.fillRect(cam.x - W / 2 / cam.zoom, cam.y - H / 2 / cam.zoom, W / cam.zoom, H / cam.zoom);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, cfg.radius);
    g.addColorStop(0, '#12455A'); g.addColorStop(1, '#0B2A3A');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, cfg.radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(127, 214, 230, 0.35)'; ctx.lineWidth = 6 / cam.zoom;
    ctx.stroke();
    // Motes of light on a fixed grid, so you can see yourself moving through the water.
    const cell = 140;
    const x0 = Math.floor((cam.x - W / 2 / cam.zoom) / cell), x1 = Math.ceil((cam.x + W / 2 / cam.zoom) / cell);
    const y0 = Math.floor((cam.y - H / 2 / cam.zoom) / cell), y1 = Math.ceil((cam.y + H / 2 / cam.zoom) / cell);
    if ((x1 - x0) * (y1 - y0) > 4000) return;
    ctx.fillStyle = 'rgba(200, 240, 250, 0.18)';
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const x = (i + hash(i, j)) * cell, y = (j + hash(j, i)) * cell;
      if (x * x + y * y > cfg.radius * cfg.radius) continue;
      const twinkle = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(clock * 1.5 + hash(i * 31 + j) * 20);
      ctx.globalAlpha = twinkle;
      ctx.beginPath(); ctx.arc(x, y, 1.5 / Math.min(1, cam.zoom), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDrop(d, me) {
    const r = Math.sqrt(d.mass), x = d.x + d.ox, y = d.y + d.oy;
    if (r * cam.zoom < 0.4) return;
    const pop = d.born > 0 ? Math.min(1, (clock - d.born) * 5) : 1;
    const [light, deep] = tint(d, me);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * pop);
    g.addColorStop(0, light); g.addColorStop(1, deep);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * pop, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (d.kind === 'mote') return;
    // Players and bots are ducklings riding their drop.
    const s = Math.min(r * 0.55, 16 / cam.zoom);
    const heading = Math.hypot(d.vx, d.vy) > 3 ? Math.atan2(d.vy, d.vx) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(heading);
    ctx.fillStyle = d === me ? '#E8A800' : 'rgba(255, 232, 140, 0.95)';
    ctx.beginPath(); ctx.ellipse(-s * 0.1, 0, s * 0.6, s * 0.42, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.45, 0, s * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FF8A1F';
    ctx.beginPath(); ctx.moveTo(s * 0.7, -s * 0.1); ctx.lineTo(s * 0.95, 0); ctx.lineTo(s * 0.7, s * 0.1); ctx.fill();
    ctx.restore();
    if (d !== me && d.name) {
      ctx.font = `700 ${13 / cam.zoom}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(d.name, x, y - r - 4 / cam.zoom);
    }
  }

  function drawBursts(dt) {
    for (const b of bursts) b.t += dt;
    for (let i = bursts.length - 1; i >= 0; i--) if (bursts[i].t > 0.8) bursts.splice(i, 1);
    for (const b of bursts) {
      const k = b.t / 0.8;
      ctx.strokeStyle = b.rain ? `rgba(200, 240, 250, ${0.35 * (1 - k)})` : `rgba(255, 255, 255, ${0.7 * (1 - k)})`;
      ctx.lineWidth = 2 / cam.zoom;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1 + k * 2.5), 0, TAU); ctx.stroke();
    }
  }

  function drawMinimap(me) {
    const size = Math.min(130, Math.min(W, H) * 0.24), pad = 16;
    const cx = pad + size / 2, cy = H - pad - size / 2, k = size / 2 / cfg.radius;
    ctx.fillStyle = 'rgba(8, 36, 47, 0.6)';
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    for (const d of drops.values()) {
      if (d.kind === 'mote' && d.mass < 400) continue;
      ctx.fillStyle = tint(d, me)[1];
      ctx.beginPath(); ctx.arc(cx + d.x * k, cy + d.y * k, Math.max(1.5, Math.sqrt(d.mass) * k), 0, TAU); ctx.fill();
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    clock += dt;
    conn.poll(now);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#061820'; ctx.fillRect(0, 0, W, H);
    if (cfg) {
      // Drift in the same fixed steps as the server.
      acc += dt;
      while (acc >= cfg.tick) { for (const d of drops.values()) drift(d, cfg.tick); acc -= cfg.tick; }
      const ease = Math.pow(0.001, dt);  // corrections fade to nothing in about a second
      for (const d of drops.values()) { d.ox *= ease; d.oy *= ease; }

      const me = myId !== null ? drops.get(myId) : null;
      flick(dt, me);

      // Follow your drop, zooming so it stays a comfortable size; or watch the biggest drop.
      let focus = me;
      if (!focus) for (const d of drops.values()) if (d.kind !== 'mote' && (!focus || d.mass > focus.mass)) focus = d;
      const base = Math.min(W, H);
      const want = focus
        ? { x: focus.x + focus.ox, y: focus.y + focus.oy, zoom: Math.max(0.15, Math.min(2, (base * (me ? 0.045 : 0.03)) / Math.sqrt(focus.mass))) }
        : { x: 0, y: 0, zoom: base / (cfg.radius * 2.2) };
      const k = me ? 1 - Math.pow(0.0001, dt) : 1 - Math.pow(0.3, dt);
      cam = { x: cam.x + (want.x - cam.x) * k, y: cam.y + (want.y - cam.y) * k, zoom: cam.zoom + (want.zoom - cam.zoom) * (1 - Math.pow(0.05, dt)) };

      ctx.setTransform(DPR * cam.zoom, 0, 0, DPR * cam.zoom, DPR * (W / 2 - cam.x * cam.zoom), DPR * (H / 2 - cam.y * cam.zoom));
      drawBasin();
      const sorted = [...drops.values()].sort((a, b) => a.mass - b.mass);
      for (const d of sorted) drawDrop(d, me);
      drawBursts(dt);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (state === 'play') drawMinimap(me);
      else { ctx.fillStyle = 'rgba(6, 24, 32, 0.35)'; ctx.fillRect(0, 0, W, H); }
    }
    Board.button.hidden = state === 'play';
    document.querySelector('.home-link').hidden = state === 'play';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
