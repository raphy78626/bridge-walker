import { describe, it, expect } from 'vitest';
import { isLevelEnd, isLevelStart, levelBanner } from '../src/tv/levelFlow.js';
import { THEMES } from '../src/tv/themes.js';

const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));

describe('isLevelEnd: when the next level\'s look goes on', () => {
  it('on the win screen, so the bake hides behind it', () => {
    expect(isLevelEnd('playing', 'won')).toBe(true);
  });

  it('on game over too (solo, a failed Wind Master level, the end of a match), so the next level has a new look', () => {
    expect(isLevelEnd('falling', 'gameover')).toBe(true);
    expect(isLevelEnd('playing', 'gameover')).toBe(true);
  });

  it('never mid-play, on a level start, or again while the panel stays up', () => {
    expect(isLevelEnd('falling', 'playing')).toBe(false);
    expect(isLevelEnd('playing', 'falling')).toBe(false);
    expect(isLevelEnd('won', 'playing')).toBe(false);
    expect(isLevelEnd('gameover', 'playing')).toBe(false);
    expect(isLevelEnd('lobby', 'playing')).toBe(false);
    expect(isLevelEnd('won', 'won')).toBe(false);
    expect(isLevelEnd('gameover', 'gameover')).toBe(false);
  });
});

describe('levelBanner', () => {
  it('names the level and the theme it starts with', () => {
    expect(levelBanner('lobby', 'playing', 1, byId.golden)).toBe('Level 1 — Golden Afternoon');
    expect(levelBanner('won', 'playing', 2, byId.valley)).toBe('Level 2 — Green Valley');
    expect(levelBanner('won', 'playing', 3, byId.sunset)).toBe('Level 3 — Sunset');
    expect(levelBanner('gameover', 'playing', 1, byId.night)).toBe('Level 1 — Moonlit Night');
  });
  it('stays quiet on a respawn', () => {
    expect(levelBanner('falling', 'playing', 2, byId.morning)).toBeNull();
    expect(isLevelStart('playing', 'falling')).toBe(false);
  });
});
