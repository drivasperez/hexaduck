import { createLeaderboard, savedName } from '/shared/leaderboard.js';

// Flock's client. The pond's Durable Object (src/flock/pond.ts) runs the game; this draws it.
// Snapshots arrive 20 times a second and are drawn about 110 ms behind so ducks can be
// interpolated smoothly between them. Only heads are sent, so each duck's trail of ducklings
// is rebuilt here from where its head has been.

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

  const TAU = Math.PI * 2, DELAY = 110, ROOMS = 5;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
  const BODY = ['#E9E4D8', '#8B6B4A', '#6E9C7E', '#C9A26B', '#7086A8', '#B86A5A', '#8A74B8', '#D98C3B', '#5BA8BA', '#A8A8A8'];
  const HEAD = ['#2F6B4A', '#5A4230', '#2F5A42', '#8A6A3E', '#3E4E6E', '#7A3A2E', '#4E3E78', '#8A5520', '#2E6878', '#5E5E5E'];
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const fixedRoom = params.get('room');

  // ---------- state ----------
  let ws = null, room = 1, cfg = null, myId = null, state = 'menu';
  let snaps = [];               // [{ time, ducks: Map<id, [x, y, angle, length, boost, safe]> }]
  const names = new Map();      // id -> { name, color, bot }
  const crumbs = new Map();     // id -> { x, y, v, born }
  const trails = new Map();     // id -> flat [x, y, ...] newest first
  const bursts = [];            // scatter effects: { x, y, t }
  let cam = { x: 0, y: 0, zoom: 1 }, clock = 0, myLength = 0, reconnectAt = 0;

  // ---------- connection ----------
  function connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/flock?room=${fixedRoom || `pond-${room}`}`;
    const sock = new WebSocket(url);
    ws = sock;
    sock.addEventListener('message', e => { if (ws === sock) onMessage(JSON.parse(e.data)); });
    sock.addEventListener('close', () => {
      if (ws !== sock) return;
      ws = null; myId = null;
      if (state === 'play') showMenu();
      status('Lost the connection. Reconnecting…');
      reconnectAt = performance.now() + 1500;
    });
  }

  function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

  function onMessage(m) {
    switch (m.t) {
      case 'hi':
        cfg = m.cfg;
        crumbs.clear(); names.clear(); trails.clear(); snaps = [];
        for (const [id, x, y, v] of m.crumbs) crumbs.set(id, { x, y, v, born: -1 });
        for (const row of m.ducks) addName(row);
        status('');
        if (state === 'joining') join();
        break;
      case 'full':
        // Try the next room along, unless a room was asked for.
        if (!fixedRoom && room < ROOMS) { room++; ws = null; connect(); }
        else status('Every pond is full right now. Try again in a minute.');
        break;
      case 'you':
        myId = m.id; state = 'play';
        $('panel').hidden = true; $('dead').hidden = true; $('hud').hidden = false;
        $('boost').hidden = !document.body.classList.contains('touch');
        cv.focus();
        break;
      case 'n':
        for (const row of m.d) addName(row);
        break;
      case 's': onSnapshot(m); break;
      case 'top': renderTop(m); break;
      case 'dead': onDead(m); break;
    }
  }

  function addName([id, name, color, bot]) { names.set(id, { name, color, bot: !!bot }); }

  function onSnapshot(m) {
    const ducks = new Map();
    for (const [id, x, y, a, len, boost, safe] of m.d) ducks.set(id, [x, y, a, len, boost, safe]);
    snaps.push({ time: performance.now(), ducks });
    if (snaps.length > 30) snaps.shift();
    for (const [id, x, y, v] of m.ca) crumbs.set(id, { x, y, v, born: clock });
    for (const id of m.cr) crumbs.delete(id);
    for (const [id] of m.k) {
      const trail = trails.get(id);
      if (trail) bursts.push({ x: trail[0], y: trail[1], t: 0 });
      trails.delete(id);
      names.delete(id);
    }
    const mine = myId !== null ? ducks.get(myId) : null;
    if (mine) {
      if (mine[3] !== myLength) sfx.grow(mine[3] > myLength);
      myLength = mine[3];
      $('hud-len').textContent = `${myLength} ducklings`;
    }
  }

  function renderTop(m) {
    $('room-count').textContent = m.humans === 1 ? '1 person swimming' : `${m.humans} people swimming`;
    const me = myId !== null ? names.get(myId)?.name : null;
    $('room-top').replaceChildren(...m.l.map(([name, len, bot]) => {
      const li = document.createElement('li');
      if (bot) li.className = 'bot'; else if (name === me) li.className = 'me';
      const a = document.createElement('span'); a.textContent = name;
      const b = document.createElement('span'); b.textContent = String(len);
      li.append(a, b);
      return li;
    }));
  }

  // ---------- screens ----------
  function status(text) { $('status').textContent = text; }

  function showMenu() {
    state = 'menu';
    $('panel').hidden = false; $('dead').hidden = true; $('hud').hidden = true; $('boost').hidden = true;
  }

  function join() {
    const name = $('join-name').value.trim() || savedName() || '';
    if (name) Board.setName(name);
    if (!ws || ws.readyState !== WebSocket.OPEN) { state = 'joining'; status('Connecting…'); return; }
    state = 'joining';
    myLength = 0;
    unlockAudio();
    send({ t: 'join', name });
  }

  function onDead(m) {
    state = 'dead'; myId = null;
    sfx.scatter();
    $('dead-peak').textContent = `${m.peak} ducklings`;
    $('dead-why').textContent = m.killer ? `You swam into ${m.killer}'s ducklings.` : 'You swam into the reeds.';
    const line = $('dead-board');
    line.className = '';
    if (m.rank) {
      line.textContent = m.improved ? `#${m.rank} on the leaderboard` : `Your best stands at ${m.best}, #${m.rank} on the leaderboard`;
      if (m.improved) line.className = 'good';
    } else line.textContent = m.peak > 4 ? '' : 'Grow your flock to make the leaderboard.';
    $('hud').hidden = true; $('boost').hidden = true; $('dead').hidden = false;
    $('again').focus();
  }

  $('join').addEventListener('submit', e => { e.preventDefault(); join(); });
  $('again').addEventListener('click', join);
  $('join-name').value = savedName();

  const Board = createLeaderboard({ game: 'flock', modes: ['Biggest flock'], format: n => `${n} ducklings`, onClose: () => cv.focus() });
  Board.button.addEventListener('click', () => { if (state !== 'play') Board.open(0); });

  // ---------- audio ----------
  let ac = null, muted = false, bus = null, lastPlip = 0;
  function unlockAudio() {
    try {
      if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); bus = ac.createGain(); bus.gain.value = 1; bus.connect(ac.destination); }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) {}
  }
  function beep(f, d, type, v, delay = 0, f2 = null) {
    if (!ac || muted) return;
    try {
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
      g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(bus); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  const sfx = {
    grow(up) {
      const now = performance.now();
      if (!up || now - lastPlip < 60) return;
      lastPlip = now;
      beep(700 + Math.min(600, myLength * 4), 0.08, 'sine', 0.05, 0, 1100 + Math.min(600, myLength * 4));
    },
    scatter() { [523, 440, 349, 262].forEach((f, i) => beep(f, 0.18, 'triangle', 0.06, i * 0.08)); },
  };

  // ---------- input ----------
  let pointer = null, boosting = false, keyTurn = 0, target = 0, lastSent = { a: NaN, b: -1, at: 0 };
  const isTouch = () => document.body.classList.contains('touch');
  addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') document.body.classList.add('touch'); }, true);

  cv.addEventListener('pointermove', e => { pointer = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerdown', e => {
    unlockAudio();
    pointer = [e.clientX, e.clientY];
    if (e.pointerType === 'mouse' && state === 'play') boosting = true;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') boosting = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  const boostBtn = $('boost');
  boostBtn.addEventListener('pointerdown', e => { e.stopPropagation(); boosting = true; boostBtn.classList.add('on'); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) boostBtn.addEventListener(type, () => { boosting = false; boostBtn.classList.remove('on'); });

  addEventListener('keydown', e => {
    if (Board.isOpen() || e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyM') { muted = !muted; return; }
    if (e.code === 'KeyL' && state !== 'play') { Board.open(0); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'dead' && !e.repeat) join();
      else if (state === 'play') boosting = true;
    }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keyTurn = -1; pointer = null; }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { keyTurn = 1; pointer = null; }
  });
  addEventListener('keyup', e => {
    if (e.code === 'Space') boosting = false;
    if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && keyTurn < 0) keyTurn = 0;
    if ((e.code === 'ArrowRight' || e.code === 'KeyD') && keyTurn > 0) keyTurn = 0;
  });
  addEventListener('blur', () => { boosting = false; keyTurn = 0; });

  function sendInput(dt, me) {
    if (state !== 'play' || !me) return;
    if (pointer) target = Math.atan2(pointer[1] - H / 2, pointer[0] - W / 2);
    else if (keyTurn) target += keyTurn * 3 * dt;
    else if (Number.isNaN(lastSent.a)) target = me.a;
    const now = performance.now(), b = boosting ? 1 : 0;
    const changed = Math.abs(Math.atan2(Math.sin(target - lastSent.a), Math.cos(target - lastSent.a))) > 0.01 || b !== lastSent.b;
    if (changed && now - lastSent.at > 50) {
      send({ t: 'in', a: Math.round(target * 1000) / 1000, b });
      lastSent = { a: target, b, at: now };
    }
  }

  // ---------- interpolation and trails ----------
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

  // Every duck's state at the render time, interpolated between the snapshots either side.
  function sample() {
    const out = new Map();
    if (!snaps.length) return out;
    const t = performance.now() - DELAY;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i - 1].time > t) i--;
    const b = snaps[i], a = snaps[Math.max(0, i - 1)];
    const k = b === a ? 1 : Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
    for (const [id, s1] of b.ducks) {
      const s0 = a.ducks.get(id) || s1;
      out.set(id, { x: lerp(s0[0], s1[0], k), y: lerp(s0[1], s1[1], k), a: lerpAngle(s0[2], s1[2], k), len: s1[3], boost: s1[4], safe: s1[5] });
    }
    return out;
  }

  function updateTrail(id, d) {
    const spacing = cfg.spacing;
    let p = trails.get(id);
    if (!p) {
      p = [];
      for (let i = 0; i <= (d.len + 2) * 2; i++) p.push(d.x - Math.cos(d.a) * i * spacing / 2, d.y - Math.sin(d.a) * i * spacing / 2);
      trails.set(id, p);
    }
    if (Math.hypot(d.x - p[0], d.y - p[1]) > 2) p.unshift(d.x, d.y); else { p[0] = d.x; p[1] = d.y; }
    // Trim to the length of the flock.
    const keep = (d.len + 2) * spacing;
    let walked = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      walked += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      if (walked > keep) { p.length = i + 4; break; }
    }
    return p;
  }

  // Duckling positions and headings along a trail, one every `spacing`.
  function chicksAlong(p, len) {
    const spacing = cfg.spacing, out = [];
    let want = spacing, walked = 0;
    for (let i = 0; i + 3 < p.length && out.length < len; i += 2) {
      const seg = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      while (seg > 0 && walked + seg >= want && out.length < len) {
        const k = (want - walked) / seg;
        out.push([p[i] + (p[i + 2] - p[i]) * k, p[i + 1] + (p[i + 3] - p[i + 1]) * k, Math.atan2(p[i + 1] - p[i + 3], p[i] - p[i + 2])]);
        want += spacing;
      }
      walked += seg;
    }
    return out;
  }

  // ---------- drawing ----------
  const duckRadius = len => 10 + Math.min(8, len / 20);
  function hash(n, seed = 0) {
    let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function drawPond() {
    ctx.fillStyle = '#6FA86A';  // the grass beyond the shore
    ctx.fillRect(cam.x - W / cam.zoom, cam.y - H / cam.zoom, (W / cam.zoom) * 2, (H / cam.zoom) * 2);
    const R = cfg.radius;
    ctx.fillStyle = '#D9C58F';
    ctx.beginPath(); ctx.arc(0, 0, R + 40, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    g.addColorStop(0, '#2A8AA0'); g.addColorStop(1, '#1B6F85');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    // Ripples and lily pads on a fixed grid give a sense of motion.
    const cell = 180;
    const x0 = Math.floor((cam.x - W / 2 / cam.zoom) / cell) - 1, x1 = Math.ceil((cam.x + W / 2 / cam.zoom) / cell) + 1;
    const y0 = Math.floor((cam.y - H / 2 / cam.zoom) / cell) - 1, y1 = Math.ceil((cam.y + H / 2 / cam.zoom) / cell) + 1;
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const h = hash(i * 7919 + j, 3);
      const x = (i + hash(i, j)) * cell, y = (j + hash(j, i)) * cell;
      if (Math.hypot(x, y) > R - 40) continue;
      if (h < 0.06) {
        const turn = h * 60;
        ctx.fillStyle = '#4E9A5E';
        ctx.beginPath(); ctx.arc(x, y, 28, turn + 0.12, turn + TAU - 0.12); ctx.lineTo(x, y); ctx.fill();
        if (h < 0.02) { ctx.fillStyle = '#F4B6C8'; ctx.beginPath(); ctx.arc(x + 8, y - 6, 6, 0, TAU); ctx.fill(); ctx.fillStyle = '#FFE38A'; ctx.beginPath(); ctx.arc(x + 8, y - 6, 2.2, 0, TAU); ctx.fill(); }
      } else if (h < 0.4) {
        const phase = reduceMotion ? 0.5 : (clock * 0.4 + h * 7) % 1;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 * (1 - phase)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 8 + phase * 26, 0, TAU); ctx.stroke();
      }
    }
    // Reeds along the shore.
    ctx.strokeStyle = '#3F7A45'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let i = 0; i < 360; i++) {
      const a = i / 360 * TAU + hash(i, 1) * 0.01, r = R + 6 + hash(i, 2) * 20;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (Math.abs(x - cam.x) > W / cam.zoom || Math.abs(y - cam.y) > H / cam.zoom) continue;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); ctx.stroke();
    }
  }

  function drawCrumbs() {
    const left = cam.x - W / 2 / cam.zoom - 20, right = cam.x + W / 2 / cam.zoom + 20;
    const top = cam.y - H / 2 / cam.zoom - 20, bottom = cam.y + H / 2 / cam.zoom + 20;
    for (const [id, c] of crumbs) {
      if (c.x < left || c.x > right || c.y < top || c.y > bottom) continue;
      const pop = c.born < 0 ? 1 : Math.min(1, (clock - c.born) * 4);
      const bob = reduceMotion ? 0 : Math.sin(clock * 3 + id) * 1.2;
      if (c.v >= 1) drawChick(c.x, c.y + bob, hash(id) * TAU, 7 * pop, null);  // a loose duckling
      else {
        ctx.fillStyle = c.v >= 0.5 ? '#F2D39B' : '#E8C98A';
        ctx.beginPath(); ctx.ellipse(c.x, c.y + bob, (c.v >= 0.5 ? 8 : 6) * pop, (c.v >= 0.5 ? 6 : 4.5) * pop, id % 3, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(160, 110, 50, 0.45)';
        ctx.beginPath(); ctx.arc(c.x + 1.5 * pop, c.y + bob + 1 * pop, 1.6 * pop, 0, TAU); ctx.fill();
      }
    }
  }

  function drawChick(x, y, a, r, ring) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    if (ring) { ctx.fillStyle = ring; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15 + 2, r * 0.9 + 2, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#FFD23F';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.9, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.9, 0, r * 0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FF8A1F';
    ctx.beginPath(); ctx.moveTo(r * 1.4, -r * 0.2); ctx.lineTo(r * 1.9, 0); ctx.lineTo(r * 1.4, r * 0.2); ctx.fill();
    ctx.restore();
  }

  function drawDuck(id, d, trail) {
    const meta = names.get(id) || { name: '', color: 0, bot: true };
    const r = duckRadius(d.len);
    const chicks = chicksAlong(trail, d.len);
    ctx.globalAlpha = d.safe && !reduceMotion ? 0.5 + 0.3 * Math.sin(clock * 20) : 1;
    // Wake behind a boosting duck.
    if (d.boost) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(d.x - Math.cos(d.a) * 14, d.y - Math.sin(d.a) * 14);
        ctx.lineTo(d.x - Math.cos(d.a + s * 0.4) * 50, d.y - Math.sin(d.a + s * 0.4) * 50); ctx.stroke();
      }
    }
    for (let i = chicks.length - 1; i >= 0; i--) drawChick(chicks[i][0], chicks[i][1], chicks[i][2], r * 0.72, BODY[meta.color]);
    // The mother duck, seen from above.
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a);
    ctx.fillStyle = BODY[meta.color];
    ctx.beginPath(); ctx.ellipse(-2, 0, 20, 13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath(); ctx.ellipse(-6, -5, 12, 4, 0.2, 0, TAU); ctx.ellipse(-6, 5, 12, 4, -0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = HEAD[meta.color];
    ctx.beginPath(); ctx.arc(14, 0, 8.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FF8A1F';
    ctx.beginPath(); ctx.moveTo(20, -3.5); ctx.lineTo(29, 0); ctx.lineTo(20, 3.5); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    if (id !== myId && meta.name) {
      ctx.font = `700 ${Math.round(13 / cam.zoom)}px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(meta.name, d.x, d.y - 28);
    }
  }

  function drawBursts(dt) {
    for (const b of bursts) b.t += dt;
    while (bursts.length && bursts[0].t > 0.6) bursts.shift();
    for (const b of bursts) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * (1 - b.t / 0.6)})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(b.x, b.y, 20 + b.t * 140, 0, TAU); ctx.stroke();
    }
  }

  function drawMinimap(ducks) {
    const size = Math.min(120, Math.min(W, H) * 0.22), pad = 16;
    const cx = pad + size / 2, cy = H - pad - size / 2;
    ctx.fillStyle = 'rgba(8, 36, 47, 0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    const k = size / 2 / cfg.radius;
    for (const [id, d] of ducks) {
      ctx.fillStyle = id === myId ? '#FFD23F' : 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath(); ctx.arc(cx + d.x * k, cy + d.y * k, id === myId ? 3.5 : 2 + Math.min(3, d.len / 40), 0, TAU); ctx.fill();
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    if (!ws && now > reconnectAt) connect();

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#1B6F85'; ctx.fillRect(0, 0, W, H);
    if (cfg) {
      const ducks = sample();
      for (const id of trails.keys()) if (!ducks.has(id)) trails.delete(id);
      const me = myId !== null ? ducks.get(myId) : null;
      sendInput(dt, me);

      // Follow your own duck, or the biggest flock while watching.
      let focus = me;
      if (!focus) for (const d of ducks.values()) if (!focus || d.len > focus.len) focus = d;
      const base = Math.min(W, H) / 640;
      const want = focus ? { x: focus.x, y: focus.y, zoom: base * Math.max(0.55, 1 / (1 + (focus.len || 4) / 150)) } : { x: 0, y: 0, zoom: base * 0.5 };
      const k = me ? 1 : Math.min(1, dt * 1.5);
      cam = { x: lerp(cam.x, want.x, k), y: lerp(cam.y, want.y, k), zoom: lerp(cam.zoom, want.zoom, Math.min(1, dt * 3)) };

      ctx.setTransform(DPR * cam.zoom, 0, 0, DPR * cam.zoom, DPR * (W / 2 - cam.x * cam.zoom), DPR * (H / 2 - cam.y * cam.zoom));
      drawPond();
      drawCrumbs();
      const order = [...ducks.entries()].sort(([a], [b]) => (a === myId) - (b === myId));
      for (const [id, d] of order) drawDuck(id, d, updateTrail(id, d));
      drawBursts(dt);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (state === 'play') drawMinimap(ducks);
      if (state !== 'play') { ctx.fillStyle = 'rgba(8, 36, 47, 0.3)'; ctx.fillRect(0, 0, W, H); }
    }
    Board.button.hidden = state === 'play';
    document.querySelector('.home-link').hidden = state === 'play';
    requestAnimationFrame(frame);
  }
  connect();
  requestAnimationFrame(frame);
})();
