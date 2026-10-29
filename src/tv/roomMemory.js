// The TV remembers its room code and key across a reload, so it asks the server for the same room back and the phones stay
// paired (server/rooms.js keeps a dropped TV's room for TV_GRACE_MS). sessionStorage, not localStorage: it lives as long as
// the tab, and two TV tabs in one browser must not take each other's room. Any storage error just means a new room.
const KEY = 'bridge-walker.room';
const ROOM_RE = /^[A-Z]{4}$/;
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

// { room, key } to ask for, or {} for a new room.
export function loadRoom(store) {
  try {
    const saved = JSON.parse(store?.getItem(KEY) ?? 'null');
    if (saved && ROOM_RE.test(saved.room) && KEY_RE.test(saved.key)) return { room: saved.room, key: saved.key };
  } catch {
    // unreadable: a new room
  }
  return {};
}

export function saveRoom(store, { room, key }) {
  try {
    if (ROOM_RE.test(room) && KEY_RE.test(key)) store?.setItem(KEY, JSON.stringify({ room, key }));
  } catch {
    // full or blocked: the next reload gets a new room
  }
}
