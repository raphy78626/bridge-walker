import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { THEMES, themeForLevel } from '../src/tv/themes.js';
import { THEME_SOUNDS } from '../src/tv/audio.js';

describe('THEMES', () => {
  it('are plain objects with a unique id and a name, in level order', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['golden', 'morning', 'sunset', 'night']);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(Object.getPrototypeOf(t)).toBe(Object.prototype);
      expect(typeof t.name).toBe('string');
    }
    expect(THEMES.find((t) => t.id === 'sunset').name).toBe('Sunset');
  });

  it('can be extended with more fields by other modules', () => {
    const extended = THEMES.map((t) => ({ ...t, sky: '#fff' }));
    expect(themeForLevel(2).id).toBe(extended[1].id);
  });
});

describe('theme visuals', () => {
  const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  it('every theme carries the data the scene reads', () => {
    for (const t of THEMES) {
      expect(t.sun.dir).toHaveLength(3);
      expect(t.sun.intensity).toBeGreaterThan(0);
      expect(t.fog.near).toBeLessThan(t.fog.far);
      expect(t.exposure).toBeGreaterThan(0);
      expect(t.rock.tint).toHaveLength(3);
      expect(t.clouds.tint).toHaveLength(3);
      expect(t.falls.tint).toHaveLength(3);
      expect(['preetham', 'night']).toContain(t.sky.kind);
    }
  });
  it('keeps the audio-facing names', () => {
    expect(THEMES.map((t) => t.name)).toEqual(['Golden Afternoon', 'Misty Morning', 'Sunset', 'Moonlit Night']);
  });
  it('morning has thicker fog, a higher cloud sea and a side sun; sunset a sun near the horizon ahead', () => {
    expect(byId.morning.fog.near).toBeLessThan(byId.golden.fog.near);
    expect(byId.morning.fog.far).toBeLessThan(byId.golden.fog.far);
    expect(byId.morning.clouds.lift).toBeGreaterThan(byId.golden.clouds.lift);
    expect(Math.abs(byId.morning.sun.dir[0])).toBeGreaterThan(0.5);
    expect(byId.sunset.sun.dir[1]).toBeLessThan(0.1);
    expect(byId.sunset.sun.dir[2]).toBeLessThan(-0.9);
  });
  it('only night shows stars and hides the birds, and its moon light is dim and cool', () => {
    expect(THEMES.filter((t) => t.stars).map((t) => t.id)).toEqual(['night']);
    expect(THEMES.filter((t) => !t.birds).map((t) => t.id)).toEqual(['night']);
    expect(byId.night.sun.intensity).toBeLessThan(byId.golden.sun.intensity);
    expect(byId.night.falls.tint[0]).toBeLessThan(byId.golden.falls.tint[0]);
  });
});

describe('themeForLevel', () => {
  it('cycles the themes by level', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13].map((l) => themeForLevel(l).id);
    expect(ids).toEqual(['golden', 'morning', 'sunset', 'night', 'golden', 'morning', 'sunset', 'night', 'golden', 'night', 'golden']);
    for (let level = 1; level <= 40; level++) expect(themeForLevel(level)).toBe(THEMES[(level - 1) % THEMES.length]);
  });

  it('treats anything that is not a level number as level 1', () => {
    for (const bad of [0, -3, NaN, undefined, null, 'x', Infinity]) expect(themeForLevel(bad)).toBe(THEMES[0]);
    expect(themeForLevel(2.9)).toBe(THEMES[1]);
  });
});

describe('theme sounds on disk', () => {
  it('every sound file a theme uses exists in public/audio', () => {
    for (const { id } of THEMES) {
      const t = THEME_SOUNDS[id];
      for (const file of [...t.layers.map((l) => l.file), ...t.calls.files]) {
        expect(existsSync(new URL(`../public/audio/${file}`, import.meta.url)), `${id}: ${file}`).toBe(true);
      }
    }
  });
});
