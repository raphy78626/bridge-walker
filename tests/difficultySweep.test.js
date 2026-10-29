import { describe, it, expect } from 'vitest';
import { createSession, distanceToNextGap } from '../src/game/session.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));

// The scripted steady player: balances, walks, and jumps when a gap is 0 < d < 0.35 m ahead.
function clear(seed, level) {
  const s = createSession({ seed });
  s.level = level;
  s.start();
  s.input.walking = true;
  for (let t = 0; t < 150 && s.phase !== 'won' && s.phase !== 'gameover'; t += DT) {
    const d = distanceToNextGap(s.gaps, s.walker.z);
    if (!s.walker.airborne && d > 0 && d < 0.35) s.input.jump = true;
    s.input.tilt = steady(s.walker);
    s.update(DT);
  }
  return s;
}

describe('a steady player on the difficulty ramp', () => {
  it('clears levels 1-8 on 40 seeds, without losing a life', () => {
    for (let level = 1; level <= 8; level++) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = clear(seed, level);
        expect(s.phase, `seed ${seed} level ${level}`).toBe('won');
        expect(s.levelFalls, `seed ${seed} level ${level}`).toBe(0);
      }
    }
  });

  it('walking alone is too slow for three stars on any level', () => {
    for (let level = 1; level <= 8; level++) {
      for (let seed = 1; seed <= 5; seed++) {
        const s = clear(seed, level);
        expect(s.result.stars).toBe(2);
        expect(s.time).toBeGreaterThan(s.parTime);
      }
    }
  });
});
