import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { connect } from '../src/shared/client.js';

class FakeSocket {
  static OPEN = 1;
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.handlers = {};
    FakeSocket.last = this;
  }
  addEventListener(type, fn) {
    (this.handlers[type] ??= []).push(fn);
  }
  emit(type, ev) {
    for (const fn of this.handlers[type] ?? []) fn(ev);
  }
  send(data) {
    this.sent.push(data);
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'mac.local:5184' });
});
afterEach(() => vi.unstubAllGlobals());

describe('connect', () => {
  it('still works with just (onMessage, onOpen) and exposes .ws, as the phone uses it', () => {
    const msgs = [];
    let opened = 0;
    const conn = connect((m) => msgs.push(m), () => opened++);
    expect(conn.ws).toBe(FakeSocket.last);
    expect(conn.ws.url).toBe('ws://mac.local:5184/ws');
    conn.ws.readyState = FakeSocket.OPEN;
    conn.ws.emit('open');
    conn.ws.emit('message', { data: JSON.stringify({ t: 'paired' }) });
    conn.ws.emit('close'); // no onClose given: must not throw
    expect(opened).toBe(1);
    expect(msgs).toEqual([{ t: 'paired' }]);
  });

  it('calls onClose when the socket closes', () => {
    let closed = 0;
    const conn = connect(() => {}, undefined, () => closed++);
    conn.ws.emit('close');
    expect(closed).toBe(1);
  });

  it('only sends while the socket is open', () => {
    const conn = connect(() => {});
    conn.send({ t: 'start' });
    expect(conn.ws.sent).toEqual([]);
    conn.ws.readyState = FakeSocket.OPEN;
    conn.send({ t: 'start' });
    expect(conn.ws.sent).toEqual(['{"t":"start"}']);
  });
});
