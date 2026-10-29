import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachRelay, isAllowedHost, sanitizeLogLine, createLogLimiter } from '../server/relayPlugin.js';

describe('isAllowedHost', () => {
  it('accepts IP literals, localhost and .local names, with or without a port', () => {
    for (const h of ['192.168.1.5', '192.168.1.5:5183', '127.0.0.1:80', 'localhost', 'LOCALHOST:5173', '[::1]:5173', '[fe80::1]', 'macbook.local', 'my-mac.local:5174', 'a.b.local']) {
      expect(isAllowedHost(h), h).toBe(true);
    }
  });

  it('rejects any other name, and anything malformed', () => {
    for (const h of ['evil.example', 'evil.example:5183', 'localhost.evil.com', '192.168.1.5.evil.com', 'evil.com:80.local.evil', '999.1.1.1', '1.2.3', 'x.local.evil.com', '.local', '[evil]', '[::1', '', '  ', 'a:b:c', undefined, null, 42]) {
      expect(isAllowedHost(h), String(h)).toBe(false);
    }
  });
});

describe('sanitizeLogLine', () => {
  it('replaces control characters, keeps everything else', () => {
    expect(sanitizeLogLine('a\nb\r\nc\x1b[31md\x00e\x7ff\tg')).toBe('a b  c [31md e f g');
    expect(sanitizeLogLine('plain text ✓')).toBe('plain text ✓');
  });
});

describe('createLogLimiter', () => {
  it('allows max lines per window per key, reports the dropped count once the window ends', () => {
    let t = 0;
    const limiter = createLogLimiter({ max: 2, windowMs: 100, now: () => t });
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
    expect(limiter.check('a').ok).toBe(false);
    expect(limiter.check('b').ok).toBe(true); // another IP is unaffected
    t = 150;
    expect(limiter.check('a')).toEqual({ ok: true, suppressed: 2 });
    expect(limiter.check('a')).toEqual({ ok: true, suppressed: 0 });
  });
});

