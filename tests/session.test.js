import { describe, it, expect } from 'vitest';
import {
  createSession,
  distanceToNextGap,
  BRIDGE_LENGTH,
  START_LIVES,
  FALL_DURATION,
} from '../src/game/session.js';
import { JUMP_FORWARD, JUMP_VY, GRAVITY_ACCEL, RUN_SPEED } from '../src/game/balance.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));
const AIRTIME = (2 * JUMP_VY) / GRAVITY_ACCEL;
const STAND_JUMP = JUMP_FORWARD * AIRTIME; // ~1.96 m

// The scripted player: balances like `steady`, and jumps when a gap is 0 < d < 0.35 m ahead and he is on the ground.
const player = () => (w, s) => {
  const d = distanceToNextGap(s.gaps, w.z);
  if (!w.airborne && d > 0 && d < 0.35) s.input.jump = true;
  return steady(w);
};

function advance(s, seconds, controller) {
  for (let t = 0; t < seconds; t += DT) {
    if (controller) s.input.tilt = controller(s.walker, s);
    s.update(DT);
  }
}
function until(s, phase, maxSeconds, controller) {
  for (let t = 0; t < maxSeconds && s.phase !== phase; t += DT) {
    if (controller) s.input.tilt = controller(s.walker, s);
    s.update(DT);
  }
  return s.phase;
}

describe('session', () => {
  it('waits in the lobby until START', () => {
    const s = createSession({ seed: 5 });
    advance(s, 5);
    expect(s.phase).toBe('lobby');
    expect(s.time).toBe(0);
  });

  it('loses a life on a fall, then respawns at the same spot', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    advance(s, 3, steady);
    s.input.walking = false;
    s.input.tilt = 0;
    expect(until(s, 'falling', 60)).toBe('falling');
    expect(s.lives).toBe(START_LIVES - 1);
    const z = s.walker.z;
    expect(z).toBeGreaterThan(0);
    expect(until(s, 'playing', 5)).toBe('playing');
    expect(s.walker.lean).toBe(0);
    expect(s.walker.z).toBe(z);
    expect(s.fallCause).toBe(null);
  });

  it('a balance fall sets fallCause to balance', () => {
    const s = createSession({ seed: 5 });
    expect(s.fallCause).toBe(null);
    s.start();
    until(s, 'falling', 60);
    expect(s.fallCause).toBe('balance');
  });

  it('ends the game after the last life', () => {
    const s = createSession({ seed: 5 });
    s.start();
    expect(until(s, 'gameover', 300)).toBe('gameover');
    expect(s.lives).toBe(0);
  });

  it('reaches the far side with steady balance', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    expect(until(s, 'won', 120, player())).toBe('won');
    expect(s.walker.z).toBeGreaterThanOrEqual(BRIDGE_LENGTH);
    expect(s.lives).toBe(START_LIVES);
  });

  it('START after a win goes to the next level and keeps lives', () => {
    const s = createSession({ seed: 5 });
    s.start();
    until(s, 'falling', 60); // idle until a gust knocks the walker off
    until(s, 'playing', 5);
    expect(s.lives).toBe(START_LIVES - 1);
    s.input.walking = true;
    expect(until(s, 'won', 120, player())).toBe('won');
    s.start();
    expect(s.phase).toBe('playing');
    expect(s.level).toBe(2);
    expect(s.walker.z).toBe(0);
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it('START after game over resets level and lives', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    until(s, 'won', 120, player());
    s.start(); // level 2
    s.input.walking = false;
    s.input.tilt = 0;
    expect(until(s, 'gameover', 300)).toBe('gameover');
    s.start();
    expect(s.phase).toBe('playing');
    expect(s.level).toBe(1);
    expect(s.lives).toBe(START_LIVES);
  });

  it('ignores START while playing', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    advance(s, 1, steady);
    const z = s.walker.z;
    s.start();
    expect(s.walker.z).toBe(z);
  });

  it('ignores START while falling', () => {
    const s = createSession({ seed: 5 });
    s.start();
    until(s, 'falling', 60);
    s.start();
    expect(s.phase).toBe('falling');
    expect(s.walker.fallen).toBe(true);
  });

  it('plays the fall for FALL_DURATION before respawning', () => {
    const s = createSession({ seed: 5 });
    s.start();
    until(s, 'falling', 60);
    advance(s, FALL_DURATION - 0.1);
    expect(s.phase).toBe('falling');
    advance(s, 0.2);
    expect(s.phase).toBe('playing');
  });

  it('caps wind so high levels stay winnable', () => {
    const s = createSession({ seed: 5 });
    s.level = 20;
    s.start();
    s.input.walking = true;
    expect(until(s, 'won', 120, player())).toBe('won'); // 1.2 m gaps at level 20
  });
});

