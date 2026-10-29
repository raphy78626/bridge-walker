import { describe, it, expect } from 'vitest';
import {
  CALM,
  WIND_OFF,
  GUST_WHOOSH_MIN_ETA,
  createGustTrigger,
  easeToward,
  forecastOf,
  streakOpacity,
  streakSpeed,
  strengthLevel,
  warningProgress,
  windIndicator,
  windRamp,
  windSway,
  STREAK_MAX_OPACITY,
} from '../src/tv/windFx.js';
import { WIND_WARNING_S } from '../src/game/forecast.js';

const warn = (dir, strength, eta = 1.8) => ({ state: 'warning', dir, strength, eta, remaining: eta + 1 });
const gust = (dir, strength) => ({ state: 'gust', dir, strength, eta: 0, remaining: 1 });

describe('forecastOf', () => {
  it('treats a session without a forecast as calm', () => {
    expect(forecastOf({})).toBe(CALM);
    expect(forecastOf(undefined)).toBe(CALM);
    expect(forecastOf({ forecast: null })).toBe(CALM);
    const f = warn(1, 0.5);
    expect(forecastOf({ forecast: f })).toBe(f);
  });
});

describe('wind indicator state', () => {
  it('is hidden when calm, with dir 0, or with no forecast', () => {
    expect(windIndicator(undefined)).toBe(WIND_OFF);
    expect(windIndicator(CALM)).toBe(WIND_OFF);
    expect(windIndicator({ state: 'warning', dir: 0, strength: 1 })).toBe(WIND_OFF);
    expect(windIndicator({ state: 'bogus', dir: 1, strength: 1 })).toBe(WIND_OFF);
    expect(WIND_OFF.visible).toBe(false);
  });

  it('sits on the side the wind comes FROM: dir +1 blows left to right, so it shows at the left', () => {
    expect(windIndicator(warn(1, 0.5))).toMatchObject({ visible: true, state: 'warning', from: 'left' });
    expect(windIndicator(warn(-1, 0.5))).toMatchObject({ visible: true, state: 'warning', from: 'right' });
    expect(windIndicator(gust(1, 0.5))).toMatchObject({ state: 'gust', from: 'left' });
  });

  it('buckets the strength into three steps', () => {
    expect(strengthLevel(0.1)).toBe(1);
    expect(strengthLevel(0.39)).toBe(1);
    expect(strengthLevel(0.4)).toBe(2);
    expect(strengthLevel(0.74)).toBe(2);
    expect(strengthLevel(0.75)).toBe(3);
    expect(strengthLevel(1)).toBe(3);
    expect(strengthLevel(5)).toBe(3);
    expect(strengthLevel(NaN)).toBe(2); // unknown: assume a medium gust
  });

  it('returns the same object while nothing the HUD shows changes, so it can write the DOM only on change', () => {
    const a = windIndicator(warn(1, 0.5, 1.7));
    expect(windIndicator(warn(1, 0.55, 0.9))).toBe(a); // same state, side and bucket
    expect(windIndicator(warn(1, 0.9))).not.toBe(a); // bucket changed
    expect(windIndicator(gust(1, 0.5))).not.toBe(a); // state changed
    expect(windIndicator(warn(-1, 0.5))).not.toBe(a); // side changed
  });

  it('does not allocate: results are frozen shared objects', () => {
    expect(Object.isFrozen(windIndicator(gust(1, 1)))).toBe(true);
  });
});

describe('streak opacity curve', () => {
  it('is zero when calm and with no direction', () => {
    expect(streakOpacity(CALM)).toBe(0);
    expect(streakOpacity(undefined)).toBe(0);
    expect(streakOpacity({ state: 'warning', dir: 0, strength: 1, eta: 1 })).toBe(0);
  });

  it('rises through the warning and peaks in the gust', () => {
    const at = (eta) => streakOpacity(warn(1, 0.8, eta));
    expect(at(1.8)).toBeGreaterThan(0);
    expect(at(1.2)).toBeGreaterThan(at(1.8));
    expect(at(0.4)).toBeGreaterThan(at(1.2));
    expect(streakOpacity(gust(1, 0.8))).toBeGreaterThan(at(0));
  });

  it('scales with strength but never exceeds the maximum', () => {
    expect(streakOpacity(gust(1, 1))).toBeCloseTo(STREAK_MAX_OPACITY, 5);
    expect(streakOpacity(gust(1, 0.2))).toBeLessThan(streakOpacity(gust(1, 1)));
    expect(streakOpacity(gust(1, 0.2))).toBeGreaterThan(0);
    expect(streakOpacity(gust(-1, 99))).toBeLessThanOrEqual(STREAK_MAX_OPACITY);
  });

  it('is the same for both directions (the shader flips the drift)', () => {
    expect(streakOpacity(gust(1, 0.7))).toBe(streakOpacity(gust(-1, 0.7)));
  });

  it('streaks move faster as the gust builds', () => {
    expect(streakSpeed(CALM)).toBe(0);
    expect(streakSpeed(warn(1, 1, 1.8))).toBeLessThan(streakSpeed(warn(1, 1, 0.3)));
    expect(streakSpeed(warn(1, 1, 0.3))).toBeLessThan(streakSpeed(gust(1, 1)));
  });
});

