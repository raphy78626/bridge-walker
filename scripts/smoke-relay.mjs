// Pairs a fake TV and two phones through a running server, the way the real ones connect, and checks: a tilt arrives
// stamped with the phone's player number (a spoofed p is overwritten), a state with `to` reaches only that phone, a
// broadcast state reaches both, a third phone gets room-full, a leaving phone frees its slot, and a phone that reconnects
// with its id while its old socket still holds the slot takes that slot over (same player, the old socket closed, no peer-left).
// Usage: node scripts/smoke-relay.mjs [httpsPort]   (5173 for `npm run dev`, 5174 for `npm run tv`; default 5174)
// The TV connects over plain HTTP on httpsPort + 10, the phone over HTTPS on httpsPort.
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 5174);
const tvUrl = `ws://127.0.0.1:${port + 10}/ws`;
const phoneUrl = `wss://127.0.0.1:${port}/ws`;
const TIMEOUT_MS = 3000;

const withTimeout = (promise, what) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const open = (u, what) =>
  withTimeout(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(u, { rejectUnauthorized: false }); // dev cert is self-signed
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    }),
    `${what} to connect`,
  );
// Every message a socket receives is queued, so none is lost between two awaits.
function inbox(ws) {
  const queue = [];
  const waiting = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    if (waiting.length) waiting.shift()(msg);
    else queue.push(msg);
  });
  return {
    next: (what) => withTimeout(queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)), what),
    // Nothing more arrived: asserted after a round trip that would have delivered it.
    empty: () => queue.length === 0,
  };
}

try {
  const tv = await open(tvUrl, 'TV');
  const tvIn = inbox(tv);
  tv.send(JSON.stringify({ t: 'join', role: 'tv' }));
  const { room } = await tvIn.next('TV room code');

  const join = async (what, id) => {
    const ws = await open(phoneUrl, what);
    const box = inbox(ws);
    ws.send(JSON.stringify({ t: 'join', role: 'phone', room, ...(id ? { id } : {}) }));
    return { ws, box, hello: await box.next(`${what} pairing reply`) };
  };

  const p1 = await join('phone 1', 'smoke-phone-one');
  assert.deepEqual(p1.hello, { t: 'paired', player: 1 });
  assert.deepEqual(await tvIn.next('TV pairing notice for player 1'), { t: 'paired', player: 1 });
  const p2 = await join('phone 2', 'smoke-phone-two');
  assert.deepEqual(p2.hello, { t: 'paired', player: 2 });
  assert.deepEqual(await tvIn.next('TV pairing notice for player 2'), { t: 'paired', player: 2 });
  console.log('room', room, 'phone 1 and 2 paired');

  // The server stamps p, whatever the client claims.
  p1.ws.send(JSON.stringify({ t: 'tilt', v: 0.5 }));
  assert.deepEqual(await tvIn.next('tilt from phone 1'), { t: 'tilt', v: 0.5, p: 1 });
  p2.ws.send(JSON.stringify({ t: 'gust', dir: -1, p: 1 }));
  assert.deepEqual(await tvIn.next('gust from phone 2'), { t: 'gust', dir: -1, p: 2 });
  p2.ws.send(JSON.stringify({ t: 'mode', mode: 'race' }));
  assert.deepEqual(await tvIn.next('mode from phone 2'), { t: 'mode', mode: 'race', p: 2 });
  console.log('p stamping ok (a spoofed p was overwritten)');

  // Targeted and broadcast state.
  tv.send(JSON.stringify({ t: 'state', phase: 'lobby', you: 2, to: 2 }));
  tv.send(JSON.stringify({ t: 'state', phase: 'playing' }));
  assert.deepEqual(await p2.box.next('targeted state on phone 2'), { t: 'state', phase: 'lobby', you: 2 });
  assert.deepEqual(await p1.box.next('broadcast state on phone 1'), { t: 'state', phase: 'playing' }, 'phone 1 must not see the state sent to phone 2');
  assert.deepEqual(await p2.box.next('broadcast state on phone 2'), { t: 'state', phase: 'playing' });
  assert.ok(p1.box.empty() && p2.box.empty());
  console.log('targeted state reached only phone 2; broadcast reached both');

  // A third phone is turned away, the first two are undisturbed.
  const p3 = await join('phone 3');
  assert.deepEqual(p3.hello, { t: 'error', reason: 'room-full' });
  p1.ws.send(JSON.stringify({ t: 'tilt', v: -1 }));
  assert.deepEqual(await tvIn.next('tilt after the refused third phone'), { t: 'tilt', v: -1, p: 1 });
  console.log('third phone got', p3.hello);

  // A leaving phone is reported with its number, and its slot is taken by the next one.
  p1.ws.close();
  assert.deepEqual(await tvIn.next('peer-left for player 1'), { t: 'peer-left', player: 1 });
  const p4 = await join('phone 4');
  assert.deepEqual(p4.hello, { t: 'paired', player: 1 });
  assert.deepEqual(await tvIn.next('TV pairing notice for the new player 1'), { t: 'paired', player: 1 });
  console.log('slot 1 freed and reused');

  // A reconnect: phone 2's link "dies" but its socket stays open on the server. It comes back with its id and must get player 2
  // again (not room-full, not another number), with its old socket closed and the TV told only a repeat pairing.
  const oldClosed = new Promise((resolve) => p2.ws.once('close', resolve));
  const p2b = await join('phone 2 again', 'smoke-phone-two');
  assert.deepEqual(p2b.hello, { t: 'paired', player: 2 });
  assert.deepEqual(await tvIn.next('TV repeat pairing for player 2'), { t: 'paired', player: 2 });
  await withTimeout(oldClosed, 'the old phone 2 socket to be closed');
  p2b.ws.send(JSON.stringify({ t: 'tilt', v: 0.25 }));
  assert.deepEqual(await tvIn.next('tilt from the reconnected phone 2'), { t: 'tilt', v: 0.25, p: 2 }, 'no peer-left may come first');
  p4.ws.send(JSON.stringify({ t: 'tilt', v: 0.5 }));
  assert.deepEqual(await tvIn.next('tilt from player 1 after the reconnect'), { t: 'tilt', v: 0.5, p: 1 });
  console.log('reconnect with an id took player 2 back; old socket closed; no peer-left');

  // An invalid id is dropped (the join goes ahead as an anonymous phone): the room is full, so it is turned away.
  const bad = await join('phone with a bad id', 'not valid!');
  assert.deepEqual(bad.hello, { t: 'error', reason: 'room-full' });
  console.log('a malformed id is ignored:', bad.hello);

  for (const ws of [tv, p2b.ws, p3.ws, p4.ws, bad.ws]) ws.close();
  console.log('smoke ok');
} catch (err) {
  console.error('smoke test failed:', err.message);
  process.exit(1);
}
