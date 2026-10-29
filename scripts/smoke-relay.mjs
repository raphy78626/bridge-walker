// Pairs a fake TV and phone through a running server, the way the real ones connect, and checks a tilt arrives.
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
const next = (ws, what) =>
  withTimeout(new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString())))), what);

try {
  const tv = await open(tvUrl, 'TV');
  tv.send(JSON.stringify({ t: 'join', role: 'tv' }));
  const { room } = await next(tv, 'TV room code');

  const phone = await open(phoneUrl, 'phone');
  const tvPaired = next(tv, 'TV pairing notice');
  phone.send(JSON.stringify({ t: 'join', role: 'phone', room }));
  await tvPaired;

  const received = next(tv, 'tilt message on TV');
  phone.send(JSON.stringify({ t: 'tilt', v: 0.5 }));
  const msg = await received;
  assert.deepEqual(msg, { t: 'tilt', v: 0.5 });
  console.log('room', room, 'tv received', msg);
  tv.close();
  phone.close();
} catch (err) {
  console.error('smoke test failed:', err.message);
  process.exit(1);
}