describe('warning progress, ramp and sway', () => {
  it('runs 0 -> 1 across the warning window and clamps', () => {
    expect(warningProgress({ eta: WIND_WARNING_S })).toBe(0);
    expect(warningProgress({ eta: WIND_WARNING_S / 2 })).toBeCloseTo(0.5, 5);
    expect(warningProgress({ eta: 0 })).toBe(1);
    expect(warningProgress({ eta: -3 })).toBe(1);
    expect(warningProgress({ eta: 9 })).toBe(0);
    expect(warningProgress({})).toBe(0.5);
  });

  it('ramps up and is full in a gust', () => {
    expect(windRamp(CALM)).toBe(0);
    expect(windRamp(gust(1, 1))).toBe(1);
    expect(windRamp(warn(1, 1, 1.8))).toBeLessThan(windRamp(warn(1, 1, 0.1)));
    expect(windRamp(warn(1, 1, 0))).toBeLessThan(1);
  });

  it('sways toward the way the wind blows, with sign', () => {
    expect(windSway(gust(1, 1))).toBeCloseTo(1, 5);
    expect(windSway(gust(-1, 1))).toBeCloseTo(-1, 5);
    expect(windSway(gust(-1, 0.4))).toBeGreaterThan(-1);
    expect(windSway(gust(-1, 0.4))).toBeLessThan(0);
    expect(windSway(CALM)).toBe(0);
  });
});

describe('easeToward', () => {
  it('moves toward the target and never overshoots', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      v = easeToward(v, 1, 0.02, 5);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(v).toBeGreaterThan(0.99);
  });

  it('is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 10; i++) a = easeToward(a, 1, 0.01, 4);
    expect(a).toBeCloseTo(easeToward(0, 1, 0.1, 4), 6);
  });

  it('does not move with no time passing', () => {
    expect(easeToward(0.3, 1, 0, 5)).toBe(0.3);
  });
});

describe('gust trigger', () => {
  it('fires once at the start of the warning, not again through the gust', () => {
    const t = createGustTrigger();
    expect(t.update(CALM)).toBe(false);
    expect(t.update(warn(1, 0.6, 1.8))).toBe(true);
    expect(t.update(warn(1, 0.6, 1.0))).toBe(false);
    expect(t.update(warn(1, 0.6, 0.1))).toBe(false);
    expect(t.update(gust(1, 0.6))).toBe(false);
    expect(t.update(gust(1, 0.6))).toBe(false);
  });

  it('fires again for the next gust, once it has been calm', () => {
    const t = createGustTrigger();
    t.update(warn(1, 0.6));
    t.update(gust(1, 0.6));
    t.update(CALM);
    expect(t.update(warn(-1, 0.9))).toBe(true);
    expect(t.update(gust(-1, 0.9))).toBe(false);
  });

  it('does not fire for a gust that is already blowing', () => {
    const t = createGustTrigger();
    expect(t.update(gust(1, 0.5))).toBe(false);
    expect(t.update(gust(1, 0.5))).toBe(false);
  });

  it('fires only while most of the warning is left (the respawn rule)', () => {
    expect(GUST_WHOOSH_MIN_ETA).toBe(1.2);
    expect(createGustTrigger().update(warn(1, 0.6, 1.8))).toBe(true);
    expect(createGustTrigger().update(warn(1, 0.6, 1.25))).toBe(true);
    expect(createGustTrigger().update(warn(1, 0.6, 1.2))).toBe(false); // not above the threshold
    expect(createGustTrigger().update(warn(1, 0.6, 0.9))).toBe(false);
    expect(createGustTrigger().update(warn(1, 0.6, 0.05))).toBe(false);
  });

  it('a gust joined late stays silent through the rest of its warning, then fires for the next one', () => {
    // fall during a warning: the forecast goes calm; the respawn lands at eta 0.9 and the warning runs out
    const t = createGustTrigger();
    expect(t.update(warn(1, 0.6, 1.8))).toBe(true);
    expect(t.update(CALM)).toBe(false); // falling
    expect(t.update(warn(1, 0.6, 0.9))).toBe(false); // respawned part-way through
    expect(t.update(warn(1, 0.6, 0.5))).toBe(false);
    expect(t.update(gust(1, 0.6))).toBe(false);
    expect(t.update(CALM)).toBe(false);
    expect(t.update(warn(-1, 0.8, 1.8))).toBe(true);
  });

  it('a warning with no eta counts as a fresh one', () => {
    expect(createGustTrigger().update({ state: 'warning', dir: 1, strength: 0.5 })).toBe(true);
  });

  it('ignores a missing forecast, and reset lets the same gust fire again', () => {
    const t = createGustTrigger();
    expect(t.update(undefined)).toBe(false);
    expect(t.update(warn(1, 0.6))).toBe(true);
    t.reset();
    expect(t.update(warn(1, 0.6))).toBe(true);
  });
});
