// The match-level fields of the {t:'state'} message a phone gets, for one player. The TV spreads these over its
// per-session fields (buildStateMessage) and sends the result with `to: player`:
//
//   tv.send({ ...buildStateMessage(sessionOf(player)), ...matchStateFor(match, player), to: player })
//
// Always: mode, you (1|2), role ('walker' | 'windmaster' | 'racer'), gustReady (the Wind Master may send a gust now).
// Race and windmaster also override phase ('lobby' | 'playing' | 'falling' | 'roundOver' | 'matchOver': 'falling' is
// this player's own walker, or the walker in windmaster) and level, and add round, scores, and the round's result
// once there is one. Race adds tally and falls (this player's, since lives do not run out); windmaster adds lives.
// Solo adds nothing else, so the single-player message is exactly the one the TV already sends.
import { MODES } from '../shared/protocol.js';

export function roleOf(match, player) {
  if (match.mode === 'race') return 'racer';
  if (match.mode === 'windmaster') return match.walkerOf() === player ? 'walker' : 'windmaster';
  return 'walker';
}

export function matchStateFor(match, player) {
  const msg = { mode: match.mode, you: player, role: roleOf(match, player), gustReady: !!match.gustReady };
  if (!MODES.includes(match.mode) || match.mode === 'solo') return msg;
  const session = match.mode === 'race' ? match.sessions[player] : match.sessions[1];
  msg.phase = match.phase === 'playing' ? session.phase : match.phase;
  msg.level = match.level;
  msg.round = match.round;
  msg.scores = match.scores;
  if (match.mode === 'race') {
    msg.tally = match.tally;
    msg.falls = session.levelFalls;
  } else {
    msg.lives = session.lives;
  }
  if (match.result) msg.result = match.result;
  return msg;
}
