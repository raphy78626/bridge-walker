import { describe, it, expect } from 'vitest';
import { createSession, WIND_WARNING_S, START_LIVES } from '../src/game/session.js';
import { createWind } from '../src/game/wind.js';
import { difficulty } from '../src/game/difficulty.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));
const CALM = { state: 'calm', dir: 0, strength: 0, eta: Infinity, remaining: 0 };

// The same wind the session builds for a seed and level, to compare the forecast against.
const windFor = (seed, level) => {
  const d = difficulty(level);
  return createWind({ seed: seed + level, maxForce: d.maxWind, gustGapMin: d.gustGapMin, gustGapMax: d.gustGapMax });
};

describe('session.forecast', () => {
  it('is calm before the game starts, and nothing happens while in the lobby', () => {
    const s = createSession({ seed: 5 });
    expect(s.forecast).toEqual(CALM);
    for (let i = 0; i < 600; i++) s.update(DT);
    expect(s.forecast).toEqual(CALM);
  });

  it('exports a 1.8 s warning', () => {
    expect(WIND_WARNING_S).toBe(1.8);
  });

  it('is calm (with the first gust still ahead) right after start()', () => {
    const s = createSession({ seed: 5 });
    s.start();
    expect(s.forecast.state).toBe('calm');
    expect(s.forecast.dir).toBe(0);
    expect(s.forecast.eta).toBeGreaterThan(WIND_WARNING_S);
    expect(s.forecast.remaining).toBe(0);
  });

  it('goes calm, warning, gust, calm in step with the real force', () => {
    for (const level of [1, 3, 6]) {
      const s = createSession({ seed: 5 });
      s.level = level;
      s.start();
      const wind = windFor(5, level);
      const gust = wind.peek(0);
      const end = gust.start + gust.length;
      const states = [];
      let prevEta = Infinity;
      let warnedAt = null;
      for (let i = 0; i < 60 * (end + 1); i++) {
        s.input.tilt = steady(s.walker);
        s.update(DT);
        const f = s.forecast;
        if (states.at(-1) !== f.state) states.push(f.state);
        if (f.state === 'warning' && warnedAt === null) {
          warnedAt = s.time;
          expect(f.eta).toBeLessThanOrEqual(WIND_WARNING_S + 1e-9);
          expect(prevEta).toBeGreaterThan(WIND_WARNING_S);
          expect(s.time + f.eta).toBeCloseTo(gust.start, 9);
        }
        if (f.state === 'gust') expect(wind.force(s.time)).not.toBe(0);
        if (f.state === 'warning' || f.state === 'calm') expect(wind.force(s.time)).toBe(0);
        prevEta = f.eta;
      }
      expect(states).toEqual(['calm', 'warning', 'gust', 'calm']);
      // The first frame at or inside the 1.8 s window, so at most one frame late.
      expect(gust.start - warnedAt).toBeLessThanOrEqual(WIND_WARNING_S + 1e-9);
      expect(gust.start - warnedAt).toBeGreaterThan(WIND_WARNING_S - DT - 1e-9);
    }
  });

  it('gives dir as the sign of the force and strength relative to MAX_WIND', () => {
    const s = createSession({ seed: 7 });
    s.level = 5;
    s.start();
    const wind = windFor(7, 5);
    let gustFrames = 0;
    for (let i = 0; i < 60 * 40; i++) {
      s.input.tilt = steady(s.walker);
      s.update(DT);
      if (s.phase !== 'playing') break;
      const f = s.forecast;
      if (f.state === 'gust' && f.remaining > 0.05 && f.remaining < wind.peek(s.time).length - 0.05) {
        gustFrames++;
        expect(f.dir).toBe(Math.sign(wind.force(s.time)));
        expect(f.eta).toBe(0);
        expect(f.remaining).toBeGreaterThan(0);
        expect(f.strength).toBeGreaterThan(0);
        expect(f.strength).toBeLessThanOrEqual(1);
      }
      if (f.state === 'warning') {
        expect(f.dir).toBe(Math.sign(wind.peek(s.time).strength));
        expect(f.remaining).toBe(0);
      }
    }
    expect(gustFrames).toBeGreaterThan(30);
  });

  it('is calm while falling, then forecasts again after the respawn', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.walker = { ...s.walker, lean: 1.2 };
    s.update(DT);
    expect(s.phase).toBe('falling');
    expect(s.forecast).toEqual(CALM);
    for (let i = 0; i < 60 * 2.6; i++) s.update(DT);
    expect(s.phase).toBe('playing');
    expect(s.forecast.eta).toBeLessThan(Infinity);
    expect(s.forecast.eta).toBeGreaterThanOrEqual(0);
  });

  it('is calm on the win screen and on game over, and reset by the next start()', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.walker = { ...s.walker, z: 59.99 };
    s.input.walking = true;
    for (let i = 0; i < 10 && s.phase === 'playing'; i++) s.update(DT);
    expect(s.phase).toBe('won');
    expect(s.forecast).toEqual(CALM);
    s.start();
    expect(s.forecast.state).toBe('calm');
    expect(s.forecast.eta).toBeGreaterThan(0);

    s.lives = 1;
    s.walker = { ...s.walker, lean: 1.2 };
    s.update(DT);
    for (let i = 0; i < 60 * 3 && s.phase !== 'gameover'; i++) s.update(DT);
    expect(s.phase).toBe('gameover');
    expect(s.forecast).toEqual(CALM);
    expect(s.lives).toBe(0);
    s.start();
    expect(s.phase).toBe('playing');
    expect(s.lives).toBe(START_LIVES);
    expect(s.forecast.state).toBe('calm');
  });
});
