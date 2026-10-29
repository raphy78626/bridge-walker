import { describe, it, expect } from 'vitest';
import { createSession, distanceToNextGap, START_LIVES, FALL_DURATION } from '../src/game/session.js';
import { difficulty } from '../src/game/difficulty.js';
import { scoreLevel } from '../src/game/scoring.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));
const player = () => (w, s) => {
  const d = distanceToNextGap(s.gaps, w.z);
  if (!w.airborne && d > 0 && d < 0.35) s.input.jump = true;
  return steady(w);
};
function until(s, phase, maxSeconds, controller) {
  for (let t = 0; t < maxSeconds && s.phase !== phase; t += DT) {
    if (controller) s.input.tilt = controller(s.walker, s);
    s.update(DT);
  }
  return s.phase;
}
function winLevel(s) {
  s.input.walking = true;
  expect(until(s, 'won', 120, player())).toBe('won');
  s.input.walking = false;
}

describe('session scoring state', () => {
  it('starts with no falls, no score, no result and a par', () => {
    const s = createSession({ seed: 5 });
    expect(s).toMatchObject({ levelFalls: 0, runScore: 0, result: null });
    s.start();
    expect(s.parTime).toBe(difficulty(1).parTime);
    expect(s.result).toBe(null);
  });

  it('sets parTime from the level on every start()', () => {
    const s = createSession({ seed: 5 });
    s.level = 4;
    s.start();
    expect(s.parTime).toBe(difficulty(4).parTime);
  });

  it('counts a balance fall and a gap fall as falls, and a respawn does not reset them', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.walker = { ...s.walker, lean: 1.2 };
    s.update(DT);
    expect(s.fallCause).toBe('balance');
    expect(s.levelFalls).toBe(1);
    for (let t = 0; t < FALL_DURATION + 0.1; t += DT) s.update(DT);
    expect(s.phase).toBe('playing');
    expect(s.levelFalls).toBe(1);

    s.walker = { ...s.walker, z: s.gaps[0].start - 0.2 };
    s.input.walking = true;
    until(s, 'falling', 5, steady);
    expect(s.fallCause).toBe('gap');
    expect(s.levelFalls).toBe(2);
    expect(s.lives).toBe(START_LIVES - 2);
  });

  it('resets levelFalls when the next level starts', () => {
    const s = createSession({ seed: 5 });
    s.start();
    until(s, 'falling', 60); // idle: toppled by a gust
    until(s, 'playing', 5);
    expect(s.levelFalls).toBe(1);
    winLevel(s);
    expect(s.result.falls).toBe(1);
    s.start();
    expect(s.level).toBe(2);
    expect(s.levelFalls).toBe(0);
  });

  it('sets a level result when won, with this level already in runScore', () => {
    const s = createSession({ seed: 5 });
    s.start();
    winLevel(s);
    const expected = scoreLevel({ level: 1, time: s.time, falls: 0, parTime: s.parTime });
    expect(s.result).toEqual({
      kind: 'level', level: 1, time: s.time, falls: 0, ...expected, parTime: s.parTime, runScore: expected.score,
    });
    expect(s.runScore).toBe(expected.score);
  });

  it('accumulates runScore across levels, and start() clears the result', () => {
    const s = createSession({ seed: 5 });
    s.start();
    winLevel(s);
    const first = s.result.score;
    s.start();
    expect(s.result).toBe(null);
    expect(s.runScore).toBe(first);
    winLevel(s);
    expect(s.result.level).toBe(2);
    expect(s.result.score).toBeGreaterThanOrEqual(100);
    expect(s.result.runScore).toBe(first + s.result.score);
    expect(s.runScore).toBe(first + s.result.score);
  });

  it('sets a run result on game over and resets runScore only when the next run starts', () => {
    const s = createSession({ seed: 5 });
    s.start();
    winLevel(s);
    s.start(); // level 2
    const banked = s.runScore;
    expect(until(s, 'gameover', 300)).toBe('gameover'); // idle until every life is gone
    expect(s.result).toEqual({ kind: 'run', level: 2, runScore: banked });
    expect(s.runScore).toBe(banked);
    s.start();
    expect(s.level).toBe(1);
    expect(s.runScore).toBe(0);
    expect(s.result).toBe(null);
    expect(s.levelFalls).toBe(0);
  });

  it('keeps result null while playing, falling and respawning', () => {
    const s = createSession({ seed: 5 });
    s.start();
    expect(s.result).toBe(null);
    until(s, 'falling', 60);
    expect(s.result).toBe(null);
    until(s, 'playing', 5);
    expect(s.result).toBe(null);
  });

  it('still counts time for the level only while playing', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.walker = { ...s.walker, lean: 1.2 };
    s.update(DT);
    const t = s.time;
    for (let i = 0; i < 60; i++) s.update(DT);
    expect(s.time).toBe(t);
  });
});
