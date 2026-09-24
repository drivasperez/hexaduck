// Leaderboard client: talks to /api, owns the leaderboard dialog, and exposes a small
// status object the game draws on its death screen.

const MODE_NAMES = ['Scope 1', 'Scope 2', 'Scope 3'];
const NAME_KEY = 'hexaduck-name';
// Mirrors the server's rule in src/index.ts.
const NAME_RE = /^[\p{L}\p{N} _.'-]{1,16}$/u;

const $ = id => document.getElementById(id);
const dialog = $('board');
const list = $('board-list');
const note = $('board-note');
const form = $('board-form');
const input = $('board-input');
const formLabel = $('board-form-label');
const formError = $('board-error');
const who = $('board-who');
const tabs = [...dialog.querySelectorAll('[data-mode]')];

let viewMode = 0;
let run = null;      // { mode, id: Promise<string|null> } for the game in progress
let pending = null;  // { mode, time, id } a finished run that is waiting for a name
let lastResult = null;
let onClose = () => {};

// What the death screen should say: null, or { kind, ... }.
export let status = null;

function loadName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
function saveName(n) { try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch (e) {} }
let name = loadName();

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

export function startRun(mode) {
  pending = null; status = null;
  const id = api('/api/runs', { mode }).then(r => r.runId, () => null);
  run = { mode, id };
}

export function finishRun(mode, time) {
  if (!run || run.mode !== mode) return;
  const finished = { mode, time, id: run.id };
  run = null;
  if (name) post(finished, name);
  else { pending = finished; status = { kind: 'needName' }; }
}

async function post(finished, as) {
  status = { kind: 'posting' };
  const id = await finished.id;
  if (!id) { status = { kind: 'offline' }; return; }
  try {
    const r = await api('/api/scores', { runId: id, name: as, time: finished.time });
    lastResult = r;
    status = { kind: 'posted', ...r, scope: MODE_NAMES[r.mode] };
    if (isOpen() && viewMode === r.mode) refresh();
  } catch (e) {
    status = { kind: e.status === 422 || e.status === 409 ? 'rejected' : 'offline' };
    // A 400 means the name was refused before the run was redeemed, so it can be retried.
    if (e.status === 400) { pending = finished; status = { kind: 'needName' }; forgetName(e.message); }
  }
}

// ---------- dialog ----------
export const isOpen = () => !dialog.hidden;

export function open(mode, closed = () => {}) {
  onClose = closed;
  dialog.hidden = false;
  show(mode);
  (form.hidden ? dialog.querySelector('.board-close') : input).focus();
}

export function close() {
  if (!isOpen()) return;
  dialog.hidden = true;
  onClose();
}

function show(mode) {
  viewMode = mode;
  tabs.forEach(t => t.setAttribute('aria-selected', String(Number(t.dataset.mode) === mode)));
  renderForm();
  refresh();
}

function renderForm() {
  form.hidden = !!name;
  who.hidden = !name;
  if (name) who.querySelector('span').textContent = name;
  formLabel.textContent = pending
    ? `Post your ${pending.time.toFixed(2)} s on ${MODE_NAMES[pending.mode]} as`
    : 'Pick a name to post your runs as';
}

async function refresh() {
  const mode = viewMode;
  list.replaceChildren();
  note.textContent = 'Loading…';
  try {
    const { scores } = await api(`/api/scores?mode=${mode}`);
    if (mode !== viewMode) return;
    renderList(scores);
  } catch (e) {
    if (mode === viewMode) note.textContent = 'The leaderboard is unavailable right now.';
  }
}

function renderList(scores) {
  const me = name.toLowerCase();
  let rank = 0, prev = null, mine = false;
  scores.forEach((s, i) => {
    if (s.time !== prev) rank = i + 1;
    prev = s.time;
    const li = document.createElement('li');
    const isMe = !!me && s.name.toLowerCase() === me;
    mine ||= isMe;
    if (isMe) li.className = 'me';
    const cells = [String(rank), s.name, `${s.time.toFixed(2)} s`];
    for (const c of cells) { const span = document.createElement('span'); span.textContent = c; li.append(span); }
    list.append(li);
  });
  if (!scores.length) note.textContent = `No one has posted a ${MODE_NAMES[viewMode]} time yet.`;
  else if (!mine && lastResult && lastResult.mode === viewMode && lastResult.name.toLowerCase() === me)
    note.textContent = `You are #${lastResult.rank} with ${lastResult.best.toFixed(2)} s.`;
  else note.textContent = '';
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
  dialog.querySelector('.board-close').focus();
});

function forgetName(why = '') {
  input.value = name; name = ''; saveName('');
  formError.textContent = why;
  if (isOpen()) { renderForm(); refresh(); input.focus(); }
}
who.querySelector('button').addEventListener('click', () => forgetName());

tabs.forEach(t => t.addEventListener('click', () => show(Number(t.dataset.mode))));
dialog.querySelector('.board-close').addEventListener('click', close);
dialog.addEventListener('pointerdown', e => { if (e.target === dialog) close(); });
dialog.addEventListener('keydown', e => {
  e.stopPropagation();  // keep the game's key handler out of the form
  if (e.key === 'Escape') { e.preventDefault(); close(); }
});
dialog.addEventListener('keyup', e => e.stopPropagation());
