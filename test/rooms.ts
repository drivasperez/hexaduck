// Opens WebSockets to multiplayer rooms from tests and waits for particular messages.
import { SELF } from 'cloudflare:test';
import { afterEach, expect } from 'vitest';

export type Msg = Record<string, any>;
const BASE = 'https://arcade.test';
const open: WebSocket[] = [];

afterEach(() => {
  for (const ws of open.splice(0)) try { ws.close(); } catch {}
});

let roomCounter = 0;
export const freshRoom = () => `test-${Date.now().toString(36)}-${roomCounter++}`;

export async function connect(path: string, room: string) {
  const res = await SELF.fetch(`${BASE}${path}?room=${room}`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  open.push(ws);
  const inbox: Msg[] = [];
  let closed: { code: number } | null = null;
  const listeners = new Set<() => void>();
  ws.addEventListener('message', e => { inbox.push(JSON.parse(e.data as string)); listeners.forEach(l => l()); });
  ws.addEventListener('close', e => { closed = { code: e.code }; listeners.forEach(l => l()); });
  // Resolves with the first message (already received or yet to come) that matches.
  function next(match: (m: Msg) => boolean, timeout = 3000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      let seen = 0;
      const check = () => {
        for (; seen < inbox.length; seen++) if (match(inbox[seen])) { listeners.delete(check); clearTimeout(timer); resolve(inbox[seen]); return; }
      };
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('timed out waiting for a message')); }, timeout);
      listeners.add(check);
      check();
    });
  }
  const send = (m: Msg) => ws.send(JSON.stringify(m));
  return { ws, inbox, next, send, closed: () => closed };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
