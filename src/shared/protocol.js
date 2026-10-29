// Every message is a small JSON object with a type field `t`.
// phone → tv: tilt {v}, walk {on}, run {on}, jump, camera (cycle the view), pause (toggle), volume {music, sfx}, start
// tv → phone: state {phase, lives, level, ...}      server → client: room {room}, paired, peer-left, error {reason}
export const RELAYED = new Set(['tilt', 'walk', 'run', 'jump', 'camera', 'pause', 'volume', 'start', 'state']);
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
    case 'state':
      return msg;
    default:
      return SERVER_TYPES.has(msg.t) ? msg : null;
  }
}
