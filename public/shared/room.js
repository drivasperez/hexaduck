// Client pieces shared by the multiplayer games (Flock and Confluence): a WebSocket to a room
// that moves on to the next room when one is full and reconnects when the connection drops, and
// the room's live list of its biggest players. See src/rooms.ts for the server side.

// `path` is the game's API route and `prefix` its room names (`pond` gives pond-1, pond-2, ...).
// `?room=name` in the page's URL picks a room outright, which the e2e tests use.
export function createRoomConnection({ path, prefix, rooms = 5, onMessage, onStatus, onLost }) {
  const fixed = new URLSearchParams(location.search).get('room');
  let ws = null, room = 1, retryAt = 0;

  function connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}?room=${fixed || `${prefix}-${room}`}`;
    const sock = new WebSocket(url);
    ws = sock;
    sock.addEventListener('message', e => {
      if (ws !== sock) return;
      const m = JSON.parse(e.data);
      if (m.t !== 'full') { onMessage(m); return; }
      // Try the next room along, unless a room was asked for.
      if (!fixed && room < rooms) { room++; connect(); }
      else { onStatus('Every room is full right now. Trying again shortly…'); room = 1; }
    });
    sock.addEventListener('close', () => {
      if (ws !== sock) return;
      ws = null;
      onLost();
      onStatus('Lost the connection. Reconnecting…');
      retryAt = performance.now() + 1500;
    });
  }

  connect();
  return {
    get open() { return !!ws && ws.readyState === WebSocket.OPEN; },
    send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    // Call every frame; reconnects once it's time to.
    poll(now) { if (!ws && now > retryAt) connect(); },
  };
}

// Fills the room's list of its biggest players from a 'top' message ({ l: [[name, score, bot]], humans }).
// `verb` describes what people are doing ("swimming").
export function renderTop(list, count, top, meName, { verb = 'playing', format = String } = {}) {
  count.textContent = top.humans === 1 ? `1 person ${verb}` : `${top.humans} people ${verb}`;
  list.replaceChildren(...top.l.map(([name, score, bot]) => {
    const li = document.createElement('li');
    if (bot) li.className = 'bot'; else if (name === meName) li.className = 'me';
    const a = document.createElement('span'); a.textContent = name;
    const b = document.createElement('span'); b.textContent = format(score);
    li.append(a, b);
    return li;
  }));
}
