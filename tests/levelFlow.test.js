import { describe, it, expect } from 'vitest';
import { themeForTransition, levelBanner, isLevelStart } from '../src/tv/levelFlow.js';
import { themeForLevel } from '../src/tv/themes.js';

describe('themeForTransition', () => {
  it('applies the NEXT level\'s theme when the win screen appears', () => {
    expect(themeForTransition('playing', 'won', 1).id).toBe('morning');
    expect(themeForTransition('playing', 'won', 2).id).toBe('sunset');
    expect(themeForTransition('playing', 'won', 3).id).toBe('night');
    expect(themeForTransition('playing', 'won', 4).id).toBe('golden'); // wraps round
  });

  it('applies level 1\'s theme on gameover -> start', () => {
    expect(themeForTransition('gameover', 'playing', 1)).toBe(themeForLevel(1));
  });

  it('re-states the current level\'s theme when a level starts (a no-op for the scene)', () => {
    expect(themeForTransition('won', 'playing', 2)).toBe(themeForLevel(2));
    expect(themeForTransition('lobby', 'playing', 1)).toBe(themeForLevel(1));
  });

  it('does nothing mid-play: respawns, falls, game over', () => {
    expect(themeForTransition('falling', 'playing', 3)).toBeNull();
    expect(themeForTransition('playing', 'falling', 3)).toBeNull();
    expect(themeForTransition('falling', 'gameover', 3)).toBeNull();
    expect(themeForTransition('won', 'won', 3)).toBeNull();
  });
});

describe('levelBanner', () => {
  it('names the level and its theme when a level starts', () => {
    expect(levelBanner('lobby', 'playing', 1)).toBe('Level 1 — Golden Afternoon');
    expect(levelBanner('won', 'playing', 2)).toBe('Level 2 — Misty Morning');
    expect(levelBanner('won', 'playing', 3)).toBe('Level 3 — Sunset');
    expect(levelBanner('gameover', 'playing', 1)).toBe('Level 1 — Golden Afternoon');
    expect(levelBanner('won', 'playing', 4)).toBe('Level 4 — Moonlit Night');
  });
  it('stays quiet on a respawn', () => {
    expect(levelBanner('falling', 'playing', 2)).toBeNull();
    expect(isLevelStart('playing', 'falling')).toBe(false);
  });
});
