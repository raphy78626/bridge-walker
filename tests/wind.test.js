import { describe, it, expect } from 'vitest';
import { createWind } from '../src/game/wind.js';
import { mulberry32 } from '../src/game/rng.js';

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

describe('wind.peek', () => {
  const FRAME = 1 / 60;

  it('returns the first gust, then the next once it is over', () => {
    const wind = createWind({ seed: 3, maxForce: 0.6 });
    const first = wind.peek(0);
    expect(first.start).toBeGreaterThanOrEqual(3);
    expect(first.start).toBeLessThanOrEqual(6);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(2);
    expect(Math.abs(first.strength)).toBeGreaterThanOrEqual(0.4 * 0.6);
    expect(Math.abs(first.strength)).toBeLessThanOrEqual(0.6);
    expect(wind.peek(first.start + first.length / 2)).toEqual(first);
    const second = wind.peek(first.start + first.length + 0.01);
    expect(second.start).toBeGreaterThan(first.start + first.length);
  });

  it('agrees with force: a gust is where the force is, and its sign is the force sign', () => {
    const wind = createWind({ seed: 11, maxForce: 0.9 });
    for (let t = 0; t < 90; t += FRAME) {
      const g = wind.peek(t);
      const f = wind.force(t);
      if (t > g.start + 1e-6 && t < g.start + g.length - 1e-6) {
        expect(Math.sign(f)).toBe(Math.sign(g.strength));
        expect(Math.abs(f)).toBeLessThanOrEqual(Math.abs(g.strength) + 1e-12);
      } else if (t < g.start) {
        expect(f).toBe(0);
      }
    }
  });

  it('does not change force: peeking ahead leaves the force identical', () => {
    const plain = createWind({ seed: 4, maxForce: 0.8 });
    const peeked = createWind({ seed: 4, maxForce: 0.8 });
    for (let t = 0; t < 60; t += FRAME) {
      peeked.peek(t + 25); // far ahead, then force at the real time
      peeked.peek(t);
      expect(peeked.force(t)).toBe(plain.force(t));
    }
  });

  it('keeps the same gusts as before peek existed (level-1 stream is unchanged)', () => {
    const wind = createWind({ seed: 3, maxForce: 0.25 });
    // First gust of seed 3 as the original generator drew it.
    const rand = mulberry32(3);
    const start = 3 + rand() * 3;
    const length = 1 + rand();
    const sign = rand() < 0.5 ? -1 : 1;
    const strength = sign * (0.4 + rand() * 0.6) * 0.25;
    const g = wind.peek(0);
    expect(g.start).toBeCloseTo(start, 12);
    expect(g.length).toBeCloseTo(length, 12);
    expect(g.strength).toBeCloseTo(strength, 12);
  });

  it('spaces gusts by the requested calm range', () => {
    const wind = createWind({ seed: 8, maxForce: 0.5, gustGapMin: 2, gustGapMax: 3.5 });
    let g = wind.peek(0);
    expect(g.start).toBeGreaterThanOrEqual(2);
    expect(g.start).toBeLessThanOrEqual(3.5);
    for (let i = 0; i < 30; i++) {
      const next = wind.peek(g.start + g.length + 0.001);
      const calm = next.start - (g.start + g.length);
      expect(calm).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(calm).toBeLessThanOrEqual(3.5 + 1e-9);
      g = next;
    }
  });
});

// The generator as it was before peek existed, to prove the rewrite draws the very same gusts.
function originalWind({ seed, maxForce }) {
  const rand = mulberry32(seed);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const newStrength = () => (rand() < 0.5 ? -1 : 1) * between(0.4, 1) * maxForce;
  let start = between(3, 6);
  let length = between(1, 2);
  let strength = newStrength();
  return (t) => {
    while (t > start + length) {
      start += length + between(3, 6);
      length = between(1, 2);
      strength = newStrength();
    }
    if (t < start) return 0;
    return strength * Math.sin((Math.PI * (t - start)) / length);
  };
}

describe('wind, level-1 stream', () => {
  it('has force(t) identical to the original generator', () => {
    for (const seed of [1, 2, 3, 6, 99]) {
      const old = originalWind({ seed, maxForce: 0.25 });
      const now = createWind({ seed, maxForce: 0.25 });
      for (let t = 0; t < 120; t += 1 / 60) expect(now.force(t)).toBe(old(t));
    }
  });
});
