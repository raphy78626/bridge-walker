// Every message is a small JSON object with a type field `t`.
// phone → server: join {role: 'phone', room, id?} (id: the phone's stable identity, 1-64 of A-Za-z0-9_-).
// phone → tv: tilt {v}, walk {on}, run {on}, jump, camera (cycle the view), pause (toggle), volume {music, sfx}, start,
//             gust {dir: -1|1} (the Wind Master), mode {mode: 'solo'|'race'|'windmaster'}.
//             The server stamps every one of these with p: 1|2, the sender's player slot (whatever the client sent is overwritten).
// tv → phone: state {phase, lives, level, ..., to?}. With to: 1|2 it goes to that player only (the server strips `to`);
//             without it, to every phone.
// server → client: room {room}, paired {player}, peer-left {player (TV side) | nothing (phone side)}, error {reason}
export const PHONE_TYPES = new Set(['tilt', 'walk', 'run', 'jump', 'camera', 'pause', 'volume', 'start', 'gust', 'mode']);
export const TV_TYPES = new Set(['state']);
export const RELAYED = new Set([...PHONE_TYPES, ...TV_TYPES]);
// The relay closes a socket whose message is bigger than this (the WebSocket server's maxPayload). The TV's state messages are
// the biggest; tests/stateSize.test.js keeps them well under it.
export const MAX_MESSAGE_BYTES = 1024;
export const MODES = ['solo', 'race', 'windmaster'];
const unit = (v) => Math.max(0, Math.min(1, v));
const SERVER_TYPES = new Set(['room', 'paired', 'peer-left', 'error']);
const ROOM_RE = /^[A-Z]{4}$/;
// A phone's stable identity: it makes one up the first time and keeps it for the tab's life, and sends it in its join. A
// phone that reconnects with the id that holds a slot takes that slot (same player number) instead of being turned away.
const PHONE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isValidPhoneId = (id) => typeof id === 'string' && PHONE_ID_RE.test(id);

export const encode = (msg) => JSON.stringify(msg);

// A phone message reaches the TV stamped by the server with the sender's slot (p: 1|2). The server's own decode strips any
// p a phone claims (it stamps the real one afterwards); the TV's client passes { keepPlayer: true } to keep the server's.
export function decode(raw, { keepPlayer = false } = {}) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  const out = decodeMessage(msg);
  if (keepPlayer && out && PHONE_TYPES.has(out.t) && (msg.p === 1 || msg.p === 2)) out.p = msg.p;
  return out;
}

function decodeMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null;
  switch (msg.t) {
    case 'join':
      if (msg.role === 'tv') return { t: 'join', role: 'tv' };
      if (msg.role === 'phone') {
        // A bad code still gets through, as '', so rooms.join answers {t:'error', reason:'no-room'} instead of silence.
        const join = { t: 'join', role: 'phone', room: typeof msg.room === 'string' && ROOM_RE.test(msg.room) ? msg.room : '' };
        if (isValidPhoneId(msg.id)) join.id = msg.id; // an invalid id is dropped: the join goes ahead as an anonymous phone
        return join;
      }
      return null;
    case 'tilt':
      return Number.isFinite(msg.v) ? { t: 'tilt', v: Math.max(-1, Math.min(1, msg.v)) } : null;
    case 'walk':
      return typeof msg.on === 'boolean' ? { t: 'walk', on: msg.on } : null;
    case 'run':
      return typeof msg.on === 'boolean' ? { t: 'run', on: msg.on } : null;
    case 'jump':
      return { t: 'jump' };
    case 'camera':
      return { t: 'camera' };
    case 'pause':
      return { t: 'pause' };
    case 'volume':
      return Number.isFinite(msg.music) && Number.isFinite(msg.sfx) ? { t: 'volume', music: unit(msg.music), sfx: unit(msg.sfx) } : null;
    case 'start':
      return { t: 'start' };
    case 'gust':
      return msg.dir === -1 || msg.dir === 1 ? { t: 'gust', dir: msg.dir } : null;
    case 'mode':
      return MODES.includes(msg.mode) ? { t: 'mode', mode: msg.mode } : null;
    case 'state':
      // The TV owns this message's shape. The one field the relay acts on is `to`: a phone number, or absent (null counts as absent).
      return msg.to == null || msg.to === 1 || msg.to === 2 ? msg : null;
    default:
      return SERVER_TYPES.has(msg.t) ? msg : null;
  }
}
