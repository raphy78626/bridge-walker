import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/game/rng.js';
import { SEED_RANGE, createLooks, nextLook, pickTheme } from '../src/tv/looks.js';
import { THEMES } from '../src/tv/themes.js';

describe('pickTheme', () => {
  it('never repeats the previous theme', () => {
    const rand = mulberry32(3);
    for (const prev of THEMES) {
      for (let i = 0; i < 200; i++) expect(pickTheme(rand, prev.id).id).not.toBe(prev.id);
    }
  });

  it('reaches every other theme, the green valley included', () => {
    const rand = mulberry32(9);
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(pickTheme(rand, 'golden').id);
    expect([...seen].sort()).toEqual(['morning', 'night', 'sunset', 'valley']);
  });

  it('with no previous theme (the first level), any theme can come up', () => {
    const rand = mulberry32(11);
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(pickTheme(rand, undefined).id);
    expect(seen.size).toBe(THEMES.length);
  });

  it('copes with the edges of the random source and a single theme', () => {
    expect(THEMES).toContain(pickTheme(() => 0.9999999, 'golden'));
    expect(pickTheme(() => 0, 'golden').id).not.toBe('golden');
    expect(pickTheme(() => 0.5, 'golden', [THEMES[0]])).toBe(THEMES[0]);
  });
});

describe('looks', () => {
  it('a look is a theme and a canyon seed', () => {
    const look = nextLook(mulberry32(1));
    expect(THEMES).toContain(look.theme);
    expect(Number.isInteger(look.seed)).toBe(true);
    expect(look.seed).toBeGreaterThanOrEqual(0);
    expect(look.seed).toBeLessThan(SEED_RANGE);
  });

  it('every level gets a new theme and a new canyon, and the next one is known ahead', () => {
    const looks = createLooks(mulberry32(5));
    const seen = [looks.current];
    for (let level = 2; level <= 60; level++) {
      const ahead = looks.upcoming;
      expect(looks.advance()).toBe(ahead);
      expect(looks.current).toBe(ahead);
      expect(looks.current.theme.id).not.toBe(seen.at(-1).theme.id);
      expect(looks.upcoming.theme.id).not.toBe(looks.current.theme.id);
      seen.push(looks.current);
    }
    expect(new Set(seen.map((l) => l.seed)).size).toBe(seen.length); // a fresh canyon every level
    expect(new Set(seen.map((l) => l.theme.id)).size).toBe(THEMES.length);
  });

  it('is random per session, but the same for the same source', () => {
    const a = createLooks(mulberry32(21));
    const b = createLooks(mulberry32(21));
    const c = createLooks(mulberry32(22));
    expect(b.current).toEqual(a.current);
    expect(b.upcoming).toEqual(a.upcoming);
    expect(c.current.seed).not.toBe(a.current.seed);
  });
});
