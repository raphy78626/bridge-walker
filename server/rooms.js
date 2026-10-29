import { randomBytes, randomInt } from 'node:crypto';
import { encode, PHONE_TYPES, TV_TYPES } from '../src/shared/protocol.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read off a TV
const SLOTS = [1, 2]; // player numbers; a phone takes the lowest free one
// A TV that drops (a reload, a Wi-Fi blip) has this long to come back to its room before the phones are let go. It proves the
// room is its own with the key it was given: the room code is on screen, the key never leaves the TV.
export const TV_GRACE_MS = 30000;

// timers: { set(fn, ms), clear(timer) } for the TV's grace period (setTimeout / clearTimeout; tests pass their own).
const unrefTimers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, // a waiting room never keeps the process up
  clear: (t) => clearTimeout(t),
};

export function createRooms({ graceMs = TV_GRACE_MS, timers = unrefTimers } = {}) {
  // code -> { tv: socket|null (null: the TV is away, within its grace), key, grace: timer|null,
  //           phones: { 1: socket|null, 2: socket|null }, ids: { 1: id|null, 2: id|null } }
  const rooms = new Map();
  const members = new Map(); // socket -> { code, role, player? }

  const send = (sock, msg) => sock?.send(encode(msg));

  function newCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join(''); // crypto: a code cannot be predicted from earlier ones
    } while (rooms.has(code));
    return code;
  }

  function join(sock, msg) {
    const prev = members.get(sock);
    if (prev) {
      leave(sock); // re-join: clean up the old membership first
      // The same TV joining again on purpose is not a drop: its old room closes now, unless it is asking for it back.
      if (prev.role === 'tv' && msg.room !== prev.code) closeRoom(prev.code);
    }
    if (msg.role === 'tv') {
      const back = msg.room && rooms.get(msg.room);
      if (back && msg.key && back.key === msg.key) {
        rejoinTv(sock, msg.room, back);
        return;
      }
      const code = newCode();
      const key = randomBytes(18).toString('base64url');
      rooms.set(code, { tv: sock, key, grace: null, phones: { 1: null, 2: null }, ids: { 1: null, 2: null } });
      members.set(sock, { code, role: 'tv' });
      send(sock, { t: 'room', room: code, key });
      return;
    }
    const room = rooms.get(msg.room);
    if (!room) {
      send(sock, { t: 'error', reason: 'no-room' });
      return;
    }
    // A phone that comes back with the id holding a slot takes that very slot over, even while the old socket still lingers
    // (a dead Wi-Fi link is only noticed by the heartbeat, many seconds later): same player number, the old socket closed
    // quietly (it is forgotten first, so its close event tells the TV nothing). Without an id, or an unknown one, the lowest
    // free slot, as ever.
    const held = msg.id ? SLOTS.find((n) => room.phones[n] && room.ids[n] === msg.id) : undefined;
    const player = held ?? SLOTS.find((n) => !room.phones[n]);
    if (!player) {
      send(sock, { t: 'error', reason: 'room-full' });
      return;
    }
    if (held) {
      const old = room.phones[held];
      members.delete(old);
      old.close?.();
    }
    room.phones[player] = sock;
    room.ids[player] = msg.id ?? null;
    members.set(sock, { code: msg.room, role: 'phone', player });
    send(room.tv, { t: 'paired', player });
    send(sock, { t: 'paired', player });
  }

  // The TV is back in its room (a reload, a new socket): it takes the room over from its old socket if that lingers, is told
  // which phones are still there (as if each had just paired), and the phones hear it is back.
  function rejoinTv(sock, code, room) {
    if (room.grace) timers.clear(room.grace);
    room.grace = null;
    if (room.tv && room.tv !== sock) {
      members.delete(room.tv); // forgotten first, so its close event lets no one go
      room.tv.close?.();
    }
    room.tv = sock;
    members.set(sock, { code, role: 'tv' });
    send(sock, { t: 'room', room: code, key: room.key });
    for (const n of SLOTS) {
      if (!room.phones[n]) continue;
      send(sock, { t: 'paired', player: n });
      send(room.phones[n], { t: 'tv-back' });
    }
  }

  // The grace period is over and the TV never came back: the room closes and its phones are let go.
  function closeRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    if (room.grace) timers.clear(room.grace);
    rooms.delete(code);
    for (const n of SLOTS) {
      const phone = room.phones[n];
      if (!phone) continue;
      members.delete(phone);
      send(phone, { t: 'peer-left' });
    }
  }

  // Phone → TV: only the phone's own message types, stamped with its slot. TV → phones: only `state`, to one
  // player when `to` is 1|2, else to every phone. `to` and `p` never travel past the server.
  function relay(sock, msg) {
    const who = members.get(sock);
    if (!who) return;
    const room = rooms.get(who.code);
    if (who.role === 'phone') {
      if (!PHONE_TYPES.has(msg.t)) return;
      const { to, ...rest } = msg;
      send(room.tv, { ...rest, p: who.player });
    } else {
      if (!TV_TYPES.has(msg.t)) return;
      const { to, p, ...rest } = msg;
      if (to === 1 || to === 2) send(room.phones[to], rest);
      else for (const n of SLOTS) send(room.phones[n], rest);
    }
  }

  function leave(sock) {
    const who = members.get(sock);
    if (!who) return;
    members.delete(sock);
    const room = rooms.get(who.code);
    if (who.role === 'tv') {
      // Not closed yet: the phones wait (and are told so) in case the TV comes back within the grace period.
      room.tv = null;
      for (const n of SLOTS) send(room.phones[n], { t: 'tv-away' });
      room.grace = timers.set(() => closeRoom(who.code), graceMs);
    } else {
      room.phones[who.player] = null;
      room.ids[who.player] = null;
      send(room.tv, { t: 'peer-left', player: who.player });
    }
  }

  return { join, relay, leave };
}