// Two plain HTTP servers stand in for Vite's HTTPS server (phone) and the plain-HTTP TV server. TLS adds
// nothing to what is under test here; scripts/smoke-relay.mjs covers the real wss:// phone against a live server.
describe('relay', () => {
  let main, relay, logs, mainPort, tvPort, sockets;

  const track = (ws) => {
    ws.on('error', () => {}); // teardown terminates sockets that may still be mid-handshake
    sockets.push(ws);
    return ws;
  };
  const connect = async (port) => {
    const ws = track(new WebSocket(`ws://127.0.0.1:${port}/ws`));
    await once(ws, 'open');
    return ws;
  };
  const nextMsg = async (ws) => JSON.parse((await once(ws, 'message'))[0].toString());
  const http = (port, { method = 'GET', path = '/', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.end(body);
    });

  async function start(options = {}, { waitForTv = true } = {}) {
    logs = [];
    const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m) };
    // The smallest thing attachRelay needs from `middlewares`: a handler with a path-prefix .use().
    const stack = [];
    const middlewares = (req, res) => {
      const layer = stack.find(([prefix]) => req.url === prefix || req.url.startsWith(`${prefix}?`));
      if (layer) layer[1](req, res);
      else { res.statusCode = 404; res.end(); }
    };
    middlewares.use = (prefix, fn) => stack.push([prefix, fn]);
    main = createServer();
    main.listen(0);
    await once(main, 'listening');
    mainPort = main.address().port;
    relay = attachRelay({ middlewares, httpServer: main, config: { logger } }, mainPort, { tvPort: 0, ...options });
    if (!waitForTv) return;
    await once(relay.tvServer, 'listening');
    tvPort = relay.tvServer.address().port;
    expect(logs).toEqual([expect.stringContaining('TV page')]);
    logs.length = 0;
  }

  beforeEach(() => { sockets = []; });
  afterEach(async () => {
    sockets.forEach((ws) => ws.terminate());
    main.closeAllConnections();
    await new Promise((r) => main.close(r)); // also fires the cleanup that closes the TV server and heartbeat
    relay.tvServer.closeAllConnections();
  });

  it('pairs a TV on the TV port with a phone on the main port, and relays tilt', async () => {
    await start();
    const tv = await connect(tvPort);
    tv.send(JSON.stringify({ t: 'join', role: 'tv' }));
    const { room } = await nextMsg(tv);
    expect(room).toMatch(/^[A-Z]{4}$/);

    const phone = await connect(mainPort);
    const paired = nextMsg(tv);
    phone.send(JSON.stringify({ t: 'join', role: 'phone', room }));
    expect(await paired).toEqual({ t: 'paired', player: 1 });
    expect(await nextMsg(phone)).toEqual({ t: 'paired', player: 1 });

    const tilt = nextMsg(tv);
    phone.send(JSON.stringify({ t: 'tilt', v: 0.5, p: 2 })); // the server overwrites a claimed p
    expect(await tilt).toEqual({ t: 'tilt', v: 0.5, p: 1 });
  });

  it('pairs two phones, stamps p, routes `to`, and refuses a third phone', async () => {
    await start();
    // Queue every message a socket gets, so none is missed between two awaits.
    const inbox = (ws) => {
      const queue = [];
      const waiting = [];
      ws.on('message', (d) => (waiting.length ? waiting.shift()(JSON.parse(d.toString())) : queue.push(JSON.parse(d.toString()))));
      return () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r)));
    };
    const tv = await connect(tvPort);
    const tvNext = inbox(tv);
    tv.send(JSON.stringify({ t: 'join', role: 'tv' }));
    const { room } = await tvNext();
    const join = async () => {
      const ws = await connect(mainPort);
      const next = inbox(ws);
      ws.send(JSON.stringify({ t: 'join', role: 'phone', room }));
      return [ws, next];
    };
    const [p1, next1] = await join();
    const [p2, next2] = await join();
    expect(await next1()).toEqual({ t: 'paired', player: 1 });
    expect(await next2()).toEqual({ t: 'paired', player: 2 });
    expect(await tvNext()).toEqual({ t: 'paired', player: 1 });
    expect(await tvNext()).toEqual({ t: 'paired', player: 2 });

    p2.send(JSON.stringify({ t: 'gust', dir: 1, p: 1 }));
    expect(await tvNext()).toEqual({ t: 'gust', dir: 1, p: 2 });

    tv.send(JSON.stringify({ t: 'state', phase: 'lobby', to: 2, you: 2 }));
    tv.send(JSON.stringify({ t: 'state', phase: 'playing' }));
    expect(await next2()).toEqual({ t: 'state', phase: 'lobby', you: 2 }); // the targeted one
    expect(await next1()).toEqual({ t: 'state', phase: 'playing' }); // player 1 never saw the targeted one
    expect(await next2()).toEqual({ t: 'state', phase: 'playing' });

    const [, next3] = await join();
    expect(await next3()).toEqual({ t: 'error', reason: 'room-full' });
    void p1;
  });

  it('answers no-room to a phone with a malformed room code', async () => {
    await start();
    const phone = await connect(mainPort);
    phone.send(JSON.stringify({ t: 'join', role: 'phone', room: 'nope' }));
    expect(await nextMsg(phone)).toEqual({ t: 'error', reason: 'no-room' });
  });

  it('403s a rebinding Host on the TV port (HTTP) and on /ws upgrades of both servers', async () => {
    await start();
    const evil = { Host: 'evil.example' };
    expect((await http(tvPort, { path: '/api/info', headers: evil })).status).toBe(403);
    expect((await http(tvPort, { path: '/api/info', headers: { Host: `192.168.1.9:${tvPort}` } })).status).toBe(200);
    for (const port of [tvPort, mainPort]) {
      const ws = track(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: evil }));
      const [, res] = await once(ws, 'unexpected-response');
      expect(res.statusCode).toBe(403);
    }
  });

  it('destroys a non-/ws upgrade on the TV port instead of leaving it hanging', async () => {
    await start();
    const ws = track(new WebSocket(`ws://127.0.0.1:${tvPort}/elsewhere`));
    const [err] = await once(ws, 'error');
    expect(err).toBeInstanceOf(Error);
  });

  it('sends CORS only to the null origin of a file:// page', async () => {
    await start();
    const withOrigin = (o) => http(tvPort, { path: '/api/info', headers: o === undefined ? {} : { Origin: o } });
    expect((await withOrigin('null')).headers['access-control-allow-origin']).toBe('null');
    expect((await withOrigin('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    expect((await withOrigin(undefined)).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('/api/log accepts only POST and logs a sanitised line', async () => {
    await start();
    const get = await http(tvPort, { path: '/api/log' });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect(logs).toEqual([]);

    expect((await http(tvPort, { method: 'POST', path: '/api/log', body: 'boom\n[vite] forged\x1b[0m' })).status).toBe(200);
    expect(logs).toEqual(['[tv] boom [vite] forged [0m']);
  });

  it('/api/log cuts off a body over 2000 bytes by destroying the request', async () => {
    await start();
    await expect(http(tvPort, { method: 'POST', path: '/api/log', body: 'x'.repeat(50_000) })).rejects.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe(`[tv] ${'x'.repeat(2000)} [truncated]`);
  });

  it('/api/log rate-limits one IP to 20 lines per window', async () => {
    await start();
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await http(tvPort, { method: 'POST', path: '/api/log', body: `line ${i}` })).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(logs).toHaveLength(20);
  });

  it('retries the TV port when the previous dev server still holds it (EADDRINUSE)', async () => {
    const squatter = createServer();
    squatter.listen(0);
    await once(squatter, 'listening');
    const taken = squatter.address().port;
    await start({ tvPort: taken }, { waitForTv: false });
    expect(relay.tvServer.listening).toBe(false);
    const listening = new Promise((resolve) => relay.tvServer.once('listening', resolve)); // not events.once: it rejects on 'error'
    squatter.close(); // Vite closes the old server shortly after starting the new one
    await listening;
    expect(relay.tvServer.address().port).toBe(taken);
    expect(logs.some((m) => m.includes('EADDRINUSE'))).toBe(false);
  });

  it('heartbeat terminates a socket that never pongs, and the peer hears peer-left', async () => {
    await start({ heartbeatMs: 30 });
    const tv = await connect(tvPort);
    tv.send(JSON.stringify({ t: 'join', role: 'tv' }));
    const { room } = await nextMsg(tv);
    const phone = await connect(mainPort);
    phone.send(JSON.stringify({ t: 'join', role: 'phone', room }));
    await nextMsg(phone);

    phone.pong = () => {}; // a dead phone: the 'ping' arrives but the automatic pong never goes back
    const closed = once(phone, 'close');
    let tvMsg;
    do tvMsg = await nextMsg(tv); while (tvMsg.t !== 'peer-left');
    await closed;
    // the TV, which does pong, is still connected
    expect(tv.readyState).toBe(WebSocket.OPEN);
  });
});
