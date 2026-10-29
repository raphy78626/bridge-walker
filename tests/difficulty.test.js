import { describe, it, expect } from 'vitest';
import { difficulty, MAX_WIND } from '../src/game/difficulty.js';
import { JUMP_FORWARD, JUMP_VY, GRAVITY_ACCEL } from '../src/game/balance.js';

const STAND_JUMP = JUMP_FORWARD * ((2 * JUMP_VY) / GRAVITY_ACCEL); // ~1.96 m

describe('difficulty', () => {
  it('returns every knob', () => {
    expect(Object.keys(difficulty(1)).sort()).toEqual(
      ['gapCount', 'gapLength', 'gustGapMax', 'gustGapMin', 'instability', 'maxWind', 'parTime'],
    );
  });

  it('level 1 is exactly the original game', () => {
    expect(difficulty(1)).toMatchObject({
      maxWind: 0.25,
      gustGapMin: 3,
      gustGapMax: 6,
      instability: 1,
      gapCount: 3,
      gapLength: 1.0,
      parTime: 32,
    });
  });

  it('ramps gusts from 3-6 s towards 2-3.5 s by level 6', () => {
    expect(difficulty(6)).toMatchObject({ gustGapMin: 2, gustGapMax: 3.5 });
    expect(difficulty(2).gustGapMin).toBeLessThan(3);
    expect(difficulty(2).gustGapMax).toBeLessThan(6);
  });

  it('is harder or equal on every axis as the level rises', () => {
    for (let level = 1; level < 30; level++) {
      const a = difficulty(level);
      const b = difficulty(level + 1);
      expect(b.maxWind).toBeGreaterThanOrEqual(a.maxWind);
      expect(b.gustGapMin).toBeLessThanOrEqual(a.gustGapMin);
      expect(b.gustGapMax).toBeLessThanOrEqual(a.gustGapMax);
      expect(b.instability).toBeGreaterThanOrEqual(a.instability);
      expect(b.gapCount).toBeGreaterThanOrEqual(a.gapCount);
      expect(b.gapLength).toBeGreaterThanOrEqual(a.gapLength);
      expect(b.parTime).toBeGreaterThanOrEqual(a.parTime);
    }
  });

  it('holds its caps', () => {
    for (const level of [9, 10, 20, 1000]) {
      const d = difficulty(level);
      expect(d.maxWind).toBe(MAX_WIND);
      expect(d.instability).toBe(1.4);
      expect(d.gapCount).toBe(7);
      expect(d.gapLength).toBe(1.25);
      expect(d.gustGapMin).toBe(2);
      expect(d.gustGapMax).toBe(3.5);
    }
    expect(MAX_WIND).toBe(1.2);
  });

  it('gusts get slightly stronger each level, 0.12 at a time', () => {
    expect(difficulty(2).maxWind).toBeCloseTo(0.37, 9);
    expect(difficulty(5).maxWind).toBeCloseTo(0.73, 9);
  });

  it('instability grows 7% a level up to 1.4', () => {
    expect(difficulty(2).instability).toBeCloseTo(1.07, 9);
    expect(difficulty(6).instability).toBeCloseTo(1.35, 9);
    expect(difficulty(7).instability).toBe(1.4);
  });

  it('gaps always leave a take-off window of at least 0.7 m', () => {
    for (let level = 1; level <= 50; level++) {
      expect(STAND_JUMP - difficulty(level).gapLength).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('par is about 1 s more for each extra gap, and walking alone cannot beat it', () => {
    expect(difficulty(2).parTime).toBe(33);
    expect(difficulty(5).parTime).toBe(36);
    for (let level = 1; level <= 12; level++) {
      expect(60 / 1.4).toBeGreaterThan(difficulty(level).parTime); // a 60 m walk takes ~43 s
    }
  });
});
