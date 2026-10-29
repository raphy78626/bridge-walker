import { describe, it, expect } from 'vitest';
import { stepGait, clipTimeScale, FADE, WALK_STRIDE, RUN_STRIDE } from '../src/tv/gait.js';

function settle(from, speed, seconds, dt = 1 / 50) {
  let g = from;
  for (let t = 0; t < seconds; t += dt) g = stepGait(g, speed, dt);
  return g;
}
const sum = (g) => g.idle + g.walk + g.run;

describe('gait blending', () => {
  it('settles on idle when standing, walk at walking speed, run when fast', () => {
    const idle = { idle: 1, walk: 0, run: 0 };
    expect(settle(idle, 0, 1)).toEqual(idle);
    expect(settle(idle, 1.4, 1)).toEqual({ idle: 0, walk: 1, run: 0 });
    expect(settle(idle, 2.8, 1)).toEqual({ idle: 0, walk: 0, run: 1 });
    expect(settle({ idle: 0, walk: 0, run: 1 }, 1.4, 1)).toEqual({ idle: 0, walk: 1, run: 0 });
  });

  it('crossfades in FADE seconds without popping: weights always sum to 1 and move at most 1/FADE per second', () => {
    let g = { idle: 0, walk: 1, run: 0 };
    const dt = 1 / 50;
    for (let t = 0; t < FADE + 0.1; t += dt) {
      const next = stepGait(g, 2.8, dt);
      expect(sum(next)).toBeCloseTo(1, 9);
      expect(Math.abs(next.run - g.run)).toBeLessThanOrEqual(dt / FADE + 1e-9);
      expect(Math.abs(next.walk - g.walk)).toBeLessThanOrEqual(dt / FADE + 1e-9);
      g = next;
    }
    expect(g.run).toBe(1);
  });

  it('a long frame cannot overshoot', () => {
    const g = stepGait({ idle: 1, walk: 0, run: 0 }, 2.8, 5);
    expect(g).toEqual({ idle: 0, walk: 0, run: 1 });
  });

  it('matches the clip rate to the speed, within limits', () => {
    expect(clipTimeScale(1.4, WALK_STRIDE, 1.0333, 0.6, 1.5)).toBeCloseTo(0.9976, 3); // about real time
    expect(clipTimeScale(2.8, RUN_STRIDE, 0.7, 0.7, 1.4)).toBeCloseTo(0.891, 2);
    expect(clipTimeScale(0, RUN_STRIDE, 0.7, 0.7, 1.4)).toBe(0.7);
    expect(clipTimeScale(9, RUN_STRIDE, 0.7, 0.7, 1.4)).toBe(1.4);
  });
});
