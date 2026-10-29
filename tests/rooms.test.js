import { describe, it, expect } from 'vitest';
import { createRooms } from '../server/rooms.js';
import { decode, encode } from '../src/shared/protocol.js';

function fakeSocket() {
  return { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
}
const last = (sock) => sock.sent.at(-1);

function pairedRoom() {
  const rooms = createRooms();
  const tv = fakeSocket();
  const phone = fakeSocket();
  rooms.join(tv, { t: 'join', role: 'tv' });
  const code = tv.sent[0].room;
  rooms.join(phone, { t: 'join', role: 'phone', room: code });
  return { rooms, tv, phone, code };
}

describe('rooms', () => {
  it('gives a TV a 4-letter room code', () => {
    const rooms = createRooms();
    const tv = fakeSocket();
    rooms.join(tv, { t: 'join', role: 'tv' });
    expect(last(tv)).toEqual({ t: 'room', room: expect.stringMatching(/^[A-Z]{4}$/) });
  });

  it('pairs a phone with the TV that owns the code', () => {
    const { tv, phone } = pairedRoom();
    expect(last(tv)).toEqual({ t: 'paired' });
    expect(last(phone)).toEqual({ t: 'paired' });
  });

  it('rejects a phone with an unknown code', () => {
    const rooms = createRooms();
    const phone = fakeSocket();
    rooms.join(phone, { t: 'join', role: 'phone', room: 'ZZZZ' });
    expect(last(phone)).toEqual({ t: 'error', reason: 'no-room' });
  });

  it('answers no-room to a phone whose room code was malformed or missing', () => {
    const rooms = createRooms();
    for (const join of [{ t: 'join', role: 'phone', room: 'abc' }, { t: 'join', role: 'phone' }]) {
      const phone = fakeSocket();
      rooms.join(phone, decode(encode(join)));
      expect(phone.sent).toEqual([{ t: 'error', reason: 'no-room' }]);
    }
  });

  it('relays controller input to the TV and state to the phone', () => {
    const { rooms, tv, phone } = pairedRoom();
    rooms.relay(phone, { t: 'tilt', v: 0.5 });
    expect(last(tv)).toEqual({ t: 'tilt', v: 0.5 });
    rooms.relay(tv, { t: 'state', phase: 'playing', lives: 3, level: 1 });
    expect(last(phone)).toEqual({ t: 'state', phase: 'playing', lives: 3, level: 1 });
  });

  it('ignores server-only types and unknown sockets', () => {
    const { rooms, tv, phone } = pairedRoom();
    const before = tv.sent.length;
    rooms.relay(phone, { t: 'paired' });
    rooms.relay(fakeSocket(), { t: 'tilt', v: 1 });
    expect(tv.sent.length).toBe(before);
  });

  it('tells the TV when the phone leaves, and lets a phone rejoin', () => {
    const { rooms, tv, phone, code } = pairedRoom();
    rooms.leave(phone);
    expect(last(tv)).toEqual({ t: 'peer-left' });
    const phone2 = fakeSocket();
    rooms.join(phone2, { t: 'join', role: 'phone', room: code });
    expect(last(phone2)).toEqual({ t: 'paired' });
  });

  it('tells the phone when the TV leaves and forgets the room', () => {
    const { rooms, tv, phone, code } = pairedRoom();
    rooms.leave(tv);
    expect(last(phone)).toEqual({ t: 'peer-left' });
    const phone2 = fakeSocket();
    rooms.join(phone2, { t: 'join', role: 'phone', room: code });
    expect(last(phone2)).toEqual({ t: 'error', reason: 'no-room' });
  });

  it('lets a new phone take over from the old one', () => {
    const { rooms, tv, phone, code } = pairedRoom();
    const phone2 = fakeSocket();
    rooms.join(phone2, { t: 'join', role: 'phone', room: code });
    expect(last(phone)).toEqual({ t: 'error', reason: 'replaced' });
    rooms.relay(tv, { t: 'state', phase: 'lobby', lives: 3, level: 1 });
    expect(last(phone2).t).toBe('state');
    expect(last(phone).t).toBe('error');
  });

  it('a TV that joins twice drops its old room', () => {
    const rooms = createRooms();
    const tv = fakeSocket();
    rooms.join(tv, { t: 'join', role: 'tv' });
    const oldCode = tv.sent[0].room;
    rooms.join(tv, { t: 'join', role: 'tv' });
    const phone = fakeSocket();
    rooms.join(phone, { t: 'join', role: 'phone', room: oldCode });
    expect(last(phone)).toEqual({ t: 'error', reason: 'no-room' });
  });

  it('a phone that switches rooms tells its old TV', () => {
    const { rooms, tv, phone } = pairedRoom();
    const tv2 = fakeSocket();
    rooms.join(tv2, { t: 'join', role: 'tv' });
    rooms.join(phone, { t: 'join', role: 'phone', room: tv2.sent[0].room });
    expect(last(tv)).toEqual({ t: 'peer-left' });
    expect(last(tv2)).toEqual({ t: 'paired' });
    rooms.relay(phone, { t: 'tilt', v: 1 });
    expect(last(tv2)).toEqual({ t: 'tilt', v: 1 });
    expect(last(tv)).toEqual({ t: 'peer-left' });
  });
});
