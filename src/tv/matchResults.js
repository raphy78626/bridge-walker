// The panels after a round or a match in the two-player modes, as plain data (hud.js places the strings). No DOM.
//
//   { kind: 'mp', variant: 'race' | 'windmaster', over: bool, title, titleColor, sub, cols: [p1, p2], rows: [{ label, v1, v2, win }],
//     tally, note, next }
// `win` marks the cell that won the row (1 or 2, 0 for none) so the panel can light it.
import { PLAYER_COLORS } from '../shared/players.js';
import { formatClock, formatScore } from './results.js';

const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const other = (p) => (p === 1 ? 2 : 1);
const lower = (a, b) => (a === b ? 0 : a < b ? 1 : 2);
const higher = (a, b) => (a === b ? 0 : a > b ? 1 : 2);
const plus = (n) => `${n >= 0 ? '+' : ''}${formatScore(n)}`;

function raceView(r) {
  const over = !!r.matchWinner;
  const winner = r.winner;
  const tally = r.tally ?? { 1: 0, 2: 0 };
  const fin = r.finished ?? { 1: true, 2: true };
  const t = r.times ?? {};
  const f = r.falls ?? {};
  const time = (p) => (fin[p] ? formatClock(t[p]) : 'DNF');
  const winTime = fin[1] && fin[2] ? lower(num(t[1]), num(t[2])) : winner;
  return {
    kind: 'mp',
    variant: 'race',
    over,
    title: over ? `P${r.matchWinner} WINS THE MATCH ${tally[r.matchWinner]}–${tally[other(r.matchWinner)]}` : `P${winner} WINS ROUND ${num(r.round, 1)}!`,
    titleColor: PLAYER_COLORS[over ? r.matchWinner : winner],
    sub: over ? `Round ${num(r.round, 1)}: P${winner} first across the bridge` : `P${winner} was first across the bridge`,
    cols: ['P1', 'P2'],
    rows: [
      { label: 'TIME', v1: time(1), v2: time(2), win: winTime },
      { label: 'FALLS', v1: String(num(f[1])), v2: String(num(f[2])), win: lower(num(f[1]), num(f[2])) },
    ],
    tally: `${over ? 'Final' : 'Round wins'}  P1 ${tally[1]} – ${tally[2]} P2`,
    note: '',
    next: over ? 'Press START for a new match' : 'Press START for the next round',
  };
}

// result: match.result. `final` says the match is over (match.phase === 'matchOver'): a drawn match has matchWinner 0, so
// the result alone cannot tell the last round from the others.
export function matchResultView(result, { final = false } = {}) {
  if (!result) return null;
  if (result.kind === 'race') return raceView(result);
  if (result.kind !== 'windmaster') return null;
  const walker = result.walker;
  const master = result.windMaster;
  const won = result.outcome === 'won';
  const scores = result.scores ?? { 1: 0, 2: 0 };
  const round = result.roundScores ?? {};
  const caused = num(result.fallsCaused);
  const [a, b] = [num(scores[1]), num(scores[2])];
  const winner = result.matchWinner;
  const title = final ? (winner ? `P${winner} WINS THE MATCH` : 'THE MATCH IS A DRAW') : `ROUND ${num(result.round, 1)} COMPLETE`;
  return {
    kind: 'mp',
    variant: 'windmaster',
    over: final,
    title,
    titleColor: final && winner ? PLAYER_COLORS[winner] : '#ffffff',
    sub: won ? `P${walker} crossed the bridge!` : `P${walker} ran out of lives`,
    cols: ['P1', 'P2'],
    rows: [
      { label: 'THIS ROUND', v1: plus(num(round[1])), v2: plus(num(round[2])), win: higher(num(round[1]), num(round[2])) },
      { label: 'TOTAL', v1: formatScore(a), v2: formatScore(b), win: higher(a, b) },
    ],
    tally: `P${master} Wind Master: ${caused} ${caused === 1 ? 'fall' : 'falls'} caused`,
    note: final ? `Final score  P1 ${formatScore(a)} – ${formatScore(b)} P2` : `Roles swap! P${master} walks next`,
    next: final ? 'Press START for a new match' : `Press START for round ${num(result.round, 1) + 1}`,
    walker,
    windMaster: master,
  };
}
