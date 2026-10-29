// What each level looks like: a look is { theme, seed }, a theme (themes.js) for the sky, light and sound, and a seed for
// the canyon's shapes (canyon.js). Both are picked at random, the first level's too, and a level never gets the theme of
// the one before it. A race or a Wind Master round is one scene for both players, so one look per round.
//
// The look after the current one is picked ahead (`upcoming`), so its canyon can be built in the background while the
// current level is played (canyonBuild.js) and its sounds warmed up (audio.js). advance() moves on to it.
import { THEMES } from './themes.js';

export const SEED_RANGE = 2 ** 31;

// A theme at random from `themes`, never the one whose id is `previousId` (unless it is the only one).
export function pickTheme(rand, previousId, themes = THEMES) {
  const pool = themes.length > 1 ? themes.filter((t) => t.id !== previousId) : themes;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export function nextLook(rand, previous = null, themes = THEMES) {
  return { theme: pickTheme(rand, previous?.theme.id, themes), seed: Math.floor(rand() * SEED_RANGE) };
}

// rand: a () => [0, 1) source; Math.random on the TV, so every session differs.
export function createLooks(rand = Math.random, themes = THEMES) {
  let current = nextLook(rand, null, themes);
  let upcoming = nextLook(rand, current, themes);
  return {
    get current() {
      return current;
    },
    get upcoming() {
      return upcoming;
    },
    advance() {
      current = upcoming;
      upcoming = nextLook(rand, current, themes);
      return current;
    },
  };
}
