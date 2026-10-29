// The phone's status line and view state, built from the TV's {t:'state'} message. Pure, so it is unit-tested.
// Every field added for two-player play (mode, you, role, gustReady, result, tally...) may be missing: a TV that does not
// send them, or a solo game, gets exactly the single-player behaviour.
import { formatScore, resultLine } from '../tv/results.js';
import { MODES } from '../shared/protocol.js';

export const STATUS = {
  lobby: 'Press Start',
  playing: 'Balance! Jump the gaps',
  falling: 'You fell!',
  gameover: 'Game over — press Start',
  won: 'You made it! Start for the next level',
};

const isPlayer = (n) => n === 1 || n === 2;

// What this phone should show: its mode, player number and role, whether the controls are the Wind Master's, and whether the
// mode picker is on screen.
// `me` is the player number the server gave this phone at pairing; the TV's `you` wins when it sends one.
export function viewOf(msg, me = 1) {
  const mode = MODES.includes(msg.mode) ? msg.mode : 'solo';
  const player = isPlayer(msg.you) ? msg.you : isPlayer(me) ? me : 1;
  const role = mode === 'windmaster' && msg.role === 'windmaster' ? 'windmaster' : mode === 'race' ? 'racer' : 'walker';
  const idle = msg.phase !== 'playing' && msg.phase !== 'falling'; // Start is on screen, and so is the mode picker
  // The mode picker shows only when the TV says a change is allowed (not between the rounds of a match: it would wipe the
  // tally). A TV that sends no flag gets the old rule, the picker whenever Start shows.
  const canChangeMode = typeof msg.canChangeMode === 'boolean' ? msg.canChangeMode : idle;
  return { mode, player, role, windMaster: role === 'windmaster', gustReady: msg.gustReady === true, idle, canChangeMode };
}

// The Start button's words: it always sends {t:'start'}, the TV decides what that begins.
export function startLabel(msg) {
  if (msg.phase === 'roundOver') return 'Next round';
  if (msg.phase === 'matchOver') return 'New match';
  return 'Start';
}

const tallyText = (tally, you) => {
  if (!tally || !Number.isFinite(tally[1]) || !Number.isFinite(tally[2])) return '';
  const other = you === 1 ? 2 : 1;
  return `Wins ${tally[you]}–${tally[other]}`;
};

// The line after a race or windmaster round, from msg.result. '' when there is none to read.
export function roundResultText(msg, me = 1) {
  const r = msg.result;
  if (!r || typeof r !== 'object') return '';
  const you = viewOf(msg, me).player;
  if (r.kind === 'race' && isPlayer(r.winner)) {
    const head = r.matchWinner
      ? r.matchWinner === you ? 'You won the match!' : `P${r.matchWinner} won the match`
      : r.winner === you ? 'You won the round!' : `P${r.winner} won the round`;
    return [head, tallyText(r.tally, you)].filter(Boolean).join(' · ');
  }
  if (r.kind === 'windmaster') {
    const total = r.scores && Number.isFinite(r.scores[you]) ? `Total ${formatScore(r.scores[you])}` : '';
    if (msg.phase === 'matchOver') { // the final line is short: the match, then the score
      const head = r.matchWinner ? (r.matchWinner === you ? 'You won the match!' : `P${r.matchWinner} won the match`) : 'Match drawn';
      return [head, total].filter(Boolean).join(' · ');
    }
    const points = r.roundScores && Number.isFinite(r.roundScores[you]) ? r.roundScores[you] : 0;
    const falls = Number.isFinite(r.fallsCaused) ? r.fallsCaused : 0;
    const head = r.windMaster === you
      ? `${falls} fall${falls === 1 ? '' : 's'} caused`
      : r.outcome === 'won' ? 'You made it!' : 'Game over';
    return [head, `${points >= 0 ? '+' : ''}${formatScore(points)} pts`, total].filter(Boolean).join(' · ');
  }
  return '';
}

// "Balance! Jump the gaps · ❤ 3 · Level 2". After a level it leads with the stars and score ("★★☆ 1,240 pts"),
// at game over with the run score. A TV that does not send those fields gets the plain line.
export function statusText(msg, me = 1) {
  const view = viewOf(msg, me);
  if (view.mode !== 'solo') return multiplayerText(msg, view);
  const tail = `❤ ${msg.lives} · Level ${msg.level}`;
  if (msg.paused && msg.phase === 'playing') return `Paused — tap ▶ to resume · ${tail}`;
  const line = msg.phase === 'won' ? resultLine(msg.stars, msg.score) : '';
  if (line) return `${line} · ${tail}`; // the Start button is on screen, so no need to say it
  if (msg.phase === 'gameover' && Number.isFinite(msg.runScore)) {
    return `${STATUS.gameover} · ${formatScore(msg.runScore)} pts · ${tail}`;
  }
  return `${STATUS[msg.phase]} · ${tail}`;
}

function multiplayerText(msg, view) {
  const level = Number.isFinite(msg.level) ? ` · Level ${msg.level}` : '';
  if (msg.paused && (msg.phase === 'playing' || msg.phase === 'falling')) return `Paused — tap ▶ to resume${level}`;
  if (msg.phase === 'roundOver' || msg.phase === 'matchOver') {
    return roundResultText(msg, view.player) || (msg.phase === 'matchOver' ? 'Match over — press New match' : 'Round over — press Next round');
  }
  if (msg.phase === 'lobby') return view.mode === 'race' ? 'Race: first to the end wins. Press Start' : 'Wind Master: one walks, one sends gusts. Press Start';
  if (view.windMaster) {
    const wind = msg.wind === 'warning' || msg.wind === 'gust' ? ` · gust ${msg.wind === 'gust' ? 'blowing' : 'coming'}` : '';
    return msg.phase === 'falling' ? `They fell!${level}` : `You are the Wind Master — blow them off!${wind}`;
  }
  const falls = view.mode === 'race' && Number.isFinite(msg.falls) ? ` · Falls ${msg.falls}` : Number.isFinite(msg.lives) ? ` · ❤ ${msg.lives}` : '';
  const base = msg.phase === 'falling' ? 'You fell!' : view.mode === 'race' ? 'Race! Get to the end first' : 'Balance! Jump the gaps';
  return `${base}${falls}${level}`;
}
