import { describe, it, expect } from 'vitest';
import { phoneUrl, reconnectDelay, createControllerGate, TILT_TIMEOUT_MS } from '../src/tv/link.js';

const info = { host: '192.168.1.20', port: 5174 };

describe('phoneUrl', () => {
  it('uses the hostname the TV reached the Mac by when the TV page is on plain HTTP', () => {
    const loc = { protocol: 'http:', hostname: '10.0.0.7', origin: 'http://10.0.0.7:5184' };
    expect(phoneUrl(loc, info, 'ABCD')).toBe('https://10.0.0.7:5174/phone.html?room=ABCD');
  });

  it('does not trust info.host over the hostname on the LAN (it may be a VM address)', () => {
    const loc = { protocol: 'http:', hostname: 'macbook.local', origin: 'http://macbook.local:5184' };
    expect(phoneUrl(loc, { host: '192.168.64.1', port: 5174 }, 'ABCD')).toBe('https://macbook.local:5174/phone.html?room=ABCD');
  });

  it('keeps the origin on an HTTPS LAN page', () => {
    const loc = { protocol: 'https:', hostname: '10.0.0.7', origin: 'https://10.0.0.7:5174' };
    expect(phoneUrl(loc, info, 'WXYZ')).toBe('https://10.0.0.7:5174/phone.html?room=WXYZ');
  });

  it('asks the server for its address only on localhost', () => {
    for (const protocol of ['http:', 'https:']) {
      for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
        const loc = { protocol, hostname, origin: `${protocol}//${hostname}:5174` };
        expect(phoneUrl(loc, info, 'ABCD')).toBe('https://192.168.1.20:5174/phone.html?room=ABCD');
      }
    }
  });

  it('reuses the origin on any other https host, including one with no explicit port', () => {
    const loc = { protocol: 'https:', hostname: 'game.example.com', origin: 'https://game.example.com' };
    expect(phoneUrl(loc, info, 'ABCD')).toBe('https://game.example.com/phone.html?room=ABCD');
  });
});

describe('reconnectDelay', () => {
  it('backs off 1 s, 2 s, 4 s and then caps at 5 s', () => {
    expect([0, 1, 2, 3, 4, 10, 1000].map(reconnectDelay)).toEqual([1000, 2000, 4000, 5000, 5000, 5000, 5000]);
  });
});

describe('controller gate', () => {
  it('is not live until a phone pairs', () => {
    const g = createControllerGate();
    expect(g.paired).toBe(false);
    expect(g.live(0)).toBe(false);
  });

  it('is live while tilt keeps arriving and goes quiet after 500 ms of silence', () => {
    const g = createControllerGate();
    g.pair(1000);
    expect(g.paired).toBe(true);
    expect(g.live(1000 + TILT_TIMEOUT_MS)).toBe(true);
    expect(g.live(1000 + TILT_TIMEOUT_MS + 1)).toBe(false);
    g.tilt(2000);
    expect(g.live(2300)).toBe(true); // recovers as soon as tilt resumes
    expect(g.paired).toBe(true); // silence pauses nothing by itself: only the input is zeroed
  });

  it('is gone after unpair and live again after the next pair', () => {
    const g = createControllerGate();
    g.pair(0);
    g.unpair();
    expect(g.paired).toBe(false);
    expect(g.live(10)).toBe(false);
    g.pair(5000);
    expect(g.live(5100)).toBe(true);
  });
});
