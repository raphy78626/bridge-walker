import { describe, it, expect } from 'vitest';
import { createSession, BRIDGE_LENGTH } from '../src/game/session.js';

const DT = 1 / 60;
const run = (s, seconds) => {
  for (let t = 0; t < seconds; t += DT) s.update(DT);
};

describe('pause', () => {
  it('freezes the walker, the level timer and the wind while paused', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    run(s, 1);
    s.togglePause();
    expect(s.paused).toBe(true);
    const frozen = { z: s.walker.z, time: s.time, phaseTime: s.phaseTime, forecast: { ...s.forecast } };
    run(s, 5);
    expect(s.walker.z).toBe(frozen.z);
    expect(s.time).toBe(frozen.time);
    expect(s.phaseTime).toBe(frozen.phaseTime);
    expect(s.forecast).toEqual(frozen.forecast);
  });

  it('resumes exactly where it stopped', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    run(s, 1);
    s.togglePause();
    run(s, 3);
    s.togglePause();
    expect(s.paused).toBe(false);
    const z = s.walker.z;
    run(s, 0.5);
    expect(s.walker.z).toBeGreaterThan(z);
  });

  it('only pauses during play, and a new level or run starts unpaused', () => {
    const s = createSession({ seed: 5 });
    s.togglePause(); // lobby: nothing to pause
    expect(s.paused).toBe(false);
    s.start();
    s.togglePause();
    expect(s.paused).toBe(true);
    s.start(); // ignored while playing, still paused
    expect(s.paused).toBe(true);
    s.togglePause();
    expect(s.paused).toBe(false);
  });

  it('togglePause is a no-op while falling, and after a win or game over', () => {
    const run = (s, phase) => {
      for (let t = 0; t < 300 && s.phase !== phase; t += DT) s.update(DT);
      return s.phase;
    };
    const falling = createSession({ seed: 5 });
    falling.start();
    expect(run(falling, 'falling')).toBe('falling'); // idle until a gust knocks him off
    falling.togglePause();
    expect(falling.paused).toBe(false);
    expect(falling.phase).toBe('falling');

    const won = createSession({ seed: 5 });
    won.start();
    won.walker = { ...won.walker, z: BRIDGE_LENGTH - 0.05, y: 0, vy: 0, airborne: false };
    won.input.walking = true;
    expect(run(won, 'won')).toBe('won');
    won.togglePause();
    expect(won.paused).toBe(false);
    expect(won.phase).toBe('won');

    const over = createSession({ seed: 5 });
    over.start();
    expect(run(over, 'gameover')).toBe('gameover');
    over.togglePause();
    expect(over.paused).toBe(false);
  });

  it('drops a jump pressed while paused', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.togglePause();
    s.input.jump = true;
    s.update(DT);
    expect(s.input.jump).toBe(false);
    s.togglePause();
    s.update(DT);
    expect(s.walker.airborne).toBe(false);
  });
});
