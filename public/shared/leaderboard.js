// Leaderboard client shared by every game: talks to /api, builds and owns the leaderboard
// dialog and its button, and exposes a status object games draw on their game-over screen.
//
//   const board = createLeaderboard({ game: 'runoff', modes: ['Endless'], format: m => `${m} m` });
//   board.startRun(mode); ...; board.finishRun(mode, score);

const NAME_KEY = 'arcade-name';
const LEGACY_NAME_KEY = 'hexaduck-name';
// Mirrors the server's rule in src/leaderboard.ts.
const NAME_RE = /^[\p{L}\p{N} _.'-]{1,16}$/u;

export function savedName() { return loadName(); }

function loadName() {
  try { return localStorage.getItem(NAME_KEY) || localStorage.getItem(LEGACY_NAME_KEY) || ''; } catch (e) { return ''; }
}
function saveName(n) {
  try {
    localStorage.removeItem(LEGACY_NAME_KEY);
    n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY);
  } catch (e) {}
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

// `modes` names each mode, `format` renders a score for display, and `onClose` runs whenever
// the dialog closes so the game can take focus back.
export function createLeaderboard({ game, modes, format, onClose = () => {} }) {
  const button = el('button', { id: 'board-btn', type: 'button', text: 'Leaderboard' });
  const close_ = el('button', { class: 'board-close', type: 'button', 'aria-label': 'Close leaderboard', text: '×' });
  const tabs = modes.map((m, i) => el('button', { type: 'button', role: 'tab', 'data-mode': String(i), text: m }));
  const list = el('ol', { id: 'board-list' });
  const note = el('p', { id: 'board-note' });
  const formLabel = el('label', { for: 'board-input' });
  const input = el('input', {
    id: 'board-input', name: 'name', maxlength: '16', autocomplete: 'nickname', spellcheck: 'false',
    enterkeyhint: 'send', placeholder: 'Your name',
  });
  const formError = el('p', { id: 'board-error', role: 'alert' });
  const form = el('form', { id: 'board-form' },
    formLabel, el('div', { class: 'board-row' }, input, el('button', { type: 'submit', text: 'Post' })), formError);
  const whoName = el('span');
  const change = el('button', { type: 'button', text: 'Change' });
  const who = el('p', { id: 'board-who' }, 'Posting runs as ', whoName, '. ', change);
  const dialog = el('div', { id: 'board', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'board-title' },
    el('div', { class: 'board-panel' },
      el('header', {}, el('h2', { id: 'board-title', text: 'Leaderboard' }), close_),
      modes.length > 1 ? el('div', { class: 'board-tabs', role: 'tablist' }, ...tabs) : '',
      list, note, form, who));
  dialog.hidden = true;
  document.body.append(button, dialog);

  let name = loadName();
  let viewMode = 0;
  let run = null;      // { mode, id: Promise<string|null> } for the game in progress
  let pending = null;  // { mode, score, id } a finished run that is waiting for a name
  let lastResult = null;
  const board = { status: null, button };  // status: what the game-over screen should say

  function startRun(mode) {
    pending = null; board.status = null;
    const id = api('/api/runs', { game, mode }).then(r => r.runId, () => null);
    run = { mode, id };
  }

  function finishRun(mode, score) {
    if (!run || run.mode !== mode) return;
    const finished = { mode, score, id: run.id };
    run = null;
    if (!(score > 0)) return;
    if (name) post(finished, name);
    else { pending = finished; board.status = { kind: 'needName' }; }
  }

  async function post(finished, as) {
    board.status = { kind: 'posting' };
    const id = await finished.id;
    if (!id) { board.status = { kind: 'offline' }; return; }
    try {
      const r = await api('/api/scores', { runId: id, name: as, score: finished.score });
      lastResult = r;
      board.status = { kind: 'posted', ...r, modeName: modes[r.mode] };
      if (isOpen() && viewMode === r.mode) refresh();
    } catch (e) {
      board.status = { kind: e.status === 422 || e.status === 409 ? 'rejected' : 'offline' };
      // A 400 means the name was refused before the run was redeemed, so it can be retried.
      if (e.status === 400) { pending = finished; board.status = { kind: 'needName' }; forgetName(e.message); }
    }
  }

  const isOpen = () => !dialog.hidden;

  function open(mode = 0) {
    dialog.hidden = false;
    show(mode);
    (form.hidden ? close_ : input).focus();
  }

  function close() {
    if (!isOpen()) return;
    dialog.hidden = true;
    onClose();
  }

  function show(mode) {
    viewMode = mode;
    tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === mode)));
    renderForm();
    refresh();
  }

  function renderForm() {
    form.hidden = !!name;
    who.hidden = !name;
    whoName.textContent = name;
    const where = modes.length > 1 ? ` on ${modes[pending?.mode]}` : '';
    formLabel.textContent = pending ? `Post your ${format(pending.score)}${where} as` : 'Pick a name to post your runs as';
  }

  async function refresh() {
    const mode = viewMode;
    list.replaceChildren();
    note.textContent = 'Loading…';
    try {
      const { scores } = await api(`/api/scores?game=${game}&mode=${mode}`);
      if (mode === viewMode) renderList(scores);
    } catch (e) {
      if (mode === viewMode) note.textContent = 'The leaderboard is unavailable right now.';
    }
  }

  function renderList(scores) {
    const me = name.toLowerCase();
    let rank = 0, prev = null, mine = false;
    scores.forEach((s, i) => {
      if (s.score !== prev) rank = i + 1;
      prev = s.score;
      const isMe = !!me && s.name.toLowerCase() === me;
      mine ||= isMe;
      list.append(el('li', isMe ? { class: 'me' } : {},
        el('span', { text: String(rank) }), el('span', { text: s.name }), el('span', { text: format(s.score) })));
    });
    if (!scores.length) note.textContent = modes.length > 1 ? `No one has posted a ${modes[viewMode]} run yet.` : 'No one has posted a run yet.';
    else if (!mine && lastResult && lastResult.mode === viewMode && lastResult.name.toLowerCase() === me)
      note.textContent = `You are #${lastResult.rank} with ${format(lastResult.best)}.`;
    else note.textContent = '';
  }

  function forgetName(why = '') {
    input.value = name; name = ''; saveName('');
    formError.textContent = why;
    if (isOpen()) { renderForm(); refresh(); input.focus(); }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const n = input.value.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(n)) { formError.textContent = "Use up to 16 letters, digits, spaces or _.'-"; input.focus(); return; }
    formError.textContent = '';
    name = n; saveName(n);
    if (pending) { const p = pending; pending = null; post(p, n); }
    renderForm();
    refresh();
    close_.focus();
  });
  change.addEventListener('click', () => forgetName());
  tabs.forEach((t, i) => t.addEventListener('click', () => show(i)));
  close_.addEventListener('click', close);
  dialog.addEventListener('pointerdown', e => { if (e.target === dialog) close(); });
  // Keep the game's key and pointer handlers out of the dialog.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup']) dialog.addEventListener(type, e => {
    e.stopPropagation();
    if (type === 'keydown' && e.key === 'Escape') { e.preventDefault(); close(); }
  });
  for (const type of ['pointerdown', 'pointerup']) button.addEventListener(type, e => e.stopPropagation());

  // For games that pick the player's name themselves (Flock asks for it before joining).
  function setName(n) { name = n; saveName(n); }

  return Object.assign(board, { startRun, finishRun, open, close, isOpen, setName });
}
