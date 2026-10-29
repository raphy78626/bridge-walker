// Every message is a small JSON object with a type field `t`.
// phone → tv: tilt {v}, walk {on}, run {on}, jump, camera (cycle the view), pause (toggle), volume {music, sfx}, start,
//             gust {dir: -1|1} (the Wind Master), mode {mode: 'solo'|'race'|'windmaster'}.
//             The server stamps every one of these with p: 1|2, the sender's player slot (whatever the client sent is overwritten).
// tv → phone: state {phase, lives, level, ..., to?}. With to: 1|2 it goes to that player only (the server strips `to`);
//             without it, to every phone.
// server → client: room {room}, paired {player}, peer-left {player (TV side) | nothing (phone side)}, error {reason}
export const PHONE_TYPES = new Set(['tilt', 'walk', 'run', 'jump', 'camera', 'pause', 'volume', 'start', 'gust', 'mode']);
export const TV_TYPES = new Set(['state']);
export const RELAYED = new Set([...PHONE_TYPES, ...TV_TYPES]);
export const MODES = ['solo', 'race', 'windmaster'];
const unit = (v) => Math.max(0, Math.min(1, v));
const SERVER_TYPES = new Set(['room', 'paired', 'peer-left', 'error']);
const ROOM_RE = /^[A-Z]{4}$/;

export const encode = (msg) => JSON.stringify(msg);

export function decode(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null;
  switch (msg.t) {
    case 'join':
      if (msg.role === 'tv') return { t: 'join', role: 'tv' };
      if (msg.role === 'phone') {
        // A bad code still gets through, as '', so rooms.join answers {t:'error', reason:'no-room'} instead of silence.
        return { t: 'join', role: 'phone', room: typeof msg.room === 'string' && ROOM_RE.test(msg.room) ? msg.room : '' };
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
