// The match-level fields of the {t:'state'} message a phone gets, for one player. The TV spreads these over its
// per-session fields (buildStateMessage) and sends the result with `to: player`:
//
//   tv.send({ ...buildStateMessage(sessionOf(player)), ...matchStateFor(match, player), to: player })
//
// Always: mode, you (1|2), role ('walker' | 'windmaster' | 'racer'), gustReady (the Wind Master may send a gust now),
// canChangeMode (the phone shows its mode picker only then: the lobby, the end of a match, or solo between levels).
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

const round2 = (n) => Math.round(n * 100) / 100;
const round2Pair = (o) => ({ 1: round2(o[1]), 2: round2(o[2]) });

// The round's result as the phone gets it. match.result is the TV's, with everything its results panel needs; the phone reads
// only who won, the tally and scores, and (windmaster) who walked, the outcome and the points. What the message already
// says elsewhere (round, level, the lane's stars and score) and the walker's whole level result are left out, and times are
// rounded to 2 decimals: the relay closes a socket over MAX_MESSAGE_BYTES (see tests/stateSize.test.js).
export function resultForPhone(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.kind === 'race') {
    return { kind: 'race', winner: r.winner, matchWinner: r.matchWinner, tally: r.tally, scores: r.scores, times: round2Pair(r.times), finished: r.finished };
  }
  if (r.kind === 'windmaster') {
    return {
      kind: 'windmaster', walker: r.walker, windMaster: r.windMaster, outcome: r.outcome, fallsCaused: r.fallsCaused,
      roundScores: r.roundScores, scores: r.scores, matchWinner: r.matchWinner,
    };
  }
  return r;
}

export function matchStateFor(match, player) {
  const msg = { mode: match.mode, you: player, role: roleOf(match, player), gustReady: !!match.gustReady, canChangeMode: !!match.canChangeMode };
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
  if (match.result) msg.result = resultForPhone(match.result);
  return msg;
}
