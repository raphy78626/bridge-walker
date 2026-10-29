import { describe, it, expect } from 'vitest';
import { LANE_X, RACE_BRIDGES, nextRaceView, isRaceView, sharedFocus, sharedFocusShell, SHARED_CAM, windSessionOf, walkerPhaseOf } from '../src/tv/raceView.js';

const focus = (z, x) => ({ w: { z }, x });
const sess = (state, dir = 1, strength = 0.6, extra = {}) => ({ forecast: { state, dir, strength, eta: 1, remaining: 2 }, ...extra });

describe('race lanes', () => {
  it('puts the two bridges 2.4 m apart, centred on the old single bridge, player 1 on the left', () => {
    expect(LANE_X[2] - LANE_X[1]).toBeCloseTo(2.4);
    expect(LANE_X[1] + LANE_X[2]).toBe(0);
    expect(RACE_BRIDGES).toEqual([-1.2, 1.2]);
  });
});

describe('race camera views', () => {
  it('cycles shared -> p1 -> p2 -> shared, and unknown counts as shared', () => {
    expect(nextRaceView('shared')).toBe('p1');
    expect(nextRaceView('p1')).toBe('p2');
    expect(nextRaceView('p2')).toBe('shared');
    expect(nextRaceView('pov')).toBe('p1');
    expect(isRaceView('p2')).toBe(true);
    expect(isRaceView('cinematic')).toBe(false);
  });
});

describe('shared camera focus', () => {
  it('sits at the midpoint of the two walkers, on the midline between their bridges', () => {
    const out = sharedFocus(sharedFocusShell(), focus(10, LANE_X[1]), focus(30, LANE_X[2]));
    expect(out.w.z).toBe(20);
    expect(out.x).toBe(0);
    expect(out.position.z).toBe(-20);
  });

  it('is the walker himself when both stand together at the start', () => {
    const out = sharedFocus(sharedFocusShell(), focus(0, LANE_X[1]), focus(0, LANE_X[2]));
    expect(out.w.z).toBe(0);
    expect(out).toMatchObject({ back: SHARED_CAM.back, up: SHARED_CAM.up, aim: SHARED_CAM.aim });
  });

  it('pulls back and up as they spread, so the one further behind stays in front of the lens', () => {
    const near = sharedFocus(sharedFocusShell(), focus(20, LANE_X[1]), focus(22, LANE_X[2]));
    const far = sharedFocus(sharedFocusShell(), focus(10, LANE_X[1]), focus(40, LANE_X[2]));
    expect(far.back).toBeGreaterThan(near.back);
    expect(far.up).toBeGreaterThan(near.up);
    // the camera ends up behind the laggard by at least a few metres, whatever the lead
    for (const gap of [0, 5, 30, 60]) {
      const f = sharedFocus(sharedFocusShell(), focus(0, LANE_X[1]), focus(gap, LANE_X[2]));
      const cameraBehindMid = f.back;
      expect(cameraBehindMid - gap / 2).toBeGreaterThanOrEqual(SHARED_CAM.back - 0.01);
    }
  });

  it('never rises past the cap', () => {
    expect(sharedFocus(sharedFocusShell(), focus(0, 0), focus(60, 0)).up).toBeLessThanOrEqual(SHARED_CAM.maxUp);
  });

  it('is the same object every call: a frame allocates nothing', () => {
    const shell = sharedFocusShell();
    expect(sharedFocus(shell, focus(1, 0), focus(2, 0))).toBe(shell);
  });
});

describe('which session the wind follows', () => {
  const calm = sess('calm', 0, 0);
  it('the followed racer in a follow view', () => {
    const s = { 1: sess('gust'), 2: calm };
    expect(windSessionOf(s, 'p1')).toBe(s[1]);
    expect(windSessionOf(s, 'p2')).toBe(s[2]);
  });
  it('the shared view takes whoever has the stronger wind, player 1 on a tie', () => {
    const s = { 1: sess('warning'), 2: sess('gust') };
    expect(windSessionOf(s, 'shared')).toBe(s[2]);
    expect(windSessionOf({ 1: calm, 2: calm }, 'shared')).toBeDefined();
    const tie = { 1: sess('gust'), 2: sess('gust') };
    expect(windSessionOf(tie, 'shared')).toBe(tie[1]);
  });
  it('a lone session (solo, windmaster) is always session 1', () => {
    const s = { 1: sess('gust') };
    expect(windSessionOf(s, 'shared')).toBe(s[1]);
    expect(windSessionOf(s, 'p2')).toBe(s[1]);
  });
});

describe('walker phase for drawing', () => {
  it('a halted racer is drawn standing, not walking on the spot', () => {
    expect(walkerPhaseOf({ phase: 'playing', halted: true })).toBe('halted');
    expect(walkerPhaseOf({ phase: 'playing', halted: false })).toBe('playing');
    expect(walkerPhaseOf({ phase: 'won', halted: false })).toBe('won');
    expect(walkerPhaseOf({ phase: 'falling', halted: true })).toBe('falling');
  });
});
