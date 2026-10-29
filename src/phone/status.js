// The phone's status line, built from the TV's {t:'state'} message. Pure, so it is unit-tested.
import { formatScore, resultLine } from '../tv/results.js';

export const STATUS = {
  lobby: 'Press Start',
  playing: 'Balance! Jump the gaps',
  falling: 'You fell!',
  gameover: 'Game over — press Start',
  won: 'You made it! Start for the next level',
};

// "Balance! Jump the gaps · ❤ 3 · Level 2". After a level it leads with the stars and score ("★★☆ 1,240 pts"),
// at game over with the run score. A TV that does not send those fields gets the plain line.
export function statusText(msg) {
  const tail = `❤ ${msg.lives} · Level ${msg.level}`;
  const line = msg.phase === 'won' ? resultLine(msg.stars, msg.score) : '';
  if (line) return `${line} · ${tail}`; // the Start button is on screen, so no need to say it
  if (msg.phase === 'gameover' && Number.isFinite(msg.runScore)) {
    return `${STATUS.gameover} · ${formatScore(msg.runScore)} pts · ${tail}`;
  }
  return `${STATUS[msg.phase]} · ${tail}`;
}
