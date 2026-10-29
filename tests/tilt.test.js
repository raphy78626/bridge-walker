import { describe, it, expect } from 'vitest';
import { createTiltReader, rawRoll } from '../src/phone/tilt.js';

// Gravity reading for a phone rotated `angle` radians in the screen plane.
const g = (angle) => [9.8 * Math.sin(angle), 9.8 * Math.cos(angle)];
function hold(reader, angle, frames = 50) {
  for (let i = 0; i < frames; i++) reader.feed(...g(angle));
  return reader.value;
}
function calibratedAt(neutral) {
  const r = createTiltReader();
  hold(r, neutral, 1);
  r.calibrateZero();
  return r;
}

describe('tilt reader', () => {
  it('measures screen-plane rotation from gravity', () => {
    expect(rawRoll(...g(0))).toBeCloseTo(0);
    expect(rawRoll(...g(0.3))).toBeCloseTo(0.3);
  });

  it('reads 0 at the calibrated neutral, however the phone is held', () => {
    expect(hold(calibratedAt(1.2), 1.2)).toBe(0);
  });

  it('is proportional to rotation away from neutral', () => {
    expect(hold(calibratedAt(1.2), 1.2 + 0.4)).toBeCloseTo(0.5, 2);
  });

  it('clamps to 1 past the max angle', () => {
    expect(hold(calibratedAt(1.2), 2.2)).toBeCloseTo(1, 3);
  });

  it('ignores tiny wobbles (deadzone)', () => {
    expect(hold(calibratedAt(1.2), 1.21)).toBe(0);
  });

  it('wraps cleanly across ±180°', () => {
    expect(hold(calibratedAt(Math.PI - 0.05), -Math.PI + 0.1)).toBeCloseTo(0.15 / 0.8, 2);
  });

  it('learns which way is right during calibration', () => {
    const r = calibratedAt(0);
    hold(r, -0.3); // this device reports a right tilt as negative
    expect(r.calibrateRight()).toBe(true);
    expect(r.sign).toBe(-1);
    expect(hold(r, -0.3)).toBeCloseTo(0.3 / 0.8, 2);
  });

  it('refuses to calibrate right from a tiny tilt', () => {
    const r = calibratedAt(0);
    hold(r, 0.05);
    expect(r.calibrateRight()).toBe(false);
    expect(r.sign).toBe(1);
  });
});
