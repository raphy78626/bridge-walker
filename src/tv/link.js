// Pure helpers for the TV's link to the phone, kept apart from main.js so they can be unit-tested.

// Reconnect backoff for the TV socket: 1 s, 2 s, 4 s, then 5 s. `attempt` counts from 0.
export function reconnectDelay(attempt) {
  return Math.min(1000 * 2 ** attempt, 5000);
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

// The URL the QR code points the phone at. The phone needs HTTPS for its motion sensors.
// `loc` is { protocol, hostname, origin } (the TV page's location); `info` is /api/info's { host, port },
// where port is the server's HTTPS port.
export function phoneUrl(loc, info, room) {
  const local = LOCAL_HOSTS.includes(loc.hostname);
  let base;
  if (local) base = `https://${info.host}:${info.port}`; // the Mac itself: localhost means nothing to a phone
  else if (loc.protocol === 'https:') base = loc.origin; // already a reachable HTTPS address
  else base = `https://${loc.hostname}:${info.port}`; // the TV got here by this name, so the phone can too
  return `${base}/phone.html?room=${room}`;
}

// Is a phone paired, and is it still sending tilt? The phone sends tilt at 30 Hz, so silence
// for TILT_TIMEOUT_MS means it locked or dropped, and the walker must not keep walking on its own.
export const TILT_TIMEOUT_MS = 500;

export function createControllerGate(timeoutMs = TILT_TIMEOUT_MS) {
  let paired = false;
  let lastTilt = 0;
  return {
    get paired() {
      return paired;
    },
    pair(now) {
      paired = true;
      lastTilt = now;
    },
    unpair() {
      paired = false;
    },
    tilt(now) {
      lastTilt = now;
    },
    // true while a phone is paired and has sent tilt recently
    live(now) {
      return paired && now - lastTilt <= timeoutMs;
    },
  };
}
