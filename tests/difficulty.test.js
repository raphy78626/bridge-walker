import { describe, it, expect } from 'vitest';
import { difficulty, MAX_WIND, MAX_PACE } from '../src/game/difficulty.js';
import { JUMP_FORWARD, JUMP_VY, GRAVITY_ACCEL, WALK_SPEED, RUN_SPEED, createWalker, stepWalker } from '../src/game/balance.js';
import { createSession, BRIDGE_LENGTH } from '../src/game/session.js';

const STAND_JUMP = JUMP_FORWARD * ((2 * JUMP_VY) / GRAVITY_ACCEL); // ~1.96 m

describe('difficulty', () => {
  it('returns every knob', () => {
    expect(Object.keys(difficulty(1)).sort()).toEqual(
      ['gapCount', 'gapLength', 'gustGapMax', 'gustGapMin', 'instability', 'maxWind', 'pace', 'parTime'],
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
      pace: 1,
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
      expect(b.pace).toBeGreaterThanOrEqual(a.pace);
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
      expect(d.pace).toBe(MAX_PACE);
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

  it('par is about 1 s more for each extra gap, less as he gets faster, and walking alone cannot beat it', () => {
    expect(difficulty(2).parTime).toBe(Math.round(33 / 1.05));
    expect(difficulty(5).parTime).toBe(Math.round(36 / 1.2));
    for (let level = 1; level <= 30; level++) {
      const d = difficulty(level);
      expect(BRIDGE_LENGTH / (WALK_SPEED * d.pace)).toBeGreaterThan(d.parTime + 3); // a walk at this level's pace
      expect(BRIDGE_LENGTH / (RUN_SPEED * d.pace)).toBeLessThan(d.parTime); // a clean run beats it
    }
  });

  it('walking and running get 5% faster each level, up to MAX_PACE', () => {
    expect(MAX_PACE).toBe(1.3);
    expect(difficulty(2).pace).toBeCloseTo(1.05, 9);
    expect(difficulty(4).pace).toBeCloseTo(1.15, 9);
    expect(difficulty(7).pace).toBe(1.3);
    expect(difficulty(8).pace).toBe(1.3);
  });

  it('pace scales the walk and the run in stepWalker; a standing jump still carries JUMP_FORWARD', () => {
    const step = (opts) => stepWalker(createWalker(), { tilt: 0, wind: 0, ground: true, ...opts }, 0.1);
    expect(step({ walking: true, pace: 1.2 }).z).toBeCloseTo(WALK_SPEED * 1.2 * 0.1, 9);
    expect(step({ running: true, pace: 1.2 }).z).toBeCloseTo(RUN_SPEED * 1.2 * 0.1, 9);
    expect(step({ walking: true }).z).toBeCloseTo(WALK_SPEED * 0.1, 9); // no pace: level 1
    expect(step({ jump: true, pace: 1.3 }).speed).toBe(JUMP_FORWARD);
  });

  it('a session walks at its level\'s pace', () => {
    const s = createSession({ seed: 3 });
    s.start({ level: 7 });
    s.gaps = [];
    s.walker = { ...s.walker, z: 0 };
    s.input.walking = true;
    for (let i = 0; i < 60; i++) { s.input.tilt = Math.max(-1, Math.min(1, -2 * s.walker.lean - 0.5 * s.walker.leanVel)); s.update(1 / 60); }
    expect(s.walker.z).toBeCloseTo(WALK_SPEED * difficulty(7).pace, 1);
  });
});