const gapsFor = (seed, level) => {
  const s = createSession({ seed });
  s.level = level;
  s.start();
  return s.gaps;
};

describe('gaps', () => {
  it('is deterministic for a seed and differs between seeds and levels', () => {
    expect(gapsFor(5, 3)).toEqual(gapsFor(5, 3));
    expect(gapsFor(5, 3)).not.toEqual(gapsFor(6, 3));
    expect(gapsFor(5, 3)).not.toEqual(gapsFor(5, 2).slice(0, 5));
  });

  it('winning in mid-air lands him: no hover on the win screen, no stray thud next level', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.walker = { ...s.walker, z: BRIDGE_LENGTH - 0.05, y: 0.3, vy: 1, airborne: true, speed: 3 };
    expect(until(s, 'won', 2)).toBe('won');
    expect(s.walker).toMatchObject({ y: 0, vy: 0, airborne: false, speed: 0 });
  });

  it('has min(2 + level, 7) gaps, capped to however many keep 6 m between them', () => {
    expect(gapsFor(5, 1)).toHaveLength(3);
    expect(gapsFor(5, 2)).toHaveLength(4);
    expect(gapsFor(5, 4)).toHaveLength(6);
    expect(gapsFor(5, 5)).toHaveLength(7);
    expect(gapsFor(5, 20)).toHaveLength(7); // 8 gaps of 1.25 m with 6 m between do not fit in 8..55
  });

  it('sizes each gap at min(0.9 + 0.1 * level, 1.25), always below a standing jump', () => {
    for (const [level, len] of [[1, 1.0], [2, 1.1], [3, 1.2], [4, 1.25], [9, 1.25]]) {
      for (const g of gapsFor(5, level)) {
        expect(g.end - g.start).toBeCloseTo(len, 6);
        expect(STAND_JUMP - (g.end - g.start)).toBeGreaterThanOrEqual(0.7);
      }
    }
  });

  it('keeps starts within 8..BRIDGE_LENGTH-5, sorted, with at least 6 m between gaps', () => {
    for (const seed of [1, 2, 3, 5, 99, 12345]) {
      for (let level = 1; level <= 12; level++) {
        const gaps = gapsFor(seed, level);
        expect(gaps[0].start).toBeGreaterThanOrEqual(8);
        expect(gaps.at(-1).start).toBeLessThanOrEqual(BRIDGE_LENGTH - 5);
        for (let i = 1; i < gaps.length; i++) {
          expect(gaps[i].start - gaps[i - 1].end).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });

  it('creates a new array on every start() that begins a level', () => {
    const s = createSession({ seed: 5 });
    s.start();
    const first = s.gaps;
    s.input.walking = true;
    until(s, 'won', 120, player());
    s.start();
    expect(s.gaps).not.toBe(first);
    expect(s.level).toBe(2);
    expect(s.gaps).toHaveLength(4);
    s.start(); // ignored while playing: no new level, same array
    const second = s.gaps;
    s.start();
    expect(s.gaps).toBe(second);
  });

  it('keeps the same array through a respawn', () => {
    const s = createSession({ seed: 5 });
    s.start();
    const gaps = s.gaps;
    until(s, 'falling', 60);
    until(s, 'playing', 5);
    expect(s.gaps).toBe(gaps);
  });
});

describe('distanceToNextGap', () => {
  const gaps = [{ start: 10, end: 11 }, { start: 20, end: 21 }];
  it('measures to the start of the next gap ahead', () => {
    expect(distanceToNextGap(gaps, 0)).toBe(10);
    expect(distanceToNextGap(gaps, 9.5)).toBeCloseTo(0.5, 9);
    expect(distanceToNextGap(gaps, 11)).toBe(9);
  });
  it('skips a gap whose start is not strictly ahead', () => {
    expect(distanceToNextGap(gaps, 10)).toBe(10);
    expect(distanceToNextGap(gaps, 10.5)).toBeCloseTo(9.5, 9);
  });
  it('is Infinity with no gap ahead', () => {
    expect(distanceToNextGap(gaps, 20)).toBe(Infinity);
    expect(distanceToNextGap(gaps, 50)).toBe(Infinity);
    expect(distanceToNextGap([], 0)).toBe(Infinity);
  });
});

describe('crossing gaps', () => {
  // Start a level-1 session with the walker placed `before` metres ahead of the first gap.
  function setup(before, level = 1) {
    const s = createSession({ seed: 5 });
    s.level = level;
    s.start();
    const gap = s.gaps[0];
    s.walker = { ...s.walker, z: gap.start - before };
    return { s, gap };
  }

  it('walking into a gap costs a life with fallCause gap', () => {
    const { s, gap } = setup(0.5);
    s.input.walking = true;
    expect(until(s, 'falling', 5, steady)).toBe('falling');
    expect(s.lives).toBe(START_LIVES - 1);
    expect(s.fallCause).toBe('gap');
    expect(s.walker.fallen).toBe(true);
    expect(s.walker.z).toBeGreaterThan(gap.start);
    expect(s.walker.z).toBeLessThan(gap.end);
    expect(s.walker.y).toBe(0);
  });

  it('plays a gap fall for FALL_DURATION, then respawns 1.5 m before the gap, fresh', () => {
    const { s, gap } = setup(0.5);
    s.input.walking = true;
    until(s, 'falling', 5, steady);
    s.input.walking = false;
    advance(s, FALL_DURATION - 0.1);
    expect(s.phase).toBe('falling');
    expect(until(s, 'playing', 1)).toBe('playing'); // stops on the respawning frame
    expect(s.walker.z).toBeCloseTo(gap.start - 1.5, 9);
    expect(s.walker).toMatchObject({ lean: 0, leanVel: 0, y: 0, vy: 0, airborne: false, fallen: false });
    expect(s.fallCause).toBe(null);
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it('the last life lost in a gap is game over', () => {
    const { s } = setup(0.5);
    s.lives = 1;
    s.input.walking = true;
    until(s, 'falling', 5, steady);
    expect(s.lives).toBe(0);
    expect(until(s, 'gameover', 5)).toBe('gameover');
  });

  it('a jump started 0.3 m before a gap clears it', () => {
    for (const level of [1, 2, 3, 4, 20]) {
      const { s, gap } = setup(0.3, level);
      s.input.walking = true;
      s.input.jump = true;
      s.input.tilt = 0;
      for (let i = 0; i < 60; i++) {
        s.update(DT);
        s.input.tilt = steady(s.walker);
        expect(s.phase).toBe('playing');
      }
      expect(s.walker.z).toBeGreaterThan(gap.end);
      expect(s.walker.airborne).toBe(false);
      expect(s.lives).toBe(START_LIVES);
    }
  });

  it('a running jump clears a gap from further back', () => {
    const { s, gap } = setup(0.5, 4); // 1.2 m gap
    s.input.running = true;
    s.input.jump = true;
    for (let i = 0; i < 60; i++) {
      s.update(DT);
      s.input.tilt = steady(s.walker);
    }
    expect(s.phase).toBe('playing');
    expect(s.walker.z).toBeGreaterThan(gap.end);
  });

  it('a jump that lands inside the gap falls through it', () => {
    const { s, gap } = setup(1.2);
    s.input.walking = true;
    s.input.jump = true; // takes off 1.2 m before a 1.0 m gap and lands 0.76 m inside it
    expect(until(s, 'falling', 3, steady)).toBe('falling');
    expect(s.fallCause).toBe('gap');
    expect(s.walker.z).toBeGreaterThan(gap.start);
    expect(s.walker.z).toBeLessThan(gap.end);
  });

  it('a gap is not a fall while the walker is airborne over it', () => {
    const { s, gap } = setup(0.3);
    s.input.walking = true;
    s.input.jump = true;
    let overGap = false;
    for (let i = 0; i < 60; i++) {
      s.update(DT);
      s.input.tilt = steady(s.walker);
      if (s.walker.z > gap.start && s.walker.z < gap.end) {
        overGap = true;
        expect(s.walker.airborne).toBe(true);
      }
    }
    expect(overGap).toBe(true);
  });

  it('a balance fall in the air above a gap respawns before that gap, not inside it', () => {
    const { s, gap } = setup(0);
    s.walker = { ...s.walker, z: gap.start + 0.5, airborne: true, y: 0.3, vy: 0, speed: 2.4, lean: 0.99, leanVel: 2 };
    s.update(DT);
    expect(s.phase).toBe('falling');
    expect(s.fallCause).toBe('balance');
    advance(s, FALL_DURATION + 0.1);
    expect(s.phase).toBe('playing');
    expect(s.walker.z).toBeCloseTo(gap.start - 1.5, 9);
  });

  it('a balance fall respawns at the same z (outside gaps)', () => {
    const { s } = setup(3);
    s.walker = { ...s.walker, lean: 1.2 };
    s.update(DT);
    const z = s.walker.z;
    expect(s.fallCause).toBe('balance');
    advance(s, FALL_DURATION + 0.1);
    expect(s.walker.z).toBe(z);
  });
});

describe('input flags', () => {
  it('consumes the jump flag on the next update, whether or not a jump could happen', () => {
    const s = createSession({ seed: 5 });
    s.input.jump = true;
    s.update(DT); // lobby: no jump possible
    expect(s.input.jump).toBe(false);

    s.start();
    s.input.jump = true;
    s.update(DT);
    expect(s.input.jump).toBe(false);
    expect(s.walker.airborne).toBe(true);

    s.input.jump = true; // mid-air: ignored but still consumed
    const vy = s.walker.vy;
    s.update(DT);
    expect(s.input.jump).toBe(false);
    expect(s.walker.vy).toBeLessThan(vy);
  });

  it('consumes a jump pressed while falling and does not jump on respawn', () => {
    const s = createSession({ seed: 5 });
    s.start();
    until(s, 'falling', 60);
    s.input.jump = true;
    s.update(DT);
    expect(s.input.jump).toBe(false);
    until(s, 'playing', 5);
    expect(s.walker.airborne).toBe(false);
  });

  it('running overrides walking for speed', () => {
    const s = createSession({ seed: 5 });
    s.start();
    s.input.walking = true;
    s.input.running = true;
    s.update(DT);
    expect(s.walker.speed).toBe(RUN_SPEED);
  });

  it('starts every level with a ground walker and no fall cause', () => {
    const s = createSession({ seed: 5 });
    s.start();
    expect(s.fallCause).toBe(null);
    expect(s.walker).toMatchObject({ y: 0, vy: 0, airborne: false, speed: 0 });
    expect(s.input).toEqual({ tilt: 0, walking: false, running: false, jump: false });
  });
});
