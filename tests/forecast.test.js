import { describe, it, expect } from 'vitest';
import { createWind } from '../src/game/wind.js';
import { forecastAt, calmForecast, WIND_WARNING_S } from '../src/game/forecast.js';
import { MAX_WIND } from '../src/game/difficulty.js';

const FRAME = 1 / 60;

describe('forecastAt', () => {
  it('exports a 1.8 s warning', () => {
    expect(WIND_WARNING_S).toBe(1.8);
  });

  it('goes calm, warning, gust, calm in step with the real force', () => {
    const wind = createWind({ seed: 6, maxForce: 0.9 });
    const g = wind.peek(0);
    const end = g.start + g.length;
    const seen = [];
    for (let t = 0; t < end + 1; t += FRAME) {
      const f = forecastAt(wind, t);
      if (seen.at(-1) !== f.state) seen.push(f.state);
      if (t < g.start - WIND_WARNING_S - 0.01) expect(f.state).toBe('calm');
      if (t > g.start - WIND_WARNING_S + 0.01 && t < g.start - 0.01) expect(f.state).toBe('warning');
      if (t > g.start + 0.01 && t < end - 0.01) expect(f.state).toBe('gust');
      if (f.state === 'warning') expect(wind.force(t)).toBe(0);
      if (f.state === 'gust') expect(wind.force(t)).not.toBe(0);
    }
    expect(seen.slice(0, 4)).toEqual(['calm', 'warning', 'gust', 'calm']);
  });

  it('warns exactly WIND_WARNING_S before the gust starts', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7]) {
      const wind = createWind({ seed, maxForce: 0.5 });
      const start = wind.peek(0).start;
      expect(forecastAt(wind, start - WIND_WARNING_S).state).toBe('warning');
      expect(forecastAt(wind, start - WIND_WARNING_S - 0.001).state).toBe('calm');
      expect(forecastAt(wind, start - WIND_WARNING_S).eta).toBeCloseTo(WIND_WARNING_S, 9);
    }
  });

  it('dir is the sign of the force during the gust and 0 when calm; strength is peak over MAX_WIND', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const wind = createWind({ seed, maxForce: 0.9 });
      for (let t = 0; t < 60; t += FRAME) {
        const f = forecastAt(wind, t);
        if (f.state === 'gust' && f.remaining > 0.02 && wind.peek(t).start < t - 0.02) {
          expect(f.dir).toBe(Math.sign(wind.force(t)));
        }
        if (f.state === 'calm') {
          expect(f.dir).toBe(0);
          expect(f.strength).toBe(0);
        } else {
          expect(Math.abs(f.dir)).toBe(1);
          expect(f.strength).toBeGreaterThan(0);
          expect(f.strength).toBeLessThanOrEqual(1);
          expect(f.strength).toBeCloseTo(Math.abs(wind.peek(t).strength) / MAX_WIND, 12);
        }
      }
    }
  });

  it('clamps strength to 1', () => {
    const wind = createWind({ seed: 2, maxForce: 5 });
    for (let t = 0; t < 30; t += 0.1) expect(forecastAt(wind, t).strength).toBeLessThanOrEqual(1);
  });

  it('counts eta down to the start and remaining down to the end', () => {
    const wind = createWind({ seed: 6, maxForce: 0.6 });
    const g = wind.peek(0);
    expect(forecastAt(wind, g.start - 1).eta).toBeCloseTo(1, 9);
    expect(forecastAt(wind, g.start - 1).remaining).toBe(0);
    const mid = forecastAt(wind, g.start + g.length / 4);
    expect(mid.eta).toBe(0);
    expect(mid.remaining).toBeCloseTo((g.length * 3) / 4, 9);
    expect(forecastAt(wind, g.start + g.length + 0.001).state).toBe('calm');
  });

  it('leaves force unchanged', () => {
    const a = createWind({ seed: 5, maxForce: 0.7 });
    const b = createWind({ seed: 5, maxForce: 0.7 });
    for (let t = 0; t < 40; t += FRAME) {
      forecastAt(b, t);
      expect(b.force(t)).toBe(a.force(t));
    }
  });

  it('has a calm default', () => {
    expect(calmForecast()).toEqual({ state: 'calm', dir: 0, strength: 0, eta: Infinity, remaining: 0 });
  });
});
