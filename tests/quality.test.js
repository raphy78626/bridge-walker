import { describe, it, expect } from 'vitest';
import { nextQuality, MIN_SCALE, TV_QUALITY } from '../src/tv/quality.js';

const start = (over = {}) => ({ scale: 0.6, shadows: true, goodStreak: 0, ...over });
const opts = { maxScale: 1 };

describe('nextQuality', () => {
  it('steps the scale down 0.1 when under 40 fps', () => {
    expect(nextQuality(38, start(), opts)).toEqual({ scale: 0.5, shadows: true, goodStreak: 0 });
  });

  it('never goes below the floor and does not drift in floating point', () => {
    let s = start({ scale: 0.7 });
    for (let i = 0; i < 6; i++) s = nextQuality(38, s, opts);
    expect(s.scale).toBe(MIN_SCALE);
    expect(s.shadows).toBe(true); // 38 fps is not slow enough to lose shadows
  });

  it('drops shadows only at the floor and only under 35 fps', () => {
    expect(nextQuality(30, start({ scale: 0.5 }), opts).shadows).toBe(true); // lowers scale first
    expect(nextQuality(36, start({ scale: MIN_SCALE }), opts).shadows).toBe(true);
    expect(nextQuality(30, start({ scale: MIN_SCALE }), opts)).toEqual({ scale: MIN_SCALE, shadows: false, goodStreak: 0 });
  });

  it('does nothing further once at the floor with shadows off', () => {
    const s = start({ scale: MIN_SCALE, shadows: false });
    expect(nextQuality(20, s, opts)).toEqual(s);
  });

  it('needs two consecutive readings above 55 fps before improving', () => {
    const one = nextQuality(60, start(), opts);
    expect(one).toEqual({ scale: 0.6, shadows: true, goodStreak: 1 });
    expect(nextQuality(60, one, opts)).toEqual({ scale: 0.7, shadows: true, goodStreak: 0 });
  });

  it('a reading in the middle band resets the streak (hysteresis)', () => {
    const one = nextQuality(60, start(), opts);
    expect(nextQuality(50, one, opts).goodStreak).toBe(0);
    expect(nextQuality(45, one, opts).scale).toBe(0.6);
    // exactly 55 is not "above 55"
    expect(nextQuality(55, one, opts).goodStreak).toBe(0);
  });

  it('does not oscillate on a steady 45 fps', () => {
    let s = start();
    for (let i = 0; i < 20; i++) s = nextQuality(45, s, opts);
    expect(s).toEqual(start());
  });

  it('brings shadows back before resolution', () => {
    let s = start({ scale: MIN_SCALE, shadows: false });
    s = nextQuality(60, s, opts);
    s = nextQuality(60, s, opts);
    expect(s).toEqual({ scale: MIN_SCALE, shadows: true, goodStreak: 0 });
    s = nextQuality(60, s, opts);
    s = nextQuality(60, s, opts);
    expect(s.scale).toBeCloseTo(0.5, 5);
  });

  it('stops at maxScale', () => {
    let s = start({ scale: 0.9 });
    for (let i = 0; i < 10; i++) s = nextQuality(60, s, opts);
    expect(s.scale).toBe(1);
    expect(nextQuality(60, s, opts).scale).toBe(1);
    expect(nextQuality(60, start({ scale: 1.2 }), { maxScale: 1.25 }).goodStreak).toBe(1);
    let t = start({ scale: 1.2, goodStreak: 1 });
    t = nextQuality(60, t, { maxScale: 1.25 });
    expect(t.scale).toBe(1.25);
  });

  describe('TV_QUALITY (50 Hz panel, weak GPU)', () => {
    const tv = (fps, over) => nextQuality(fps, start({ scale: 0.75, ...over }), TV_QUALITY);

    it('never drops below 0.6, which stays sharp enough on a big screen', () => {
      let s = start({ scale: 0.75 });
      for (let i = 0; i < 6; i++) s = nextQuality(20, s, TV_QUALITY);
      expect(s.scale).toBe(0.6);
    });

    it('can win resolution back at 46-50 fps, the most a 50 Hz TV ever shows', () => {
      const once = tv(48, { shadows: false });
      expect(once.goodStreak).toBe(1);
      expect(nextQuality(48, once, TV_QUALITY).scale).toBe(0.85);
    });

    it('holds steady in the 38-46 fps band', () => {
      expect(tv(40)).toEqual({ scale: 0.75, shadows: false, goodStreak: 0 });
    });

    it('has shadows permanently off, so no reading can toggle them (that rebuilds shaders)', () => {
      expect(TV_QUALITY.shadows).toBe(false);
      // every fps from a stall to a 50 Hz panel's best, from every starting scale, with the flag on or off
      for (const shadows of [false, true]) {
        for (const scale of [0.6, 0.7, 0.8, 1]) {
          for (let fps = 5; fps <= 60; fps += 1) {
            for (const goodStreak of [0, 1, 2]) {
              const next = nextQuality(fps, { scale, shadows, goodStreak }, TV_QUALITY);
              expect(next.shadows).toBe(false);
            }
          }
        }
      }
    });

    it('a long run of readings never turns shadows on, and still adapts the scale', () => {
      let s = { scale: 0.7, shadows: false, goodStreak: 0 };
      const seen = new Set();
      for (let i = 0; i < 400; i++) {
        s = nextQuality([20, 36, 40, 44, 48, 50][i % 6], s, TV_QUALITY);
        expect(s.shadows).toBe(false);
        seen.add(s.scale);
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it('goes straight to resolution at 48 fps, with no shadow step first', () => {
      let s = { scale: 0.6, shadows: false, goodStreak: 0 };
      s = nextQuality(48, s, TV_QUALITY);
      s = nextQuality(48, s, TV_QUALITY);
      expect(s).toEqual({ scale: 0.7, shadows: false, goodStreak: 0 });
    });

    it('stops at full app resolution (1.0)', () => {
      expect(nextQuality(48, start({ scale: 1, goodStreak: 1 }), TV_QUALITY).scale).toBe(1);
    });
  });

  it('does not mutate its input', () => {
    const s = Object.freeze(start());
    expect(() => nextQuality(30, s, opts)).not.toThrow();
  });
});
