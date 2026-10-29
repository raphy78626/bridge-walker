import { encode, RELAYED } from '../src/shared/protocol.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read off a TV

export function createRooms() {
  const rooms = new Map(); // code -> { tv, phone }
  const members = new Map(); // socket -> { code, role }

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
      rooms.set(code, { tv: sock, phone: null });
      members.set(sock, { code, role: 'tv' });
      send(sock, { t: 'room', room: code });
      return;
    }
    const room = rooms.get(msg.room);
    if (!room) {
      send(sock, { t: 'error', reason: 'no-room' });
      return;
    }
    if (room.phone) {
      members.delete(room.phone);
      send(room.phone, { t: 'error', reason: 'replaced' });
    }
    room.phone = sock;
    members.set(sock, { code: msg.room, role: 'phone' });
    send(room.tv, { t: 'paired' });
    send(sock, { t: 'paired' });
  }

  function relay(sock, msg) {
    const who = members.get(sock);
    if (!who || !RELAYED.has(msg.t)) return;
    const room = rooms.get(who.code);
    send(who.role === 'tv' ? room.phone : room.tv, msg);
  }

  function leave(sock) {
    const who = members.get(sock);
    if (!who) return;
    members.delete(sock);
    const room = rooms.get(who.code);
    if (who.role === 'tv') {
      rooms.delete(who.code);
      if (room.phone) {
        members.delete(room.phone);
        send(room.phone, { t: 'peer-left' });
      }
    } else {
      room.phone = null;
      send(room.tv, { t: 'peer-left' });
    }
  }

  return { join, relay, leave };
}
