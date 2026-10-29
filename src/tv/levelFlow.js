// When the look and sound of the level change, as pure functions of the session's phase transitions so main.js
// stays thin and the rules are testable.
import { themeForLevel } from './themes.js';

// A level begins when play starts from the lobby, the win screen or the game-over screen. A respawn after a fall
// (falling -> playing) is the same level and does not count.
const STARTS = new Set(['lobby', 'won', 'gameover']);
export const isLevelStart = (prev, phase) => phase === 'playing' && STARTS.has(prev);

// The theme to apply on a phase change, or null for none. `level` is the session's level AFTER the change.
//  - entering 'won': the NEXT level's theme, so the sky bake and the sound crossfade hide behind the win screen
//  - a level starting: that level's theme. After a win it is the one already applied (a no-op); after game over
//    the session has dropped to level 1, so this is the gameover -> start path back to the first theme.
export function themeForTransition(prev, phase, level) {
  if (phase === 'won' && prev !== 'won') return themeForLevel(level + 1);
  if (isLevelStart(prev, phase)) return themeForLevel(level);
  return null;
}

// "Level 3 — Sunset" when a level starts, else null.
export function levelBanner(prev, phase, level) {
  return isLevelStart(prev, phase) ? `Level ${level} — ${themeForLevel(level).name}` : null;
}
