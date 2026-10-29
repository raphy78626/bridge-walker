import { describe, it, expect } from 'vitest';
import { createSession, FALL_DURATION } from '../src/game/session.js';
import { onBridge } from './helpers/onBridge.js';

describe('the restart after a fall is quick', () => {
  it('respawns FALL_DURATION after the fall, which is under 2 s, yet long enough to see him drop out of sight', () => {
    expect(FALL_DURATION).toBeLessThan(2);
    expect(4.9 * FALL_DURATION ** 2).toBeGreaterThan(10); // the TV drops him 4.9 t² metres (walker.js): 12.5 m by then
    const s = onBridge(createSession({ seed: 5 }));
    s.start();
    onBridge(s);
    s.walker = { ...s.walker, lean: 1.2 };
    s.update(1 / 60);
    expect(s.phase).toBe('falling');
    let t = 0;
    while (s.phase === 'falling' && t < 5) { s.update(1 / 60); t += 1 / 60; }
    expect(s.phase).toBe('playing');
    expect(t).toBeCloseTo(FALL_DURATION, 1);
  });
});
