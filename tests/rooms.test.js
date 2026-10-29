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
    expect(last(tv)).toEqual({ t: 'paired', player: 1 });
    expect(last(phone)).toEqual({ t: 'paired', player: 1 });
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
    expect(last(tv)).toEqual({ t: 'tilt', v: 0.5, p: 1 });
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
    expect(last(tv)).toEqual({ t: 'peer-left', player: 1 });
    const phone2 = fakeSocket();
    rooms.join(phone2, { t: 'join', role: 'phone', room: code });
    expect(last(phone2)).toEqual({ t: 'paired', player: 1 });
  });

  it('tells the phone when the TV leaves and forgets the room', () => {
    const { rooms, tv, phone, code } = pairedRoom();
    rooms.leave(tv);
    expect(last(phone)).toEqual({ t: 'peer-left' });
    const phone2 = fakeSocket();
    rooms.join(phone2, { t: 'join', role: 'phone', room: code });
    expect(last(phone2)).toEqual({ t: 'error', reason: 'no-room' });
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
    expect(last(tv)).toEqual({ t: 'peer-left', player: 1 });
    expect(last(tv2)).toEqual({ t: 'paired', player: 1 });
    rooms.relay(phone, { t: 'tilt', v: 1 });
    expect(last(tv2)).toEqual({ t: 'tilt', v: 1, p: 1 });
    expect(last(tv)).toEqual({ t: 'peer-left', player: 1 });
  });
});

describe('rooms: two phones', () => {
  function twoPhones() {
    const rooms = createRooms();
    const tv = fakeSocket();
    const p1 = fakeSocket();
    const p2 = fakeSocket();
    rooms.join(tv, { t: 'join', role: 'tv' });
    const code = tv.sent[0].room;
    rooms.join(p1, { t: 'join', role: 'phone', room: code });
    rooms.join(p2, { t: 'join', role: 'phone', room: code });
    return { rooms, tv, p1, p2, code };
  }

  it('gives the phones slots 1 and 2 and tells the TV about each', () => {
    const { tv, p1, p2 } = twoPhones();
    expect(p1.sent).toEqual([{ t: 'paired', player: 1 }]);
    expect(p2.sent).toEqual([{ t: 'paired', player: 2 }]);
    expect(tv.sent.slice(1)).toEqual([{ t: 'paired', player: 1 }, { t: 'paired', player: 2 }]);
  });

  it('answers room-full to a third phone and leaves the others alone', () => {
    const { rooms, tv, p1, p2, code } = twoPhones();
    const p3 = fakeSocket();
    const [tvN, n1, n2] = [tv.sent.length, p1.sent.length, p2.sent.length];
    rooms.join(p3, { t: 'join', role: 'phone', room: code });
    expect(p3.sent).toEqual([{ t: 'error', reason: 'room-full' }]);
    expect([tv.sent.length, p1.sent.length, p2.sent.length]).toEqual([tvN, n1, n2]);
    rooms.relay(p3, { t: 'tilt', v: 1 }); // not a member: ignored
    expect(tv.sent.length).toBe(tvN);
  });

  it('a phone that leaves frees its slot for the next phone (the lowest free one)', () => {
    const { rooms, tv, p1, p2, code } = twoPhones();
    rooms.leave(p1);
    expect(last(tv)).toEqual({ t: 'peer-left', player: 1 });
    const p3 = fakeSocket();
    rooms.join(p3, { t: 'join', role: 'phone', room: code });
    expect(last(p3)).toEqual({ t: 'paired', player: 1 });
    expect(last(tv)).toEqual({ t: 'paired', player: 1 });
    rooms.leave(p2);
    expect(last(tv)).toEqual({ t: 'peer-left', player: 2 });
    const p4 = fakeSocket();
    rooms.join(p4, { t: 'join', role: 'phone', room: code });
    expect(last(p4)).toEqual({ t: 'paired', player: 2 });
  });

  it('stamps p on every phone message, overwriting what the client sent', () => {
    const { rooms, tv, p1, p2 } = twoPhones();
    rooms.relay(p1, { t: 'tilt', v: 0.1 });
    rooms.relay(p2, { t: 'tilt', v: -0.2, p: 1 }); // a phone cannot claim to be player 1
    rooms.relay(p2, { t: 'gust', dir: -1, p: 1 });
    rooms.relay(p1, { t: 'mode', mode: 'race', p: 2 });
    rooms.relay(p1, { t: 'jump' });
    expect(tv.sent.slice(3)).toEqual([
      { t: 'tilt', v: 0.1, p: 1 },
      { t: 'tilt', v: -0.2, p: 2 },
      { t: 'gust', dir: -1, p: 2 },
      { t: 'mode', mode: 'race', p: 1 },
      { t: 'jump', p: 1 },
    ]);
  });

  it('sends a TV message with `to` to that player only, without the `to` field', () => {
    const { rooms, tv, p1, p2 } = twoPhones();
    const [n1, n2] = [p1.sent.length, p2.sent.length];
    rooms.relay(tv, { t: 'state', phase: 'playing', to: 2, you: 2 });
    expect(p1.sent.length).toBe(n1);
    expect(last(p2)).toEqual({ t: 'state', phase: 'playing', you: 2 });
    rooms.relay(tv, { t: 'state', phase: 'playing', to: 1 });
    expect(last(p1)).toEqual({ t: 'state', phase: 'playing' });
    expect(p2.sent.length).toBe(n2 + 1);
  });

  it('broadcasts a TV message without `to` to every phone', () => {
    const { rooms, tv, p1, p2 } = twoPhones();
    rooms.relay(tv, { t: 'state', phase: 'lobby', mode: 'race' });
    expect(last(p1)).toEqual({ t: 'state', phase: 'lobby', mode: 'race' });
    expect(last(p2)).toEqual({ t: 'state', phase: 'lobby', mode: 'race' });
  });

  it('a `to` for an empty slot goes nowhere', () => {
    const { rooms, tv, p1, p2 } = twoPhones();
    rooms.leave(p2);
    const n = p1.sent.length;
    rooms.relay(tv, { t: 'state', phase: 'lobby', to: 2 });
    expect(p1.sent.length).toBe(n);
  });

  it('a phone cannot send state, and the TV cannot send phone-only types', () => {
    const { rooms, tv, p1, p2 } = twoPhones();
    const [t, n1, n2] = [tv.sent.length, p1.sent.length, p2.sent.length];
    rooms.relay(p1, { t: 'state', phase: 'won' });
    rooms.relay(tv, { t: 'tilt', v: 1 });
    rooms.relay(tv, { t: 'gust', dir: 1 });
    expect([tv.sent.length, p1.sent.length, p2.sent.length]).toEqual([t, n1, n2]);
  });

  it('when the TV leaves, both phones hear peer-left and the room is gone', () => {
    const { rooms, tv, p1, p2, code } = twoPhones();
    rooms.leave(tv);
    expect(last(p1)).toEqual({ t: 'peer-left' });
    expect(last(p2)).toEqual({ t: 'peer-left' });
    const p3 = fakeSocket();
    rooms.join(p3, { t: 'join', role: 'phone', room: code });
    expect(last(p3)).toEqual({ t: 'error', reason: 'no-room' });
  });

  it('a phone that joins twice leaves its old slot first', () => {
    const { rooms, tv, p1, code } = twoPhones();
    rooms.join(p1, { t: 'join', role: 'phone', room: code });
    expect(tv.sent.at(-2)).toEqual({ t: 'peer-left', player: 1 });
    expect(last(p1)).toEqual({ t: 'paired', player: 1 });
  });
});
