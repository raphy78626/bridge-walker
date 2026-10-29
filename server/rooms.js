import { encode, PHONE_TYPES, TV_TYPES } from '../src/shared/protocol.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read off a TV
const SLOTS = [1, 2]; // player numbers; a phone takes the lowest free one

export function createRooms() {
  const rooms = new Map(); // code -> { tv, phones: { 1: socket|null, 2: socket|null }, ids: { 1: id|null, 2: id|null } }
  const members = new Map(); // socket -> { code, role, player? }

  const send = (sock, msg) => sock?.send(encode(msg));

  function newCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function join(sock, msg) {
    if (members.has(sock)) leave(sock); // re-join: clean up the old membership first
    if (msg.role === 'tv') {
      const code = newCode();
      rooms.set(code, { tv: sock, phones: { 1: null, 2: null }, ids: { 1: null, 2: null } });
      members.set(sock, { code, role: 'tv' });
      send(sock, { t: 'room', room: code });
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
      rooms.delete(who.code);
      for (const n of SLOTS) {
        const phone = room.phones[n];
        if (!phone) continue;
        members.delete(phone);
        send(phone, { t: 'peer-left' });
      }
    } else {
      room.phones[who.player] = null;
      room.ids[who.player] = null;
      send(room.tv, { t: 'peer-left', player: who.player });
    }
  }

  return { join, relay, leave };
}
