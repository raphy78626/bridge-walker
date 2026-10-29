import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { WebSocketServer } from 'ws';
import { decode, MAX_MESSAGE_BYTES } from '../src/shared/protocol.js';
import { createRooms } from './rooms.js';
import { lanIp } from './lanIp.js';

const TV_PORT_OFFSET = 10;
const HEARTBEAT_MS = 5000;
const LOG_MAX_BYTES = 2000;
const LOG_MAX_LINES = 20; // per IP, per window
const LOG_WINDOW_MS = 10_000;
const LISTEN_RETRIES = 8; // x 250 ms: Vite starts its new server before closing the old one on a dev restart
const LISTEN_RETRY_MS = 250;

export function relayPlugin() {
  return {
    name: 'bridge-relay',
    // Braces matter: a returned value would be taken by Vite as a post-middleware hook.
    configureServer: (server) => {
      attachRelay(server, server.config.server.port);
    },
    // `vite preview` serves the production build, which loads far faster on a TV browser.
    configurePreviewServer: (server) => {
      attachRelay(server, server.config.preview.port);
    },
  };
}

// Only IP literals, localhost and mDNS (*.local) names are served. A DNS-rebinding page reaches us under
// its own domain name, so refusing every other Host closes that hole. Vite skips its own check over https.
export function isAllowedHost(hostHeader) {
  if (typeof hostHeader !== 'string') return false;
  const m = /^(\[[^\]]*\]|[^:]*)(?::\d{1,5})?$/.exec(hostHeader.trim().toLowerCase());
  if (!m) return false;
  const host = m[1];
  if (host.startsWith('[')) return isIP(host.slice(1, -1)) === 6;
  return isIP(host) === 4 || host === 'localhost' || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.local$/.test(host);
}

// Replace control characters (newlines, ANSI escapes...) so a posted line cannot forge or garble log output.
export const sanitizeLogLine = (text) => String(text).replace(/[\x00-\x1f\x7f]/g, ' ');

// Allows `max` lines per `windowMs` per key. check() says whether to accept; when a window that dropped
// lines has ended it also reports how many, so the caller can log a single "suppressed N" line.
export function createLogLimiter({ max = LOG_MAX_LINES, windowMs = LOG_WINDOW_MS, now = Date.now } = {}) {
  const windows = new Map(); // key -> { start, count, dropped }
  return {
    check(key) {
      const t = now();
      let w = windows.get(key);
      let suppressed = 0;
      if (!w || t - w.start >= windowMs) {
        suppressed = w?.dropped ?? 0;
        if (windows.size > 100) for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
        w = { start: t, count: 0, dropped: 0 };
        windows.set(key, w);
      }
      if (w.count < max) {
        w.count++;
        return { ok: true, suppressed };
      }
      w.dropped++;
      return { ok: false, suppressed };
    },
  };
}

const reject = (socket) => {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
};

// `options` is for tests: tvPort (0 = any free port) and heartbeatMs.
export function attachRelay(server, port, { tvPort = port + TV_PORT_OFFSET, heartbeatMs = HEARTBEAT_MS } = {}) {
  const logger = server.config.logger;
  server.middlewares.use('/api/info', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // The webOS app's launcher polls this from file://, whose Origin is the string "null". Nobody else gets CORS.
    if (req.headers.origin === 'null') res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Vary', 'Origin');
    res.end(JSON.stringify({ host: lanIp(), port }));
  });
  // The TV page reports errors here (see tv.html), since a TV has no developer tools.
  const logLimiter = createLogLimiter();
  server.middlewares.use('/api/log', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end();
      return;
    }
    const ip = req.socket.remoteAddress ?? 'unknown';
    const verdict = logLimiter.check(ip);
    if (verdict.suppressed) logger.info(`[tv] suppressed ${verdict.suppressed} lines from ${ip}`);
    if (!verdict.ok) {
      res.statusCode = 429;
      res.end();
      req.resume();
      return;
    }
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      if (size > LOG_MAX_BYTES) return; // already cut off
      size += chunk.length;
      if (size > LOG_MAX_BYTES) {
        body += chunk.toString('utf8', 0, Math.max(0, chunk.length - (size - LOG_MAX_BYTES)));
        logger.info(`[tv] ${sanitizeLogLine(body)} [truncated]`);
        req.destroy();
      } else {
        body += chunk;
      }
    });
    req.on('end', () => {
      logger.info(`[tv] ${sanitizeLogLine(body)}`);
      res.end();
    });
  });
  if (!server.httpServer) return null; // vitest / middleware mode

  const rooms = createRooms();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES }); // messages are tiny JSON
  const makeOnUpgrade = (isTv) => (req, socket, head) => {
    if (req.url !== '/ws') {
      if (isTv) socket.destroy(); // nothing else upgrades here; don't leave it hanging
      return; // on the main server, leave Vite's HMR socket alone
    }
    if (!isAllowedHost(req.headers.host)) return reject(socket);
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Without this a malformed frame emits an unhandled 'error' and kills the server.
      ws.on('error', (err) => logger.warn(`[bridge-relay] ${err.message}`));
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('message', (data) => {
        const msg = decode(data.toString());
        if (!msg) return;
        if (msg.t === 'join') rooms.join(ws, msg);
        else rooms.relay(ws, msg);
      });
      ws.on('close', () => rooms.leave(ws));
    });
  };
  server.httpServer.on('upgrade', makeOnUpgrade(false));

  // A phone that loses Wi-Fi or is pocketed sends no close frame. Ping every client; one that never
  // answered the previous ping is dead, so terminate it. That fires 'close', and rooms.leave tells the peer.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  // The TV needs no motion sensors, so it gets plain HTTP on port + 10: a TV browser stops on the
  // self-signed certificate warning every launch. Same app and same rooms, so the HTTPS phone pairs with it.
  // Vite skips its Host check when https is on, and this server reuses that stack, so check Host here.
  const tvServer = createServer((req, res) => {
    if (!isAllowedHost(req.headers.host)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    server.middlewares(req, res);
  });
  tvServer.on('upgrade', makeOnUpgrade(true));
  let retries = 0;
  let retryTimer;
  tvServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries < LISTEN_RETRIES) {
      retries++;
      retryTimer = setTimeout(listen, LISTEN_RETRY_MS);
      return;
    }
    logger.warn(`[bridge-relay] TV port ${tvPort}: ${err.message}`);
  });
  function listen() {
    tvServer.listen(tvPort, () => logger.info(`  ➜  TV page: http://${lanIp()}:${tvServer.address().port}/tv.html`));
  }
  listen();

  server.httpServer.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(retryTimer);
    for (const ws of wss.clients) ws.terminate(); // so a TV or phone reconnects to the restarted server
    tvServer.close();
  });
  return { tvServer, rooms };
}
