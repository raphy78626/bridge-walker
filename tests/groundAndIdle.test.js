import { describe, it, expect } from 'vitest';
import { createSession, START_Z, IDLE_GRACE, BRIDGE_LENGTH } from '../src/game/session.js';
import { createWalker, stepWalker, FALL_ANGLE } from '../src/game/balance.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));
function run(s, seconds, each) {
  for (let t = 0; t < seconds; t += DT) {
    if (each) each(s);
    s.update(DT);
  }
}
function walkOnto(s, z) {
  s.input.walking = true;
  for (let t = 0; t < 30 && s.walker.z < z; t += DT) {
    s.input.tilt = steady(s.walker);
    s.update(DT);
  }
  s.input.walking = false;
}

describe('solid ground (balance)', () => {
  it('never falls on the ground, whatever the wind and lean', () => {
    let w = { ...createWalker(), lean: 0.9, leanVel: 2 };
    for (let i = 0; i < 600; i++) w = stepWalker(w, { tilt: 0, walking: false, wind: 1.2, ground: true }, DT);
    expect(w.fallen).toBe(false);
    expect(Math.abs(w.lean)).toBeLessThan(0.05); // he steadies himself back upright
  });

  it('still walks, runs and jumps on the ground', () => {
    let w = createWalker();
    w = stepWalker(w, { tilt: 0, walking: true, wind: 0, ground: true }, 1);
    expect(w.z).toBeCloseTo(1.4, 5);
    w = stepWalker(w, { tilt: 0, walking: false, jump: true, wind: 0, ground: true }, DT);
    expect(w.airborne).toBe(true);
  });

  it('the bridge is unchanged: a small lean still grows into a fall', () => {
    let w = { ...createWalker(), lean: 0.2 };
    for (let i = 0; i < 1200 && !w.fallen; i++) w = stepWalker(w, { tilt: 0, walking: false, wind: 0 }, DT);
    expect(w.fallen).toBe(true);
    expect(Math.abs(w.lean)).toBeGreaterThan(FALL_ANGLE);
  });
});

describe('each level starts on the rock ledge', () => {
  it('starts before the bridge, with the timer waiting until he steps on', () => {
    const s = createSession({ seed: 5 });
    s.start();
    expect(START_Z).toBeLessThan(0);
    expect(s.walker.z).toBe(START_Z);
    run(s, 30); // standing on the ledge for half a minute
    expect(s.phase).toBe('playing');
    expect(s.time).toBe(0);
    expect(s.idleTime).toBe(0);
  });

  it('starts the timer once he is on the bridge', () => {
    const s = createSession({ seed: 5 });
    s.start();
    walkOnto(s, 1);
    expect(s.time).toBeGreaterThan(0);
    expect(s.time).toBeLessThan(1.5);
  });
});

describe('keep moving on the bridge', () => {
  it('standing still on the bridge ends in a fall even with perfect balance', () => {
    const s = createSession({ seed: 5 });
    s.start();
    walkOnto(s, 3);
    let stood = 0;
    for (; stood < 20 && s.phase === 'playing'; stood += DT) {
      s.input.tilt = steady(s.walker);
      s.update(DT);
    }
    expect(s.phase).toBe('falling');
    expect(s.fallCause).toBe('balance');
    expect(stood).toBeGreaterThan(IDLE_GRACE); // a short grace to catch your breath
    expect(stood).toBeLessThan(IDLE_GRACE + 6);
  });

  it('counts how long he has stood still, and resets when he moves', () => {
    const s = createSession({ seed: 5 });
    s.start();
    walkOnto(s, 3);
    run(s, 1, (x) => (x.input.tilt = steady(x.walker)));
    expect(s.idleTime).toBeGreaterThan(0.9);
    s.input.walking = true;
    run(s, 0.1, (x) => (x.input.tilt = steady(x.walker)));
    expect(s.idleTime).toBe(0);
  });

  it('a steady player who keeps moving crosses without falling', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    for (let t = 0; t < 90 && s.phase === 'playing'; t += DT) {
      s.input.tilt = steady(s.walker);
      const gap = s.gaps.find((g) => g.start > s.walker.z);
      if (gap && gap.start - s.walker.z < 0.35 && !s.walker.airborne) s.input.jump = true;
      s.update(DT);
    }
    expect(s.phase).toBe('won');
    expect(s.levelFalls).toBe(0);
    expect(s.walker.z).toBeGreaterThanOrEqual(BRIDGE_LENGTH);
  });

  it('a respawned walker starts a fresh grace period', () => {
    const s = createSession({ seed: 5 });
    s.start();
    walkOnto(s, 3);
    for (let t = 0; t < 20 && s.phase === 'playing'; t += DT) s.update(DT);
    expect(s.phase).toBe('falling');
    for (let t = 0; t < 5 && s.phase !== 'playing'; t += DT) s.update(DT);
    expect(s.phase).toBe('playing');
    expect(s.idleTime).toBe(0);
  });
});
