import { describe, it, expect } from 'vitest';
import { createWind } from '../src/game/wind.js';

const sample = (wind, seconds) => {
  const out = [];
  for (let t = 0; t < seconds; t += 1 / 60) out.push(wind.force(t));
  return out;
};

describe('wind', () => {
  it('is calm at the start', () => {
    expect(createWind({ seed: 3 }).force(0)).toBe(0);
  });

  it('never exceeds maxForce', () => {
    for (const f of sample(createWind({ seed: 3, maxForce: 0.6 }), 120)) {
      expect(Math.abs(f)).toBeLessThanOrEqual(0.6);
    }
  });

  it('produces a gust within the first ten seconds', () => {
    const peak = Math.max(...sample(createWind({ seed: 3, maxForce: 0.6 }), 10).map(Math.abs));
    expect(peak).toBeGreaterThan(0.2);
  });

  it('is deterministic per seed', () => {
    expect(sample(createWind({ seed: 9 }), 30)).toEqual(sample(createWind({ seed: 9 }), 30));
    expect(sample(createWind({ seed: 9 }), 30)).not.toEqual(sample(createWind({ seed: 10 }), 30));
  });
});
