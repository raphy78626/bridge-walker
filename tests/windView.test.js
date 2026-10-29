import { describe, it, expect } from 'vitest';
import { createWindView } from '../src/tv/windView.js';
import { streakOpacity, windSway } from '../src/tv/windFx.js';

const gust = (dir) => ({ forecast: { state: 'gust', dir, strength: 1, eta: 0, remaining: 2 } });
const run = (view, s, seconds, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) view.update(s, dt);
};

describe('wind view', () => {
  it('starts calm', () => {
    const v = createWindView();
    expect([v.opacity, v.speed, v.sway]).toEqual([0, 0, 0]);
  });

  it('eases toward a gust, and back to nothing when it is over', () => {
    const v = createWindView();
    v.update(gust(1), 0.05);
    expect(v.opacity).toBeGreaterThan(0);
    expect(v.opacity).toBeLessThan(streakOpacity(gust(1).forecast)); // eased, not jumped
    run(v, gust(1), 3);
    expect(v.opacity).toBeCloseTo(streakOpacity(gust(1).forecast), 2);
    expect(v.sway).toBeCloseTo(windSway(gust(1).forecast), 2);
    run(v, {}, 5); // no forecast reads as calm
    expect(v.opacity).toBeCloseTo(0, 2);
    expect(v.sway).toBeCloseTo(0, 2);
  });

  it('holds still when no time passes (a pause)', () => {
    const v = createWindView();
    run(v, gust(1), 1);
    const before = { ...v };
    v.update({}, 0);
    expect(v.opacity).toBe(before.opacity);
    expect(v.sway).toBe(before.sway);
  });

  it('remembers the last gust direction while the streaks fade out', () => {
    const v = createWindView();
    expect(v.dir).toBe(1);
    v.update(gust(-1), 0.05);
    expect(v.dir).toBe(-1);
    run(v, {}, 1);
    expect(v.dir).toBe(-1);
    v.update(gust(1), 0.05);
    expect(v.dir).toBe(1);
  });
});
