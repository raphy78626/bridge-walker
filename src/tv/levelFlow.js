// When the look and sound of the level change, as pure functions of the session's phase transitions so main.js
// stays thin and the rules are testable. Which look comes next is looks.js's job.

// A level begins when play starts from the lobby, the win screen or the game-over screen. A respawn after a fall
// (falling -> playing) is the same level and does not count.
const STARTS = new Set(['lobby', 'won', 'gameover']);
export const isLevelStart = (prev, phase) => phase === 'playing' && STARTS.has(prev);

// A level ends: cleared ('won'), or failed or the match over ('gameover'), in any mode (matchLink.js's flowPhase). This is
// when the NEXT level's look goes on, so the sky bake, the canyon swap and the sound crossfade hide behind the results
// panel, and the level that follows starts on its own look.
export const isLevelEnd = (prev, phase) => (phase === 'won' || phase === 'gameover') && prev !== phase;

// "Level 3 — Sunset" when a level starts, else null. `theme` is the look's theme the level starts with.
export function levelBanner(prev, phase, level, theme) {
  return isLevelStart(prev, phase) ? `Level ${level} — ${theme.name}` : null;
}
